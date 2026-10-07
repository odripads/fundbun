import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmClient, type LlmRequest, type LlmResponse } from '../src/core/agent/llm'
import { buildSystemPrompt } from '../src/core/agent/prompts'
import { llmToolDefinitions } from '../src/core/agent/specs'
import { redactDeep } from '../src/core/security/redact'
import { createGatewayServer, SECURITY_HEADERS, type GatewayOptions, type Redactor } from './app'
import { createMockProvider, MOCK_INJECT_AMOUNT, type MockProvider } from './providers/mock'
import { ProviderError, type LlmProvider } from './providers/types'
import { LIMITS } from './schema'
import { createStaticHandler } from './static'

const PHONE = '13812345678'
const CARD = '4111111111111111'
const SYSTEM = buildSystemPrompt({ name: 'Mei', currency: 'CNY', today: '2026-10-22', tone: 'cheeky', autonomy: 'copilot' })
const TOOLS = llmToolDefinitions()

/** Stand-in for the real redactor so gateway plumbing is testable on its own: masks long digit runs. */
const fakeRedact: Redactor = (value) => {
  let count = 0
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/\d[\d -]{9,22}\d/g, () => (count++, '[NUMBER]'))
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  const out = walk(value)
  const counts: Record<string, number> = count ? { number: count } : {}
  return { value: out, counts }
}

const realRedactorReady = (() => {
  try {
    redactDeep({ probe: 'x' })
    return true
  } catch {
    return false
  }
})()

interface Started {
  base: string
  port: number
  provider: LlmProvider | null
  mock: MockProvider
  logs: string[]
  close: () => Promise<void>
}

const running: Started[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()))
})

async function start(opts: Partial<GatewayOptions> = {}): Promise<Started> {
  const mock = createMockProvider()
  const logs: string[] = []
  const provider = 'provider' in opts ? (opts.provider ?? null) : mock
  const server = createGatewayServer({ rateLimitRpm: 1000, redact: fakeRedact, log: (l) => logs.push(l), ...opts, provider })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const started: Started = {
    base: `http://127.0.0.1:${port}`,
    port,
    provider,
    mock,
    logs,
    close: () => new Promise<void>((r) => {
      server.closeAllConnections()
      server.close(() => r())
    }),
  }
  running.push(started)
  return started
}

const llmBody = (text: string, extra: Partial<LlmRequest> = {}): LlmRequest => ({ system: SYSTEM, messages: [{ role: 'user', content: text }], tools: TOOLS, ...extra })

function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
}

