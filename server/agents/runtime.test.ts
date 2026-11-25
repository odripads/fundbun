import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/core/ai/types'
import { TOOL_SPECS } from '../../src/core/agent/specs'
import { createAiService, type AiServiceOptions } from '../ai/service'
import { MAX_MODEL_ID, createMemoryStore } from '../ai/store'
import type { AcpTransport, JsonObject } from './acp'
import { IDLE_MS, PROBE_CACHE_MS, PROBE_TIMEOUT_MS, createAgentRuntime, fundbunToolOf } from './runtime'

interface ScriptedAgent {
  transport: AcpTransport
  received: JsonObject[]
  kills: number
  send: (msg: JsonObject) => void
  close: (code?: number | null) => void
}

function scriptedAgent(onMessage: (msg: JsonObject, api: ScriptedAgent) => void): ScriptedAgent {
  const lineH: ((l: string) => void)[] = []
  const closeH: ((c: number | null) => void)[] = []
  const errH: ((s: string) => void)[] = []
  const received: JsonObject[] = []
  let kills = 0
  const api: ScriptedAgent = {
    received,
    get kills() {
      return kills
    },
    send: (msg) => {
      const line = JSON.stringify({ jsonrpc: '2.0', ...msg })
      for (const h of lineH) h(line)
    },
    close: (code = 0) => {
      for (const h of closeH) h(code)
    },
    transport: {
      write: (line) => {
        const msg = JSON.parse(line) as JsonObject
        received.push(msg)
        queueMicrotask(() => onMessage(msg, api))
      },
      onLine: (h) => void lineH.push(h),
      onClose: (h) => void closeH.push(h),
      onStderr: (h) => void errH.push(h),
      kill: () => {
        kills++
        api.close(0)
      },
    },
  }
  return api
}

async function setupRuntime(onMessage: (msg: JsonObject, api: ScriptedAgent) => void, extra: { ai?: Partial<AiServiceOptions>; now?: () => number } = {}) {
  const ai = createAiService({ store: createMemoryStore(), find: () => '/usr/local/bin/npx', ...extra.ai })
  const added = await ai.add({ presetId: 'claude-code' })
  if (!added.ok) throw new Error('expected agent connection')
  const agents: ScriptedAgent[] = []
  const runtime = createAgentRuntime({
    ai,
    workspace: '/tmp/fundbun-agent-test-ws',
    bridgeUrl: () => 'http://127.0.0.1:4567/api/agent/mcp',
    bridgeScript: '/app/mcp-bridge.mjs',
    nodePath: '/usr/local/bin/node',
    transport: () => {
      const a = scriptedAgent(onMessage)
      agents.push(a)
      return a.transport
    },
    ...(extra.now ? { now: extra.now } : {}),
  })
  return { ai, connectionId: added.value.id, agents, runtime }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fundbunToolOf', () => {
  const names = new Set(['get_overview', 'log_spending'])

  it('matches only exact mcp__fundbun__<tool> names with kind other or absent', () => {
    expect(fundbunToolOf('mcp__fundbun__get_overview', undefined, names)).toBe('get_overview')
    expect(fundbunToolOf('mcp__fundbun__log_spending', 'other', names)).toBe('log_spending')
    expect(fundbunToolOf('mcp__fundbun__get_overview', 'execute', names)).toBeNull()
    expect(fundbunToolOf('mcp__fundbun__get_overview', 'edit', names)).toBeNull()
    expect(fundbunToolOf('mcp__fundbun__transfer_external', 'other', names)).toBeNull()
    expect(fundbunToolOf('mcp__other__get_overview', 'other', names)).toBeNull()
    expect(fundbunToolOf('get_overview', undefined, names)).toBeNull()
  })
})

