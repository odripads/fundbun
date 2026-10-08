import { uid } from '../ids'
import { computeBindingHash, signApproval, verifyApproval, verifyBindingHash } from '../security/binding'
import { scanForInjection } from '../security/injection'
import { checkPin } from '../security/pin'
import {
  callAmount,
  evaluatePolicy,
  shouldTripBreaker,
  utcOffsetMinutesAt,
  type AgentActionRecord,
  type PolicyContext,
} from '../security/policy'
import type {
  AppState,
  AuditActor,
  Decision,
  PendingAction,
  PendingStatus,
  PlanStepStatus,
  PolicyDecision,
  RecurringSeries,
  TaskPlan,
  ToolCall,
  ToolName,
} from '../types'
import type { AgentHost, ToolOutcome } from './host'
import { buildPreview } from './previews'
import { TOOL_SPECS, isToolName } from './specs'
import { PENDING_TTL_MIN, addMinutes, addSeconds, errorText, isAfter, maskArgs, summarizeArgs } from './support'
import { applyUndo, runTool, type ToolRun, type UndoRecord } from './tools'
import { addCard, addNotice, addSource, taint, trace, type Turn } from './turn'

/**
 * The policy gate. Every tool call — offline planner, LLM, plan step or UI button — goes through runGated():
 * validate + evaluatePolicy against the current state → allow (execute now) / confirm · step_up (PendingAction
 * bound by hash) / deny (recorded for breaker, rate limit and audit). Approval, rejection, undo and expiry of
 * PendingActions live here too. The LLM never decides any of it.
 */

export interface GateOptions {
  /** the call belongs to a task-plan step */
  planStep?: { planId: string; stepId: string }
  /** attach the tool's result cards to the turn (default true) */
  cards?: boolean
}

export type GateStatus = 'done' | 'pending' | 'denied' | 'failed'

export interface GateResult {
  call: ToolCall
  decision: PolicyDecision
  status: GateStatus
  outcome?: ToolOutcome
  pending?: PendingAction
  reason?: string
}

/** Stored in PendingAction.result once executed. */
export interface ActionResult {
  summary: string
  data?: unknown
  txnIds?: string[]
  undo?: UndoRecord
}

const AGENT_PROPOSERS = new Set<ToolCall['proposedBy']>(['llm', 'offline'])

// ───────────────────────────── policy context ─────────────────────────────

export function agentRecords(state: AppState, excludeId?: string): (AgentActionRecord & { tainted: boolean; decision: Decision })[] {
  return state.pending
    .filter((p) => p.id !== excludeId && AGENT_PROPOSERS.has(p.call.proposedBy))
    .map((p) => ({
      ts: p.executedAt ?? p.createdAt,
      tool: p.call.tool as ToolName,
      amount: p.preview.amount ?? callAmount(p.call, state.bank),
      status: p.status,
      tainted: p.decision.tainted,
      decision: p.decision.decision,
    }))
}

function recurringIds(host: AgentHost): string[] {
  try {
    return host.recurring().map((r) => r.id)
  } catch {
    return []
  }
}

function safeRecurring(host: AgentHost): RecurringSeries[] {
  try {
    return host.recurring()
  } catch {
    return []
  }
}


export function policyContext(host: AgentHost, state: AppState, tainted: boolean, excludeId?: string): PolicyContext {
  const now = host.now()
  return {
    mandate: state.mandate,
    bank: state.bank,
    dreams: state.dreams,
    tainted,
    consentFinancial: state.profile?.consent.financialData === true,
    now,
    recentAgentActions: agentRecords(state, excludeId),
    knownRecurringIds: recurringIds(host),
    utcOffsetMinutes: utcOffsetMinutesAt(now),
  }
}

/** The LLM may only ever call tools that are exposed to it — anything else is denied outright. */
function llmGuard(call: ToolCall, decision: PolicyDecision): PolicyDecision {
  if (call.proposedBy !== 'llm') return decision
  if (isToolName(call.tool) && TOOL_SPECS[call.tool].exposedToLLM) return decision
  const extra = decision.decision === 'deny' ? decision : null
  return {
    decision: 'deny',
    tier: decision.tier,
    reasons: [`The AI model asked for an action it is never offered (${TOOL_SPECS[call.tool as ToolName]?.label ?? 'unknown action'}), so FundBun blocked it.`, ...(extra?.reasons ?? [])],
    ruleIds: ['P-LLM-NOT-EXPOSED', ...(extra?.ruleIds ?? [])],
    tainted: decision.tainted,
  }
}

