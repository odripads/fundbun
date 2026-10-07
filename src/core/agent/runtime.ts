import { uid } from '../ids'
import { checkGrounding } from '../security/grounding'
import type { ActionPreview, ChatCard, ChatMessage, GroundingReport, PendingAction, SuggestedAction, ToolCall, TraceStep } from '../types'
import {
  approvePending,
  expirePending,
  newCall,
  rejectPending,
  runGated,
  undoPending,
  type ActionResult,
} from './actions'
import { detectDialogueAct } from './dialogue'
import { TOOL_INTENT, actionFacts, readFacts } from './facts'
import type { AgentEngine, AgentEngineFactory, AgentHost } from './host'
import { respondLlm } from './llm-engine'
import { isRefusalIntent, understand } from './nlu'
import { actionReply, nluContext, respondOffline, toneOf, type Reply } from './offline-engine'
import { buildPreview } from './previews'
import { TOOL_SPECS, isToolName } from './specs'
import { currencyOf, money } from './support'
import { startTurn, trace, type Turn } from './turn'
import { composeReply } from './voice'

/** Creates the FundBun agent runtime (offline Bun Engine + LLM tool loop, policy-gated). */
export const createAgentEngine: AgentEngineFactory = (host) => {
  const engine: AgentEngine = {
    respond: (text, opts) => respond(host, text, opts?.source ?? 'chat'),
    propose: async (action, proposedBy) => propose(host, action, proposedBy),
    approve: async (pendingId, pin) => approve(host, pendingId, pin),
    reject: (pendingId) => void rejectPending(host, pendingId),
    undo: (pendingId) => undo(host, pendingId),
    expire: () => void expirePending(host),
    preview: (call) => previewOf(host, call),
  }
  return engine
}

// ───────────────────────────── turns ─────────────────────────────

async function respond(host: AgentHost, text: string, source: 'chat' | 'xray'): Promise<ChatMessage> {
  const turn = startTurn(host, source)
  const input = String(text ?? '').slice(0, 8000)
  host.mutate((draft) => {
    draft.chat.push({ id: uid('msg'), role: 'user', text: input, ts: turn.ts })
  })
  const client = source === 'chat' ? host.llm() : null
  let reply: Reply & { grounding?: GroundingReport }
  if (client && !needsDeterministicPath(host, input)) reply = await respondLlm(host, turn, input, client)
  else reply = respondOffline(host, turn, input)
  return finishTurn(host, turn, reply, input)
}

/**
 * Dialogue acts (stop / yes / corrections / plans / clarification answers), refusals and pasted bills are
 * handled by the deterministic engine even when the LLM is on: they act on structured state or untrusted text.
 */
function needsDeterministicPath(host: AgentHost, text: string): boolean {
  if (detectDialogueAct(text)) return true
  if (host.state().dialogue.pendingClarification) return true
  const nlu = understand(text, nluContext(host))
  if (nlu.rule && isRefusalIntent(nlu.intent)) return true
  return nlu.intent === 'xray' && Boolean(nlu.slots.text)
}

function finishTurn(host: AgentHost, turn: Turn, reply: Reply & { grounding?: GroundingReport }, userText: string): ChatMessage {
  const state = host.state()
  let grounding = reply.grounding
  if (!grounding) {
    grounding = checkGrounding(reply.text, [turn.sources, userText], currencyOf(state))
    trace(turn, 'grounding', grounding.ok ? `Grounded: ${grounding.checked} numbers checked` : `Ungrounded numbers: ${grounding.ungrounded.join(', ')}`, grounding)
    if (!grounding.ok) host.audit('system', 'grounding_violation', 'On-device reply contained a number no tool returned', { ungrounded: grounding.ungrounded, engine: 'offline', turnId: turn.id })
  }
  const msg = message(host, reply.text, turn.engine, {
    cards: turn.cards,
    trace: turn.trace,
    grounding,
    suggestions: reply.suggestions ?? [],
  })
  host.mutate((draft) => {
    draft.chat.push(msg)
    const d = { ...draft.dialogue }
    if (turn.dialogue.pendingClarification === null) delete d.pendingClarification
    else if (turn.dialogue.pendingClarification) d.pendingClarification = turn.dialogue.pendingClarification
    if (turn.dialogue.lastProposalId) d.lastProposalId = turn.dialogue.lastProposalId
    d.lastIntent = turn.dialogue.lastIntent ?? reply.intent
    draft.dialogue = d
  })
  return msg
}

/** Every assistant message carries engine, cards, trace, grounding and suggestions (arrays may be empty). */
function message(host: AgentHost, text: string, engine: 'offline' | 'llm', extra: Partial<ChatMessage>): ChatMessage {
  return {
    id: uid('msg'),
    role: 'assistant',
    text,
    ts: host.now(),
    engine,
    cards: extra.cards ?? [],
    trace: extra.trace ?? [],
    grounding: extra.grounding ?? { ok: true, checked: 0, ungrounded: [] },
    suggestions: extra.suggestions ?? [],
  }
}

