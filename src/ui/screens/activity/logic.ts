/**
 * Pure view logic for the audit timeline (Activity screen + the glass box's audit tail): filters, actor and
 * type labels, day grouping and hash chips. Unit-tested in logic.test.ts.
 */
import { dateLabel, diffDays, parseDate } from '../../../core/dates'
import type { AuditActor, AuditEntry, AuditType, ISODate } from '../../../core/types'
import type { BadgeVariant } from '../../components/ds'
import { onSandboxCalendar } from '../../state/clock'

export type ActivityFilter = 'all' | 'agent' | 'blocked' | 'security' | 'tripwires' | 'you'

export const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'agent', label: 'Agent actions' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'security', label: 'Security' },
  { id: 'tripwires', label: 'Tripwires' },
  { id: 'you', label: 'You' },
]

const AGENT_TYPES: ReadonlySet<AuditType> = new Set([
  'tool_call', 'action_confirmed', 'action_rejected', 'action_executed', 'action_failed', 'action_undone', 'action_denied',
])
const SECURITY_TYPES: ReadonlySet<AuditType> = new Set([
  'injection_detected', 'circuit_breaker', 'kill_switch', 'mandate_changed', 'step_up_failed', 'grounding_violation',
  'sensitive_request_refused', 'consent', 'data_export', 'data_wiped', 'llm_request',
])

/** A blocked attempt: a deny decision, a denied action, a refused request, a failed PIN or a breaker trip. */
export function isBlocked(e: AuditEntry): boolean {
  if (e.type === 'action_denied' || e.type === 'sensitive_request_refused' || e.type === 'step_up_failed' || e.type === 'circuit_breaker') return true
  return e.type === 'policy_decision' && e.data?.decision === 'deny'
}

export function matchesFilter(e: AuditEntry, f: ActivityFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'agent':
      return e.actor === 'agent' || (AGENT_TYPES.has(e.type) && e.actor !== 'user')
    case 'blocked':
      return isBlocked(e)
    case 'security':
      return SECURITY_TYPES.has(e.type) || isBlocked(e)
    case 'tripwires':
      return e.type === 'tripwire_fired' || typeof e.data?.tripwireId === 'string'
    case 'you':
      return e.actor === 'user'
  }
}

export function filterCounts(entries: readonly AuditEntry[]): Record<ActivityFilter, number> {
  const out = { all: 0, agent: 0, blocked: 0, security: 0, tripwires: 0, you: 0 } as Record<ActivityFilter, number>
  for (const e of entries) for (const f of FILTERS) if (matchesFilter(e, f.id)) out[f.id]++
  return out
}

export const ACTOR_LABEL: Record<AuditActor, string> = {
  user: 'You',
  agent: 'Bun (AI agent)',
  system: 'FundBun',
  bank: 'Sandbox bank',
  policy: 'Policy engine',
}

const TYPE_LABEL: Record<AuditType, string> = {
  session_start: 'Session',
  onboarding: 'Onboarding',
  consent: 'Consent',
  tool_call: 'Tool call',
  policy_decision: 'Policy',
  action_confirmed: 'Approved',
  action_rejected: 'Rejected',
  action_executed: 'Executed',
  action_failed: 'Failed',
  action_undone: 'Undone',
  action_denied: 'Blocked',
  step_up_failed: 'PIN failed',
  tripwire_fired: 'Tripwire',
  mandate_changed: 'Permissions',
  kill_switch: 'Kill switch',
  injection_detected: 'Injection',
  grounding_violation: 'Grounding',
  llm_request: 'LLM request',
  llm_response: 'LLM reply',
  data_import: 'Import',
  data_export: 'Export',
  data_wiped: 'Wiped',
  sandbox_event: 'Sandbox',
  user_action: 'Change',
  circuit_breaker: 'Breaker',
  sensitive_request_refused: 'Refused',
}

export function typeLabel(e: Pick<AuditEntry, 'type' | 'data'>): string {
  if (e.type === 'policy_decision') {
    const d = e.data?.decision
    if (d === 'deny') return 'Denied'
    if (d === 'step_up') return 'Needs PIN'
    if (d === 'confirm') return 'Needs tap'
    if (d === 'allow') return 'Allowed'
  }
  return TYPE_LABEL[e.type] ?? e.type
}

/** Badge colour for an entry: red for blocks and alarms, green for completed/safe, gold for agent work. */
export function typeVariant(e: Pick<AuditEntry, 'type' | 'data'>): BadgeVariant {
  if (isBlocked(e as AuditEntry) || e.type === 'injection_detected' || e.type === 'grounding_violation' || e.type === 'action_failed') return 'over'
  if (e.type === 'kill_switch') return e.data?.frozen === false ? 'under' : 'warn'
  if (e.type === 'tripwire_fired') return 'warn'
  if (e.type === 'policy_decision') return e.data?.decision === 'allow' ? 'under' : 'warn'
  if (e.type === 'action_executed' || e.type === 'action_confirmed' || e.type === 'action_undone') return 'under'
  if (e.type === 'tool_call' || e.type === 'llm_request' || e.type === 'llm_response') return 'ai'
  if (e.type === 'mandate_changed' || e.type === 'consent' || e.type === 'data_export' || e.type === 'data_wiped') return 'info'
  return 'neutral'
}

