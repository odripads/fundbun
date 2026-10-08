import { computeMirror } from '../finance'
import type { AppState, Tone, ToolName } from '../types'
import { newCall, policyContext, rejectPending, runGated, type GateResult } from './actions'
import {
  choicesOf,
  detectDialogueAct,
  fillClarification,
  makeClarification,
  slotHints,
  type Choice,
  type Clarification,
  type DialogueAct,
  type SlotHints,
} from './dialogue'
import { TOOL_INTENT, actionFacts, readFacts, type Facts } from './facts'
import type { AgentHost } from './host'
import { evaluatePolicy } from '../security/policy'
import { ACTION_VERB_RE, VERB_GATED_INTENTS, understand, type Intent, type NluContext, type NluResult } from './nlu'
import { cancelActivePlans, planIntent, planReply, runRecoveryPlan, type IntentPlan, type Slots } from './planner'
import { TOOL_SPECS, isToolName } from './specs'
import { findBill, firstName, nluContextOf, summarizeArgs } from './support'
import { addCard, addNotice, addSource, trace, type Turn } from './turn'
import { composeReply, refusal, suggestionsFor, type ActionStage } from './voice'

/**
 * The on-device "Bun Engine": dialogue acts → clarification answers → NLU intent → planner → policy-gated
 * tool calls → facts → templated reply. Deterministic and fully offline.
 */
export interface Reply {
  text: string
  /** intent the reply answers (suggestions + dialogue.lastIntent) */
  intent: string
  suggestions?: string[]
}

const ACTION_INTENTS = VERB_GATED_INTENTS
const ACTION_VERB = ACTION_VERB_RE
const READ_TWIN: Partial<Record<Intent, Intent>> = { save_to_goal: 'goals', withdraw_goal: 'goals', pay_bill: 'bills', cancel_sub: 'subscriptions', dispute: 'bills' }

export function toneOf(state: AppState): Tone {
  return state.profile?.tone ?? 'gentle'
}

function safeRecurring(host: AgentHost) {
  try {
    return host.recurring()
  } catch {
    return []
  }
}

export function nluContext(host: AgentHost): NluContext {
  return nluContextOf(host.state(), safeRecurring(host))
}

export function respondOffline(host: AgentHost, turn: Turn, text: string): Reply {
  if (turn.source === 'xray') return xrayPaste(host, turn, text)
  const act = detectDialogueAct(text)
  if (act) {
    const handled = handleAct(host, turn, act, text)
    if (handled) return handled
  }
  const ctx = nluContext(host)
  const clar = host.state().dialogue.pendingClarification
  if (clar) {
    const handled = handleClarification(host, turn, clar, text, ctx)
    if (handled) return handled
  }
  return handleUtterance(host, turn, act?.act === 'correction' ? act.body : text, ctx)
}

// ───────────────────────────── utterances ─────────────────────────────

/** Action intents the classifier guessed without an action verb ("Youku", "explain my bill") become read-only. */
export function guardIntent(nlu: NluResult, text: string): Intent {
  if (nlu.rule || !ACTION_INTENTS.includes(nlu.intent)) return nlu.intent
  return ACTION_VERB.test(text) ? nlu.intent : READ_TWIN[nlu.intent] ?? nlu.intent
}

export function handleUtterance(host: AgentHost, turn: Turn, text: string, ctx: NluContext): Reply {
  const nlu = understand(text, ctx)
  const intent = guardIntent(nlu, text)
  trace(turn, 'intent', `${intent} (${Math.round(nlu.confidence * 100)}%)`, {
    intent, classifierIntent: nlu.intent, confidence: nlu.confidence, rule: nlu.rule, slots: summarizeArgs(nlu.slots as Record<string, unknown>),
    alternatives: nlu.alternatives, engine: 'offline', guarded: intent !== nlu.intent,
  })
  if (host.state().dialogue.pendingClarification && intent !== 'unknown') turn.dialogue.pendingClarification = null
  return runIntent(host, turn, intent, nlu.slots as Slots, text, nlu)
}

export function runIntent(host: AgentHost, turn: Turn, intent: Intent, slots: Slots, text: string, nlu?: NluResult): Reply {
  const plan = planIntent(intent, slots, text, host)
  turn.dialogue.lastIntent = intent
  switch (plan.kind) {
    case 'chat': return chatReply(host, turn, plan.intent)
    case 'unknown': return fallbackReply(host, nlu)
    case 'refusal': return refusalReply(host, turn, plan, nlu)
    case 'read': return readReply(host, turn, plan)
    case 'action': return actionReply(host, turn, plan.intent, runGated(host, turn, newCall(plan.tool, plan.args, 'offline', turn)))
    case 'clarify': return clarifyReply(host, turn, plan)
    case 'ask': return { text: composeReply(plan.intent, plan.facts, toneOf(host.state())), intent: plan.intent, suggestions: suggestionsFor(plan.intent) }
  }
}

