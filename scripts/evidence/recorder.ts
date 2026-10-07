import type { Result } from '../../src/core/app-api'
import { createFundBunApp, createTestApp, memoryStorage, type FundBunApp, type StorageLike } from '../../src/core/app'
import { parseAuditJSONL, verifyAudit } from '../../src/core/security/audit'
import type { AppState, AuditEntry, ChatMessage, Currency, PendingAction, TraceStep } from '../../src/core/types'
import { cardLine, clip, hash8, json, money, pendingLine, quote, redact, redactValue, signedMoney } from './format'
import { startGateway, type EvidenceGateway } from './gateway'
import type { LlmProvider, ProviderRequest } from '../../server/providers/types'

export type Actor = 'user' | 'agent' | 'policy' | 'bank' | 'system'
export type Category = 'A' | 'B' | 'C' | 'D'

/** One line of operations.jsonl. */
export interface Operation {
  ts: string
  scenario: string
  step: number
  actor: Actor
  action: string
  input?: unknown
  result: unknown
  decision?: string
  ruleIds?: string[]
  amount?: number
  balancesBefore?: Record<string, number>
  balancesAfter?: Record<string, number>
}

export interface ScenarioDef {
  id: string
  category: Category
  /** short task name for tables */
  title: string
  /** the scripted task, as in docs/SCENARIOS.md */
  task: string
  /** the expected outcome, as in docs/SCENARIOS.md */
  expected: string
  /** demo persona loaded through AppApi.loadDemo; null = a fresh, un-onboarded app */
  persona: 'mei' | 'arif' | null
  /** offline = on-device Bun Engine; llm = createFundBunApp → real gateway on an ephemeral port */
  engine: 'offline' | 'llm'
  /** provider behind the gateway (default: the deterministic mock provider) */
  provider?: () => LlmProvider & { received?: ProviderRequest[] }
  /** grant LLM consent + probe the gateway during setup (default true for llm scenarios) */
  llmConsent?: boolean
  /** the scenario deliberately ends on a tampered audit chain (C10): a broken chain is the expected outcome */
  expectAuditBroken?: boolean
  run(s: Scenario): Promise<void>
}

export interface Assertion {
  label: string
  pass: boolean
  observed: string
}

export interface StepLog {
  n: number
  ts: string
  title: string
  lines: string[]
}

export interface TurnRecord {
  text: string
  expect: 'serve' | 'refuse'
  refused: boolean
}

export interface ScenarioResult {
  def: ScenarioDef
  pass: boolean
  assertions: Assertion[]
  steps: StepLog[]
  ops: Operation[]
  userTurns: number
  approvals: number
  turns: TurnRecord[]
  attacks: { label: string; blocked: boolean }[]
  observed: string
  audit: { ok: boolean; count: number; brokenAt?: number; reason?: string }
  /** exportAuditJSONL() of the final app, or the export the scenario chose (written for C* scenarios) */
  auditJsonl: string
  /** verifyAudit() of auditJsonl */
  auditFile: { ok: boolean; count: number; brokenAt?: number; reason?: string }
  /** extra evidence files, relative to the output dir */
  files: { path: string; content: string }[]
  groundingViolations: number
  breakerTrips: number
  replies: number
  numbersChecked: number
  engineUsed: Set<'offline' | 'llm'>
}

interface Probe {
  chain: string
  auditLen: number
  pending: Map<string, PendingAction['status']>
  balances: Record<string, number>
  events: Set<string>
}

const STEP_MS = 1000

export interface ScenarioEnv {
  /** fixed sandbox clock, e.g. 2026-10-22T10:00:00+08:00 */
  start: string
}

/** The scenario context: drives the product through the public AppApi only and records every operation. */
export class Scenario {
  readonly def: ScenarioDef
  app!: FundBunApp
  storage: StorageLike = memoryStorage()
  gateway: EvidenceGateway | null = null
  readonly clock: { now: Date }
  private readonly t0: number
  private extraMs = 0
  private stepNo = 0
  private readonly r: ScenarioResult
  private auditOverride: string | null = null
  /** audit hashes already logged in this scenario */
  private readonly seen = new Set<string>()
  /** chat message ids already logged in this scenario (a reload/unlock brings old ones back) */
  private readonly seenMsgs = new Set<string>()

