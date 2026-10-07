import { checkGrounding } from '../security/grounding'
import { UNTRUSTED_REMINDER, sanitizeUntrusted, wrapUntrusted } from '../security/injection'
import { redactDeep } from '../security/redact'
import type { AppState, ChatMessage, GroundingReport, ToolName } from '../types'
import { newCall, runGated, type GateResult } from './actions'
import { TOOL_INTENT, readFacts } from './facts'
import type { AgentHost } from './host'
import type { LlmClient, LlmContentBlock, LlmMessage, LlmResponse } from './llm'
import { respondOffline, toneOf, type Reply } from './offline-engine'
import { PROMPT_VERSION, buildSystemPrompt } from './prompts'
import { TOOL_SPECS, isToolName, llmToolDefinitions } from './specs'
import { currencyOf, errorText } from './support'
import { addNotice, trace, type Turn } from './turn'
import { composeReply, suggestionsFor } from './voice'

/**
 * The LLM engine: the model may only PROPOSE tool calls; each one goes through the same policy gate as the
 * offline engine (proposedBy 'llm'). Context is minimised and redacted, untrusted / user-authored text is
 * wrapped, the final reply is grounding-checked, and any LLM failure falls back to the on-device engine.
 */
export const MAX_ROUNDS = 5
export const LLM_TIMEOUT_MS = 30_000
const HISTORY_MESSAGES = 9
const MAX_MESSAGE_CHARS = 2000

export interface LlmReply extends Reply {
  grounding?: GroundingReport
}

interface ReadResult {
  tool: ToolName
  data: unknown
}

export async function respondLlm(host: AgentHost, turn: Turn, text: string, client: LlmClient): Promise<LlmReply> {
  turn.engine = 'llm'
  const reads: ReadResult[] = []
  try {
    const finalText = await toolLoop(host, turn, client, reads)
    return finish(host, turn, text, finalText, reads)
  } catch (e) {
    return fallback(host, turn, text, e, reads)
  }
}

// ───────────────────────────── request building ─────────────────────────────

function namesOf(state: AppState): string[] {
  const name = state.profile?.name?.trim() ?? ''
  return [name, ...name.split(/\s+/)].filter((n) => n.length >= 2)
}

/** Strings the user typed themselves (dream names, notes) — wrapped as untrusted when sent to the model. */
function userAuthored(state: AppState): string[] {
  const out = new Set<string>()
  for (const d of state.dreams) {
    if (d.name.trim().length >= 2) out.add(d.name.trim())
    if (d.note && d.note.trim().length >= 2) out.add(d.note.trim())
  }
  return [...out]
}