function compose(host: AgentHost, intent: Intent, facts: Facts): string {
  return composeReply(intent, facts, toneOf(host.state()))
}

function chatReply(host: AgentHost, turn: Turn, intent: Intent): Reply {
  const state = host.state()
  const facts: Facts = {}
  const name = firstName(state)
  if (name) facts.name = name
  if (intent === 'greeting') {
    try {
      const headline = computeMirror(host.ctx()).headline
      if (headline) {
        facts.headline = headline
        addSource(turn, { headline })
      }
    } catch {
      // no headline before onboarding data exists
    }
  }
  return { text: compose(host, intent, facts), intent, suggestions: suggestionsFor(intent) }
}

const ALT_CHIPS: Partial<Record<Intent, string>> = {
  overview: 'How am I doing this month?',
  breakdown: 'Where did my money go?',
  search: 'Show my recent transactions',
  subscriptions: 'List my subscriptions',
  bills: 'Check my bills',
  insights: 'Any insights for me?',
  afford: 'Can I afford something?',
  goals: 'Show my goals',
  save_to_goal: 'Move money to my goal',
  set_budget: 'Set a delivery budget',
  budget_plan: 'Make me a budget plan',
  tripwire: 'Alert me at 80% of my target',
  pay_bill: 'Pay a bill',
  cancel_sub: 'Cancel a subscription',
}

/** Low confidence / unknown: never a dead end — offer the closest things the user may have meant. */
function fallbackReply(host: AgentHost, nlu?: NluResult): Reply {
  const guesses = (nlu?.alternatives ?? []).filter((a) => a.confidence >= 0.2).map((a) => ALT_CHIPS[a.intent]).filter((c): c is string => !!c)
  const chips = [...new Set([...guesses, ...suggestionsFor('unknown')])].slice(0, 4)
  const tail = guesses.length ? ' Or tap one of the suggestions below — I think you might mean one of those.' : ''
  return { text: `${compose(host, 'unknown', {})}${tail}`, intent: 'unknown', suggestions: chips }
}

function refusalReply(host: AgentHost, turn: Turn, plan: Extract<IntentPlan, { kind: 'refusal' }>, nlu?: NluResult): Reply {
  const state = host.state()
  const r = refusal(plan.intent, toneOf(state))
  if (plan.t4) {
    const call = newCall(plan.t4.tool, plan.t4.args, 'offline', turn)
    if (plan.t4.store) runGated(host, turn, call)
    else unstoredDenial(host, turn, call.tool, call.args)
  } else {
    host.audit('policy', 'sensitive_request_refused', 'Refused a request for secrets, full numbers or a data export', { rule: nlu?.rule ?? 'sensitive_request' })
    trace(turn, 'policy', 'Sensitive request refused', { rule: nlu?.rule })
    addNotice(turn, 'block', r.title, 'Nothing was revealed, exported or sent.')
  }
  return { text: r.text, intent: plan.intent, suggestions: suggestionsFor(plan.intent) }
}

/** Invest / credit: policy-decided and audited, but not stored as an attempt (it's a question, not an act). */
function unstoredDenial(host: AgentHost, turn: Turn, tool: string, args: Record<string, unknown>): void {
  const state = host.state()
  const call = newCall(tool, args, 'offline', turn)
  const decision = evaluatePolicy(call, policyContext(host, state, turn.tainted))
  host.mutate(() => {
    host.audit('agent', 'tool_call', `offline proposed ${tool}`, { callId: call.id, tool, proposedBy: 'offline', args: summarizeArgs(args) })
    host.audit('policy', 'policy_decision', `${decision.decision.toUpperCase()} ${tool} (${decision.ruleIds.join(', ')})`, { callId: call.id, tool, decision: decision.decision, tier: decision.tier, ruleIds: decision.ruleIds })
  })
  trace(turn, 'policy', `${decision.decision.toUpperCase()} · ${tool}`, { tool, decision: decision.decision, ruleIds: decision.ruleIds, reasons: decision.reasons })
  addNotice(turn, 'block', `Blocked: ${isToolName(tool) ? TOOL_SPECS[tool].label : tool}`, decision.reasons[0] ?? 'Not allowed for the assistant')
}