describe('createAgentRuntime', () => {
  it('streams status, text, done, sends preamble only on first turn, and reuses the process', async () => {
    const prompts: string[] = []
    let newParams: JsonObject = {}
    const { connectionId, agents, runtime } = await setupRuntime((msg, api) => {
      const { id, method, params } = msg as { id?: number; method: string; params: JsonObject }
      if (method === 'initialize') return api.send({ id, result: { protocolVersion: 1 } })
      if (method === 'session/new') {
        newParams = params
        return api.send({ id, result: { sessionId: 'sess_1' } })
      }
      if (method === 'session/prompt') {
        prompts.push(((params.prompt as { text: string }[])[0]).text)
        api.send({ method: 'session/update', params: { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } } } })
        api.send({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } } } })
        api.send({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Jing' } } } })
        return api.send({ id, result: { stopReason: 'end_turn' } })
      }
    })

    const events1: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'chat-1', text: 'First question', preamble: 'RULES' }, (e) => events1.push(e))
    expect(events1).toEqual([
      { type: 'status', text: 'Starting Claude Code…' },
      { type: 'thought', delta: 'thinking' },
      { type: 'text', delta: 'Hello ' },
      { type: 'text', delta: 'Jing' },
      { type: 'done', stopReason: 'end_turn' },
    ])

    // one MCP server named fundbun with URL and a 48-hex token
    const mcpServers = newParams.mcpServers as { name: string; command: string; args: string[]; env: { name: string; value: string }[] }[]
    expect(mcpServers).toHaveLength(1)
    expect(mcpServers[0].name).toBe('fundbun')
    expect(mcpServers[0].command).toBe('/usr/local/bin/node')
    expect(mcpServers[0].args).toEqual(['/app/mcp-bridge.mjs'])
    const envMap = Object.fromEntries(mcpServers[0].env.map((e) => [e.name, e.value]))
    expect(envMap.FUNDBUN_BRIDGE_URL).toBe('http://127.0.0.1:4567/api/agent/mcp')
    expect(envMap.FUNDBUN_BRIDGE_TOKEN).toMatch(/^[a-f0-9]{48}$/)

    // second turn on same sessionKey reuses the process and sends text without preamble
    const events2: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'chat-1', text: 'Second question', preamble: 'RULES' }, (e) => events2.push(e))
    expect(agents).toHaveLength(1)
    expect(prompts).toEqual(['RULES\n\n---\n\nFirst question', 'Second question'])
    runtime.close()
  })

  it('switches bypassPermissions to default, and fails closed if switching fails', async () => {
    let allowSetMode = true
    const { connectionId, agents, runtime } = await setupRuntime((msg, api) => {
      const { id, method } = msg as { id?: number; method: string }
      if (method === 'initialize') return api.send({ id, result: {} })
      if (method === 'session/new') {
        return api.send({
          id,
          result: {
            sessionId: 'sess_mode',
            modes: {
              currentModeId: 'bypassPermissions',
              availableModes: [{ id: 'default', name: 'Ask' }, { id: 'bypassPermissions', name: 'Bypass' }],
            },
          },
        })
      }
      if (method === 'session/set_mode') {
        return allowSetMode ? api.send({ id, result: {} }) : api.send({ id, error: { code: -32000, message: 'no' } })
      }
      if (method === 'session/prompt') return api.send({ id, result: { stopReason: 'end_turn' } })
    })

    const okEvents: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 's1', text: 'hi', preamble: '' }, (e) => okEvents.push(e))
    expect(agents[0].received.some((m) => m.method === 'session/set_mode')).toBe(true)
    expect(okEvents.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })

    allowSetMode = false
    const failEvents: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 's2', text: 'hi', preamble: '' }, (e) => failEvents.push(e))
    expect(failEvents.at(-1)).toMatchObject({ type: 'error', code: 'agent_unsafe_mode' })
    expect(agents[1].received.some((m) => m.method === 'session/prompt')).toBe(false)
    expect(agents[1].kills).toBe(1)
    runtime.close()
  })

  it('auto-allows FundBun tools once (never always), asks user for Bash, and cancels unknown or null options', async () => {
    const permReplies: JsonObject[] = []
    const { connectionId, runtime } = await setupRuntime((msg, api) => {
      const { id, method, result } = msg as { id?: number; method?: string; result?: JsonObject }
      if (!method && result) {
        permReplies.push(result)
        if (permReplies.length === 1) {
          // 2. Ask permission for Bash
          api.send({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'tc_bash', title: 'Run ls', kind: 'execute' } } })
          api.send({
            id: 202,
            method: 'session/request_permission',
            params: {
              toolCall: { toolCallId: 'tc_bash', title: 'Run ls', rawInput: { command: 'ls -la' } },
              options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'deny', name: 'No', kind: 'reject_once' }],
            },
          })
        } else if (permReplies.length === 2) {
          // 3. Ask again, will receive unknown optionId -> cancelled
          api.send({
            id: 203,
            method: 'session/request_permission',
            params: {
              toolCall: { toolCallId: 'tc_bash2', title: 'Run pwd', rawInput: { cmd: 'pwd' } },
              options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }],
            },
          })
        } else if (permReplies.length === 3) {
          // 4. Ask again, will receive null -> cancelled
          api.send({
            id: 204,
            method: 'session/request_permission',
            params: {
              toolCall: { toolCallId: 'tc_bash3', title: 'Read file' },
              options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }],
            },
          })
        } else {
          api.send({ id: 3, result: { stopReason: 'end_turn' } })
        }
        return
      }
      if (method === 'initialize') return api.send({ id, result: {} })
      if (method === 'session/new') return api.send({ id, result: { sessionId: 'sess_perm' } })
      if (method === 'session/prompt') {
        // 1. Announce FundBun tool (must not emit 'tool' event, must auto-select allow_once, never allow_always)
        api.send({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'tc_fb', name: 'mcp__fundbun__get_overview', kind: 'other', title: 'Overview' } } })
        api.send({
          id: 201,
          method: 'session/request_permission',
          params: {
            toolCall: { toolCallId: 'tc_fb', title: 'Overview' },
            options: [{ optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'once', name: 'Once', kind: 'allow_once' }],
          },
        })
      }
    })

    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 's-perm', text: 'check', preamble: '' }, (e) => {
      events.push(e)
      if (e.type === 'permission') {
        if (e.title === 'Run ls') runtime.permission(e.requestId, 'once')
        else if (e.title === 'Run pwd') runtime.permission(e.requestId, 'forged_option')
        else runtime.permission(e.requestId, null)
      }
    })

    expect(events.filter((e) => e.type === 'tool')).toEqual([{ type: 'tool', id: 'tc_bash', title: 'Run ls', kind: 'execute', status: 'pending' }])
    expect(permReplies).toEqual([
      { outcome: { outcome: 'selected', optionId: 'once' } },
      { outcome: { outcome: 'selected', optionId: 'once' } },
      { outcome: { outcome: 'cancelled' } },
      { outcome: { outcome: 'cancelled' } },
    ])
    runtime.close()
  })

  it('bridge excludes T4 tools, authenticates tokens, round-trips tools/call during a turn, fails outside a turn and on timeout', async () => {
    let bridgeToken = ''
    let activePromptId = 0
    const { connectionId, runtime } = await setupRuntime((msg, api) => {
      const { id, method, params } = msg as { id?: number; method: string; params: JsonObject }
      if (method === 'initialize') return api.send({ id, result: {} })
      if (method === 'session/new') {
        const mcpServers = params.mcpServers as { env: { name: string; value: string }[] }[]
        bridgeToken = mcpServers[0].env.find((e) => e.name === 'FUNDBUN_BRIDGE_TOKEN')!.value
        return api.send({ id, result: { sessionId: 'sess_bridge' } })
      }
      if (method === 'session/prompt') {
        activePromptId = id as number
      }
    })

    // Wrong token throws 401
    await expect(runtime.bridge('0'.repeat(48), { method: 'tools/list' })).rejects.toMatchObject({ code: 401 })

    let seenCallId = ''
    let finishTurnPromise!: Promise<void>
    const gotCall = new Promise<void>((resolve) => {
      finishTurnPromise = runtime.turn({ connectionId, sessionKey: 's-bridge', text: 'hi', preamble: '' }, (e) => {
        if (e.type === 'fundbun_tool') {
          seenCallId = e.callId
          resolve()
        }
      })
    })

    await vi.waitFor(() => expect(activePromptId).toBeGreaterThan(0))

    // tools/list excludes T4 tools
    const listed = await runtime.bridge(bridgeToken, { method: 'tools/list' })
    const listedNames = (listed.tools as { name: string }[]).map((t) => t.name)
    for (const spec of Object.values(TOOL_SPECS)) {
      if (spec.tier === 4) expect(listedNames).not.toContain(spec.name)
      else expect(listedNames).toContain(spec.name)
    }

    // tools/call for unknown tool is denied immediately
    const denied = await runtime.bridge(bridgeToken, { method: 'tools/call', name: 'transfer_external', arguments: {} })
    expect(denied.isError).toBe(true)

    // tools/call round-trips via fundbun_tool + toolResult
    const callP = runtime.bridge(bridgeToken, { method: 'tools/call', name: 'get_overview', arguments: { month: '2026-10' } })
    await gotCall
    expect(runtime.toolResult(seenCallId, '{"spent":1200}', false)).toBe(true)
    await expect(callP).resolves.toEqual({ content: '{"spent":1200}', isError: false })

    // End the turn so s.emit becomes null
    const agent = (await Promise.resolve()) as unknown
    void agent
    // Finish prompt via cancel + close test below: first test timeout using fake timers in a fresh turn, and outside-turn failure
    runtime.close('s-bridge')
    await finishTurnPromise

    // After close, token is gone -> 401
    await expect(runtime.bridge(bridgeToken, { method: 'tools/list' })).rejects.toMatchObject({ code: 401 })
  })

  it('rejects tools/call outside a turn and times out stalled tool calls', async () => {
    let bridgeToken = ''
    let promptId = 0
    const { connectionId, agents, runtime } = await setupRuntime((msg, api) => {
      const { id, method, params } = msg as { id?: number; method: string; params: JsonObject }
      if (method === 'initialize') return api.send({ id, result: {} })
      if (method === 'session/new') {
        const mcpServers = params.mcpServers as { env: { name: string; value: string }[] }[]
        bridgeToken = mcpServers[0].env.find((e) => e.name === 'FUNDBUN_BRIDGE_TOKEN')!.value
        return api.send({ id, result: { sessionId: 'sess_t' } })
      }
      if (method === 'session/prompt') {
        promptId = id as number
        if (promptId === 3) api.send({ id, result: { stopReason: 'end_turn' } })
      }
    })

    // First turn completes immediately so session stays open but idle (s.emit === null)
    await runtime.turn({ connectionId, sessionKey: 's-idle', text: 'first', preamble: '' }, () => undefined)
    const outside = await runtime.bridge(bridgeToken, { method: 'tools/call', name: 'get_overview', arguments: {} })
    expect(outside.isError).toBe(true)
    expect(String(outside.content)).toContain('not waiting')

    // Second turn stays busy while we test tool timeout with fake timers
    vi.useFakeTimers()
    let gotTool = false
    const turnP = runtime.turn({ connectionId, sessionKey: 's-idle', text: 'second', preamble: '' }, (e) => {
      if (e.type === 'fundbun_tool') gotTool = true
    })
    await vi.waitFor(() => expect(promptId).toBe(4))
    const callP = runtime.bridge(bridgeToken, { method: 'tools/call', name: 'get_overview', arguments: {} })
    await vi.waitFor(() => expect(gotTool).toBe(true))
    await vi.advanceTimersByTimeAsync(120_000)
    await expect(callP).resolves.toMatchObject({ isError: true })

    // Cancel sends session/cancel and close kills the transport
    runtime.cancel('s-idle')
    await vi.waitFor(() => expect(agents[0].received.some((m) => m.method === 'session/cancel')).toBe(true))
    runtime.close('s-idle')
    await turnP
    expect(agents[0].kills).toBe(1)

    // Idle timeout closes an idle session
    expect(IDLE_MS).toBe(15 * 60_000)
  })
})