/** The stricter of two decisions (approval re-checks against the state at approval time). */
function stricter(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  const rank: Record<Decision, number> = { allow: 0, confirm: 1, step_up: 2, deny: 3 }
  return rank[b.decision] >= rank[a.decision] ? b : { ...b, decision: a.decision }
}

// ───────────────────────────── audit helpers ─────────────────────────────

function actorFor(call: ToolCall): AuditActor {
  return call.proposedBy === 'user' ? 'user' : call.proposedBy === 'system' ? 'system' : 'agent'
}

function auditCall(host: AgentHost, call: ToolCall): void {
  host.audit(actorFor(call), 'tool_call', `${call.proposedBy} proposed ${call.tool}`, {
    callId: call.id, tool: call.tool, proposedBy: call.proposedBy, turnId: call.turnId, args: summarizeArgs(call.args),
  })
}

function auditDecision(host: AgentHost, call: ToolCall, d: PolicyDecision, pendingId?: string): void {
  host.audit('policy', 'policy_decision', `${d.decision.toUpperCase()} ${call.tool} (${d.ruleIds.join(', ')})`, {
    callId: call.id, tool: call.tool, decision: d.decision, tier: d.tier, ruleIds: d.ruleIds, tainted: d.tainted, pendingId,
  })
}

function traceDecision(turn: Turn, call: ToolCall, d: PolicyDecision, pendingId?: string): void {
  trace(turn, 'policy', `${d.decision.toUpperCase()} · ${call.tool}`, { tool: call.tool, decision: d.decision, tier: d.tier, ruleIds: d.ruleIds, reasons: d.reasons, tainted: d.tainted, pendingId })
}

// ───────────────────────────── the gate ─────────────────────────────

export function newCall(tool: string, args: Record<string, unknown>, proposedBy: ToolCall['proposedBy'], turn?: Turn, rationale?: string): ToolCall {
  const call: ToolCall = { id: uid('call'), tool, args, proposedBy }
  if (turn) call.turnId = turn.id
  if (rationale) call.rationale = rationale.slice(0, 300)
  return call
}

export function runGated(host: AgentHost, turn: Turn, call: ToolCall, opts: GateOptions = {}): GateResult {
  const state = host.state()
  const decision = llmGuard(call, evaluatePolicy(call, policyContext(host, state, turn.tainted)))
  trace(turn, 'tool_call', `${call.proposedBy} → ${call.tool}`, { callId: call.id, tool: call.tool, args: summarizeArgs(call.args), proposedBy: call.proposedBy })
  const tier = isToolName(call.tool) ? TOOL_SPECS[call.tool].tier : 4
  return tier === 0 ? runRead(host, turn, call, decision, opts) : runAction(host, turn, call, decision, opts)
}

function runRead(host: AgentHost, turn: Turn, call: ToolCall, decision: PolicyDecision, opts: GateOptions): GateResult {
  host.mutate(() => {
    auditCall(host, call)
    auditDecision(host, call, decision)
  })
  traceDecision(turn, call, decision)
  if (decision.decision === 'deny') {
    addNotice(turn, 'block', 'I can’t read that right now', decision.reasons[0] ?? 'Blocked by policy')
    addSource(turn, decision.reasons)
    if (opts.planStep) updateStep(host, opts.planStep, 'blocked', decision.reasons[0])
    return { call, decision, status: 'denied', reason: decision.reasons[0] }
  }
  const run = runTool(call, host)
  absorbRun(host, turn, call, run, opts)
  if (opts.planStep) updateStep(host, opts.planStep, run.outcome.ok ? 'done' : 'failed', run.outcome.summary)
  return { call, decision, status: run.outcome.ok ? 'done' : 'failed', outcome: run.outcome, reason: run.outcome.error }
}

function pendingFor(host: AgentHost, state: AppState, call: ToolCall, decision: PolicyDecision): PendingAction {
  const stored: ToolCall = isToolName(call.tool) && TOOL_SPECS[call.tool].tier < 4 ? call : { ...call, args: maskArgs(call.args) }
  const preview = buildPreview(stored, state, safeRecurring(host))
  const now = host.now()
  const id = uid('pa')
  return {
    id,
    call: stored,
    decision,
    preview,
    createdAt: now,
    expiresAt: decision.decision === 'deny' ? now : addMinutes(now, PENDING_TTL_MIN),
    status: decision.decision === 'deny' ? 'denied' : 'pending',
    bindingHash: computeBindingHash({ id, tool: stored.tool, args: stored.args, amount: callAmount(stored, state.bank), to: preview.to }),
  }
}