function readReply(host: AgentHost, turn: Turn, plan: Extract<IntentPlan, { kind: 'read' }>): Reply {
  const r = runGated(host, turn, newCall(plan.tool, plan.args, 'offline', turn))
  const intent = plan.intent
  if (r.status === 'denied') return { text: `I can’t look at that right now: ${r.reason ?? 'blocked by your settings'}`, intent, suggestions: suggestionsFor(intent) }
  if (r.status !== 'done' || !r.outcome) return { text: `I couldn’t load that just now${r.reason ? ` (${r.reason})` : ''}. Nothing was changed.`, intent, suggestions: suggestionsFor(intent) }
  const facts = readFacts(plan.tool, r.outcome.data, host.state())
  return { text: compose(host, intent, facts), intent, suggestions: suggestionsFor(intent) }
}

function stageOf(r: GateResult): ActionStage {
  return r.status === 'done' ? 'done' : r.status === 'pending' ? 'confirm' : 'blocked'
}

export function actionReply(host: AgentHost, turn: Turn, intent: Intent, r: GateResult, prefix = ''): Reply {
  const state = host.state()
  const tool = r.call.tool as ToolName
  const stage = stageOf(r)
  const facts = actionFacts(tool, r.call.args, state, { stage, data: r.outcome?.data, reason: r.reason, recurring: safeRecurring(host) })
  let text = tool === 'set_bill_reminder' && stage !== 'done' ? reminderText(host, r, stage) : compose(host, TOOL_INTENT[tool] ?? intent, facts)
  const p = r.pending
  if (stage === 'done' && p?.undoUntil) text += ` You can undo it for ${state.mandate.undoWindowSec} seconds.`
  if (stage === 'confirm' && p?.decision.ruleIds.includes('P-TAINT')) text += ' Because this conversation included outside text, it waits for your tap.'
  if (turn.noticeKeys.has('breaker')) text += ' For your safety I’ve paused myself — you can unfreeze me in Settings with your PIN.'
  return { text: `${prefix}${text}`.trim(), intent, suggestions: suggestionsFor(intent) }
}

function reminderText(host: AgentHost, r: GateResult, stage: ActionStage): string {
  const bill = findBill(host.state(), r.call.args.billId)
  const days = Number(r.call.args.daysBefore)
  if (stage === 'blocked') return `I couldn’t set that reminder${r.reason ? `: ${r.reason}` : '.'}`
  return `Set a reminder ${days} day${days === 1 ? '' : 's'} before ${bill?.name ?? 'that bill'} is due? Tap to confirm.`
}

function clarifyReply(host: AgentHost, turn: Turn, plan: Extract<IntentPlan, { kind: 'clarify' }>): Reply {
  const text = compose(host, plan.intent, plan.facts)
  const clar = makeClarification(plan.intent, plan.slots, plan.missing, plan.choices, host.now())
  turn.dialogue.pendingClarification = clar
  if (plan.choices.length) addCard(turn, { type: 'clarify', question: text, options: plan.choices.map((c) => ({ label: c.label, value: c.label })) })
  trace(turn, 'intent', `Clarification needed: ${plan.missing}`, { intent: plan.intent, missing: plan.missing, options: plan.choices.map((c) => c.label) })
  const chips = plan.choices.map((c) => c.label).slice(0, 4)
  return { text, intent: plan.intent, suggestions: chips.length ? chips : suggestionsFor(plan.intent) }
}

// ───────────────────────────── dialogue acts ─────────────────────────────

function handleAct(host: AgentHost, turn: Turn, act: DialogueAct, text: string): Reply | null {
  switch (act.act) {
    case 'interrupt': return interruptReply(host, turn, act.soft)
    case 'affirm': return affirmReply(host, turn)
    case 'correction': return correctionReply(host, turn, act.body)
    case 'plan_recovery': return planRecoveryReply(host, turn, text)
    case 'explain_bill': return explainBill(host, turn, text)
  }
}