/** "3f9a…c21b" — enough to compare links in the chain by eye. */
export function shortHash(hash: string | undefined, head = 4, tail = 4): string {
  if (!hash) return '—'
  if (hash.length <= head + tail + 1) return hash
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * "Today" / "Yesterday" / "Wed 7 Oct" for a timestamp, relative to `now`. With `sandboxToday`, days are placed on
 * the sandbox calendar (the device's today = the sandbox's today) and labelled with that date: "Today · Oct 22",
 * "Yesterday · Oct 21", "Tue · Oct 20" — so the log never contradicts the bank's clock.
 */
export function dayLabel(ts: string, now: Date = new Date(), sandboxToday?: ISODate): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  if (sandboxToday) {
    const day = onSandboxCalendar(d, sandboxToday, now)
    if (!day) return 'Unknown date'
    const back = diffDays(day, sandboxToday)
    const lead = back === 0 ? 'Today' : back === 1 ? 'Yesterday' : parseDate(day).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    const year = day.slice(0, 4) === sandboxToday.slice(0, 4) ? '' : `, ${day.slice(0, 4)}`
    return `${lead} · ${dateLabel(day)}${year}`
  }
  const key = localDayKey(d)
  if (key === localDayKey(now)) return 'Today'
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (key === localDayKey(y)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function timeLabel(ts: string, seconds = false): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined })
}

export interface DayGroup {
  key: string
  label: string
  entries: AuditEntry[]
}

/** Newest first, grouped by calendar day (the sandbox calendar when `sandboxToday` is given). */
export function groupByDay(entries: readonly AuditEntry[], now: Date = new Date(), sandboxToday?: ISODate): DayGroup[] {
  const sorted = [...entries].sort((a, b) => b.seq - a.seq)
  const groups: DayGroup[] = []
  for (const e of sorted) {
    const d = new Date(e.ts)
    const key = Number.isNaN(d.getTime()) ? 'unknown' : sandboxToday ? (onSandboxCalendar(d, sandboxToday, now) ?? 'unknown') : localDayKey(d)
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(e.ts, now, sandboxToday), entries: [] }
      groups.push(g)
    }
    g.entries.push(e)
  }
  return groups
}

/** "1 action" / "3 actions" — the unit after a count. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many
}

/** Pretty JSON for the details panel; never throws on odd data. */
export function prettyData(data: unknown): string {
  try {
    const s = JSON.stringify(data ?? {}, null, 2)
    return s ?? '{}'
  } catch {
    return String(data)
  }
}

export interface ActivityStats {
  agentActions: number
  blocked: number
  approvals: number
}

/** The three numbers above the timeline. */
export function activityStats(entries: readonly AuditEntry[]): ActivityStats {
  let agentActions = 0
  let blocked = 0
  let approvals = 0
  for (const e of entries) {
    if (e.type === 'action_executed' && e.actor !== 'user') agentActions++
    if (e.type === 'action_denied' || e.type === 'sensitive_request_refused') blocked++
    if (e.type === 'action_confirmed') approvals++
  }
  return { agentActions, blocked, approvals }
}

/** The first `n` hex characters of a hash ("3f9a"), for dense chips. */
export function hashHead(hash: string | undefined, n = 4): string {
  return hash ? hash.slice(0, Math.max(1, n)) : '—'
}

/** The newest `n` entries, oldest first (for drawing the end of the chain left → right). */
export function chainTail(entries: readonly AuditEntry[], n = 5): AuditEntry[] {
  if (n <= 0) return []
  return [...entries].sort((a, b) => a.seq - b.seq).slice(-n)
}

export interface ChainCheck {
  ok: boolean
  count: number
  brokenAt?: number
  reason?: string
}

/** Banner copy for a verification result. */
export function chainHeadline(check: ChainCheck, headHash?: string): { title: string; detail: string } {
  if (!check.ok) {
    return {
      title: check.brokenAt !== undefined ? `Chain broken at #${check.brokenAt}` : 'Chain check failed',
      detail: check.reason ?? 'An entry no longer matches its hash, so the log may have been changed.',
    }
  }
  const n = check.count
  return {
    title: 'Chain intact',
    detail: `${n.toLocaleString('en-US')} entr${n === 1 ? 'y' : 'ies'}${headHash ? ` · head ${shortHash(headHash)}` : ''}`,
  }
}

/** Show the newest `limit` entries; the rest load on demand. */
export const PAGE_SIZE = 60
