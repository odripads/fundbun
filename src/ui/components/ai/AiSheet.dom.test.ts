// @vitest-environment jsdom
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiClient } from '../../../core/ai/client'
import type { AiConnection, AiState, ConnectionTest, DetectedAgent, ModelOption } from '../../../core/ai/types'
import { createTestApp, type FundBunApp } from '../../../core/app'
import { AppProvider } from '../../state'
import { byText, changeValue, cleanup, click, flush, render } from '../ds/testing'
import { AiSheet } from './AiSheet'

afterEach(cleanup)

const CLAUDE: DetectedAgent = {
  id: 'claude-code', name: 'Claude', vendor: 'Anthropic', bin: 'claude', login: 'claude auth login',
  launch: { via: 'npx', package: '@agentclientprotocol/claude-agent-acp@0.106.0', args: [] },
  note: 'Uses the Claude plan you are signed in to.', installed: true,
}
const ANTIGRAVITY: DetectedAgent = {
  id: 'antigravity', name: 'Antigravity', vendor: 'Google', bin: 'agy', login: 'agy acp --login',
  launch: { via: 'bin', args: ['acp'] },
  note: 'Uses the Google / Gemini plan you are signed in to.', installed: true,
}
const COMMAND = ['npx', '-y', '@agentclientprotocol/claude-agent-acp@0.106.0']
const OPTIONS: ModelOption[] = [{ id: 'default', name: 'Default (recommended)' }, { id: 'opus', name: 'Opus 5.5' }, { id: 'sonnet', name: 'sonnet' }]
const AGENT_TEST: ConnectionTest = { ok: true, ms: 2300, tools: true, kind: 'agent', model: 'Default (recommended)', modelCount: 3 }

function agentConnection(over: Partial<AiConnection> = {}): AiConnection {
  return { id: 'ai_agent0000001', kind: 'agent', presetId: 'claude-code', label: 'Claude', hasKey: false, local: false, command: COMMAND, createdAt: '2026-11-25T08:00:00.000Z', ...over }
}

function stateWith(connections: AiConnection[]): AiState {
  return { local: true, presets: [], agents: [CLAUDE, ANTIGRAVITY], connections, activeId: connections[0]?.id ?? null, keyStorage: 'Kept on this computer.' }
}

type Call = { method: string; path: string; body?: Record<string, unknown> }

/** The FundBun server on this computer, as far as the sheet can tell: /api/ai/* answered from memory. */
function fakeServer(initial: AiState, opts: { models?: (id: string) => Promise<{ models: string[]; modelOptions?: ModelOption[] }>; test?: ConnectionTest; remembers?: boolean } = {}) {
  let state = structuredClone(initial)
  const calls: Call[] = []
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const find = (id: string) => state.connections.find((c) => c.id === id)
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, path, ...(body ? { body } : {}) })
    if (path === '/api/ai/state') return json(state)
    if (path === '/api/ai/active' && method === 'POST') {
      state = { ...state, activeId: body?.id as string | null }
      return json(state)
    }
    if (path === '/api/ai/connections' && method === 'POST') {
      const connection = agentConnection({ id: 'ai_new00000001' })
      state = { ...state, connections: [...state.connections, connection] }
      return json({ connection, state })
    }
    const m = /^\/api\/ai\/connections\/([^/]+)(?:\/(models|test))?$/.exec(path)
    const c = m ? find(m[1]) : undefined
    if (m && c && m[2] === 'models') {
      // like the real server: asking an agent writes down the model it runs on when none was picked
      if (opts.remembers && !c.model) Object.assign(c, { model: 'default', modelName: 'Default (recommended)' })
      return json(await (opts.models?.(m[1]) ?? Promise.resolve({ models: OPTIONS.map((o) => o.id), modelOptions: OPTIONS })))
    }
    if (m && c && m[2] === 'test') {
      // the server writes down the agent's own model during a test
      if (!c.model) Object.assign(c, { model: 'default', modelName: 'Default (recommended)' })
      return json(opts.test ?? AGENT_TEST)
    }
    if (m && c && method === 'PATCH') {
      if (typeof body?.model === 'string') {
        c.model = body.model
        if (typeof body.modelName === 'string') c.modelName = body.modelName
        else delete c.modelName
      }
      return json({ connection: c, state })
    }
    return json({ error: 'not_found', message: 'Unknown API route.' }, 404)
  }
  return { fetchImpl, calls }
}

function appWith(fetchImpl: typeof fetch): FundBunApp {
  const app = createTestApp()
  app.loadDemo('mei')
  return { ...app, ai: new AiClient('/api', fetchImpl) }
}

async function openSheet(server: ReturnType<typeof fakeServer>, wrap: (app: FundBunApp) => FundBunApp = (a) => a) {
  const app = wrap(appWith(server.fetchImpl as typeof fetch))
  await render(h(AppProvider, { status: { ready: true, app }, children: h(AiSheet, { open: true, onClose: () => {} }) }))
  await flush()
  return app
}

const text = () => document.body.textContent ?? ''

