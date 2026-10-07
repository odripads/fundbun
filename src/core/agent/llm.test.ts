import { describe, expect, it } from 'vitest'
import { isLlmResponse, LlmClient, LlmError, type LlmRequest, type LlmResponse } from './llm'

type Call = { url: string; init: RequestInit }

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} }
    calls.push(call)
    return respond(call)
  }) as typeof fetch
  return { impl, calls }
}

/** Never answers, but rejects on abort like the real fetch. */
const hanging = () =>
  fakeFetch(({ init }) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  }))

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const REQ: LlmRequest = { system: 'You are Bun.', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 256 }
const RES: LlmResponse = {
  content: [{ type: 'text', text: 'Hello!' }, { type: 'tool_use', id: 't1', name: 'get_overview', input: {} }],
  stopReason: 'tool_use',
  provider: 'mock',
  model: 'fundbun-mock-1',
  redactions: { phone: 1 },
  usage: { inputTokens: 10, outputTokens: 2 },
}

describe('LlmClient.health', () => {
  it('GETs {baseUrl}/health and returns the gateway status', async () => {
    const f = fakeFetch(() => json({ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5', extra: 'ignored' }))
    const health = await new LlmClient('/api', f.impl).health()
    expect(health).toEqual({ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(f.calls[0].url).toBe('/api/health')
    expect(f.calls[0].init.method).toBe('GET')
  })

  it('passes ok=false and the reason through', async () => {
    const f = fakeFetch(() => json({ ok: false, provider: 'none', reason: 'No LLM provider configured' }))
    expect(await new LlmClient('/api', f.impl).health()).toEqual({ ok: false, provider: 'none', reason: 'No LLM provider configured' })
  })

  it('never throws on HTTP errors, network errors, garbage or timeouts', async () => {
    const http = fakeFetch(() => new Response('<html>502</html>', { status: 502 }))
    expect(await new LlmClient('/api', http.impl).health()).toEqual({ ok: false, reason: 'Gateway answered HTTP 502' })

    const network = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await new LlmClient('/api', network.impl).health()).toEqual({ ok: false, reason: 'Gateway unreachable' })

    const garbage = fakeFetch(() => json({ status: 'fine' }))
    expect((await new LlmClient('/api', garbage.impl).health()).ok).toBe(false)

    const notJson = fakeFetch(() => new Response('not json', { status: 200 }))
    expect((await new LlmClient('/api', notJson.impl).health()).ok).toBe(false)

    const slow = hanging()
    expect(await new LlmClient('/api', slow.impl).health(20)).toEqual({ ok: false, reason: 'Gateway health check timed out' })
  })

  it('treats a truthy non-boolean ok as malformed (never reports a fake ok)', async () => {
    const f = fakeFetch(() => json({ ok: 'yes' }))
    expect((await new LlmClient('/api', f.impl).health()).ok).toBe(false)
  })

  it('uses a custom base URL (static deployments, tests)', async () => {
    const f = fakeFetch(() => json({ ok: true }))
    await new LlmClient('https://gw.example/api', f.impl).health()
    expect(f.calls[0].url).toBe('https://gw.example/api/health')
  })
})

describe('LlmClient.complete', () => {
  it('POSTs JSON to {baseUrl}/llm and returns the response', async () => {
    const f = fakeFetch(() => json(RES))
    const r = await new LlmClient('/api', f.impl).complete(REQ)
    expect(r).toEqual(RES)
    expect(f.calls[0].url).toBe('/api/llm')
    expect(f.calls[0].init.method).toBe('POST')
    expect((f.calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual(REQ)
  })

  it('throws LlmError with the gateway status, message, code and Retry-After', async () => {
    const f = fakeFetch(() => json({ error: 'rate_limited', message: 'Too many requests.' }, 429, { 'Retry-After': '12' }))
    const err = await new LlmClient('/api', f.impl).complete(REQ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', message: 'Too many requests.', retryAfterSec: 12 })
  })

  it.each([400, 413, 502, 503])('throws LlmError for HTTP %d', async (status) => {
    const f = fakeFetch(() => json({ error: 'x', message: 'nope' }, status))
    await expect(new LlmClient('/api', f.impl).complete(REQ)).rejects.toMatchObject({ status, message: 'nope' })
  })

  it('falls back to a generic message for non-JSON error bodies and truncates long ones', async () => {
    const html = fakeFetch(() => new Response('<html>Bad Gateway</html>', { status: 502 }))
    await expect(new LlmClient('/api', html.impl).complete(REQ)).rejects.toMatchObject({ status: 502, message: 'LLM gateway error (HTTP 502)' })
    const long = fakeFetch(() => json({ message: 'x'.repeat(5000) }, 500))
    const err = (await new LlmClient('/api', long.impl).complete(REQ).catch((e: unknown) => e)) as LlmError
    expect(err.message.length).toBeLessThanOrEqual(300)
  })

  it('times out with LlmError 408 code timeout', async () => {
    const f = hanging()
    await expect(new LlmClient('/api', f.impl).complete(REQ, 20)).rejects.toMatchObject({ name: 'LlmError', status: 408, code: 'timeout' })
  })

  it('honours a caller AbortSignal (status 0, code aborted)', async () => {
    const f = hanging()
    const controller = new AbortController()
    const pending = new LlmClient('/api', f.impl).complete(REQ, 10_000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ status: 0, code: 'aborted' })
  })

  it('does not even send when the signal is already aborted', async () => {
    const f = hanging()
    await expect(new LlmClient('/api', f.impl).complete(REQ, 10_000, AbortSignal.abort())).rejects.toMatchObject({ status: 0, code: 'aborted' })
    expect(f.calls).toHaveLength(0)
  })

  it('maps network failures to status 0 code network', async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(new LlmClient('/api', f.impl).complete(REQ)).rejects.toMatchObject({ status: 0, code: 'network' })
  })

  it('rejects a malformed 200 response', async () => {
    const f = fakeFetch(() => json({ content: [{ type: 'image' }], stopReason: 'end_turn', provider: 'x', model: 'y' }))
    await expect(new LlmClient('/api', f.impl).complete(REQ)).rejects.toMatchObject({ status: 502, code: 'malformed' })
  })
})

describe('isLlmResponse', () => {
  it('accepts every block type and stop reason', () => {
    expect(isLlmResponse(RES)).toBe(true)
    expect(isLlmResponse({ ...RES, stopReason: 'refusal', content: [] })).toBe(true)
    expect(isLlmResponse({ ...RES, content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] })).toBe(true)
  })

  it.each([
    ['null', null],
    ['missing content', { ...RES, content: undefined }],
    ['unknown stop reason', { ...RES, stopReason: 'pause_turn' }],
    ['tool_use with array input', { ...RES, content: [{ type: 'tool_use', id: 'a', name: 'b', input: [] }] }],
    ['text without text', { ...RES, content: [{ type: 'text' }] }],
    ['missing model', { ...RES, model: 1 }],
  ])('rejects %s', (_label, value) => expect(isLlmResponse(value)).toBe(false))
})

describe('LlmError', () => {
  it('is an Error with status and optional code', () => {
    const e = new LlmError(502, 'bad', 'provider_error')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('LlmError')
    expect(e.status).toBe(502)
    expect(e.code).toBe('provider_error')
    expect(new LlmError(400, 'x').code).toBeUndefined()
  })
})
