import type { LlmContentBlock, LlmMessage, LlmResponse, LlmToolDef } from '../../src/core/agent/llm'
import { ProviderError, codeForStatus, type LlmProvider, type ProviderRequest, type ProviderResult } from './types'

/** Any OpenAI-compatible /chat/completions endpoint (DeepSeek, Qwen/DashScope, local servers). */
export interface OpenAiCompatOptions {
  baseUrl: string
  apiKey?: string
  model: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface OpenAiTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

const MAX_RESPONSE_BYTES = 1_000_000

export function toOpenAiTools(tools: LlmToolDef[]): OpenAiTool[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
}

export function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = system ? [{ role: 'system', content: system }] : []
  for (const m of messages) out.push(...(m.role === 'user' ? userMessages(m.content) : assistantMessages(m.content)))
  return out
}

/** Tool results become `tool` messages, which must directly follow the assistant tool_calls; user text goes after them. */
function userMessages(content: LlmMessage['content']): OpenAiMessage[] {
  if (typeof content === 'string') return [{ role: 'user', content }]
  const tools: OpenAiMessage[] = content.flatMap((b) =>
    b.type === 'tool_result' ? [{ role: 'tool' as const, tool_call_id: b.tool_use_id, content: b.is_error ? `[error] ${b.content}` : b.content }] : [],
  )
  const text = joinText(content)
  return text ? [...tools, { role: 'user', content: text }] : tools
}

function assistantMessages(content: LlmMessage['content']): OpenAiMessage[] {
  if (typeof content === 'string') return [{ role: 'assistant', content }]
  const calls: OpenAiToolCall[] = content.flatMap((b) =>
    b.type === 'tool_use' ? [{ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }] : [],
  )
  const text = joinText(content)
  return [{ role: 'assistant', content: text || (calls.length ? null : ''), ...(calls.length ? { tool_calls: calls } : {}) }]
}

function joinText(blocks: LlmContentBlock[]): string {
  return blocks.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('\n\n')
}

export function buildOpenAiBody(req: ProviderRequest, model: string): Record<string, unknown> {
  return {
    model,
    messages: toOpenAiMessages(req.system, req.messages),
    max_tokens: req.maxTokens,
    stream: false,
    ...(req.tools.length ? { tools: toOpenAiTools(req.tools), tool_choice: 'auto' } : {}),
  }
}

function mapFinishReason(reason: unknown, hasToolCalls: boolean): LlmResponse['stopReason'] {
  if (hasToolCalls) return 'tool_use'
  if (reason === 'stop') return 'end_turn'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'content_filter') return 'refusal'
  return 'other'
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('')
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string') throw new ProviderError('upstream_malformed')
  if (!raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // fall through — a tool call with unparseable arguments must never be executed on a guess
  }
  throw new ProviderError('upstream_malformed')
}

function toToolUse(call: unknown, index: number): LlmContentBlock {
  const c = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
  const name = c?.function?.name
  if (typeof name !== 'string' || !name) throw new ProviderError('upstream_malformed')
  const id = typeof c.id === 'string' && c.id ? c.id : `call_${index}`
  return { type: 'tool_use', id, name, input: parseArguments(c.function?.arguments) }
}

export function fromOpenAiResponse(json: unknown, fallbackModel: string): ProviderResult {
  const body = json as { model?: unknown; choices?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }
  const choice = Array.isArray(body?.choices) ? (body.choices[0] as { message?: unknown; finish_reason?: unknown }) : undefined
  const message = choice?.message as { content?: unknown; tool_calls?: unknown } | undefined
  if (!message || typeof message !== 'object') throw new ProviderError('upstream_malformed')
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.map(toToolUse) : []
  const text = textOf(message.content)
  const stopReason = mapFinishReason(choice?.finish_reason, calls.length > 0)
  const content: LlmContentBlock[] = stopReason === 'refusal' ? [] : [...(text ? [{ type: 'text' as const, text }] : []), ...calls]
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    content,
    stopReason,
    provider: 'openai_compat',
    model: typeof body.model === 'string' && body.model ? body.model : fallbackModel,
    usage: { inputTokens: num(body.usage?.prompt_tokens), outputTokens: num(body.usage?.completion_tokens) },
  }
}

export function createOpenAiCompatProvider(opts: OpenAiCompatOptions): LlmProvider {
  const fetchImpl = opts.fetch ?? fetch
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const timeoutMs = opts.timeoutMs ?? 30_000
  return {
    name: 'openai_compat',
    model: opts.model,
    async complete(req, signal) {
      const timeout = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}) },
          body: JSON.stringify(buildOpenAiBody(req, opts.model)),
          signal: combined,
        })
        if (!res.ok) {
          // the error body may echo request content — discard it unread
          await res.body?.cancel().catch(() => undefined)
          throw new ProviderError(codeForStatus(res.status), res.status)
        }
        const raw = await res.text()
        if (raw.length > MAX_RESPONSE_BYTES) throw new ProviderError('upstream_malformed')
        return fromOpenAiResponse(parseJson(raw), opts.model)
      } catch (err) {
        if (err instanceof ProviderError) throw err
        if (signal?.aborted) throw new ProviderError('aborted')
        if (timeout.aborted) throw new ProviderError('upstream_timeout')
        throw new ProviderError('upstream_unavailable')
      }
    },
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ProviderError('upstream_malformed')
  }
}