function runAction(host: AgentHost, turn: Turn, call: ToolCall, decision: PolicyDecision, opts: GateOptions): GateResult {
  const pending = pendingFor(host, host.state(), call, decision)
  const reason = decision.reasons[0]
  let run: ToolRun | undefined
  host.mutate((draft) => {
    auditCall(host, call)
    auditDecision(host, call, decision, pending.id)
    if (decision.decision === 'deny') {
      pending.error = reason
      host.audit('policy', 'action_denied', `Blocked: ${pending.preview.title}`, { pendingId: pending.id, tool: call.tool, ruleIds: decision.ruleIds, tier: decision.tier, tainted: decision.tainted })
    } else if (decision.decision === 'allow') {
      run = runTool(call, host)
      settle(host, pending, run, draft)
    }
    draft.pending.push(structuredClone(pending))
    if (opts.planStep) setStep(draft, opts.planStep, stepStatusFor(pending.status), pending.status === 'executed' ? run?.outcome.summary : pending.error, pending.id)
  })
  traceDecision(turn, call, decision, pending.id)
  turn.proposals.push(pending.id)
  if (turn.source === 'chat' && decision.tier < 4) turn.dialogue.lastProposalId = pending.id
  addSource(turn, { tool: call.tool, args: summarizeArgs(call.args), preview: pending.preview, reasons: decision.reasons })
  if (run) absorbRun(host, turn, call, run, opts)
  if (decision.decision === 'deny') {
    addNotice(turn, 'block', `Blocked: ${pending.preview.title}`, reason ?? 'Blocked by FundBun’s permission rules', `deny:${pending.id}`)
    if (isHighRisk(call.tool)) checkBreaker(host, turn)
  } else {
    addCard(turn, { type: 'action', pendingId: pending.id })
  }
  const status: GateStatus = pending.status === 'executed' ? 'done' : pending.status === 'denied' ? 'denied' : pending.status === 'failed' ? 'failed' : 'pending'
  return { call, decision, status, outcome: run?.outcome, pending, reason: pending.error ?? reason }
}

/** Record the result of an executed action on the (draft) pending action + audit it. */
function settle(host: AgentHost, pending: PendingAction, run: ToolRun, draft: AppState): void {
  const now = host.now()
  const spec = isToolName(pending.call.tool) ? TOOL_SPECS[pending.call.tool] : undefined
  if (run.outcome.ok) {
    pending.status = 'executed'
    pending.executedAt = now
    if (spec?.reversible && run.undo) pending.undoUntil = addSeconds(now, draft.mandate.undoWindowSec)
    const result: ActionResult = { summary: run.outcome.summary, data: run.outcome.data }
    if (run.outcome.txnIds?.length) result.txnIds = run.outcome.txnIds
    if (run.undo) result.undo = run.undo
    pending.result = result
    host.audit('agent', 'action_executed', run.outcome.summary, {
      pendingId: pending.id, tool: pending.call.tool, amount: pending.preview.amount, bindingHash: pending.bindingHash, txnIds: run.outcome.txnIds, proposedBy: pending.call.proposedBy,
    })
  } else {
    pending.status = 'failed'
    pending.error = run.outcome.error ?? 'The action failed'
    host.audit('agent', 'action_failed', `Failed: ${pending.preview.title}`, { pendingId: pending.id, tool: pending.call.tool, error: pending.error })
  }
}

function isHighRisk(tool: string): boolean {
  return !isToolName(tool) || TOOL_SPECS[tool].movesMoney || TOOL_SPECS[tool].tier === 4
}

/** Trace + cards + grounding sources for an executed tool; untrusted results taint the turn and get scanned. */
export function absorbRun(host: AgentHost, turn: Turn, call: ToolCall, run: ToolRun, opts: GateOptions = {}): void {
  const o = run.outcome
  trace(turn, 'tool_result', o.ok ? o.summary : `Failed: ${o.error}`, { tool: call.tool, ok: o.ok, summary: o.summary, untrusted: o.untrusted === true })
  addSource(turn, o.data)
  if (opts.cards !== false) for (const card of o.cards) addCard(turn, card)
  if (!o.untrusted) return
  taint(turn, `${call.tool} returned untrusted text`)
  for (const u of run.untrustedTexts) scanUntrusted(host, turn, call.tool, u.source, u.text)
}

