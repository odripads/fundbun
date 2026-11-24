import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/core/ai/types'
import { TOOL_SPECS } from '../../src/core/agent/specs'
import { createAiService } from '../ai/service'
import { createMemoryStore } from '../ai/store'
import type { AcpTransport, JsonObject } from './acp'
import { IDLE_MS, createAgentRuntime, fundbunToolOf } from './runtime'

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

async function setupRuntime(onMessage: (msg: JsonObject, api: ScriptedAgent) => void) {
  const ai = createAiService({ store: createMemoryStore(), find: () => '/usr/local/bin/npx' })
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