describe('GET /api/health', () => {
  it('reports the configured provider', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, provider: 'mock', model: 'fundbun-mock-1' })
  })

  it('reports ok=false with a reason when no provider is configured', async () => {
    const { base } = await start({ provider: null, unavailableReason: 'ANTHROPIC_API_KEY is not set', providerLabel: { provider: 'anthropic', model: 'claude-sonnet-5-5' } })
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: false, provider: 'anthropic', model: 'claude-sonnet-5-5', reason: 'ANTHROPIC_API_KEY is not set' })
  })

  it('answers HEAD without a body and rejects POST', async () => {
    const { base } = await start()
    const head = await fetch(`${base}/api/health`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    const res = await fetch(`${base}/api/health`, { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })
})

describe('security headers and routing', () => {
  it('sets the security headers on every response, including errors', async () => {
    const { base } = await start()
    const responses = await Promise.all([
      fetch(`${base}/api/health`),
      fetch(`${base}/api/nope`),
      fetch(`${base}/anything`),
      post(base, '{bad json'),
    ])
    for (const res of responses) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value)
    }
  })

  it('uses the required CSP directives', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy']
    for (const d of ["default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'", "connect-src 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(d)
  })

  it('never sends CORS headers, even to a foreign Origin', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await fetch(`${base}/api/llm`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })
    expect(preflight.status).toBe(405)
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('returns JSON 404s for unknown API routes and non-API paths in development', async () => {
    const { base } = await start()
    const api = await fetch(`${base}/api/admin`)
    expect(api.status).toBe(404)
    expect(await api.json()).toMatchObject({ error: 'not_found' })
    expect((await fetch(`${base}/`)).status).toBe(404)
  })

  it('serves the built app in production mode with security headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fundbun-gw-dist-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>FundBun</title>')
    writeFileSync(join(dir, 'assets/index-AbCdEf12.js'), 'x')
    try {
      const { base } = await start({ staticHandler: createStaticHandler({ root: dir }) })
      const page = await fetch(`${base}/mirror`)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('FundBun')
      expect(page.headers.get('content-security-policy')).toBe(SECURITY_HEADERS['Content-Security-Policy'])
      const asset = await fetch(`${base}/assets/index-AbCdEf12.js`)
      expect(asset.headers.get('cache-control')).toContain('immutable')
      expect((await fetch(`${base}/api/health`)).status).toBe(200)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('POST /api/llm — validation', () => {
  it('rejects invalid JSON with 400', async () => {
    const { base, mock } = await start()
    const res = await post(base, '{"system": ')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_json' })
    expect(mock.received).toHaveLength(0)
  })

  it.each([
    ['missing messages', { system: 'x', tools: [] }],
    ['system over 20k chars', llmBody('hi', { system: 'x'.repeat(20_001) })],
    ['more than 40 messages', llmBody('hi', { messages: Array.from({ length: 41 }, () => ({ role: 'user' as const, content: 'x' })) })],
    ['more than 40 tools', llmBody('hi', { tools: Array.from({ length: 41 }, (_, i) => ({ name: `t${i}`, description: 'd', input_schema: { type: 'object' } })) })],
    ['maxTokens over 2048', llmBody('hi', { maxTokens: 4096 })],
    ['a smuggled provider parameter', { ...llmBody('hi'), model: 'claude-opus-5-5' }],
    ['an assistant prefill', llmBody('hi', { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })],
  ])('rejects %s with 400 and issue paths', async (_label, body) => {
    const { base, mock } = await start()
    const res = await post(base, body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_request')
    expect(Array.isArray(json.issues)).toBe(true)
    expect(mock.received).toHaveLength(0)
  })

  it('refuses to offer prohibited (T4) tools to the model', async () => {
    const { base, mock } = await start()
    const res = await post(base, llmBody('hi', { tools: [...TOOLS.slice(0, 2), { name: 'transfer_external', description: 'x', input_schema: { type: 'object' } }] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'tool_not_allowed' })
    expect(mock.received).toHaveLength(0)
  })

  it('requires application/json', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(llmBody('hi')) })
    expect(res.status).toBe(415)
  })

  it('accepts a charset parameter on the content type', async () => {
    const { base } = await start()
    const res = await post(base, llmBody('hello'), { 'Content-Type': 'application/json; charset=utf-8' })
    expect(res.status).toBe(200)
  })

  it('only allows POST', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/llm`)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })
})

describe('POST /api/llm — size limit', () => {
  it('rejects a declared body over 256 KB with 413 before reading it', async () => {
    const { base, mock } = await start()
    const big = JSON.stringify(llmBody('x'.repeat(LIMITS.bodyBytes)))
    const res = await post(base, big)
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' })
    expect(mock.received).toHaveLength(0)
  })

  it('rejects an oversized chunked body (no Content-Length) with 413', async () => {
    const { port, mock } = await start()
    const status = await new Promise<number>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/llm', method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => {
        res.resume()
        done(res.statusCode ?? 0)
      })
      req.on('error', fail)
      const chunk = 'x'.repeat(64 * 1024)
      for (let i = 0; i < 5; i++) req.write(chunk)
      req.end()
    })
    expect(status).toBe(413)
    expect(mock.received).toHaveLength(0)
  })

  it('accepts a body just under the limit', async () => {
    const { base } = await start()
    const body = llmBody('hello')
    const pad = LIMITS.bodyBytes - Buffer.byteLength(JSON.stringify(body)) - 100
    const res = await post(base, llmBody('hello', { system: '' , messages: [{ role: 'user', content: 'a'.repeat(pad) }] }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/llm — rate limiting', () => {
  it('returns 429 with Retry-After once the per-IP bucket is empty', async () => {
    const { base, mock } = await start({ rateLimitRpm: 3 })
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await post(base, llmBody('hello'))).status)
    expect(statuses).toEqual([200, 200, 200, 429])
    const res = await post(base, llmBody('hello'))
    expect(res.headers.get('retry-after')).toBe('20')
    expect(await res.json()).toMatchObject({ error: 'rate_limited', retryAfterSec: 20 })
    expect(mock.received).toHaveLength(3)
  })

  it('ignores X-Forwarded-For unless the proxy is trusted (no bypass by spoofing)', async () => {
    const { base } = await start({ rateLimitRpm: 1 })
    expect((await post(base, llmBody('a'), { 'X-Forwarded-For': '1.1.1.1' })).status).toBe(200)
    expect((await post(base, llmBody('a'), { 'X-Forwarded-For': '2.2.2.2' })).status).toBe(429)
  })

  it('keys buckets by the forwarded client IP behind a trusted proxy', async () => {
    const { base } = await start({ rateLimitRpm: 1, trustProxy: true })
    expect((await post(base, llmBody('a'), { 'X-Forwarded-For': '1.1.1.1' })).status).toBe(200)
    expect((await post(base, llmBody('a'), { 'X-Forwarded-For': '2.2.2.2, 10.0.0.1' })).status).toBe(200)
    expect((await post(base, llmBody('a'), { 'X-Forwarded-For': '1.1.1.1' })).status).toBe(429)
  })

  it('does not rate-limit the health check', async () => {
    const { base } = await start({ rateLimitRpm: 1 })
    for (let i = 0; i < 5; i++) expect((await fetch(`${base}/api/health`)).status).toBe(200)
  })
})

describe('POST /api/llm — same-origin only', () => {
  it('rejects a foreign Origin and cross-site fetch metadata with 403', async () => {
    const { base, mock } = await start()
    expect((await post(base, llmBody('hi'), { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(base, llmBody('hi'), { Origin: 'null' })).status).toBe(403)
    expect((await post(base, llmBody('hi'), { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect(mock.received).toHaveLength(0)
  })

  it('accepts the same origin and allow-listed origins', async () => {
    const { base, port } = await start({ allowedOrigins: ['https://fundbun.example'] })
    expect((await post(base, llmBody('hi'), { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200)
    expect((await post(base, llmBody('hi'), { Origin: 'https://fundbun.example' })).status).toBe(200)
  })
})

describe('POST /api/llm — provider availability and errors', () => {
  it('answers 503 when no provider is configured', async () => {
    const { base } = await start({ provider: null, unavailableReason: 'ANTHROPIC_API_KEY is not set' })
    const res = await post(base, llmBody('hi'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'llm_unavailable', message: 'ANTHROPIC_API_KEY is not set' })
  })

  it('maps provider failures to 502 with a sanitised message and no stack trace', async () => {
    const leaky: LlmProvider = {
      name: 'leaky',
      model: 'm',
      complete: async () => {
        throw new Error(`upstream said: user ${PHONE} at /srv/app/node_modules/x.js:12`)
      },
    }
    const { base, logs } = await start({ provider: leaky })
    const res = await post(base, llmBody('hi'))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'provider_error', code: 'upstream_error', message: 'The AI provider failed.' })
    expect(text).not.toContain(PHONE)
    expect(text).not.toContain('node_modules')
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0))
    expect(logs.join('\n')).not.toContain(PHONE)
  })

  it('passes typed provider error codes through', async () => {
    const limited: LlmProvider = { name: 'p', model: 'm', complete: async () => { throw new ProviderError('upstream_rate_limited', 429) } }
    const { base } = await start({ provider: limited })
    const res = await post(base, llmBody('hi'))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'upstream_rate_limited' })
  })

  it('enforces an overall provider deadline (502 upstream_timeout)', async () => {
    let sawAbort = false
    const slow: LlmProvider = {
      name: 'slow',
      model: 'm',
      complete: (_req, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          sawAbort = true
          reject(new ProviderError('aborted'))
        })
      }),
    }
    const { base } = await start({ provider: slow, providerTimeoutMs: 50 })
    const res = await post(base, llmBody('hi'))
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'upstream_timeout' })
    expect(sawAbort).toBe(true)
  })

  it('aborts the provider call when the client disconnects', async () => {
    let providerSignal: AbortSignal | undefined
    let called!: () => void
    const calledP = new Promise<void>((r) => (called = r))
    const hanging: LlmProvider = {
      name: 'hang',
      model: 'm',
      complete: (_req, signal) => {
        providerSignal = signal
        called()
        return new Promise(() => undefined)
      },
    }
    const { base, logs } = await start({ provider: hanging })
    const controller = new AbortController()
    const pending = fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(llmBody('hi')), signal: controller.signal }).catch(() => undefined)
    await calledP
    controller.abort()
    await pending
    await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true))
    await vi.waitFor(() => expect(logs.some((l) => l.includes(' 499 '))).toBe(true))
  })
})

describe('POST /api/llm — server-side redaction', () => {
  it('redacts before the provider sees anything and reports counts', async () => {
    const { base, mock } = await start()
    const res = await post(base, llmBody(`How am I doing? Call ${PHONE}, card ${CARD}. I spent ¥2,000.`))
    expect(res.status).toBe(200)
    const json = (await res.json()) as LlmResponse
    expect(json.redactions).toEqual({ number: 2 })
    const seen = JSON.stringify(mock.received)
    expect(seen).not.toContain(PHONE)
    expect(seen).not.toContain(CARD)
    expect(seen).toContain('¥2,000')
  })

  it('redacts tool results and the system prompt too', async () => {
    const { base, mock } = await start()
    await post(base, {
      system: `${SYSTEM}\nUser phone ${PHONE}`,
      tools: TOOLS,
      messages: [
        { role: 'user', content: 'search' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_transactions', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `{"memo":"pay ${CARD}"}` }] },
      ],
    })
    const seen = JSON.stringify(mock.received)
    expect(seen).not.toContain(PHONE)
    expect(seen).not.toContain(CARD)
  })

  it('fails closed (503) when redaction throws — nothing reaches the provider', async () => {
    const { base, mock } = await start({ redact: () => { throw new Error('redactor down') } })
    const res = await post(base, llmBody(`call ${PHONE}`))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'redaction_unavailable' })
    expect(mock.received).toHaveLength(0)
  })

  it('fails closed when the redactor returns something that is not a request', async () => {
    const { base, mock } = await start({ redact: () => ({ value: 'oops', counts: {} }) })
    expect((await post(base, llmBody('hi'))).status).toBe(503)
    expect(mock.received).toHaveLength(0)
  })

  it.runIf(!realRedactorReady)('with the real redactor still a stub, the default gateway fails closed', async () => {
    const { base, mock } = await start({ redact: undefined })
    const res = await post(base, llmBody(`call ${PHONE}`))
    expect(res.status).toBe(503)
    expect(mock.received).toHaveLength(0)
  })

  it.runIf(realRedactorReady)('integration: the real redactDeep strips phone and card numbers but keeps amounts', async () => {
    const { base, mock } = await start({ redact: undefined })
    const res = await post(base, llmBody(`Text me on ${PHONE} or +86 138 1234 5678. Card 4111 1111 1111 1111. Can I afford ¥2,000 shoes?`))
    expect(res.status).toBe(200)
    const json = (await res.json()) as LlmResponse
    expect(Object.values(json.redactions ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2)
    const seen = JSON.stringify(mock.received)
    expect(seen).not.toContain(PHONE)
    expect(seen).not.toContain('138 1234 5678')
    expect(seen).not.toContain(CARD)
    expect(seen).not.toContain('4111 1111 1111 1111')
    expect(seen).toContain('¥2,000')
  })
})

describe('POST /api/llm — tool-use round trip (mock provider)', () => {
  it('proposes a tool, then answers with numbers quoted from the tool result', async () => {
    const { base } = await start()
    const question = 'How am I doing this month?'
    const first = (await (await post(base, llmBody(question))).json()) as LlmResponse
    expect(first.stopReason).toBe('tool_use')
    const call = first.content.find((b) => b.type === 'tool_use')
    expect(call).toMatchObject({ name: 'get_overview' })
    if (call?.type !== 'tool_use') throw new Error('no tool call')

    const second = (await (await post(base, {
      system: SYSTEM,
      tools: TOOLS,
      messages: [
        { role: 'user', content: question },
        { role: 'assistant', content: first.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ spent: 1_214_000, target: 950_000 }) }] },
      ],
    })).json()) as LlmResponse
    expect(second.stopReason).toBe('end_turn')
    expect(second.provider).toBe('mock')
    const text = second.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('¥12,140')
    expect(text).toContain('¥9,500')
  })

  it('#inject yields a transfer_external proposal for the policy engine to deny', async () => {
    const { base } = await start()
    const r = (await (await post(base, llmBody('pay my electricity bill #inject'))).json()) as LlmResponse
    expect(r.content.find((b) => b.type === 'tool_use')).toMatchObject({ name: 'transfer_external', input: { amount: MOCK_INJECT_AMOUNT } })
  })
})

describe('logging', () => {
  it('logs method, path, status, latency and provider — never bodies or query strings', async () => {
    const { base, logs } = await start()
    await post(base, llmBody(`my phone is ${PHONE}`))
    await fetch(`${base}/api/health?token=abc123`)
    await vi.waitFor(() => expect(logs).toHaveLength(2))
    expect(logs[0]).toMatch(/^\[gateway\] POST \/api\/llm 200 \d+ms provider=mock$/)
    expect(logs[1]).toMatch(/^\[gateway\] GET \/api\/health 200 \d+ms provider=mock$/)
    const all = logs.join('\n')
    expect(all).not.toContain(PHONE)
    expect(all).not.toContain('abc123')
  })
})

describe('LlmClient against the live gateway', () => {
  it('health() and complete() work end to end', async () => {
    const { base } = await start()
    const client = new LlmClient(`${base}/api`)
    expect(await client.health()).toEqual({ ok: true, provider: 'mock', model: 'fundbun-mock-1' })
    const r = await client.complete(llmBody('Can I afford ¥1,299 headphones?'))
    expect(r.content[0]).toMatchObject({ type: 'tool_use', name: 'check_affordability', input: { amount: 129_900 } })
  })

  it('surfaces gateway errors as LlmError with status and code', async () => {
    const { base } = await start({ rateLimitRpm: 1 })
    const client = new LlmClient(`${base}/api`)
    await client.complete(llmBody('hello'))
    await expect(client.complete(llmBody('hello'))).rejects.toMatchObject({ name: 'LlmError', status: 429, code: 'rate_limited', retryAfterSec: 60 })
  })

  it('health() reports an unreachable gateway without throwing', async () => {
    const { base, close } = await start()
    await close()
    const health = await new LlmClient(`${base}/api`).health(500)
    expect(health.ok).toBe(false)
  })
})