/** The model setting claude-agent-acp answers session/new with (its dist, 0.106.0). */
const CLAUDE_MODELS = {
  configOptions: [{
    id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'default',
    options: [{ value: 'default', name: 'Default (recommended)' }, { value: 'opus', name: 'Opus' }, { value: 'sonnet', name: 'Sonnet' }],
  }],
}
const BYPASS_MODES = { currentModeId: 'bypassPermissions', availableModes: [{ id: 'default', name: 'Ask' }, { id: 'bypassPermissions', name: 'Bypass' }] }

/** A scripted agent that offers models and answers each turn at once. */
function modelAgent(over: { models?: JsonObject; modes?: JsonObject; setMode?: 'ok' | 'fail'; setModel?: 'ok' | 'fail'; switchReply?: JsonObject; switchNote?: JsonObject } = {}) {
  return (msg: JsonObject, api: ScriptedAgent) => {
    const { id, method } = msg as { id?: number; method?: string }
    if (method === 'initialize') return api.send({ id, result: { protocolVersion: 1 } })
    if (method === 'session/new') return api.send({ id, result: { sessionId: 'sess_m', ...(over.models ?? CLAUDE_MODELS), ...(over.modes ? { modes: over.modes } : {}) } })
    if (method === 'session/set_mode') return over.setMode === 'fail' ? api.send({ id, error: { code: -32000, message: 'no' } }) : api.send({ id, result: {} })
    if (method === 'session/set_config_option' || method === 'session/set_model') {
      if (over.setModel === 'fail') return api.send({ id, error: { code: -32602, message: 'Invalid value' } })
      if (over.switchNote) api.send({ method: 'session/update', params: { sessionId: 'sess_m', update: over.switchNote } })
      return api.send({ id, result: over.switchReply ?? {} })
    }
    if (method === 'session/prompt') return api.send({ id, result: { stopReason: 'end_turn' } })
  }
}