export function buildHistory(chat: ChatMessage[]): LlmMessage[] {
  const recent = chat.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim()).slice(-HISTORY_MESSAGES)
  const out: LlmMessage[] = []
  for (const m of recent) {
    const role = m.role as 'user' | 'assistant'
    let body = m.text.slice(0, MAX_MESSAGE_CHARS)
    // a long user message is a paste (bill, statement): data, not instructions
    if (role === 'user' && m.text.length > 400) body = wrapUntrusted('pasted-text', m.text)
    const prev = out[out.length - 1]
    if (prev && prev.role === role && typeof prev.content === 'string') prev.content = `${prev.content}\n${body}`
    else out.push({ role, content: body })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

function systemPrompt(state: AppState): string {
  return buildSystemPrompt({
    name: state.profile?.name ?? '',
    currency: currencyOf(state),
    today: state.bank.today,
    tone: toneOf(state),
    autonomy: state.mandate.frozen ? 'observe' : state.mandate.autonomy,
  })
}

// ───────────────────────────── the tool loop ─────────────────────────────

async function toolLoop(host: AgentHost, turn: Turn, client: LlmClient, reads: ReadResult[]): Promise<string> {
  const state = host.state()
  const names = namesOf(state)
  const redacted = redactDeep({ system: systemPrompt(state), messages: buildHistory(state.chat) }, names)
  const system = redacted.value.system
  const messages: LlmMessage[] = redacted.value.messages
  if (!messages.length) throw new Error('Nothing to send')
  trace(turn, 'redaction', 'Context minimised and redacted before leaving the device', { counts: redacted.counts, messages: messages.length })
  const tools = llmToolDefinitions()
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    host.audit('agent', 'llm_request', `LLM request (round ${round})`, {
      round, turnId: turn.id, messages: messages.length, tools: tools.length, promptVersion: PROMPT_VERSION, redactions: round === 1 ? redacted.counts : {},
    })
    trace(turn, 'llm', `LLM request · round ${round}`, { round, messages: messages.length, tools: tools.length })
    const res = await client.complete({ system, messages, tools, maxTokens: 1024 }, LLM_TIMEOUT_MS)
    const uses = res.content.filter((b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    const said = res.content.filter((b): b is Extract<LlmContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim()
    recordResponse(host, turn, round, res, uses.length)
    if (!uses.length) return said
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: uses.map((u) => toolResult(host, turn, u, said, reads)) })
    if (round === MAX_ROUNDS) {
      trace(turn, 'llm', 'Tool-round limit reached — stopping the model', { maxRounds: MAX_ROUNDS })
      return said
    }
  }
  return ''
}

function recordResponse(host: AgentHost, turn: Turn, round: number, res: LlmResponse, toolUses: number): void {
  host.audit('agent', 'llm_response', `LLM response (round ${round}): ${res.stopReason}`, {
    round, turnId: turn.id, provider: res.provider, model: res.model, stopReason: res.stopReason, toolUses, usage: res.usage, gatewayRedactions: res.redactions ?? {},
  })
  trace(turn, 'llm', `LLM response · ${res.stopReason}${toolUses ? ` · ${toolUses} tool call${toolUses === 1 ? '' : 's'}` : ''}`, {
    round, provider: res.provider, model: res.model, stopReason: res.stopReason, toolUses, gatewayRedactions: res.redactions ?? {},
  })
  if (res.redactions && Object.keys(res.redactions).length) trace(turn, 'redaction', 'Gateway redacted personal data before the provider', { counts: res.redactions })
}

function toolResult(host: AgentHost, turn: Turn, use: Extract<LlmContentBlock, { type: 'tool_use' }>, rationale: string, reads: ReadResult[]): LlmContentBlock {
  const args = use.input && typeof use.input === 'object' && !Array.isArray(use.input) ? use.input : {}
  // model prose is never stored on the call: action cards are built from structured data only
  const r = runGated(host, turn, newCall(use.name, args, 'llm', turn))
  if (rationale) trace(turn, 'llm', 'Model note before the tool call (not shown on cards)', { chars: rationale.length })
  const content = encodeResult(host, use.name, r, reads)
  return { type: 'tool_result', tool_use_id: use.id, content: content.text, ...(content.error ? { is_error: true } : {}) }
}

function encodeResult(host: AgentHost, tool: string, r: GateResult, reads: ReadResult[]): { text: string; error?: boolean } {
  const state = host.state()
  const names = namesOf(state)
  const tier = isToolName(tool) ? TOOL_SPECS[tool].tier : 4
  if (r.status === 'denied') return { text: JSON.stringify({ status: 'denied', reason: r.reason ?? 'Blocked by FundBun policy', note: 'Do not retry this or look for another way around it.' }), error: true }
  if (r.status === 'failed') return { text: JSON.stringify({ status: 'failed', error: r.reason ?? 'The action failed' }), error: true }
  if (r.status === 'pending' && r.pending) {
    const p = r.pending
    return {
      text: JSON.stringify(redactDeep({
        status: 'pending',
        pendingId: p.id,
        decision: p.decision.decision,
        message: 'Proposed to the user. It has NOT happened: it waits for their approval on the action card' + (p.decision.decision === 'step_up' ? ' with their PIN.' : '.'),
        preview: { title: p.preview.title, amount: p.preview.amount, from: p.preview.from, to: p.preview.to },
      }, names).value),
    }
  }
  const outcome = r.outcome
  if (!outcome) return { text: JSON.stringify({ status: 'failed', error: 'No result' }), error: true }
  if (tier === 0) reads.push({ tool: tool as ToolName, data: outcome.data })
  const payload = tier === 0 ? outcome.data : { status: 'executed', summary: outcome.summary, data: outcome.data }
  const redacted = redactDeep(payload, names).value
  if (outcome.untrusted) return { text: wrapUntrusted(`tool:${tool}`, JSON.stringify(redacted)) }
  return { text: JSON.stringify(wrapUserText(redacted, userAuthored(state))) }
}

/** Wrap every string value that carries user-authored free text (dream names, notes) as untrusted data. */
export function wrapUserText(value: unknown, texts: string[]): unknown {
  if (!texts.length) return value
  let wrapped = false
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') {
      if (!texts.some((t) => v.includes(t))) return v
      wrapped = true
      return `<untrusted source="user-content">${sanitizeUntrusted(v, 500)}</untrusted>`
    }
    if (depth > 12 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, depth + 1)
    return out
  }
  const result = walk(value, 0)
  if (!wrapped || typeof result !== 'object' || result === null || Array.isArray(result)) return result
  return { _note: UNTRUSTED_REMINDER, ...(result as Record<string, unknown>) }
}