function appendAssistant(host: AgentHost, text: string, cards: ChatCard[], traceSteps: TraceStep[], sources: unknown[] = []): ChatMessage {
  const grounding = checkGrounding(text, sources, currencyOf(host.state()))
  const msg = message(host, text, 'offline', { cards, trace: [...traceSteps, { kind: 'grounding', label: grounding.ok ? `Grounded: ${grounding.checked} numbers checked` : `Ungrounded numbers: ${grounding.ungrounded.join(', ')}`, detail: grounding, ts: host.now() }], grounding })
  host.mutate((draft) => {
    draft.chat.push(msg)
  })
  return msg
}

// ───────────────────────────── UI-initiated actions ─────────────────────────────

async function propose(host: AgentHost, action: SuggestedAction, proposedBy: ToolCall['proposedBy']): Promise<PendingAction> {
  const turn = startTurn(host, 'ui')
  trace(turn, 'intent', `Button: ${action.label}`, { tool: action.tool, proposedBy })
  const call = newCall(action.tool, action.args ?? {}, proposedBy, turn, action.label)
  const r = runGated(host, turn, call)
  const state = host.state()
  const isRead = isToolName(call.tool) && TOOL_SPECS[call.tool].tier === 0
  let text: string
  if (isRead && r.status === 'done' && r.outcome) {
    const intent = TOOL_INTENT[call.tool as keyof typeof TOOL_INTENT] ?? 'unknown'
    text = composeReply(intent, readFacts(call.tool as never, r.outcome.data, state), toneOf(state))
  } else {
    text = actionReply(host, turn, TOOL_INTENT[call.tool as keyof typeof TOOL_INTENT] ?? 'unknown', r).text
  }
  const grounding = checkGrounding(text, [turn.sources], currencyOf(state))
  const msg = message(host, text, 'offline', { cards: turn.cards, trace: turn.trace, grounding })
  host.mutate((draft) => {
    draft.chat.push(msg)
    if (r.pending && !isRead) draft.dialogue = { ...draft.dialogue, lastProposalId: r.pending.id }
  })
  return r.pending ?? syntheticPending(host, call, r.decision, r.status === 'done' ? 'executed' : r.status === 'denied' ? 'denied' : 'failed', r.reason)
}

/** T0 buttons run immediately and are not stored as pending actions; the caller still gets a PendingAction shape. */
function syntheticPending(host: AgentHost, call: ToolCall, decision: PendingAction['decision'], status: PendingAction['status'], error?: string): PendingAction {
  const now = host.now()
  const p: PendingAction = {
    id: uid('pa'),
    call,
    decision,
    preview: buildPreview(call, host.state(), safeRecurring(host)),
    createdAt: now,
    expiresAt: now,
    status,
    bindingHash: '',
  }
  if (status === 'executed') p.executedAt = now
  if (error) p.error = error
  return p
}

function safeRecurring(host: AgentHost) {
  try {
    return host.recurring()
  } catch {
    return []
  }
}

function previewOf(host: AgentHost, call: ToolCall): ActionPreview {
  return buildPreview(call, host.state(), safeRecurring(host))
}

// ───────────────────────────── approval / undo ─────────────────────────────

async function approve(host: AgentHost, pendingId: string, pin?: string): Promise<{ ok: boolean; error?: string }> {
  const res = approvePending(host, pendingId, pin)
  const p = res.pending
  const steps: TraceStep[] = res.steps.map((s) => ({ kind: s.kind, label: s.label, ...(s.detail !== undefined ? { detail: s.detail } : {}), ts: host.now() }))
  if (res.ok && p) {
    appendAssistant(host, confirmationText(host, p), [{ type: 'action', pendingId }], steps, [p, p.result])
  } else if (p && (p.status === 'denied' || p.status === 'failed')) {
    appendAssistant(host, `I didn’t run “${p.preview.title}”: ${p.error ?? res.error ?? 'it was blocked'}`, [{ type: 'action', pendingId }], steps, [p])
  }
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'Not approved' }
}

function confirmationText(host: AgentHost, p: PendingAction): string {
  const state = host.state()
  const tool = p.call.tool
  if (!isToolName(tool)) return 'Done.'
  const result = (p.result ?? {}) as ActionResult
  const intent = TOOL_INTENT[tool] ?? 'unknown'
  const facts = actionFacts(tool, p.call.args, state, { stage: 'done', data: result.data, recurring: safeRecurring(host) })
  let text = composeReply(intent, facts, toneOf(state))
  if (p.undoUntil) text += ` Undo within ${state.mandate.undoWindowSec}s.`
  return text
}

function undo(host: AgentHost, pendingId: string): { ok: boolean; error?: string } {
  const res = undoPending(host, pendingId)
  if (!res.ok || !res.pending) return { ok: false, error: res.error ?? 'Could not undo that action' }
  const p = res.pending
  const f = money(host.state())
  const text = p.preview.amount && isToolName(p.call.tool) && TOOL_SPECS[p.call.tool].movesMoney
    ? `Undone — ${f(p.preview.amount)} is back where it was.`
    : `Undone — “${p.preview.title}” was reverted.`
  appendAssistant(host, text, [{ type: 'action', pendingId }], [{ kind: 'tool_result', label: `Undone: ${p.preview.title}`, detail: { pendingId, tool: p.call.tool }, ts: host.now() }], [p])
  return { ok: true }
}
