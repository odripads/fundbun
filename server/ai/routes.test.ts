import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiState } from '../../src/core/ai/types'
import { buildSystemPrompt } from '../../src/core/agent/prompts'
import { llmToolDefinitions } from '../../src/core/agent/specs'
import { createGatewayServer, type GatewayOptions } from '../app'
import { createAgentRuntime } from '../agents/runtime'
import { createMockProvider } from '../providers/mock'
import { createAiService } from './service'
import { createMemoryStore } from './store'

const SYSTEM = buildSystemPrompt({ name: 'Jing', currency: 'CNY', today: '2026-10-22', tone: 'cheeky', autonomy: 'copilot' })
const TOOLS = llmToolDefinitions()
const LLM_BODY = { system: SYSTEM, messages: [{ role: 'user' as const, content: 'How am I doing?' }], tools: TOOLS }

const running: { close: () => Promise<void> }[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()))
})

async function start(opts: Partial<GatewayOptions> = {}) {
  const server = createGatewayServer({ provider: null, rateLimitRpm: 1000, ...opts })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections()
      server.close(() => r())
    })
  running.push({ close })
  return { base: `http://127.0.0.1:${port}`, port, close }
}

function rawHttp(port: number, method: string, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

describe('/api/ai/* and /api/agent/* without local ai enabled', () => {
  it('returns 404 for every /api/ai/* and /api/agent/* route', async () => {
    const { base } = await start()
    for (const [method, path] of [
      ['GET', '/api/ai/state'],
      ['POST', '/api/ai/connections'],
      ['POST', '/api/ai/active'],
      ['POST', '/api/agent/turn'],
      ['POST', '/api/agent/mcp'],
    ]) {
      const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined })
      expect(res.status, `${method} ${path}`).toBe(404)
    }
  })
})