function interruptReply(host: AgentHost, turn: Turn, soft: boolean): Reply {
  const state = host.state()
  trace(turn, 'intent', soft ? 'negate (dialogue)' : 'interrupt (dialogue)', { act: soft ? 'negate' : 'interrupt', engine: 'offline' })
  const plans = cancelActivePlans(host, 'Stopped by you')
  let rejected = plans.rejected
  const last = state.dialogue.lastProposalId
  if (last && rejectPending(host, last, 'interrupted')) rejected++
  const hadClar = Boolean(state.dialogue.pendingClarification)
  turn.dialogue.pendingClarification = null
  turn.dialogue.lastIntent = 'interrupt'
  if (plans.plans) trace(turn, 'policy', 'Plan cancelled by the user', plans)
  const parts: string[] = []
  if (plans.plans) parts.push(`Stopped. I cancelled the plan and skipped ${plans.skipped === 1 ? 'the remaining step' : `the remaining ${plans.skipped} steps`}.`)
  if (rejected) parts.push(`${rejected === 1 ? 'The pending action was' : `${rejected} pending actions were`} dropped — nothing will run.`)
  if (!parts.length) parts.push(hadClar ? 'No problem — dropped that.' : 'Okay — nothing is running right now, so there’s nothing to stop.')
  if (plans.plans) parts.push('Anything already done stays done; you can undo it from its card.')
  return { text: parts.join(' '), intent: 'interrupt', suggestions: ['How am I doing this month?', 'Show my goals', 'Check my bills'] }
}

function affirmReply(host: AgentHost, turn: Turn): Reply {
  const state = host.state()
  trace(turn, 'intent', 'affirm (dialogue)', { act: 'affirm', note: 'Approvals happen only on the action card (tap / PIN), never from chat text' })
  const awaiting = state.pending.filter((p) => p.status === 'pending')
  const latest = awaiting.find((p) => p.id === state.dialogue.lastProposalId) ?? awaiting[awaiting.length - 1]
  if (latest) {
    addCard(turn, { type: 'action', pendingId: latest.id })
    const pin = latest.decision.decision === 'step_up' ? ' and enter your PIN' : ''
    return {
      text: `To keep your money safe I never approve things from chat — tap Approve on the card${pin}. That way nobody can approve on your behalf with a look-alike message.`,
      intent: 'affirm',
      suggestions: ['What can you do?', 'How am I doing this month?'],
    }
  }
  const clar = state.dialogue.pendingClarification
  if (clar) return reAsk(turn, clar)
  return { text: 'Great! What should we look at next?', intent: 'affirm', suggestions: suggestionsFor('thanks') }
}

const HINT_ARGS: Partial<Record<ToolName, (args: Record<string, unknown>, h: SlotHints) => Record<string, unknown> | null>> = {
  transfer_to_goal: (a, h) => patch(a, { amount: h.amount, goalId: h.goalId }),
  withdraw_from_goal: (a, h) => patch(a, { amount: h.amount, goalId: h.goalId }),
  set_category_budget: (a, h) => patch(a, { limit: h.amount, category: h.category }),
  create_tripwire: (a, h) => patch(a, { threshold: a.kind === 'single_over' || a.kind === 'daily_over' ? h.amount : h.percent, category: a.kind === 'category_pct' ? h.category : undefined }),
  pay_bill: (a, h) => patch(a, { billId: h.billId }),
  cancel_subscription: (a, h) => patch(a, { recurringId: h.recurringId }),
}

function patch(args: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> | null {
  const next = { ...args }
  let changed = false
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || next[k] === v) continue
    next[k] = v
    changed = true
  }
  return changed ? next : null
}

function correctionReply(host: AgentHost, turn: Turn, body: string): Reply | null {
  const state = host.state()
  const ctx = nluContext(host)
  const clar = state.dialogue.pendingClarification
  if (clar) {
    const filled = fillClarification(clar, body, ctx)
    if (filled) return resumeClarification(host, turn, clar, filled, body)
  }
  const last = state.pending.find((p) => p.id === state.dialogue.lastProposalId)
  if (!last || !isToolName(last.call.tool)) return null
  const next = HINT_ARGS[last.call.tool]?.(last.call.args, slotHints(body, ctx))
  if (!next) return null
  trace(turn, 'intent', 'correction (dialogue)', { act: 'correction', tool: last.call.tool, from: summarizeArgs(last.call.args), to: summarizeArgs(next), previous: last.id })
  if (last.status === 'executed') {
    return {
      text: 'That one already went through, so I can’t change it now. Tap Undo on its card first (if it’s still in the undo window), then tell me the new amount.',
      intent: 'correction',
      suggestions: ['Show my goals'],
    }
  }
  if (last.status === 'pending') rejectPending(host, last.id, 'corrected')
  const intent = TOOL_INTENT[last.call.tool] ?? 'unknown'
  const r = runGated(host, turn, newCall(last.call.tool, next, 'offline', turn))
  turn.dialogue.lastIntent = intent
  const prefix = last.status === 'pending' ? 'Got it — I dropped the earlier proposal. ' : 'Got it. '
  return actionReply(host, turn, intent, r, prefix)
}