export function scanUntrusted(host: AgentHost, turn: Turn, tool: string, source: string, text: string): boolean {
  const report = scanForInjection(text)
  if (!report.suspicious) return false
  const kind = source.startsWith('memo') ? 'memo' : 'bill'
  trace(turn, 'injection', `Prompt injection detected in ${kind} text`, { tool, source, score: report.score, signals: report.signals })
  host.audit('system', 'injection_detected', `Instructions aimed at the assistant found in ${kind} text — ignored`, { tool, source, score: report.score, signals: report.signals })
  const title = kind === 'memo' ? 'A transaction memo contains instructions aimed at AI assistants — I ignored them' : 'This bill contains instructions aimed at AI assistants — I ignored them'
  addNotice(turn, 'warn', 'Hidden instructions ignored', `${title}. Bills and memos are data, never commands. Nothing was moved.`, `inject:${kind}`)
  return true
}

// ───────────────────────────── plans ─────────────────────────────

function stepStatusFor(status: PendingStatus): PlanStepStatus {
  switch (status) {
    case 'executed': return 'done'
    case 'pending': return 'needs_approval'
    case 'denied': return 'blocked'
    case 'failed': return 'failed'
    default: return 'skipped'
  }
}

export function setStep(draft: AppState, ref: { planId: string; stepId: string }, status: PlanStepStatus, summary?: string, pendingId?: string): void {
  const plan = draft.plans.find((p) => p.id === ref.planId)
  const step = plan?.steps.find((s) => s.id === ref.stepId)
  if (!plan || !step) return
  step.status = status
  if (summary) step.resultSummary = summary
  if (pendingId) step.pendingId = pendingId
  refreshPlan(plan)
}

function updateStep(host: AgentHost, ref: { planId: string; stepId: string }, status: PlanStepStatus, summary?: string): void {
  host.mutate((draft) => setStep(draft, ref, status, summary))
}

const TERMINAL: PlanStepStatus[] = ['done', 'skipped', 'failed', 'blocked']

export function refreshPlan(plan: TaskPlan): void {
  if (plan.status === 'cancelled') return
  if (plan.steps.some((s) => s.status === 'needs_approval')) plan.status = 'awaiting_user'
  else if (plan.steps.some((s) => !TERMINAL.includes(s.status))) plan.status = 'running'
  else plan.status = plan.steps.length > 0 && plan.steps.every((s) => s.status === 'failed') ? 'failed' : 'done'
}

/** Keep the plan step that produced a pending action in sync with it. */
export function syncPlanForPending(draft: AppState, pendingId: string, status: PendingStatus, summary?: string): void {
  for (const plan of draft.plans) {
    const step = plan.steps.find((s) => s.pendingId === pendingId)
    if (!step) continue
    step.status = stepStatusFor(status)
    if (summary) step.resultSummary = summary
    refreshPlan(plan)
  }
}

// ───────────────────────────── circuit breaker ─────────────────────────────

function lastUnfreeze(state: AppState): string | undefined {
  for (let i = state.audit.length - 1; i >= 0; i--) {
    const e = state.audit[i]
    if (e.type === 'kill_switch' && e.data.frozen === false) return e.ts
  }
  return undefined
}

/** After a denied money-moving attempt: trip the breaker (freeze the agent) when shouldTripBreaker says so. */
export function checkBreaker(host: AgentHost, turn?: Turn): boolean {
  const state = host.state()
  if (state.mandate.frozen) return false
  const since = lastUnfreeze(state)
  const verdict = shouldTripBreaker(agentRecords(state), host.now(), since ? { since } : {})
  if (!verdict.trip) return false
  const reason = verdict.reason ?? 'Repeated blocked money attempts'
  host.mutate((draft) => {
    draft.mandate.frozen = true
    draft.mandate.breakerTrippedAt = host.now()
    draft.mandate.breakerReason = reason
    host.audit('system', 'circuit_breaker', 'Circuit breaker tripped: the assistant is paused (read-only)', { reason })
  })
  if (turn) {
    trace(turn, 'policy', 'Circuit breaker tripped — agent frozen', { reason })
    addNotice(turn, 'block', 'I’ve paused myself', `${reason} I can still read and explain. To let me act again, unfreeze me in Settings with your PIN.`, 'breaker')
  }
  return true
}