describe('local host & same-origin guards on /api/ai/*, /api/agent/*, /api/llm', () => {
  it('refuses a foreign Origin with 403 and a forged foreign Host with 403', async () => {
    const ai = createAiService({ store: createMemoryStore() })
    const agents = createAgentRuntime({ ai, workspace: '/tmp/fb-w', bridgeUrl: () => 'http://127.0.0.1:1/api/agent/mcp', bridgeScript: 'x.mjs' })
    const { base, port } = await start({ ai, agents })

    expect((await fetch(`${base}/api/ai/state`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    expect((await fetch(`${base}/api/ai/state`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403)
    expect((await fetch(`${base}/api/agent/turn`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403)

    const hostState = await rawHttp(port, 'GET', '/api/ai/state', { Host: `evil.example:${port}` })
    expect(hostState.status).toBe(403)

    const hostLlm = await rawHttp(port, 'POST', '/api/llm', { Host: `evil.example:${port}`, 'Content-Type': 'application/json' }, JSON.stringify(LLM_BODY))
    expect(hostLlm.status).toBe(403)

    const hostAgent = await rawHttp(port, 'POST', '/api/agent/turn', { Host: `evil.example:${port}`, 'Content-Type': 'application/json' }, '{}')
    expect(hostAgent.status).toBe(403)
  })
})

describe('/api/ai/* CRUD, health shapes and /api/llm integration', () => {
  it('supports add, list, patch, models, test, setActive, remove and 404/415 errors', async () => {
    let providerFail = false
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const s = String(url)
      if (s.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (providerFail) return new Response('err', { status: 500 })
      return new Response(JSON.stringify({
        model: 'deepseek-chat',
        choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ping', arguments: '{"word":"bun"}' } }] }, finish_reason: 'tool_calls' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const ai = createAiService({ store: createMemoryStore(), fetch: fakeFetch })
    const { base } = await start({ ai, provider: createMockProvider() })

    // nothing connected yet: /api/health says ok=false, and /api/llm returns 503 even with opts.provider set
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: false, provider: 'none', local: true, reason: 'No AI connected yet' })
    expect((await fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LLM_BODY) })).status).toBe(503)

    // 415 for non-JSON
    expect((await fetch(`${base}/api/ai/connections`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)

    // add DeepSeek connection (model fetched automatically)
    const added = await (await fetch(`${base}/api/ai/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'deepseek', apiKey: 'sk-test-secret' }),
    })).json() as { connection: { id: string; model: string }; state: AiState }
    expect(added.connection.model).toBe('deepseek-chat')
    expect(JSON.stringify(added)).not.toContain('sk-test-secret')

    // /api/health reflects active API connection
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({
      ok: true, provider: 'DeepSeek', model: 'deepseek-chat', local: true, kind: 'openai_compat', connectionId: added.connection.id, onDevice: false,
    })

    // models + patch + test
    expect(await (await fetch(`${base}/api/ai/connections/${added.connection.id}/models`)).json()).toEqual({ models: ['deepseek-chat', 'deepseek-reasoner'] })
    const patched = await fetch(`${base}/api/ai/connections/${added.connection.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-reasoner', label: 'My DeepSeek' }),
    })
    expect(patched.status).toBe(200)
    expect((await patched.json()).connection).toMatchObject({ label: 'My DeepSeek', model: 'deepseek-reasoner' })

    const tested = await (await fetch(`${base}/api/ai/connections/${added.connection.id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    expect(tested).toMatchObject({ ok: true, tools: true })

    // /api/llm failure records lastError on the connection
    providerFail = true
    const llmFail = await fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LLM_BODY) })
    expect(llmFail.status).toBe(502)
    const afterFail = await (await fetch(`${base}/api/ai/state`)).json() as AiState
    expect(afterFail.connections[0].lastError).toBeTruthy()

    // /api/llm success clears lastError
    providerFail = false
    const llmOk = await fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LLM_BODY) })
    expect(llmOk.status).toBe(200)
    const afterOk = await (await fetch(`${base}/api/ai/state`)).json() as AiState
    expect(afterOk.connections[0].lastError).toBeUndefined()

    // agent connection health shape and /api/llm returning 503 for agent
    const agentRes = await (await fetch(`${base}/api/ai/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ presetId: 'claude-code' }),
    })).json() as { connection: { id: string } }
    await fetch(`${base}/api/ai/active`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: agentRes.connection.id }) })
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({
      ok: true, provider: 'Claude Code', model: '', local: true, kind: 'agent', connectionId: agentRes.connection.id,
    })
    expect((await fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LLM_BODY) })).status).toBe(503)

    // 404s and delete
    expect((await fetch(`${base}/api/ai/connections/ai_000000000000`, { method: 'DELETE' })).status).toBe(404)
    expect((await fetch(`${base}/api/ai/connections/not-an-id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect((await fetch(`${base}/api/ai/unknown`)).status).toBe(404)
    expect((await fetch(`${base}/api/ai/connections/${added.connection.id}`, { method: 'DELETE' })).status).toBe(200)
  })
})

describe('/api/ai/* for an agent: its models, its live test, and the model it answers with', () => {
  it('lists named models, tests by starting the agent, takes a picked model with its name, and reports it in /api/health', async () => {
    const options = [{ id: 'default', name: 'Default (recommended)' }, { id: 'opus', name: 'Opus' }]
    const probeAgent = vi.fn(async () => ({ ok: true as const, ms: 1800, currentModel: 'default', currentModelName: 'Default (recommended)', options }))
    const onConnectionChange = vi.fn()
    const ai = createAiService({ store: createMemoryStore(), find: () => '/usr/local/bin/npx', probeAgent, onConnectionChange })
    const { base } = await start({ ai })
    const json = { 'Content-Type': 'application/json' }

    const added = await (await fetch(`${base}/api/ai/connections`, { method: 'POST', headers: json, body: JSON.stringify({ presetId: 'claude-code' }) })).json() as { connection: { id: string; command: string[] } }
    const id = added.connection.id
    expect(added.connection.command).toEqual(['npx', '-y', '@agentclientprotocol/claude-agent-acp@0.106.0'])

    expect(await (await fetch(`${base}/api/ai/connections/${id}/models`)).json()).toEqual({ models: ['default', 'opus'], modelOptions: options })
    expect(await (await fetch(`${base}/api/ai/connections/${id}/test`, { method: 'POST', headers: json, body: '{}' })).json()).toEqual({
      ok: true, ms: 1800, model: 'Default (recommended)', tools: true, kind: 'agent', modelCount: 2,
    })
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, provider: 'Claude Code', model: 'Default (recommended)', kind: 'agent' })

    const patched = await fetch(`${base}/api/ai/connections/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ model: 'opus', modelName: 'Opus' }) })
    expect((await patched.json()).connection).toMatchObject({ model: 'opus', modelName: 'Opus' })
    expect(onConnectionChange).toHaveBeenCalledWith(id)
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ provider: 'Claude Code', model: 'Opus', kind: 'agent' })

    // a name that is not a short string is ignored, not stored
    await fetch(`${base}/api/ai/connections/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ modelName: 'x'.repeat(5000) }) })
    await fetch(`${base}/api/ai/connections/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ modelName: { evil: true } }) })
    expect((await (await fetch(`${base}/api/ai/state`)).json() as AiState).connections[0].modelName).toBe('Opus')

    // a failed listing is a 502 with the agent's reason
    probeAgent.mockResolvedValueOnce({ ok: false, ms: 3, error: 'Claude Code is not signed in on this computer.' } as never)
    const failed = await fetch(`${base}/api/ai/connections/${id}/models`)
    expect(failed.status).toBe(502)
    expect((await failed.json()).message).toBe('Claude Code is not signed in on this computer.')
  })
})