const methodsOf = (a: ScriptedAgent) => a.received.map((m) => m.method).filter(Boolean)

describe('the model an agent session runs on', () => {
  it('writes down the agent’s own model when none was picked, without ending anything', async () => {
    const onConnectionChange = vi.fn()
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent(), { ai: { onConnectionChange } })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'm1', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    expect(methodsOf(agents[0])).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(ai.get(connectionId)).toMatchObject({ model: 'default', modelName: 'Default (recommended)' })
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(agents[0].kills).toBe(0)
    runtime.close()
  })

  it('switches to the picked model before the first prompt, and fills in its name', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent())
    ai.update(connectionId, { model: 'opus' })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'm2', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    expect(methodsOf(agents[0])).toEqual(['initialize', 'session/new', 'session/set_config_option', 'session/prompt'])
    expect(agents[0].received.find((m) => m.method === 'session/set_config_option')?.params).toEqual({ sessionId: 'sess_m', configId: 'model', value: 'opus' })
    expect(ai.get(connectionId)).toMatchObject({ model: 'opus', modelName: 'Opus' })
    runtime.close()
  })

  it('uses session/set_model with an agent that reports the older models shape', async () => {
    const legacy = { models: { currentModelId: 'gemini-2.5-pro', availableModels: [{ modelId: 'gemini-2.5-pro', name: 'Pro' }, { modelId: 'gemini-2.5-flash', name: 'Flash' }] } }
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ models: legacy }))
    ai.update(connectionId, { model: 'gemini-2.5-flash', modelName: 'Flash' })
    await runtime.turn({ connectionId, sessionKey: 'm3', text: 'hi', preamble: '' }, () => undefined)
    expect(agents[0].received.find((m) => m.method === 'session/set_model')?.params).toEqual({ sessionId: 'sess_m', modelId: 'gemini-2.5-flash' })
    expect(methodsOf(agents[0])).toContain('session/prompt')
    runtime.close()
  })

  it('fails closed when the agent refuses the picked model: no prompt, process stopped, a clear error', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ setModel: 'fail' }))
    ai.update(connectionId, { model: 'sonnet', modelName: 'Sonnet' })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'm4', text: 'hi', preamble: '' }, (e) => events.push(e))
    const last = events.at(-1)
    expect(last).toMatchObject({ type: 'error', code: 'agent_model_unavailable' })
    const message = last?.type === 'error' ? last.message : ''
    expect(message).toContain('"sonnet"')
    expect(message).toContain('Pick another model in Your AI')
    expect(methodsOf(agents[0])).not.toContain('session/prompt')
    expect(agents[0].kills).toBe(1)
    expect(ai.get(connectionId)?.lastError).toContain('could not switch')
    // the stored choice is kept: FundBun never quietly falls back to another model
    expect(ai.get(connectionId)?.model).toBe('sonnet')
  })

  it('fails closed on a model the agent no longer offers, without asking the agent to switch', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent())
    ai.update(connectionId, { model: 'claude-retired' })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'm5', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'agent_model_unavailable' })
    expect(methodsOf(agents[0])).toEqual(['initialize', 'session/new'])
  })

  it('a new model picked in Your AI ends the running session, so the next message starts on it', async () => {
    let rt: { closeByConnection(id: string): void } | null = null
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent(), { ai: { onConnectionChange: (id) => rt?.closeByConnection(id) } })
    rt = runtime
    await runtime.turn({ connectionId, sessionKey: 'chat', text: 'first', preamble: '' }, () => undefined)
    expect(agents[0].kills).toBe(0)
    ai.update(connectionId, { model: 'opus', modelName: 'Opus' })
    expect(agents[0].kills).toBe(1)
    await runtime.turn({ connectionId, sessionKey: 'chat', text: 'second', preamble: 'RULES' }, () => undefined)
    expect(agents).toHaveLength(2)
    expect(agents[1].received.find((m) => m.method === 'session/set_config_option')?.params).toMatchObject({ value: 'opus' })
    // the same model again changes nothing
    ai.update(connectionId, { model: 'opus' })
    expect(agents[1].kills).toBe(0)
    runtime.close()
  })
})