function resumeClarification(host: AgentHost, turn: Turn, clar: Clarification, slots: Record<string, unknown>, text: string): Reply {
  turn.dialogue.pendingClarification = null
  trace(turn, 'intent', `Clarification answered: ${clar.missing}`, { intent: clar.intent, missing: clar.missing, filled: summarizeArgs({ [clar.missing]: slots[clar.missing] }) })
  return runIntent(host, turn, clar.intent as Intent, slots as Slots, text)
}

function handleClarification(host: AgentHost, turn: Turn, clar: Clarification, text: string, ctx: NluContext): Reply | null {
  const nlu = understand(text, ctx)
  // a clear new request ("Take ¥100 out of my Birkin pot") wins over filling the open question with its amount
  const preempted = Boolean(nlu.rule) && nlu.intent !== clar.intent && nlu.intent !== 'unknown'
  const filled = preempted ? null : fillClarification(clar, text, ctx)
  if (filled) return resumeClarification(host, turn, clar, filled, text)
  if (nlu.intent !== 'unknown' && (nlu.rule || nlu.confidence >= 0.6)) {
    turn.dialogue.pendingClarification = null
    return null
  }
  return reAsk(turn, clar)
}

function reAsk(turn: Turn, clar: Clarification): Reply {
  const choices: Choice[] = choicesOf(clar)
  const question = choices.length ? 'Sorry, I didn’t catch which one. Pick one below — or say “cancel”.' : 'Sorry, I didn’t catch that. Could you say it another way — or say “cancel”?'
  if (choices.length) addCard(turn, { type: 'clarify', question, options: choices.map((c) => ({ label: c.label, value: c.label })) })
  trace(turn, 'intent', `Clarification repeated: ${clar.missing}`, { intent: clar.intent })
  return { text: question, intent: clar.intent, suggestions: choices.map((c) => c.label).slice(0, 4) }
}

function planRecoveryReply(host: AgentHost, turn: Turn, text: string): Reply | null {
  const ctx = nluContext(host)
  const hints = slotHints(text, ctx)
  if (hints.amount !== undefined) return null
  trace(turn, 'intent', 'plan_recovery (dialogue)', { act: 'plan_recovery', goalId: hints.goalId, engine: 'offline' })
  turn.dialogue.pendingClarification = null
  turn.dialogue.lastIntent = 'plan_recovery'
  const outcome = runRecoveryPlan(host, turn, { goalId: hints.goalId })
  turn.cards.unshift({ type: 'plan', planId: outcome.plan.id })
  for (const step of outcome.plan.steps) if (step.pendingId && step.status === 'needs_approval') addCard(turn, { type: 'action', pendingId: step.pendingId })
  const last = outcome.plan.steps.filter((s) => s.pendingId).map((s) => s.pendingId as string).pop()
  if (last) turn.dialogue.lastProposalId = last
  return { text: planReply(outcome, host.state(), toneOf(host.state())), intent: 'plan_recovery', suggestions: ['Stop', 'Show my goals', 'Where did my money go?'] }
}

/** "Explain my electricity bill": X-ray the stored bill text (untrusted) — never a payment. */
function explainBill(host: AgentHost, turn: Turn, text: string): Reply | null {
  const ctx = nluContext(host)
  const billId = understand(text, ctx).slots.billId
  const bill = findBill(host.state(), billId)
  if (!bill?.rawText) return null
  trace(turn, 'intent', 'explain_bill (dialogue)', { act: 'explain_bill', billId: bill.id, engine: 'offline' })
  turn.dialogue.lastIntent = 'xray'
  return readReply(host, turn, { kind: 'read', intent: 'xray', tool: 'xray_bill', args: { text: bill.rawText.slice(0, 8000) } })
}

function xrayPaste(host: AgentHost, turn: Turn, text: string): Reply {
  const body = understand(text.slice(0, 8000), nluContext(host)).slots.text ?? text
  trace(turn, 'intent', 'xray (pasted bill)', { intent: 'xray', chars: body.length, engine: 'offline' })
  turn.dialogue.lastIntent = 'xray'
  return readReply(host, turn, { kind: 'read', intent: 'xray', tool: 'xray_bill', args: { text: body.slice(0, 8000) } })
}
