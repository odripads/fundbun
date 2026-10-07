import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '../../src/core/agent/llm'
import { buildOpenAiBody, createOpenAiCompatProvider, fromOpenAiResponse, toOpenAiMessages, toOpenAiTools } from './openai'
import { ProviderError, type ProviderRequest } from './types'

const TOOL = { name: 'check_affordability', description: 'Pre-purchase check', input_schema: { type: 'object', properties: { amount: { type: 'integer' } }, required: ['amount'] } }

const ROUND_TRIP: LlmMessage[] = [
  { role: 'user', content: 'Can I afford ¥1,299 headphones?' },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'call_1', name: 'check_affordability', input: { amount: 129900 } },
      { type: 'tool_use', id: 'call_2', name: 'get_overview', input: {} },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'call_1', content: '{"verdict":"think"}' },
      { type: 'tool_result', tool_use_id: 'call_2', content: 'not available', is_error: true },
      { type: 'text', text: 'Also, be brief.' },
    ],
  },
]

const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({ system: 'You are Bun.', messages: ROUND_TRIP, tools: [TOOL], maxTokens: 512, ...overrides })

describe('toOpenAiMessages', () => {
  it('translates a tool round trip into function calling', () => {
    expect(toOpenAiMessages('You are Bun.', ROUND_TRIP)).toEqual([
      { role: 'system', content: 'You are Bun.' },
      { role: 'user', content: 'Can I afford ¥1,299 headphones?' },
      {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'check_affordability', arguments: '{"amount":129900}' } },
          { id: 'call_2', type: 'function', function: { name: 'get_overview', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"verdict":"think"}' },
      { role: 'tool', tool_call_id: 'call_2', content: '[error] not available' },
      { role: 'user', content: 'Also, be brief.' },
    ])
  })

  it('uses null content for tool-only assistant turns and omits an empty system prompt', () => {
    const out = toOpenAiMessages('', [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'get_goals', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{}' }] },
    ])
    expect(out[0]).toEqual({ role: 'user', content: 'x' })
    expect(out[1]).toMatchObject({ role: 'assistant', content: null })
    expect(out).toHaveLength(3)
  })

  it('passes string assistant content through', () => {
    expect(toOpenAiMessages('', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }])).toEqual([
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' },
    ])
  })
})

describe('toOpenAiTools / buildOpenAiBody', () => {
  it('wraps tools as functions', () => {
    expect(toOpenAiTools([TOOL])).toEqual([{ type: 'function', function: { name: TOOL.name, description: TOOL.description, parameters: TOOL.input_schema } }])
  })

  it('builds a non-streaming body with tool_choice auto only when tools exist', () => {
    const body = buildOpenAiBody(request(), 'deepseek-chat')
    expect(body).toMatchObject({ model: 'deepseek-chat', max_tokens: 512, stream: false, tool_choice: 'auto' })
    const noTools = buildOpenAiBody(request({ tools: [] }), 'm')
    expect(noTools).not.toHaveProperty('tools')
    expect(noTools).not.toHaveProperty('tool_choice')
  })
})

