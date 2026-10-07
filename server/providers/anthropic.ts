import Anthropic from '@anthropic-ai/sdk'
import type { LlmContentBlock, LlmMessage, LlmResponse, LlmToolDef } from '../../src/core/agent/llm'
import type { AnthropicEffort } from '../config'
import { ProviderError, codeForStatus, type LlmProvider, type ProviderRequest, type ProviderResult } from './types'

/** Server-side refusal fallback, `"default"` form (Anthropic picks the fallback model by refusal category). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export interface AnthropicProviderOptions {
  apiKey: string
  model: string
  /** null omits output_config.effort (for models without effort support) */
  effort?: AnthropicEffort | null
  fallbacks?: boolean
  timeoutMs?: number
  maxRetries?: number
  /** test seam: custom fetch for the SDK */
  fetch?: typeof fetch
}

type MessageParam = Anthropic.Beta.BetaMessageParam
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam

export function toAnthropicMessages(messages: LlmMessage[]): MessageParam[] {
  return messages.flatMap((m) => {
    const content = toAnthropicContent(m.content)
    return content.length ? [{ role: m.role, content }] : []
  })
}

function toAnthropicContent(content: LlmMessage['content']): ContentBlockParam[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : []
  return content.flatMap((b): ContentBlockParam[] => {
    if (b.type === 'text') return b.text.trim() ? [{ type: 'text', text: b.text }] : []
    if (b.type === 'tool_use') return [{ type: 'tool_use', id: b.id, name: b.name, input: b.input }]
    return [{ type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content, ...(b.is_error ? { is_error: true } : {}) }]
  })
}

export function toAnthropicTools(tools: LlmToolDef[]): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
  }))
}

export function mapStopReason(reason: string | null | undefined): LlmResponse['stopReason'] {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end_turn'
  if (reason === 'tool_use' || reason === 'max_tokens' || reason === 'refusal') return reason
  return 'other'
}

/**
 * Map 1:1 onto our blocks. Only blocks after the last `fallback` marker belong to the model that
 * served the turn; thinking and server-tool blocks have no equivalent in the wire format and are dropped
 * (the client never replays them, so no preserved-thinking history check can fail on edited history).
 */
export function fromAnthropicContent(content: Anthropic.Beta.BetaContentBlock[]): LlmContentBlock[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback')
  return content.slice(lastFallback + 1).flatMap((b): LlmContentBlock[] => {
    if (b.type === 'text') return [{ type: 'text', text: b.text }]
    if (b.type === 'tool_use') return [{ type: 'tool_use', id: b.id, name: b.name, input: asRecord(b.input) }]
    return []
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function fromAnthropicMessage(message: Anthropic.Beta.BetaMessage): ProviderResult {
  const stopReason = mapStopReason(message.stop_reason)
  const u = message.usage
  return {
    // a refusal may carry partial output that must not be treated as an answer
    content: stopReason === 'refusal' ? [] : fromAnthropicContent(message.content),
    stopReason,
    provider: 'anthropic',
    model: message.model,
    usage: {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    },
  }
}

/** Typed SDK errors, most specific first; never forwards upstream messages. */
export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError('aborted')
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('upstream_timeout')
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('upstream_unavailable')
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('upstream_rate_limited', 429)
  if (err instanceof Anthropic.APIError && typeof err.status === 'number') return new ProviderError(codeForStatus(err.status), err.status)
  return new ProviderError('upstream_error')
}

export function buildAnthropicParams(
  req: ProviderRequest,
  opts: Pick<AnthropicProviderOptions, 'model' | 'effort' | 'fallbacks'>,
): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: toAnthropicMessages(req.messages),
    // system + tools are stable within a session, so the growing tool-loop prefix is reusable
    cache_control: { type: 'ephemeral' },
    ...(req.tools.length ? { tools: toAnthropicTools(req.tools) } : {}),
    ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
    ...(opts.fallbacks ? { fallbacks: 'default' as const, betas: [FALLBACK_BETA] } : {}),
  }
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    maxRetries: opts.maxRetries ?? 1,
    timeout: opts.timeoutMs ?? 30_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  })
  const effort = opts.effort === undefined ? 'low' : opts.effort
  return {
    name: 'anthropic',
    model: opts.model,
    async complete(req, signal) {
      try {
        const message = await client.beta.messages.create(buildAnthropicParams(req, { ...opts, effort }), { signal })
        return fromAnthropicMessage(message)
      } catch (err) {
        throw toProviderError(err)
      }
    },
  }
}
