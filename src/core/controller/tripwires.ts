import type { Result, TripwireInput } from '../app-api'
import { CATEGORIES } from '../categories'
import { ym } from '../dates'
import { describeTripwire, evaluateTripwires, tripwireEventMonth } from '../finance'
import { uid } from '../ids'
import { fmt } from '../money'
import type { AppState, Currency, ISODateTime, Transaction, Tripwire, TripwireEvent, TripwireKind } from '../types'
import { appendAudit } from './audit'
import { MAX_TRIPWIRE_EVENTS } from './constants'
import { ctxOf } from './state'
import { OK, fail, isPosInt, safely } from './util'

const KINDS: readonly TripwireKind[] = ['month_pct', 'category_pct', 'single_over', 'daily_over', 'pace_over']
const PCT_KINDS: readonly TripwireKind[] = ['month_pct', 'category_pct', 'pace_over']

/** Returns an error message, or null when the input is a valid tripwire. */
export function tripwireInputError(input: Partial<TripwireInput>): string | null {
  if (!input.kind || !KINDS.includes(input.kind)) return `Unknown tripwire kind "${String(input.kind)}"`
  if (!isPosInt(input.threshold)) return 'Tripwire threshold must be a positive whole number'
  if (PCT_KINDS.includes(input.kind) && input.threshold > 1000) return 'Percentage thresholds must be 1–1000'
  if (input.kind === 'category_pct' && !input.category) return 'Choose a category for a category tripwire'
  if (input.category && !(input.category in CATEGORIES)) return `Unknown category "${input.category}"`
  return null
}

function fallbackLabel(t: Tripwire, currency: Currency): string {
  switch (t.kind) {
    case 'month_pct': return `Alert me at ${t.threshold}% of my monthly target`
    case 'category_pct': return `Alert me at ${t.threshold}% of my ${t.category ?? 'category'} budget`
    case 'single_over': return `Alert me on any purchase over ${fmt(t.threshold, currency)}`
    case 'daily_over': return `Alert me when a day's spending passes ${fmt(t.threshold, currency)}`
    case 'pace_over': return `Alert me when I'm on pace for ${t.threshold}% of my target`
  }
}

export function labelTripwire(t: Tripwire, currency: Currency): string {
  return safely('describeTripwire', () => describeTripwire(t, currency), fallbackLabel(t, currency))
}

export function buildTripwire(input: TripwireInput, currency: Currency, createdBy: Tripwire['createdBy']): Tripwire {
  const t: Tripwire = {
    id: uid('tw'),
    kind: input.kind,
    threshold: input.threshold,
    enabled: input.enabled ?? true,
    createdBy,
    label: '',
  }
  if (input.category) t.category = input.category
  t.label = labelTripwire(t, currency)
  return t
}

export function currencyOf(state: AppState): Currency {
  return state.profile?.currency ?? 'CNY'
}

export function addTripwireTo(draft: AppState, input: TripwireInput, ts: ISODateTime): Tripwire {
  const err = tripwireInputError(input)
  if (err) throw new Error(err)
  const t = buildTripwire(input, currencyOf(draft), 'user')
  draft.tripwires.push(t)
  appendAudit(draft, ts, 'user', 'user_action', `Tripwire added: ${t.label}`, { tripwireId: t.id, kind: t.kind, threshold: t.threshold })
  return t
}

export function updateTripwireIn(draft: AppState, id: string, patch: Partial<TripwireInput>, ts: ISODateTime): Result {
  const t = draft.tripwires.find((x) => x.id === id)
  if (!t) return fail('Tripwire not found')
  const next = { kind: t.kind, threshold: t.threshold, category: t.category, enabled: t.enabled, ...patch }
  const err = tripwireInputError(next)
  if (err) return fail(err)
  Object.assign(t, { kind: next.kind, threshold: next.threshold, enabled: next.enabled ?? true })
  if (next.category) t.category = next.category
  else delete t.category
  t.label = labelTripwire(t, currencyOf(draft))
  appendAudit(draft, ts, 'user', 'user_action', `Tripwire updated: ${t.label}`, { tripwireId: id, fields: Object.keys(patch) })
  return OK
}

export function removeTripwireFrom(draft: AppState, id: string, ts: ISODateTime): Result {
  const t = draft.tripwires.find((x) => x.id === id)
  if (!t) return fail('Tripwire not found')
  draft.tripwires = draft.tripwires.filter((x) => x.id !== id)
  appendAudit(draft, ts, 'user', 'user_action', `Tripwire removed: ${t.label}`, { tripwireId: id })
  return OK
}

export function markSeen(draft: AppState, ids?: string[]): void {
  const only = ids ? new Set(ids) : null
  for (const e of draft.tripwireEvents) if (!only || only.has(e.id)) e.seen = true
}

/**
 * Evaluate tripwires after new transactions (inside a mutation): stores updated tripwires + new events and
 * audits one 'tripwire_fired' per event. A finance failure yields no events rather than a failed mutation.
 */
export function applyTripwires(draft: AppState, txns: Transaction[], now: ISODateTime): TripwireEvent[] {
  const ctx = ctxOf(draft)
  if (!ctx) return []
  const known = new Set(draft.tripwireEvents.map((e) => e.id))
  const out = safely('evaluateTripwires', () => evaluateTripwires(ctx, { newTxns: txns, now, firedIds: known }), null)
  if (!out) return []
  draft.tripwires = out.tripwires
  // one event per id, ever: the log is keyed by it (React keys, markEventsSeen)
  const events = out.events.filter((e) => !known.has(e.id) && !!known.add(e.id))
  if (!events.length) return []
  draft.tripwireEvents = [...draft.tripwireEvents, ...events].slice(-MAX_TRIPWIRE_EVENTS)
  for (const ev of events) {
    appendAudit(draft, now, 'system', 'tripwire_fired', ev.title, {
      tripwireId: ev.tripwireId,
      eventId: ev.id,
      txnId: ev.txnId,
      amount: ev.amount,
      dream: ev.dream?.label,
    })
  }
  return events
}

/**
 * After the calendar moves into a new month: a finished month's unseen pace alert ("at this pace you'll end the month
 * around ¥15,230") is an obsolete forecast, so it is marked seen. Month-level facts (month_pct, category_pct) stay —
 * they carry `month`, so screens can say which month they are about. Returns the ids retired.
 */
export function retireStaleEvents(draft: AppState): string[] {
  const month = ym(draft.bank.today)
  const kindOf = new Map(draft.tripwires.map((t) => [t.id, t.kind]))
  const retired: string[] = []
  for (const e of draft.tripwireEvents) {
    if (e.seen || kindOf.get(e.tripwireId) !== 'pace_over') continue
    const about = tripwireEventMonth(e)
    if (about && about < month) {
      e.seen = true
      retired.push(e.id)
    }
  }
  return retired
}