describe('probe: a live test of an agent', () => {
  it('starts it, puts it in ask-first mode, reads its models, and stops it', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ modes: BYPASS_MODES }))
    const r = await runtime.probe(connectionId)
    expect(r).toEqual({
      ok: true,
      ms: expect.any(Number),
      currentModel: 'default',
      currentModelName: 'Default (recommended)',
      options: [{ id: 'default', name: 'Default (recommended)' }, { id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }],
    })
    expect(methodsOf(agents[0])).toEqual(['initialize', 'session/new', 'session/set_mode'])
    // a test gets no FundBun tools: nothing it does can reach the money
    expect((agents[0].received.find((m) => m.method === 'session/new')?.params as JsonObject).mcpServers).toEqual([])
    expect(agents[0].kills).toBe(1)
    expect(ai.get(connectionId)?.okAt).toBeTruthy()
    expect(ai.get(connectionId)?.lastError).toBeUndefined()
    // a test alone never picks a model: AiService decides what to write down
    expect(ai.get(connectionId)?.model).toBeUndefined()
  })

  it('reuses a recent test, and starts the agent again when asked to or when the test is old', async () => {
    let t = 1_000
    const { connectionId, agents, runtime } = await setupRuntime(modelAgent(), { now: () => t })
    const first = await runtime.probe(connectionId)
    expect(await runtime.probe(connectionId, { useCache: true })).toBe(first)
    expect(agents).toHaveLength(1)
    t += PROBE_CACHE_MS + 1
    await runtime.probe(connectionId, { useCache: true })
    expect(agents).toHaveLength(2)
    await runtime.probe(connectionId, { useCache: false })
    expect(agents).toHaveLength(3)
    await runtime.probe(connectionId)
    expect(agents).toHaveLength(4)
  })

  it('shares one running test between callers that ask at the same time', async () => {
    const { connectionId, agents, runtime } = await setupRuntime(modelAgent())
    const [a, b, c] = await Promise.all([runtime.probe(connectionId), runtime.probe(connectionId, { useCache: true }), runtime.probe(connectionId, { useCache: false })])
    expect(agents).toHaveLength(1)
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('fails closed when the agent cannot be put in ask-first mode, and keeps nothing', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ modes: BYPASS_MODES, setMode: 'fail' }))
    const r = await runtime.probe(connectionId)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('act without asking')
    expect(agents[0].kills).toBe(1)
    expect(ai.get(connectionId)?.lastError).toContain('act without asking')
    await runtime.probe(connectionId, { useCache: true })
    expect(agents).toHaveLength(2)
  })

  it('stops an agent that does not answer in time', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(() => undefined)
    vi.useFakeTimers()
    const pending = runtime.probe(connectionId)
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)
    const r = await pending
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('did not answer in time') })
    expect(agents[0].kills).toBe(1)
    expect(ai.get(connectionId)?.lastError).toContain('did not answer in time')
  })

  it('reports an agent that cannot be started without starting anything', async () => {
    const { connectionId, agents, runtime } = await setupRuntime(modelAgent(), { ai: { find: () => null } })
    const r = await runtime.probe(connectionId)
    expect(r).toEqual({ ok: false, ms: 0, error: 'Claude Code needs Node.js (the "npx" command was not found).' })
    expect(agents).toHaveLength(0)
  })

  it('a shutdown stops a test that is still running', async () => {
    const { connectionId, agents, runtime } = await setupRuntime(() => undefined)
    const pending = runtime.probe(connectionId)
    await vi.waitFor(() => expect(agents).toHaveLength(1))
    runtime.close()
    expect((await pending).ok).toBe(false)
    expect(agents[0].kills).toBeGreaterThanOrEqual(1)
  })
})