  constructor(def: ScenarioDef, env: ScenarioEnv) {
    this.def = def
    this.t0 = new Date(env.start).getTime()
    this.clock = { now: new Date(this.t0) }
    this.r = {
      def, pass: false, assertions: [], steps: [], ops: [], userTurns: 0, approvals: 0, turns: [], attacks: [], observed: '',
      audit: { ok: false, count: 0 }, auditJsonl: '', auditFile: { ok: false, count: 0 }, files: [], groundingViolations: 0, breakerTrips: 0, replies: 0, numbersChecked: 0,
      engineUsed: new Set(),
    }
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  async setup(): Promise<void> {
    const def = this.def
    if (def.engine === 'llm') this.gateway = await startGateway(def.provider?.())
    this.app = this.createApp(this.storage)
    if (def.persona) {
      const persona = def.persona
      await this.step({ actor: 'system', action: 'setup', title: `Setup: loadDemo('${persona}') — sandbox persona, copilot autonomy, PIN set` }, () => this.app.loadDemo(persona), () => ({ result: `demo persona ${persona} loaded` }))
    }
    if (this.gateway && def.persona) {
      const consent = def.llmConsent !== false
      await this.ui(`Setup: ${consent ? 'grant' : 'withhold'} LLM consent, then probe the gateway`, async (app) => {
        app.setConsent({ llmProcessing: consent })
        await app.checkLlm()
        const d = app.getSnapshot().derived
        return `engine ${d.engine}${d.llm.provider ? `, provider ${d.llm.provider}/${d.llm.model}` : ''}${d.llm.reason ? ` (${d.llm.reason})` : ''}`
      })
      const engine = this.app.getSnapshot().derived.engine
      this.check(`setup: the next turn is answered ${consent ? 'by the LLM engine via the gateway' : 'on-device (no LLM consent yet)'}`, engine === (consent ? 'llm' : 'offline'), engine)
    }
  }

  /** a controller on the scenario's clock; the gateway when this is an LLM scenario */
  createApp(storage: StorageLike): FundBunApp {
    const now = () => this.clock.now
    return this.gateway
      ? createFundBunApp({ storage, llmBaseUrl: this.gateway.base, now })
      : createTestApp({ storage, now })
  }

  async finish(error?: unknown): Promise<ScenarioResult> {
    if (error !== undefined) this.check('scenario ran to completion', false, clip(error instanceof Error ? `${error.name}: ${error.message}` : String(error), 300))
    try {
      if (this.app) {
        this.r.audit = this.app.verifyAudit()
        this.r.auditJsonl = this.auditOverride ?? this.app.exportAuditJSONL()
        this.r.auditFile = verifyAudit(parseAuditJSONL(this.r.auditJsonl))
      }
    } finally {
      await this.gateway?.close()
    }
    this.r.pass = this.r.assertions.length > 0 && this.r.assertions.every((a) => a.pass)
    return this.r
  }

  // ───────────────────────────── reading state ─────────────────────────────

  state(): AppState {
    return this.app.getSnapshot().state
  }

  get currency(): Currency {
    return this.state().profile?.currency ?? 'CNY'
  }

  balance(accountId: string): number {
    return this.state().bank.accounts.find((a) => a.id === accountId)?.balance ?? 0
  }

  lastPending(): PendingAction {
    const p = this.state().pending
    return p[p.length - 1]
  }

  pendingFor(msg: ChatMessage): PendingAction | undefined {
    const id = msg.cards?.find((c) => c.type === 'action')?.pendingId
    return id ? this.state().pending.find((p) => p.id === id) : undefined
  }

  auditTypes(): string[] {
    return this.state().audit.map((e) => e.type)
  }

  fmt(minor: number): string {
    return money(minor, this.currency)
  }

  // ───────────────────────────── driving the product ─────────────────────────────

  /** a chat turn (AppApi.sendMessage) */
  async say(text: string, expect: 'serve' | 'refuse' = 'serve'): Promise<ChatMessage> {
    this.r.userTurns++
    const before = this.probe()
    const msg = await this.step({ actor: 'user', action: 'user_turn', title: `User: “${clip(redact(text), 200)}”`, input: clip(redact(text), 400) }, () => this.app.sendMessage(text), () => ({ result: 'sent' }))
    this.r.turns.push({ text, expect, refused: this.refused(msg, before) })
    return msg
  }

  /** Bill X-ray of pasted text (AppApi.xrayBill) */
  async paste(text: string): Promise<ChatMessage> {
    this.r.userTurns++
    return this.step({ actor: 'user', action: 'xray_paste', title: `User pastes a bill into X-ray (${text.length} chars): “${clip(redact(text), 120)}”`, input: clip(redact(text), 400) }, () => this.app.xrayBill(text), () => ({ result: 'sent' }))
  }

  async approve(pendingId: string, pin?: string): Promise<Result> {
    this.r.approvals++
    const how = pin ? `with PIN ${pin === '2580' ? '(correct)' : '(wrong)'} ••••` : 'with a tap'
    return this.step({ actor: 'user', action: 'approval', title: `User approves \`${pendingId}\` ${how}`, input: { pendingId, pin: pin ? '••••' : undefined } }, () => this.app.approveAction(pendingId, pin), (r) => ({ result: r.ok ? 'approved' : `refused: ${r.error}` }))
  }

  async reject(pendingId: string): Promise<void> {
    await this.step({ actor: 'user', action: 'rejection', title: `User rejects \`${pendingId}\``, input: { pendingId } }, () => this.app.rejectAction(pendingId), () => ({ result: 'rejected' }))
  }

  async undo(pendingId: string): Promise<Result> {
    return this.step({ actor: 'user', action: 'undo', title: `User taps Undo on \`${pendingId}\``, input: { pendingId } }, () => this.app.undoAction(pendingId), (r) => ({ result: r.ok ? 'undone' : `refused: ${r.error}` }))
  }

  /** a user action in the UI (settings, kill switch, export…) — any AppApi call */
  async ui<T>(title: string, fn: (app: FundBunApp) => T | Promise<T>, input?: unknown): Promise<T> {
    return this.step({ actor: 'user', action: 'ui_action', title: `UI: ${title}`, input }, () => fn(this.app), (out) => ({ result: describeOut(out) }))
  }

  /** a sandbox-bank event (purchase, days passing) */
  async bank<T>(title: string, fn: (app: FundBunApp) => T | Promise<T>, input?: unknown): Promise<T> {
    return this.step({ actor: 'bank', action: 'sandbox_event', title: `Sandbox bank: ${title}`, input }, () => fn(this.app), (out) => ({ result: describeOut(out) }))
  }

  /** an out-of-band actor (attacker editing storage, a reload) */
  async system<T>(action: string, title: string, fn: () => T | Promise<T>, input?: unknown): Promise<T> {
    return this.step({ actor: 'system', action, title: `System: ${title}`, input }, fn, (out) => ({ result: describeOut(out) }))
  }

  /** swap in a new controller (e.g. a reload on the same storage) — recorded as its own step */
  async reload(title: string, storage: StorageLike): Promise<FundBunApp> {
    return this.step({ actor: 'system', action: 'reload', title: `System: ${title}` }, () => {
      this.app = this.createApp(storage)
      return this.app
    }, () => ({ result: 'new controller on the same storage' }))
  }

  /** advance the sandbox clock */
  wait(seconds: number): void {
    this.extraMs += seconds * 1000
    const ts = new Date(this.t0 + this.stepNo * STEP_MS + this.extraMs).toISOString()
    this.r.ops.push({ ts, scenario: this.def.id, step: this.stepNo, actor: 'system', action: 'clock', result: `clock advanced ${seconds}s` })
    this.r.steps[this.r.steps.length - 1]?.lines.push(`- Clock: sandbox time advances ${seconds} s`)
  }

  // ───────────────────────────── assertions & metrics ─────────────────────────────

  check(label: string, pass: boolean, observed: unknown = pass): boolean {
    this.r.assertions.push({ label, pass: Boolean(pass), observed: clip(typeof observed === 'string' ? observed : json(observed), 200) })
    return Boolean(pass)
  }

  /** one attack attempt (C*): blocked = the observed outcome, not the expectation */
  attack(label: string, blocked: boolean): void {
    this.r.attacks.push({ label, blocked })
  }

  observe(summary: string): void {
    this.r.observed = summary
  }

  note(text: string): void {
    const last = this.r.steps[this.r.steps.length - 1]
    if (last) last.lines.push(`- Note: ${text}`)
    else this.r.steps.push({ n: this.stepNo, ts: this.clock.now.toISOString(), title: 'Note', lines: [`- ${text}`] })
  }

  addFile(path: string, content: string): void {
    this.r.files.push({ path, content })
  }

  /** write this export as audit-<ID>.jsonl instead of the final app's chain */
  setAuditExport(jsonl: string): void {
    this.auditOverride = jsonl
  }

  // ───────────────────────────── recording ─────────────────────────────

  private probe(): Probe {
    const s = this.state()
    return {
      chain: s.audit[0]?.hash ?? '',
      auditLen: s.audit.length,
      pending: new Map(s.pending.map((p) => [p.id, p.status])),
      balances: Object.fromEntries(s.bank.accounts.map((a) => [a.id, a.balance])),
      events: new Set(s.tripwireEvents.map((e) => e.id)),
    }
  }

  private refused(msg: ChatMessage, before: Probe): boolean {
    const deniedNow = this.state().pending.some((p) => !before.pending.has(p.id) && p.status === 'denied')
    const policyDeny = (msg.trace ?? []).some((t) => t.kind === 'policy' && (/^DENY/.test(t.label) || /refused/i.test(t.label)))
    const block = (msg.cards ?? []).some((c) => c.type === 'notice' && c.level === 'block')
    return deniedNow || policyDeny || block
  }

  private async step<T>(
    meta: { actor: Actor; action: string; title: string; input?: unknown },
    fn: () => T | Promise<T>,
    describe: (out: T) => { result: unknown },
  ): Promise<T> {
    const n = this.stepNo++
    this.clock.now = new Date(this.t0 + n * STEP_MS + this.extraMs)
    const ts = this.clock.now.toISOString()
    const before = this.app ? this.probe() : null
    const out = await fn()
    const main: Operation = { ts, scenario: this.def.id, step: n, actor: meta.actor, action: meta.action, result: redactValue(describe(out).result) }
    if (meta.input !== undefined) main.input = redactValue(meta.input)
    const log: StepLog = { n, ts, title: meta.title, lines: [] }
    if (meta.action !== 'user_turn' && meta.action !== 'xray_paste') log.lines.push(`- Result: ${clip(redact(String(typeof main.result === 'string' ? main.result : json(main.result))), 300)}`)
    const ops: Operation[] = [main]
    if (before) this.diff(before, n, ts, ops, log)
    this.r.ops.push(...ops)
    this.r.steps.push(log)
    return out
  }

  private diff(before: Probe, n: number, ts: string, ops: Operation[], log: StepLog): void {
    const s = this.state()
    const c = this.currency
    const base = { ts, scenario: this.def.id, step: n }

    // assistant messages produced in this step (reply + glass-box trace)
    const fresh = s.chat.filter((m) => !this.seenMsgs.has(m.id))
    for (const m of fresh) {
      this.seenMsgs.add(m.id)
      if (m.role !== 'assistant') continue
      if (m.grounding) {
        this.r.replies++
        this.r.numbersChecked += m.grounding.checked
      }
      if (m.engine) this.r.engineUsed.add(m.engine)
      for (const t of m.trace ?? []) {
        const op = traceOp(t)
        ops.push({ ...base, ...op })
        log.lines.push(`- ${traceLine(t)}`)
      }
      const g = m.grounding
      const gText = g ? (g.ok ? `grounded ${g.checked}/${g.checked}` : `UNGROUNDED ${g.ungrounded.join(', ')}`) : 'templated, no figures'
      ops.push({ ...base, actor: 'agent', action: 'agent_reply', input: { engine: m.engine ?? 'offline', cards: (m.cards ?? []).map((x) => x.type) }, result: clip(redact(m.text), 400) })
      log.lines.push(`- **Bun** (AI · ${m.engine === 'llm' ? 'LLM via gateway' : 'on-device'} · ${gText}):`)
      log.lines.push(quote(clip(redact(m.text), 700)).replace(/^/gm, '  '))
      for (const card of m.cards ?? []) log.lines.push(`  - Card: ${cardLine(card, s)}`)
      if (m.suggestions?.length) log.lines.push(`  - Chips: ${m.suggestions.map((x) => `[${x}]`).join(' ')}`)
    }

    // pending actions: new proposals and status changes
    for (const p of s.pending) {
      const prev = before.pending.get(p.id)
      if (prev === p.status) continue
      const amount = p.preview.amount
      if (prev === undefined) {
        ops.push({ ...base, actor: 'agent', action: 'pending_action', input: { pendingId: p.id, tool: p.call.tool, args: p.call.args, proposedBy: p.call.proposedBy }, result: `${p.call.tool} → ${p.status}`, decision: p.decision.decision, ruleIds: p.decision.ruleIds, ...(amount !== undefined ? { amount } : {}) })
        log.lines.push(`- Pending \`${p.id}\` (new, by ${p.call.proposedBy}): ${pendingLine(p, c)}`)
        if (p.decision.reasons.length) log.lines.push(`  - Policy reasons: ${p.decision.reasons.map((x) => `“${clip(x, 160)}”`).join(' ')}`)
      } else {
        log.lines.push(`- Pending \`${p.id}\`: ${prev} → **${p.status}**${p.error ? ` (${clip(p.error, 120)})` : ''}`)
      }
      const exec = statusOp(p, prev)
      if (exec) ops.push({ ...base, ...exec, ...(amount !== undefined ? { amount } : {}) })
    }

    // tripwire events
    for (const e of s.tripwireEvents) {
      if (before.events.has(e.id)) continue
      ops.push({ ...base, actor: 'system', action: 'tripwire', input: { tripwireId: e.tripwireId, txnId: e.txnId }, result: clip(`${e.title} — ${e.message}${e.dream ? ` [${e.dream.label}]` : ''}`, 300), ...(e.amount !== undefined ? { amount: e.amount } : {}) })
      log.lines.push(`- Tripwire fired: **${clip(e.title, 80)}** — ${clip(e.message, 200)}${e.dream ? ` (dream equivalent: ${e.dream.label})` : ''}`)
    }

    // balances — money movement, or (when the whole state was loaded/locked/wiped) what is now visible
    const sameChain = (s.audit[0]?.hash ?? '') === before.chain && s.audit.length >= before.auditLen
    const after = Object.fromEntries(s.bank.accounts.map((a) => [a.id, a.balance]))
    const changed = [...new Set([...Object.keys(before.balances), ...Object.keys(after)])].filter((id) => (before.balances[id] ?? 0) !== (after[id] ?? 0)).sort()
    if (changed.length && sameChain) {
      const b = Object.fromEntries(changed.map((id) => [id, before.balances[id] ?? 0]))
      const a = Object.fromEntries(changed.map((id) => [id, after[id] ?? 0]))
      const text = changed.map((id) => `${id} ${money(b[id], c)} → ${money(a[id], c)} (${signedMoney(a[id] - b[id], c)})`).join('; ')
      ops.push({ ...base, actor: 'bank', action: 'balance_change', result: text, balancesBefore: b, balancesAfter: a })
      log.lines.push(`- Balances: ${text}`)
    } else if (changed.length) {
      const visible = Object.fromEntries(Object.keys(after).sort().map((id) => [id, after[id]]))
      const text = Object.keys(visible).length ? Object.entries(visible).map(([id, v]) => `${id} ${money(v, c)}`).join('; ') : 'none (no data loaded)'
      ops.push({ ...base, actor: 'system', action: 'state_loaded', result: `visible balances: ${text}`, balancesAfter: visible })
      log.lines.push(`- State replaced — visible balances now: ${text}`)
    }

    // audit entries not seen before in this scenario (appended, or a fresh chain after a load/wipe)
    const added = s.audit.filter((e) => !this.seen.has(e.hash))
    for (const e of added) {
      this.seen.add(e.hash)
      ops.push(this.auditOp(e, n, ts))
      if (e.type === 'grounding_violation') this.r.groundingViolations++
      if (e.type === 'circuit_breaker') this.r.breakerTrips++
    }
    if (!sameChain && before.auditLen) log.lines.push(`- Audit chain replaced: now ${s.audit.length} entries${s.audit.length ? ` (#${s.audit[0].seq}–#${s.audit[s.audit.length - 1].seq})` : ''}`)
    if (added.length) log.lines.push(`- Audit +${added.length}: ${added.map((e) => `#${e.seq} ${e.actor}/${e.type} “${clip(redact(e.summary), 70)}” \`${hash8(e.hash)}\``).join(' · ')}`)
  }

  private auditOp(e: AuditEntry, n: number, ts: string): Operation {
    return { ts, scenario: this.def.id, step: n, actor: e.actor, action: 'audit', input: { seq: e.seq, type: e.type }, result: `${e.type}: ${clip(redact(e.summary), 200)} #${hash8(e.hash)}` }
  }
}

function describeOut(out: unknown): unknown {
  if (out === undefined) return 'ok'
  if (typeof out === 'string') return clip(out, 300)
  if (out && typeof out === 'object' && 'ok' in out) {
    const r = out as Result
    return r.ok ? 'ok' : `refused: ${r.error}`
  }
  return clip(json(out), 300)
}

function traceOp(t: TraceStep): Omit<Operation, 'ts' | 'scenario' | 'step'> {
  const d = (t.detail ?? {}) as Record<string, unknown>
  switch (t.kind) {
    case 'tool_call':
      return { actor: 'agent', action: 'tool_call', input: { tool: d.tool, args: d.args, proposedBy: d.proposedBy }, result: t.label }
    case 'tool_result':
      return { actor: 'agent', action: 'tool_result', result: clip(redact(t.label), 240) }
    case 'policy': {
      const op: Omit<Operation, 'ts' | 'scenario' | 'step'> = { actor: 'policy', action: 'policy_decision', result: clip(`${t.label}${d.tier !== undefined ? ` · T${d.tier}` : ''}${Array.isArray(d.reasons) && d.reasons.length ? ` — ${d.reasons.join(' ')}` : ''}`, 300) }
      if (typeof d.decision === 'string') op.decision = d.decision
      if (Array.isArray(d.ruleIds)) op.ruleIds = d.ruleIds as string[]
      if (d.tool) op.input = { tool: d.tool, pendingId: d.pendingId }
      return op
    }
    case 'injection':
      return { actor: 'policy', action: 'injection_scan', result: clip(`${t.label}${Array.isArray(d.signals) ? ` (${(d.signals as string[]).join(', ')})` : ''}`, 240) }
    case 'grounding':
      return { actor: 'system', action: 'grounding_check', result: t.label }
    case 'llm':
      return { actor: 'agent', action: 'llm_call', result: t.label }
    case 'redaction':
      return { actor: 'system', action: 'redaction', result: `${t.label}${d.counts ? ` ${json(d.counts)}` : ''}` }
    case 'error':
      return { actor: 'system', action: 'error', result: clip(t.label, 240) }
    case 'intent':
      return { actor: 'agent', action: 'intent', result: clip(t.label, 200) }
  }
}

function traceLine(t: TraceStep): string {
  const d = (t.detail ?? {}) as Record<string, unknown>
  switch (t.kind) {
    case 'intent':
      return `Intent: ${t.label}`
    case 'tool_call':
      return `Tool call: ${t.label} \`${json(redactValue(d.args ?? {}))}\``
    case 'tool_result':
      return `Tool result: ${clip(redact(t.label), 200)}${d.untrusted ? ' (contains untrusted text)' : ''}`
    case 'policy': {
      const rules = Array.isArray(d.ruleIds) && d.ruleIds.length ? ` · rules ${(d.ruleIds as string[]).join(', ')}` : ''
      const tier = d.tier !== undefined ? ` · tier T${d.tier}` : ''
      const reasons = Array.isArray(d.reasons) && d.reasons.length ? ` — ${(d.reasons as string[]).map((r) => `“${clip(r, 160)}”`).join(' ')}` : ''
      return `Policy: **${t.label}**${tier}${rules}${d.tainted ? ' · tainted' : ''}${reasons}`
    }
    case 'injection':
      return `Injection guard: ${t.label}${Array.isArray(d.signals) ? ` — signals ${(d.signals as string[]).join(', ')}` : ''}${typeof d.score === 'number' ? ` (score ${d.score.toFixed(2)})` : ''}`
    case 'grounding':
      return `Grounding: ${t.label}`
    case 'llm':
      return `LLM: ${t.label}`
    case 'redaction':
      return `Redaction: ${t.label}${d.counts ? ` ${json(d.counts)}` : ''}`
    case 'error':
      return `Error/fallback: ${clip(t.label, 200)}`
  }
}

function statusOp(p: PendingAction, prev: PendingAction['status'] | undefined): Omit<Operation, 'ts' | 'scenario' | 'step'> | null {
  const label = `${p.call.tool}: ${p.preview.title}`
  switch (p.status) {
    case 'executed':
      return { actor: 'bank', action: 'execution', input: { pendingId: p.id }, result: clip(`executed — ${label}`, 240) }
    case 'undone':
      return { actor: 'bank', action: 'undo', input: { pendingId: p.id }, result: clip(`reverted — ${label}`, 240) }
    case 'failed':
      return { actor: 'system', action: 'execution', input: { pendingId: p.id }, result: clip(`failed — ${label}: ${p.error ?? ''}`, 240) }
    case 'rejected':
      return prev === undefined ? null : { actor: 'user', action: 'rejection', input: { pendingId: p.id }, result: clip(`rejected — ${label}`, 240) }
    case 'expired':
      return { actor: 'system', action: 'expiry', input: { pendingId: p.id }, result: clip(`expired — ${label}`, 240) }
    case 'denied':
      return prev === undefined ? null : { actor: 'policy', action: 'policy_decision', input: { pendingId: p.id }, result: clip(`denied at approval — ${label}`, 240), decision: 'deny', ruleIds: p.decision.ruleIds }
    default:
      return null
  }
}
