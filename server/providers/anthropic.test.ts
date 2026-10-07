import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '../../src/core/agent/llm'
import {
  buildAnthropicParams,
  createAnthropicProvider,
  FALLBACK_BETA,
  fromAnthropicContent,
  fromAnthropicMessage,
  mapStopReason,
  toAnthropicMessages,
  toAnthropicTools,
} from './anthropic'
import { ProviderError, type ProviderRequest } from './types'

const TOOL = { name: 'get_overview', description: 'Month overview', input_schema: { type: 'object', properties: {}, additionalProperties: false } }
const MESSAGES: LlmMessage[] = [
  { role: 'user', content: 'How am I doing?' },
  { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_overview', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"spent":1214000}' }, { type: 'tool_result', tool_use_id: 'toolu_x', content: 'oops', is_error: true }] },
]
const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({ system: 'You are Bun.', messages: MESSAGES, tools: [TOOL], maxTokens: 512, ...overrides })

function message(overrides: Partial<Anthropic.Beta.BetaMessage> = {}): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: 'You spent ¥12,140.', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
    ...overrides,
  } as Anthropic.Beta.BetaMessage
}

describe('toAnthropicMessages / toAnthropicTools', () => {
  it('maps our blocks 1:1', () => {
    expect(toAnthropicMessages(MESSAGES)).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'How am I doing?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_overview', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"spent":1214000}' }, { type: 'tool_result', tool_use_id: 'toolu_x', content: 'oops', is_error: true }] },
    ])
  })

  it('drops empty text blocks and empty messages (the API rejects them)', () => {
    expect(toAnthropicMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '   ' },
      { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'tool_use', id: 't', name: 'x', input: {} }] },
    ])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] },
    ])
  })

  it('passes tool definitions through', () => {
    expect(toAnthropicTools([TOOL])).toEqual([TOOL])
  })
})

describe('response mapping', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['stop_sequence', 'end_turn'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
    [null, 'other'],
  ])('maps stop_reason %s → %s', (input, output) => expect(mapStopReason(input)).toBe(output))

  it('keeps text and tool_use, drops thinking and other block types', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Let me look.', citations: null },
      { type: 'tool_use', id: 'toolu_2', name: 'get_goals', input: { a: 1 } },
      { type: 'redacted_thinking', data: 'x' },
    ] as Anthropic.Beta.BetaContentBlock[]
    expect(fromAnthropicContent(content)).toEqual([
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_use', id: 'toolu_2', name: 'get_goals', input: { a: 1 } },
    ])
  })

  it('only keeps content after the last fallback marker', () => {
    const content = [
      { type: 'text', text: 'partial from the declining model', citations: null },
      { type: 'fallback', from: { model: 'claude-sonnet-5-5' }, to: { model: 'claude-sonnet-5' } },
      { type: 'text', text: 'served by fallback', citations: null },
    ] as unknown as Anthropic.Beta.BetaContentBlock[]
    expect(fromAnthropicContent(content)).toEqual([{ type: 'text', text: 'served by fallback' }])
  })

  it('reports the serving model and total input tokens including cache', () => {
    expect(fromAnthropicMessage(message({ model: 'claude-sonnet-5' }))).toEqual({
      content: [{ type: 'text', text: 'You spent ¥12,140.' }],
      stopReason: 'end_turn',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 160, outputTokens: 20 },
    })
  })

  it('discards partial output on a refusal', () => {
    const r = fromAnthropicMessage(message({ stop_reason: 'refusal' }))
    expect(r.stopReason).toBe('refusal')
    expect(r.content).toEqual([])
  })
})