// ───────────────────────────── approve / reject / undo / expire ─────────────────────────────

export interface ApprovalOutcome {
  ok: boolean
  error?: string
  pending?: PendingAction
  run?: ToolRun
  /** trace of the approval (policy re-check, binding, PIN) for the confirmation message */
  steps: { kind: 'policy' | 'tool_result' | 'error'; label: string; detail?: unknown }[]
}

function markPending(host: AgentHost, id: string, status: PendingStatus, error?: string): void {
  host.mutate((draft) => {
    const p = draft.pending.find((x) => x.id === id)
    if (!p) return
    p.status = status
    if (error) p.error = error
    syncPlanForPending(draft, id, status, error)
  })
}

export function approvePending(host: AgentHost, id: string, pin?: string): ApprovalOutcome {
  const steps: ApprovalOutcome['steps'] = []
  const state = host.state()
  const p = state.pending.find((x) => x.id === id)
  if (!p) return { ok: false, error: 'That action was not found.', steps }
  if (p.status !== 'pending') return { ok: false, error: `That action is already ${p.status}.`, steps }
  const now = host.now()
  if (isAfter(now, p.expiresAt)) {
    markPending(host, id, 'expired')
    host.audit('user', 'action_rejected', `Expired before approval: ${p.preview.title}`, { pendingId: id, reason: 'expired' })
    return { ok: false, error: 'That action expired. Ask me again and I’ll prepare a fresh one.', steps }
  }

  const fresh = llmGuard(p.call, evaluatePolicy(p.call, policyContext(host, state, p.decision.tainted, p.id)))
  const decision = stricter(p.decision, fresh)
  steps.push({ kind: 'policy', label: `Re-checked at approval: ${fresh.decision.toUpperCase()}`, detail: { decision: fresh.decision, ruleIds: fresh.ruleIds, reasons: fresh.reasons } })
  if (decision.decision === 'deny') {
    const reason = fresh.reasons[0] ?? 'Blocked by policy'
    host.mutate((draft) => {
      const target = draft.pending.find((x) => x.id === id) as PendingAction
      target.status = 'denied'
      target.error = reason
      target.decision = fresh
      syncPlanForPending(draft, id, 'denied', reason)
      auditDecision(host, p.call, fresh, id)
      host.audit('policy', 'action_denied', `Blocked at approval: ${p.preview.title}`, { pendingId: id, tool: p.call.tool, ruleIds: fresh.ruleIds, atApproval: true })
    })
    if (isHighRisk(p.call.tool)) checkBreaker(host)
    return { ok: false, error: reason, steps }
  }

  const preview = buildPreview(p.call, state, safeRecurring(host))
  const binding = { id: p.id, tool: p.call.tool, args: p.call.args, amount: callAmount(p.call, state.bank), to: preview.to }
  if (!verifyBindingHash(binding, p.bindingHash)) {
    const error = 'This action changed after you saw it, so I didn’t run it. Nothing was moved.'
    markPending(host, id, 'failed', error)
    host.audit('system', 'action_failed', `Binding check failed: ${p.preview.title}`, { pendingId: id, tool: p.call.tool, reason: 'binding_mismatch' })
    steps.push({ kind: 'error', label: 'Binding hash mismatch — execution refused' })
    return { ok: false, error, steps }
  }
  steps.push({ kind: 'policy', label: 'Binding hash verified: what you saw is what runs', detail: { bindingHash: p.bindingHash } })

  const result = host.mutate((draft) => executeApproved(host, draft, id, decision.decision === 'step_up', pin))
  if (result.pinChecked) steps.push({ kind: 'policy', label: result.ok || result.run ? 'PIN verified (step-up)' : 'PIN check failed' })
  if (result.run) steps.push({ kind: 'tool_result', label: result.run.outcome.ok ? result.run.outcome.summary : `Failed: ${result.run.outcome.error}`, detail: { tool: p.call.tool, ok: result.run.outcome.ok } })
  const after = host.state().pending.find((x) => x.id === id)
  return { ok: result.ok, error: result.error, pending: after, run: result.run, steps }
}

interface ExecResult {
  ok: boolean
  error?: string
  run?: ToolRun
  pinChecked?: boolean
}

