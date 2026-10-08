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
import { replyLang } from './lang'
import { isRefusalIntent, understand } from './nlu'
import { actionReply, awaitingStepUp, joinSentences, nluContext, respondOffline, toneOf, type Reply } from './offline-engine'
import { buildPreview } from './previews'
import { TOOL_SPECS, isToolName } from './specs'
import { currencyOf, money, pastedBillLine, profileFacts } from './support'
import { addCard, addNotice, addSource, startTurn, trace, type Turn } from './turn'
import { composeReply, line } from './voice'

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
  const raw = String(text ?? '').slice(0, 8000)
  // a PIN typed into chat is masked before anything is stored, understood or sent to a model
  const pin = source === 'chat' ? maskPinInChat(raw, Boolean(awaitingStepUp(host.state()))) : { text: raw, request: raw, masked: false }
  const input = pin.text
  // a pasted bill is untrusted data: the chat keeps a one-line note, never the bill text itself
  const shown = source === 'xray' ? pastedBillLine(String(text ?? '')) : input
  host.mutate((draft) => {
    draft.chat.push({ id: uid('msg'), role: 'user', text: shown, ts: turn.ts })
  })
  turn.lang = replyLang(input, host.state())
  if (pin.masked) {
    turn.pinMasked = true
    pinHygiene(host, turn)
    if (!/[\p{L}\p{N}]/u.test(pin.request.replace(/\[PIN\]/g, ''))) return finishTurn(host, turn, pinOnlyReply(host, turn), input)
  }
  const request = pin.request
  const client = source === 'chat' ? host.llm() : null
  let reply: Reply & { grounding?: GroundingReport }
  if (client && !pin.masked && !needsDeterministicPath(host, request)) reply = await respondLlm(host, turn, request, client)
  else reply = respondOffline(host, turn, request)
  if (pin.masked) reply = { ...reply, text: joinSentences([line('pinWarning', turn.lang), reply.text], turn.lang ?? 'en') }
  return finishTurn(host, turn, reply, input)
}

/** "my pin is 2580", "PIN: 2580", "密码是2580", "pin saya 2580" — the digits are the PIN whatever their value. */
const PIN_PHRASE_RE = /(?:\b(?:my\s+)?(?:pin(?:\s*(?:code|number))?|passcode|password|kata sandi|sandi)\b(?:\s*(?:saya|ku|aku))?\s*(?:is|was|=|:|：|-|adalah|nya)?\s*|(?:我的)?(?:支付密码|PIN码?|pin码?|密码)\s*(?:是|为|:|：)?\s*)(\d{4,6})(?!\d)/gi
const BARE_PIN_RE = /^\s*(?:pin\s*[:：]?\s*)?(\d{4,6})\s*[.!。]?\s*$/i

/**
 * Masks a PIN in a chat message. Only by wording ("my pin is …") or, while a PIN step-up is waiting, a bare
 * 4–6 digit message — never by comparing digits with the stored PIN hash: a reply that differed for the right
 * PIN would let anyone with the chat test PINs without ever hitting the keypad's attempt limit.
 */
export function maskPinInChat(text: string, stepUpWaiting: boolean): { text: string; request: string; masked: boolean } {
  let masked = false
  let shown = text.replace(PIN_PHRASE_RE, (m, digits: string) => {
    masked = true
    return m.slice(0, m.length - digits.length) + '[PIN]'
  })
  let request = masked ? text.replace(PIN_PHRASE_RE, ' ').replace(/^[\s,，;；.。:-]+|[\s,，;；:-]+$/g, '').replace(/^(?:and|then|dan|然后)\s+/i, '').trim() : text
  if (!masked && stepUpWaiting && BARE_PIN_RE.test(text)) {
    masked = true
    shown = '[PIN]'
    request = ''
  }
  return { text: shown, request, masked }
}

function pinHygiene(host: AgentHost, turn: Turn): void {
  const lang = turn.lang ?? 'en'
  trace(turn, 'redaction', 'PIN masked before storage — never kept, never sent', { kind: 'pin', masked: 1 })
  host.audit('system', 'user_action', 'A PIN was typed into chat — masked before storage', { type: 'credential_hygiene', kind: 'pin_in_chat' })
  addNotice(turn, 'warn', line('pinNoticeTitle', lang), line('pinNoticeText', lang), 'pin')
}

/** The message was only a PIN: warn, and point back to the card that is waiting for it. */
function pinOnlyReply(host: AgentHost, turn: Turn): Reply {
  const lang = turn.lang ?? 'en'
  const waiting = awaitingStepUp(host.state())
  trace(turn, 'intent', 'PIN typed in chat (masked) — approvals only happen on the card keypad', { act: 'pin_in_chat', engine: 'offline' })
  if (waiting) {
    addCard(turn, { type: 'action', pendingId: waiting.id })
    addSource(turn, waiting)
  }
  const hint = waiting ? line('pinApproveHint', lang, { title: waiting.preview.title }) : ''
  return { text: joinSentences([line('pinWarning', lang), hint], lang), intent: 'sensitive_request', suggestions: [] }
}

/**
 * Dialogue acts (stop / yes / corrections / plans / clarification answers), refusals and pasted bills are
 * handled by the deterministic engine even when the LLM is on: they act on structured state or untrusted text.
 */
function needsDeterministicPath(host: AgentHost, text: string): boolean {
  if (detectDialogueAct(text)) return true
  if (host.state().dialogue.pendingClarification) return true
  const nlu = understand(text, nluContext(host))
  // an override attempt is audited and answered by the rule-based engine, whatever it wraps
  if (nlu.override) return true
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
  const grounding = checkGrounding(text, [...sources, profileFacts(host.state())], currencyOf(host.state()))
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
  const lang = replyLang('', state)
  const facts = actionFacts(tool, p.call.args, state, { stage: 'done', data: result.data, recurring: safeRecurring(host), lang })
  let text = composeReply(intent, facts, toneOf(state), lang)
  if (p.undoUntil) text += lang === 'zh' ? ` ${state.mandate.undoWindowSec}秒内可撤销。` : lang === 'id' ? ` Bisa dibatalkan dalam ${state.mandate.undoWindowSec} detik.` : ` Undo within ${state.mandate.undoWindowSec}s.`
  return text
}

function undo(host: AgentHost, pendingId: string): { ok: boolean; error?: string } {
  const res = undoPending(host, pendingId)
  if (!res.ok || !res.pending) return { ok: false, error: res.error ?? 'Could not undo that action' }
  const p = res.pending
  const f = money(host.state())
  const lang = replyLang('', host.state())
  const text = p.preview.amount && isToolName(p.call.tool) && TOOL_SPECS[p.call.tool].movesMoney
    ? line('undoMoney', lang, { amount: f(p.preview.amount) })
    : line('undoOther', lang, { title: p.preview.title })
  appendAssistant(host, text, [{ type: 'action', pendingId }], [{ kind: 'tool_result', label: `Undone: ${p.preview.title}`, detail: { pendingId, tool: p.call.tool }, ts: host.now() }], [p])
  return { ok: true }
}
