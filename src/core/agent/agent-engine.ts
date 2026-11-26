import type { AgentEvent, LiveReply } from '../ai/types'
import { CREATOR_TOOL_LABELS, isCreatorTool } from '../plugins/tools'
import { wrapUntrusted } from '../security/injection'
import { redactDeep } from '../security/redact'
import { runCreatorTool } from './creator-tools'
import type { ChatAttachment } from '../types'
import { attachmentBlocks } from './attachments'
import type { AgentHost, AgentLink } from './host'
import { fallback, finish, namesOf, toolResult, type LlmReply, type ReadResult } from './llm-engine'
import { toneOf } from './offline-engine'
import { PROMPT_VERSION, buildAgentPreamble, sanitizeField } from './prompts'
import { TOOL_SPECS, isToolName } from './specs'
import { currencyOf } from './support'
import { addNotice, trace, type Turn } from './turn'

/**
 * The agent engine: an agent on this computer (Claude Code, Codex, Qwen Code, … — whichever the user connected)
 * does the thinking. It reaches the user's numbers only through FundBun's tools, and every one of those calls
 * runs through the same policy gate as an API model's (proposedBy 'llm'): the agent proposes, FundBun decides.
 * What is sent is redacted first, the reply is grounding-checked, and a failure falls back to the on-device engine.
 */
const MAX_FUNDBUN_CALLS = 24
const MAX_REPLY_CHARS = 24_000
const LIVE_EVERY_MS = 60

export async function respondAgent(host: AgentHost, turn: Turn, text: string, link: AgentLink, files: readonly ChatAttachment[] = []): Promise<LlmReply> {
  turn.engine = 'llm'
  const reads: ReadResult[] = []
  const state = host.state()
  const names = namesOf(state)
  // a long message is a paste (a bill, a statement): data, not instructions — as for an API model
  const asked = text.length > 400 ? wrapUntrusted('pasted-text', text) : text
  // attached files go along as data, each one wrapped: the agent reads them, it never takes orders from them
  const rawBody = files.length ? `${asked}\n\n${attachmentBlocks(files)}` : asked
  // turns handled on-device while this ACP session was already open (refusals, preset shortcuts, UI cards) never
  // reached the agent: pass a sanitized recap so follow-ups keep their context
  const missed = !link.fresh ? missedOnDeviceMessages(host, text) : []
  const recap = missed.length
    ? `[Recent chat turns handled on-device before this message:\n${missed.map((m) => `${m.role === 'user' ? 'User' : 'Bun'}: ${m.text}`).join('\n')}\n]\n\n`
    : ''
  const body = `${recap}${rawBody}`
  const redacted = redactDeep({ text: body }, names)
  trace(turn, 'redaction', 'Message redacted before it goes to the agent', { counts: redacted.counts })
  host.audit('agent', 'llm_request', `Agent request (${link.label})`, {
    turnId: turn.id, agent: link.label, promptVersion: PROMPT_VERSION, redactions: redacted.counts, freshSession: link.fresh,
  })
  trace(turn, 'llm', `Asked ${link.label} (an agent on this computer)`, { agent: link.label, freshSession: link.fresh })

  const creatorOn = link.fresh && host.plugins ? await host.plugins.syncEnabled() : false
  const preamble = link.fresh
    ? buildAgentPreamble({
        creatorMode: creatorOn,
        name: redactDeep(state.profile?.name ?? '', names).value,
        currency: currencyOf(state),
        today: state.bank.today,
        tone: toneOf(state),
        autonomy: state.mandate.frozen ? 'observe' : state.mandate.autonomy,
        earlier: redactDeep(earlierMessages(host, text), names).value,
      })
    : ''

  let said = ''
  let stop = ''
  let failure: Extract<AgentEvent, { type: 'error' }> | null = null
  let calls = 0
  const steps = new Map<string, LiveReply['steps'][number]>()
  let permission: LiveReply['permission']
  let lastPush = 0
  const push = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPush < LIVE_EVERY_MS) return
    lastPush = now
    host.live?.({ via: link.label, text: said, steps: [...steps.values()].slice(-12), ...(permission ? { permission } : {}) })
  }
  push(true)

  await link.client.turn({ connectionId: link.connectionId, sessionKey: link.sessionKey, text: redacted.value.text, preamble }, async (ev) => {
    if (ev.type !== 'permission') permission = undefined
    switch (ev.type) {
      case 'text':
        if (said.length < MAX_REPLY_CHARS) said += ev.delta
        return push()
      case 'status':
        steps.set('status', { id: 'status', title: ev.text, status: 'running', mine: true })
        return push(true)
      case 'tool':
        steps.delete('status')
        steps.set(ev.id, { id: ev.id, title: ev.title, status: ev.status === 'completed' ? 'done' : ev.status === 'failed' ? 'failed' : 'running', mine: false })
        return push(true)
      case 'fundbun_tool': {
        steps.delete('status')
        const creatorName = isCreatorTool(ev.name) ? ev.name : null
        const label = creatorName ? CREATOR_TOOL_LABELS[creatorName] : isToolName(ev.name) ? TOOL_SPECS[ev.name].label : ev.name
        steps.set(ev.callId, { id: ev.callId, title: label, status: 'running', mine: true })
        push(true)
        // the same gate as every other tool call; a runaway agent is cut off rather than served forever
        const result = ++calls > MAX_FUNDBUN_CALLS
          ? { content: JSON.stringify({ status: 'denied', reason: 'Too many tool calls in one answer.' }), is_error: true }
          : creatorName
            ? await runCreatorTool(host, turn, creatorName, ev.args)
            : gated(host, turn, ev, reads)
        steps.set(ev.callId, { id: ev.callId, title: label, status: result.is_error ? 'failed' : 'done', mine: true })
        push(true)
        await link.client.toolResult(ev.callId, result.content, result.is_error === true)
        return
      }
      case 'permission':
        permission = { requestId: ev.requestId, title: ev.title, ...(ev.detail ? { detail: ev.detail } : {}), options: ev.options }
        return push(true)
      case 'done':
        stop = ev.stopReason
        return
      case 'error':
        failure = ev
        return
      default:
        return
    }
  }, link.signal)
  host.live?.(null)

  const external = [...steps.values()].filter((s) => !s.mine)
  if (external.length) trace(turn, 'llm', `${link.label} used ${external.length} of its own tool${external.length === 1 ? '' : 's'}`, { tools: external.map((s) => ({ title: s.title.slice(0, 120), status: s.status })) })
  const failed = failure as Extract<AgentEvent, { type: 'error' }> | null
  host.audit('agent', 'llm_response', failed ? `Agent failed (${link.label}): ${failed.code}` : `Agent response (${link.label}): ${stop || 'end'}`, {
    turnId: turn.id, agent: link.label, stopReason: stop || null, error: failed?.code ?? null, fundbunCalls: calls, ownTools: external.length, chars: said.length,
  })

  if (failed && failed.code === 'aborted') {
    trace(turn, 'llm', 'Stopped by the user', {})
    return finish(host, turn, text, said.trim() || 'Stopped.', reads, { via: link.label })
  }
  if (failed && !said.trim()) {
    const reply = fallback(host, turn, text, { code: failed.code, message: failed.message }, reads)
    addNotice(turn, 'warn', `${link.label} could not answer`, failed.message, 'agent_failed')
    return reply
  }
  trace(turn, 'llm', `${link.label} answered · ${stop || 'end'}`, { stopReason: stop || null, fundbunCalls: calls })
  host.llmOk?.()
  return finish(host, turn, text, said, reads, { via: link.label })
}