describe('closeByConnection', () => {
  it('ends the sessions of that connection only, and forgets its test', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent())
    const other = await ai.add({ presetId: 'codex' })
    if (!other.ok) throw new Error('expected a second agent')
    await runtime.turn({ connectionId, sessionKey: 'a', text: 'hi', preamble: '' }, () => undefined)
    await runtime.turn({ connectionId: other.value.id, sessionKey: 'b', text: 'hi', preamble: '' }, () => undefined)
    await runtime.probe(connectionId)
    expect(agents).toHaveLength(3)

    runtime.closeByConnection(connectionId)
    expect(agents[0].kills).toBe(1)
    expect(agents[1].kills).toBe(0)

    // the next message starts the agent afresh, and the next model list asks it again
    await runtime.turn({ connectionId, sessionKey: 'a', text: 'again', preamble: '' }, () => undefined)
    expect(agents).toHaveLength(4)
    await runtime.probe(connectionId, { useCache: true })
    expect(agents).toHaveLength(5)
    runtime.close()
  })

  it('stops a test that was running when the connection changed, and tests it again as it is now', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const base = modelAgent()
    const { ai, connectionId, agents, runtime } = await setupRuntime((msg, api) => {
      if (msg.method === 'initialize') return void gate.then(() => base(msg, api))
      base(msg, api)
    })
    const markOk = vi.spyOn(ai, 'markOk')
    const markError = vi.spyOn(ai, 'markError')
    const pending = runtime.probe(connectionId)
    await vi.waitFor(() => expect(agents).toHaveLength(1))
    runtime.closeByConnection(connectionId)
    // its agent is stopped at once, not left running in the background
    expect(agents[0].kills).toBe(1)
    await vi.waitFor(() => expect(agents).toHaveLength(2))
    // the stopped test leaves no mark on the connection
    expect(markError).not.toHaveBeenCalled()
    release()
    expect(await pending).toMatchObject({ ok: true, currentModel: 'default' })
    expect(markOk).toHaveBeenCalledTimes(1)
    // one test at a time: the fresh one is the one remembered
    await runtime.probe(connectionId, { useCache: true })
    expect(agents).toHaveLength(2)
  })

  it('a test of a connection that is removed meanwhile ends with its agent, and starts nothing more', async () => {
    let rt: { closeByConnection(id: string): void } | null = null
    const { ai, connectionId, agents, runtime } = await setupRuntime(() => undefined, { ai: { onConnectionChange: (id) => rt?.closeByConnection(id) } })
    rt = runtime
    const markError = vi.spyOn(ai, 'markError')
    const pending = runtime.probe(connectionId)
    await vi.waitFor(() => expect(agents).toHaveLength(1))
    expect(ai.remove(connectionId)).toBe(true)
    expect(agents[0].kills).toBe(1)
    expect(await pending).toEqual({ ok: false, ms: 0, error: 'That connection no longer exists.' })
    expect(agents).toHaveLength(1)
    expect(markError).not.toHaveBeenCalled()
  })

  it('stops an answer that is still coming with a clear error, so it is not taken for a whole answer', async () => {
    let held = false
    const base = modelAgent()
    const { connectionId, agents, runtime } = await setupRuntime((msg, api) => {
      if (msg.method === 'session/prompt') {
        held = true
        return api.send({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Half an ans' } } } })
      }
      base(msg, api)
    })
    const events: AgentEvent[] = []
    const turn = runtime.turn({ connectionId, sessionKey: 'busy', text: 'hi', preamble: '' }, (e) => events.push(e))
    await vi.waitFor(() => expect(held).toBe(true))
    runtime.closeByConnection(connectionId)
    await turn
    expect(agents[0].kills).toBe(1)
    expect(events.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', code: 'agent_changed', message: 'Claude Code was changed in Your AI, so this answer stopped. Send your message again.' },
    ])
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })
})