describe('buildAnthropicParams', () => {
  it('builds the request with effort, caching and the default fallback', () => {
    const params = buildAnthropicParams(request(), { model: 'claude-sonnet-5-5', effort: 'low', fallbacks: true })
    expect(params).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 512,
      system: 'You are Bun.',
      cache_control: { type: 'ephemeral' },
      output_config: { effort: 'low' },
      fallbacks: 'default',
      betas: [FALLBACK_BETA],
    })
    expect(params.tools).toHaveLength(1)
    // never forced tool use or a manual thinking budget: both are 400s on current models
    expect(params).not.toHaveProperty('tool_choice')
    expect(params).not.toHaveProperty('thinking')
    expect(params).not.toHaveProperty('temperature')
  })

  it('omits optional features when disabled', () => {
    const params = buildAnthropicParams(request({ tools: [] }), { model: 'claude-haiku-4-5', effort: null, fallbacks: false })
    expect(params).not.toHaveProperty('tools')
    expect(params).not.toHaveProperty('output_config')
    expect(params).not.toHaveProperty('fallbacks')
    expect(params).not.toHaveProperty('betas')
  })
})

type Captured = { url: string; headers: Headers; body: Record<string, unknown> }

function sdkFetch(respond: () => Response | Promise<Response>) {
  const calls: Captured[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) })
    return respond()
  }) as typeof fetch
  return { impl, calls }
}

/** Never answers, but honours the abort signal like the real fetch. */
const hangingFetch = (async (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })) as typeof fetch

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'request-id': 'req_test' } })
const apiError = (status: number, type: string) => jsonResponse({ type: 'error', error: { type, message: 'upstream detail: user said 13812345678' } }, status)

describe('createAnthropicProvider (SDK over a fake fetch)', () => {
  const make = (respond: () => Response | Promise<Response>, extra: { timeoutMs?: number } = {}) => {
    const f = sdkFetch(respond)
    const provider = createAnthropicProvider({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5-5', fallbacks: true, maxRetries: 0, fetch: f.impl, ...extra })
    return { provider, calls: f.calls }
  }

  it('sends a beta Messages request with the fallback header and maps the reply', async () => {
    const { provider, calls } = make(() => jsonResponse(message({
      content: [{ type: 'text', text: 'Checking.', citations: null }, { type: 'tool_use', id: 'toolu_9', name: 'get_overview', input: {} }],
      stop_reason: 'tool_use',
    } as Partial<Anthropic.Beta.BetaMessage>)))
    const r = await provider.complete(request())
    expect(r).toMatchObject({ stopReason: 'tool_use', provider: 'anthropic', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'toolu_9', name: 'get_overview', input: {} }] })
    expect(calls[0].url).toContain('/v1/messages')
    expect(calls[0].headers.get('anthropic-beta')).toContain(FALLBACK_BETA)
    expect(calls[0].headers.get('x-api-key')).toBe('sk-ant-test')
    expect(calls[0].body).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', output_config: { effort: 'low' }, max_tokens: 512 })
    expect(calls[0].body).not.toHaveProperty('betas')
  })

  it.each([
    [429, 'rate_limit_error', 'upstream_rate_limited'],
    [401, 'authentication_error', 'upstream_config'],
    [404, 'not_found_error', 'upstream_config'],
    [400, 'invalid_request_error', 'upstream_bad_request'],
    [529, 'overloaded_error', 'upstream_unavailable'],
    [500, 'api_error', 'upstream_unavailable'],
  ])('maps HTTP %d (%s) → %s with a sanitised message', async (status, type, code) => {
    const { provider } = make(() => apiError(status, type))
    const err = await provider.complete(request()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({ code })
    expect((err as Error).message).not.toContain('13812345678')
    expect((err as Error).message).not.toContain('upstream detail')
  })

  it('maps connection failures', async () => {
    const { provider } = make(() => Promise.reject(new TypeError('fetch failed')))
    await expect(provider.complete(request())).rejects.toMatchObject({ code: 'upstream_unavailable' })
  })

  it('maps a caller abort to aborted', async () => {
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', maxRetries: 0, fetch: hangingFetch })
    const controller = new AbortController()
    const pending = provider.complete(request(), controller.signal)
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('maps the SDK timeout to upstream_timeout', async () => {
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', maxRetries: 0, timeoutMs: 30, fetch: hangingFetch })
    await expect(provider.complete(request())).rejects.toMatchObject({ code: 'upstream_timeout' })
  })
})