describe('Your AI: the model picker and live test for agents', () => {
  it('an agent in use lists its real models by name, shows colored logos, and saves a pick as Claude + model', async () => {
    const server = fakeServer(stateWith([agentConnection({ model: 'default', modelName: 'Default (recommended)' })]))
    await openSheet(server)
    expect(server.calls.some((c) => c.path === '/api/ai/connections/ai_agent0000001/models')).toBe(true)
    expect(document.body.querySelector('svg[data-brand="claude"]')).not.toBeNull()
    const select = document.body.querySelector('select')!
    expect([...select.options].map((o) => o.textContent)).toEqual(['Default (recommended) (default)', 'Opus 5.5 (opus)', 'sonnet'])
    expect(select.value).toBe('default')
    expect(text()).toContain('Default (recommended) · agent on this computer, your own sign-in')
    // the real launch line, never "its own command"
    expect(text()).toContain(`Runs as ${COMMAND.join(' ')}`)
    expect(text()).not.toContain('its own command')

    await changeValue(select as unknown as HTMLInputElement, 'opus')
    await flush()
    expect(server.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ model: 'opus', modelName: 'Opus 5.5' })
    expect(text()).toContain('Claude Opus 5.5')
    expect(text()).toContain('Agent on this computer, your own sign-in')
  })

  it('waits while the agent is asked, and says so when it offers no model choice', async () => {
    let answer!: (v: { models: string[]; modelOptions: ModelOption[] }) => void
    const server = fakeServer(stateWith([agentConnection()]), { models: () => new Promise((r) => (answer = r)) })
    await openSheet(server)
    expect(text()).toContain('Asking Claude which models it has…')
    expect(document.body.querySelector('select')).toBeNull()
    answer({ models: [], modelOptions: [] })
    await flush()
    expect(text()).not.toContain('Asking Claude')
    expect(text()).toContain('Uses this agent’s configured model.')
    expect(document.body.querySelector('select')).toBeNull()
  })

  it('offers Test for an agent, and shows what the live test verified', async () => {
    const server = fakeServer(stateWith([agentConnection({ model: 'default' })]))
    await openSheet(server)
    await click(byText(document.body, 'Test', 'button'))
    await flush()
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/ai/connections/ai_agent0000001/test')).toBe(true)
    expect(text()).toContain('Connected in 2.3 s (ask-first mode verified, 3 models found).')
  })

  it('shows a failed agent test as the error it is', async () => {
    const server = fakeServer(stateWith([agentConnection({ model: 'default' })]), { test: { ok: false, ms: 800, error: 'Claude is not signed in on this computer. Sign in with its own command in a terminal, then try again.' } })
    await openSheet(server)
    await click(byText(document.body, 'Test', 'button'))
    await flush()
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('is not signed in on this computer')
  })

  it('connecting an agent tests it at once, lists Antigravity with its logo, and loads its models', async () => {
    const server = fakeServer(stateWith([]))
    await openSheet(server)
    await click(byText(document.body, 'Connect an AI', 'button'))
    expect(document.body.querySelector('svg[data-brand="antigravity"]')).not.toBeNull()
    await click(byText(document.body, /^Claude/, 'button'))
    await click(byText(document.body, 'Connect Claude', 'button'))
    await flush()
    await flush()
    const asked = server.calls.map((c) => `${c.method} ${c.path}`)
    expect(asked).toContain('POST /api/ai/connections')
    expect(asked).toContain('POST /api/ai/connections/ai_new00000001/test')
    expect(asked).toContain('GET /api/ai/connections/ai_new00000001/models')
    expect(text()).toContain('Connected in 2.3 s (ask-first mode verified, 3 models found).')
    expect(document.body.querySelector('select')?.value).toBe('default')
  })

  it('shows the model the server wrote down while it asked the agent, and asks again who answers', async () => {
    const server = fakeServer(stateWith([agentConnection()]), { remembers: true })
    const checkLlm = vi.fn(async () => undefined)
    await openSheet(server, (app) => ({ ...app, checkLlm }))
    await flush()
    const asked = server.calls.map((c) => `${c.method} ${c.path}`)
    const listed = asked.indexOf('GET /api/ai/connections/ai_agent0000001/models')
    expect(listed).toBeGreaterThan(-1)
    expect(asked.slice(listed + 1)).toContain('GET /api/ai/state')
    expect(checkLlm).toHaveBeenCalled()
    expect(document.body.querySelector('select')?.value).toBe('default')
    expect(text()).toContain('Default (recommended) · agent on this computer, your own sign-in')
  })

  it('a test asks again who answers, so the chip names the model the test wrote down', async () => {
    const server = fakeServer(stateWith([agentConnection({ model: 'default' })]))
    const checkLlm = vi.fn(async () => undefined)
    await openSheet(server, (app) => ({ ...app, checkLlm }))
    checkLlm.mockClear()
    await click(byText(document.body, 'Test', 'button'))
    await flush()
    expect(checkLlm).toHaveBeenCalled()
  })
})