describe('fromOpenAiResponse', () => {
  it('maps text + tool calls back to our blocks', () => {
    const r = fromOpenAiResponse({
      model: 'deepseek-chat',
      choices: [{ finish_reason: 'tool_calls', message: { content: 'Checking.', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get_overview', arguments: '{"month":"2026-10"}' } }] } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    }, 'fallback')
    expect(r).toEqual({
      content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'call_9', name: 'get_overview', input: { month: '2026-10' } }],
      stopReason: 'tool_use',
      provider: 'openai_compat',
      model: 'deepseek-chat',
      usage: { inputTokens: 120, outputTokens: 30 },
    })
  })

  it('treats tool calls as tool_use even when finish_reason says stop', () => {
    const r = fromOpenAiResponse({ choices: [{ finish_reason: 'stop', message: { content: null, tool_calls: [{ id: 'x', function: { name: 'get_goals', arguments: '' } }] } }] }, 'm')
    expect(r.stopReason).toBe('tool_use')
    expect(r.content).toEqual([{ type: 'tool_use', id: 'x', name: 'get_goals', input: {} }])
    expect(r.model).toBe('m')
  })

  it.each([
    ['stop', 'end_turn'],
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
    ['weird', 'other'],
  ])('maps finish_reason %s → %s', (finish, stop) => {
    expect(fromOpenAiResponse({ choices: [{ finish_reason: finish, message: { content: 'hi' } }] }, 'm').stopReason).toBe(stop)
  })

  it('drops partial content on a content-filter refusal', () => {
    expect(fromOpenAiResponse({ choices: [{ finish_reason: 'content_filter', message: { content: 'partial' } }] }, 'm').content).toEqual([])
  })

  it('accepts array-of-parts content and generates missing call ids', () => {
    const r = fromOpenAiResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], tool_calls: [{ function: { name: 'get_goals', arguments: '{}' } }] } }] }, 'm')
    expect(r.content).toEqual([{ type: 'text', text: 'ab' }, { type: 'tool_use', id: 'call_0', name: 'get_goals', input: {} }])
  })

  it.each([
    ['no choices', {}],
    ['no message', { choices: [{}] }],
    ['unparseable arguments', { choices: [{ message: { tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{amount: 1' } }] } }] }],
    ['array arguments', { choices: [{ message: { tool_calls: [{ id: 'a', function: { name: 'x', arguments: '[1]' } }] } }] }],
    ['missing function name', { choices: [{ message: { tool_calls: [{ id: 'a', function: { arguments: '{}' } }] } }] }],
  ])('rejects malformed responses: %s', (_label, json) => {
    expect(() => fromOpenAiResponse(json, 'm')).toThrow(ProviderError)
  })
})

type FakeCall = { url: string; init: RequestInit }

function fakeFetch(respond: (call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('createOpenAiCompatProvider', () => {
  it('posts to {base}/chat/completions with bearer auth and translated body', async () => {
    const f = fakeFetch(() => json({ model: 'deepseek-chat', choices: [{ finish_reason: 'stop', message: { content: 'You are fine.' } }] }))
    const p = createOpenAiCompatProvider({ baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'sk-test', model: 'deepseek-chat', fetch: f.impl })
    const r = await p.complete(request())
    expect(r).toMatchObject({ content: [{ type: 'text', text: 'You are fine.' }], stopReason: 'end_turn', provider: 'openai_compat' })
    expect(f.calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions')
    const headers = f.calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(f.calls[0].init.body))
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are Bun.' })
    expect(body.tools[0].function.name).toBe('check_affordability')
  })

  it('omits Authorization for keyless local servers', async () => {
    const f = fakeFetch(() => json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }))
    await createOpenAiCompatProvider({ baseUrl: 'http://localhost:11434/v1', model: 'm', fetch: f.impl }).complete(request())
    expect(f.calls[0].init.headers).not.toHaveProperty('Authorization')
  })

  it.each([
    [429, 'upstream_rate_limited'],
    [401, 'upstream_config'],
    [400, 'upstream_bad_request'],
    [503, 'upstream_unavailable'],
    [504, 'upstream_timeout'],
  ])('maps HTTP %d → %s without leaking the upstream body', async (status, code) => {
    const leak = 'echo: call me on 13812345678'
    const f = fakeFetch(() => json({ error: { message: leak } }, status))
    const p = createOpenAiCompatProvider({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm', fetch: f.impl })
    const err = await p.complete(request()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).toMatchObject({ code, upstreamStatus: status })
    expect((err as Error).message).not.toContain('13812345678')
  })

  it('maps network failures to upstream_unavailable', async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError('fetch failed: getaddrinfo ENOTFOUND')))
    const err = await createOpenAiCompatProvider({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetch: f.impl }).complete(request()).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'upstream_unavailable' })
  })

  it('maps invalid JSON bodies to upstream_malformed', async () => {
    const f = fakeFetch(() => new Response('<html>gateway</html>', { status: 200 }))
    const err = await createOpenAiCompatProvider({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetch: f.impl }).complete(request()).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'upstream_malformed' })
  })

  const hanging = () =>
    fakeFetch(({ init }) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))

  it('times out with upstream_timeout', async () => {
    const f = hanging()
    const err = await createOpenAiCompatProvider({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetch: f.impl, timeoutMs: 30 }).complete(request()).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'upstream_timeout' })
  })

  it('reports a caller abort as aborted', async () => {
    const f = hanging()
    const controller = new AbortController()
    const pending = createOpenAiCompatProvider({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetch: f.impl }).complete(request(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })
})