function gated(host: AgentHost, turn: Turn, ev: Extract<AgentEvent, { type: 'fundbun_tool' }>, reads: ReadResult[]): { content: string; is_error?: boolean } {
  const block = toolResult(host, turn, { type: 'tool_use', id: ev.callId, name: ev.name, input: ev.args }, '', reads)
  return block.type === 'tool_result' ? { content: block.content, ...(block.is_error ? { is_error: true } : {}) } : { content: '{"status":"failed"}', is_error: true }
}

/** The last few messages before this one, for an agent session that starts mid-conversation (after a reload). */
function earlierMessages(host: AgentHost, current: string): { role: 'user' | 'assistant'; text: string }[] {
  const chat = host.state().chat.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
  // the user's message for this turn is already in the chat: leave it out
  const upTo = chat.length && chat[chat.length - 1].role === 'user' && chat[chat.length - 1].text === current ? chat.length - 1 : chat.length
  return chat.slice(Math.max(0, upTo - 6), upTo).map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text.slice(0, 400) }))
}

/** Intervening user/assistant turns handled on-device since the agent's last reply in this chat. */
function missedOnDeviceMessages(host: AgentHost, current: string): { role: 'user' | 'assistant'; text: string }[] {
  const chat = host.state().chat.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
  const upTo = chat.length && chat[chat.length - 1].role === 'user' && chat[chat.length - 1].text === current ? chat.length - 1 : chat.length
  const slice = chat.slice(0, upTo)
  let lastLlm = -1
  for (let i = slice.length - 1; i >= 0; i--) {
    if (slice[i].role === 'assistant' && slice[i].engine === 'llm') {
      lastLlm = i
      break
    }
  }
  const missed = lastLlm >= 0 ? slice.slice(lastLlm + 1) : slice.slice(Math.max(0, slice.length - 6))
  return missed
    .slice(-6)
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: sanitizeField(m.text, 400) }))
    .filter((m) => m.text.length > 0)
}