function executeApproved(host: AgentHost, draft: AppState, id: string, needsPin: boolean, pin?: string): ExecResult {
  const target = draft.pending.find((x) => x.id === id) as PendingAction
  const now = host.now()
  if (needsPin) {
    if (!pin) {
      host.audit('user', 'step_up_failed', `PIN required: ${target.preview.title}`, { pendingId: id, reason: 'pin_required' })
      return { ok: false, error: 'Enter your PIN to approve this.' }
    }
    const check = checkPin(pin, draft.mandate, now)
    draft.mandate = check.mandate
    if (!check.ok) {
      host.audit('user', 'step_up_failed', `PIN check failed: ${target.preview.title}`, {
        pendingId: id, reason: check.reason, failedPinAttempts: check.mandate.failedPinAttempts, pinLockedUntil: check.mandate.pinLockedUntil,
      })
      return { ok: false, error: check.reason ?? 'Wrong PIN.', pinChecked: true }
    }
    const pinHash = draft.mandate.pinHash as string
    if (!verifyApproval(signApproval(target.bindingHash, pinHash), target.bindingHash, pinHash)) {
      return { ok: false, error: 'PIN approval could not be bound to this action.', pinChecked: true }
    }
  }
  target.status = 'approved'
  host.audit('user', 'action_confirmed', `Approved: ${target.preview.title}`, { pendingId: id, tool: target.call.tool, bindingHash: target.bindingHash, pinVerified: needsPin })
  const run = runTool(target.call, host)
  settle(host, target, run, draft)
  const settled = target.status as PendingStatus
  syncPlanForPending(draft, id, settled, settled === 'executed' ? run.outcome.summary : target.error)
  return { ok: run.outcome.ok, error: run.outcome.ok ? undefined : target.error, run, pinChecked: needsPin }
}

export function rejectPending(host: AgentHost, id: string, reason = 'rejected'): boolean {
  const p = host.state().pending.find((x) => x.id === id)
  if (!p || p.status !== 'pending') return false
  host.mutate((draft) => {
    const target = draft.pending.find((x) => x.id === id) as PendingAction
    target.status = 'rejected'
    syncPlanForPending(draft, id, 'rejected', reason === 'rejected' ? 'You said no' : reason)
    host.audit('user', 'action_rejected', `Rejected: ${p.preview.title}`, { pendingId: id, tool: p.call.tool, reason })
  })
  return true
}

export function undoPending(host: AgentHost, id: string): { ok: boolean; error?: string; pending?: PendingAction } {
  const p = host.state().pending.find((x) => x.id === id)
  if (!p) return { ok: false, error: 'That action was not found.' }
  if (p.status !== 'executed') return { ok: false, error: `Only executed actions can be undone (this one is ${p.status}).` }
  const result = (p.result ?? {}) as ActionResult
  if (!result.undo || !p.undoUntil) return { ok: false, error: 'This action can’t be undone from FundBun.' }
  if (isAfter(host.now(), p.undoUntil)) return { ok: false, error: 'The undo window has passed.' }
  try {
    host.mutate((draft, bank) => {
      applyUndo(result.undo as UndoRecord, draft, bank)
      const target = draft.pending.find((x) => x.id === id) as PendingAction
      target.status = 'undone'
      syncPlanForPending(draft, id, 'undone', 'Undone by you')
      host.audit('user', 'action_undone', `Undone: ${p.preview.title}`, { pendingId: id, tool: p.call.tool, txnIds: result.txnIds })
    })
  } catch (e) {
    return { ok: false, error: `Couldn’t undo that: ${errorText(e)}` }
  }
  return { ok: true, pending: host.state().pending.find((x) => x.id === id) }
}

export function expirePending(host: AgentHost): number {
  const now = host.now()
  const stale = host.state().pending.filter((p) => p.status === 'pending' && isAfter(now, p.expiresAt))
  if (!stale.length) return 0
  host.mutate((draft) => {
    for (const s of stale) {
      const target = draft.pending.find((x) => x.id === s.id) as PendingAction
      target.status = 'expired'
      syncPlanForPending(draft, s.id, 'expired', 'Expired')
      host.audit('system', 'action_rejected', `Expired: ${s.preview.title}`, { pendingId: s.id, tool: s.call.tool, reason: 'expired' })
    }
  })
  return stale.length
}