/** A scripted agent that holds back its answer to one method until released. */
function holdBack(method: string, base: (msg: JsonObject, api: ScriptedAgent) => void) {
  const held: (() => void)[] = []
  return {
    handler: (msg: JsonObject, api: ScriptedAgent) => {
      if (msg.method === method) return void held.push(() => base(msg, api))
      base(msg, api)
    },
    held,
    release: () => held.splice(0).forEach((go) => go()),
  }
}

describe('a model picked while the agent is starting', () => {
  async function wired(handler: (msg: JsonObject, api: ScriptedAgent) => void) {
    let rt: { closeByConnection(id: string): void } | null = null
    const setup = await setupRuntime(handler, { ai: { onConnectionChange: (id) => rt?.closeByConnection(id) } })
    rt = setup.runtime
    return setup
  }

  it('is the model the session runs on, and the agent’s own model never writes over it', async () => {
    const gate = holdBack('session/new', modelAgent())
    const { ai, connectionId, agents, runtime } = await wired(gate.handler)
    const events: AgentEvent[] = []
    const turn = runtime.turn({ connectionId, sessionKey: 'pick', text: 'hi', preamble: '' }, (e) => events.push(e))
    await vi.waitFor(() => expect(gate.held).toHaveLength(1))
    ai.update(connectionId, { model: 'opus', modelName: 'Opus' })
    gate.release()
    await turn
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    expect(agents).toHaveLength(1)
    expect(agents[0].received.find((m) => m.method === 'session/set_config_option')?.params).toEqual({ sessionId: 'sess_m', configId: 'model', value: 'opus' })
    expect(ai.get(connectionId)).toMatchObject({ model: 'opus', modelName: 'Opus' })
  })

  it('replaces a model picked earlier', async () => {
    const gate = holdBack('session/new', modelAgent())
    const { ai, connectionId, agents, runtime } = await wired(gate.handler)
    ai.update(connectionId, { model: 'sonnet', modelName: 'Sonnet' })
    const turn = runtime.turn({ connectionId, sessionKey: 'pick2', text: 'hi', preamble: '' }, () => undefined)
    await vi.waitFor(() => expect(gate.held).toHaveLength(1))
    ai.update(connectionId, { model: 'opus', modelName: 'Opus' })
    gate.release()
    await turn
    const switches = agents.flatMap((a) => a.received.filter((m) => m.method === 'session/set_config_option').map((m) => (m.params as JsonObject).value))
    expect(switches).toEqual(['opus'])
    expect(ai.get(connectionId)?.model).toBe('opus')
  })

  it('starts the agent once more when the pick comes after the switch, so the session never runs on the old one', async () => {
    const gate = holdBack('session/set_config_option', modelAgent())
    const { ai, connectionId, agents, runtime } = await wired(gate.handler)
    ai.update(connectionId, { model: 'sonnet', modelName: 'Sonnet' })
    const events: AgentEvent[] = []
    const turn = runtime.turn({ connectionId, sessionKey: 'late', text: 'hi', preamble: '' }, (e) => events.push(e))
    await vi.waitFor(() => expect(gate.held).toHaveLength(1))
    ai.update(connectionId, { model: 'opus', modelName: 'Opus' })
    gate.release()
    await vi.waitFor(() => expect(agents).toHaveLength(2))
    await vi.waitFor(() => expect(gate.held).toHaveLength(1))
    gate.release()
    await turn
    expect(agents[0].kills).toBe(1)
    expect(methodsOf(agents[0])).not.toContain('session/prompt')
    expect(agents[1].received.find((m) => m.method === 'session/set_config_option')?.params).toMatchObject({ value: 'opus' })
    expect(methodsOf(agents[1])).toContain('session/prompt')
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    // the next message reuses that session: it runs on the model Your AI shows
    await runtime.turn({ connectionId, sessionKey: 'late', text: 'again', preamble: '' }, () => undefined)
    expect(agents).toHaveLength(2)
    runtime.close()
  })

  it('a connection removed while its agent starts gets no session', async () => {
    const gate = holdBack('session/new', modelAgent())
    const { ai, connectionId, agents, runtime } = await wired(gate.handler)
    const events: AgentEvent[] = []
    const turn = runtime.turn({ connectionId, sessionKey: 'gone', text: 'hi', preamble: '' }, (e) => events.push(e))
    await vi.waitFor(() => expect(gate.held).toHaveLength(1))
    ai.remove(connectionId)
    gate.release()
    await turn
    expect(methodsOf(agents[0])).not.toContain('session/prompt')
    expect(agents[0].kills).toBe(1)
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'agent_missing' })
  })
})

