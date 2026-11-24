import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/core/ai/types'
import { createGatewayServer, type GatewayOptions } from '../app'
import { createAiService } from '../ai/service'
import { createMemoryStore } from '../ai/store'
import { AcpError } from './acp'
import type { AgentRuntime } from './runtime'

const TOKEN = 'a'.repeat(48)

function fakeAgents(over: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    turn: vi.fn(async (_input, emit) => {
      emit({ type: 'status', text: 'Starting…' })
      emit({ type: 'text', delta: 'Hi' })
      emit({ type: 'done', stopReason: 'end_turn' })
    }),
    toolResult: vi.fn(() => true),
    permission: vi.fn(() => true),
    cancel: vi.fn(),
    bridge: vi.fn(async () => ({ tools: [] })),
    close: vi.fn(),
    ...over,
  }
}

const running: { close: () => Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()))
})

async function start(agents = fakeAgents(), extra: Partial<GatewayOptions> = {}) {
  const ai = createAiService({ store: createMemoryStore() })
  const server = createGatewayServer({ provider: null, rateLimitRpm: 1000, ai, agents, ...extra })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections()
      server.close(() => r())
    })
  running.push({ close })
  return { base: `http://127.0.0.1:${port}`, agents, close }
}

describe('/api/agent/* routes', () => {
  it('streams NDJSON events for POST /api/agent/turn and validates inputs', async () => {
    const { base, agents } = await start()
    const bad = await fetch(`${base}/api/agent/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: 'ai_1', sessionKey: 'bad key!', text: 'hi', preamble: '' }),
    })
    expect(bad.status).toBe(400)

    const res = await fetch(`${base}/api/agent/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: 'ai_1', sessionKey: 'chat_1', text: 'hello', preamble: 'rules' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')
    const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as AgentEvent)
    expect(lines).toEqual([
      { type: 'status', text: 'Starting…' },
      { type: 'text', delta: 'Hi' },
      { type: 'done', stopReason: 'end_turn' },
    ])
    expect(agents.turn).toHaveBeenCalledTimes(1)
  })

  it('aborts the turn signal if the client disconnects mid-stream', async () => {
    let sawAbort = false
    let started!: () => void
    const startedP = new Promise<void>((r) => (started = r))
    const agents = fakeAgents({
      turn: (_input, _emit, signal) =>
        new Promise<void>((resolve) => {
          started()
          signal?.addEventListener('abort', () => {
            sawAbort = true
            resolve()
          })
        }),
    })
    const { base } = await start(agents)
    const ac = new AbortController()
    const pending = fetch(`${base}/api/agent/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: 'ai_1', sessionKey: 'chat_1', text: 'hello', preamble: '' }),
      signal: ac.signal,
    }).catch(() => undefined)
    await startedP
    ac.abort()
    await pending
    await vi.waitFor(() => expect(sawAbort).toBe(true))
  })

  it('handles tool-result, permission, cancel, close and validates bodies', async () => {
    const { base, agents } = await start()

    expect((await fetch(`${base}/api/agent/turn`, { method: 'GET' })).status).toBe(405)
    expect((await fetch(`${base}/api/agent/nope`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)

    const tr = await fetch(`${base}/api/agent/tool-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: 'call_1', content: '{"ok":true}', isError: false }),
    })
    expect(tr.status).toBe(200)
    expect(agents.toolResult).toHaveBeenCalledWith('call_1', '{"ok":true}', false)
    expect((await fetch(`${base}/api/agent/tool-result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId: 'call_1' }) })).status).toBe(400)

    const permOk = await fetch(`${base}/api/agent/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'perm_1', optionId: null }),
    })
    expect(permOk.status).toBe(200)
    expect(agents.permission).toHaveBeenCalledWith('perm_1', null)

    const permBad = await fetch(`${base}/api/agent/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'perm_1', optionId: 123 }),
    })
    expect(permBad.status).toBe(400)
    const permMissing = await fetch(`${base}/api/agent/permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'perm_1' }),
    })
    expect(permMissing.status).toBe(400)

    await fetch(`${base}/api/agent/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey: 'chat_1' }) })
    expect(agents.cancel).toHaveBeenCalledWith('chat_1')

    await fetch(`${base}/api/agent/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionKey: 'chat_1' }) })
    expect(agents.close).toHaveBeenCalledWith('chat_1')
  })

  it('/api/agent/mcp requires a 48-hex bearer token and rejects any browser Origin', async () => {
    const agents = fakeAgents({
      bridge: vi.fn(async (token) => {
        if (token !== TOKEN) throw new AcpError('Unknown session', 401)
        return { tools: [{ name: 'get_overview' }] }
      }),
    })
    const { base } = await start(agents)

    // missing or malformed token -> 401
    expect((await fetch(`${base}/api/agent/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
    expect((await fetch(`${base}/api/agent/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer short' }, body: '{}' })).status).toBe(401)

    // valid token WITH an Origin header (browser request) -> 401
    expect((await fetch(`${base}/api/agent/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: base },
      body: JSON.stringify({ method: 'tools/list' }),
    })).status).toBe(401)

    // valid token, no Origin -> 200
    const ok = await fetch(`${base}/api/agent/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ method: 'tools/list' }),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ tools: [{ name: 'get_overview' }] })

    // unknown session token -> 401
    const unknown = await fetch(`${base}/api/agent/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'b'.repeat(48)}` },
      body: JSON.stringify({ method: 'tools/list' }),
    })
    expect(unknown.status).toBe(401)
  })
})