// ───────────────────────────── final reply ─────────────────────────────

const TAG_RE = /<\/?\s*untrusted\b[^>]*>/gi

function finish(host: AgentHost, turn: Turn, userText: string, raw: string, reads: ReadResult[]): LlmReply {
  const state = host.state()
  let text = raw.replace(TAG_RE, '').replace(UNTRUSTED_REMINDER, '').replace(/[ \t]+/g, ' ').trim()
  if (!text) text = offlineSummary(host, turn, reads)
  const report = checkGrounding(text, [turn.sources, userText], currencyOf(state))
  trace(turn, 'grounding', report.ok ? `Grounded: ${report.checked} numbers checked` : `Ungrounded numbers: ${report.ungrounded.join(', ')}`, report)
  if (!report.ok) text = repairGrounding(host, turn, text, report, reads)
  text = guardClaims(host, turn, text)
  const intent = reads[0] ? TOOL_INTENT[reads[0].tool] ?? 'unknown' : 'unknown'
  return { text, intent, suggestions: suggestionsFor(intent), grounding: report }
}

function repairGrounding(host: AgentHost, turn: Turn, text: string, report: GroundingReport, reads: ReadResult[]): string {
  host.audit('system', 'grounding_violation', 'The model\'s reply contained numbers that no tool returned — corrected before showing it', {
    ungrounded: report.ungrounded, checked: report.checked, engine: 'llm', turnId: turn.id,
  })
  const kept = text.split(/(?<=[.!?。！？])\s+/).filter((s) => !report.ungrounded.some((u) => s.includes(u)))
  const stripped = kept.join(' ').trim()
  const fixed = stripped.length >= 20 ? stripped : offlineSummary(host, turn, reads)
  addNotice(turn, 'info', 'Unverified number removed', `I removed ${report.ungrounded.join(', ')} from my answer because none of your data backs it up.`, 'grounding')
  trace(turn, 'grounding', stripped.length >= 20 ? 'Ungrounded sentences removed' : 'Reply replaced with the on-device answer', { removed: report.ungrounded })
  return fixed
}

/** The model must never claim a pending action happened. */
function guardClaims(host: AgentHost, turn: Turn, text: string): string {
  const waiting = turn.proposals.map((id) => host.state().pending.find((p) => p.id === id)).filter((p) => p?.status === 'pending')
  if (!waiting.length || /approv|card|confirm|PIN/i.test(text)) return text
  return `${text} Nothing happens until you approve it on the card.`
}

/** A number-safe reply built from this turn's tool results (closest intent), or a neutral line. */
function offlineSummary(host: AgentHost, turn: Turn, reads: ReadResult[]): string {
  const state = host.state()
  const first = reads[0]
  const intent = first ? TOOL_INTENT[first.tool] : undefined
  if (first && intent) return composeReply(intent, readFacts(first.tool, first.data, state), toneOf(state))
  if (turn.proposals.length) return 'I’ve prepared that for you — check the card below. Nothing happens until you approve it.'
  return 'Here’s what I found — see the cards below.'
}

function fallback(host: AgentHost, turn: Turn, text: string, e: unknown, reads: ReadResult[]): LlmReply {
  const code = (e as { code?: string; status?: number })?.code ?? (e as { status?: number })?.status
  trace(turn, 'error', 'LLM unavailable — answered with the on-device engine', { error: errorText(e).slice(0, 200), code })
  host.audit('agent', 'llm_response', 'LLM call failed — fell back to the on-device engine', { error: errorText(e).slice(0, 200), code: code ?? null, turnId: turn.id })
  turn.engine = 'offline'
  if (reads.length || turn.proposals.length) {
    const t = offlineSummary(host, turn, reads)
    return { text: t, intent: reads[0] ? TOOL_INTENT[reads[0].tool] ?? 'unknown' : 'unknown' }
  }
  return respondOffline(host, turn, text)
}