describe('the ask-first check comes after the model switch', () => {
  const ASK_MODES = { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Ask' }, { id: 'bypassPermissions', name: 'Bypass' }] }

  it('puts the session back in ask-first mode when the switch changed it (config options answer)', async () => {
    const switchReply = { configOptions: [{ id: 'mode', category: 'mode', currentValue: 'bypassPermissions' }, { id: 'model', category: 'model', currentValue: 'opus' }] }
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ modes: ASK_MODES, switchReply }))
    ai.update(connectionId, { model: 'opus' })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'mode1', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(methodsOf(agents[0])).toEqual(['initialize', 'session/new', 'session/set_config_option', 'session/set_mode', 'session/prompt'])
    expect(agents[0].received.find((m) => m.method === 'session/set_mode')?.params).toEqual({ sessionId: 'sess_m', modeId: 'default' })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    runtime.close()
  })

  it('reads a current_mode_update too, and fails closed when the mode cannot be put back', async () => {
    const switchNote = { sessionUpdate: 'current_mode_update', currentModeId: 'bypassPermissions' }
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ modes: ASK_MODES, switchNote, setMode: 'fail' }))
    ai.update(connectionId, { model: 'opus' })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'mode2', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'agent_unsafe_mode' })
    expect(methodsOf(agents[0])).not.toContain('session/prompt')
    expect(agents[0].kills).toBe(1)
  })

  it('sends no extra mode change when the switch left the mode alone', async () => {
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ modes: ASK_MODES }))
    ai.update(connectionId, { model: 'opus' })
    await runtime.turn({ connectionId, sessionKey: 'mode3', text: 'hi', preamble: '' }, () => undefined)
    expect(methodsOf(agents[0])).toEqual(['initialize', 'session/new', 'session/set_config_option', 'session/prompt'])
    runtime.close()
  })
})

describe('long model ids', () => {
  it('an id at the length FundBun stores is kept whole and used again in the next session', async () => {
    const long = `gateway/${'x'.repeat(MAX_MODEL_ID - 8)}`
    const models = { configOptions: [{ id: 'model', category: 'model', currentValue: long, options: [{ value: long, name: 'Gateway' }, { value: 'opus', name: 'Opus' }] }] }
    const { ai, connectionId, agents, runtime } = await setupRuntime(modelAgent({ models }))
    await runtime.turn({ connectionId, sessionKey: 'l1', text: 'hi', preamble: '' }, () => undefined)
    expect(ai.get(connectionId)).toMatchObject({ model: long, modelName: 'Gateway' })
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'l2', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    expect(methodsOf(agents[1])).not.toContain('session/set_config_option')
    runtime.close()
  })

  it('an id too long to store is never written down cut short', async () => {
    const tooLong = `gateway/${'y'.repeat(MAX_MODEL_ID)}`
    const models = { configOptions: [{ id: 'model', category: 'model', currentValue: tooLong, options: [{ value: tooLong }, { value: 'opus', name: 'Opus' }] }] }
    const { ai, connectionId, runtime } = await setupRuntime(modelAgent({ models }))
    const events: AgentEvent[] = []
    await runtime.turn({ connectionId, sessionKey: 'l3', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    expect(ai.get(connectionId)?.model).toBeUndefined()
    await runtime.turn({ connectionId, sessionKey: 'l4', text: 'hi', preamble: '' }, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' })
    runtime.close()
  })
})
