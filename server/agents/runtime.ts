import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '../../src/core/ai/types'
import { llmToolDefinitions } from '../../src/core/agent/specs'
import { childEnv } from '../ai/paths'
import type { AiService } from '../ai/service'
import { AcpError, connectAcp, processTransport, type AcpConnection, type AcpTransport, type JsonObject } from './acp'

/**
 * Agents on this computer, T3-Code style: FundBun starts the agent the user is already signed in to, speaks ACP
 * with it, and hands it FundBun's tools through a small MCP bridge. The agent thinks; FundBun's policy gate
 * (in the app) still decides every tool call, exactly as it does for an API model.
 *
 * One agent process per chat session, kept between turns so the agent remembers the conversation, and closed
 * after a quiet spell.
 */
export const IDLE_MS = 15 * 60_000
const START_TIMEOUT_MS = 120_000
const TOOL_TIMEOUT_MS = 120_000
const MAX_SESSIONS = 4

export type Emit = (event: AgentEvent) => void

export interface TurnInput {
  connectionId: string
  /** the app's name for this conversation; a new key starts a fresh agent session */
  sessionKey: string
  text: string
  /** FundBun's rules for the agent: sent once, at the start of a session */
  preamble: string
}

export interface AgentRuntimeOptions {
  ai: AiService
  /** folder the agents run in: an empty workspace of their own, never the user's home */
  workspace: string
  /** where the bridge reaches this server, e.g. http://127.0.0.1:8787/api/agent/mcp */
  bridgeUrl: () => string
  /** path of mcp-bridge.mjs and the program that runs it */
  bridgeScript: string
  nodePath?: string
  /** extra environment for the bridge process (the desktop app sets ELECTRON_RUN_AS_NODE) */
  nodeEnv?: Record<string, string>
  /** test seam: build the transport instead of spawning */
  transport?: (command: string, args: string[], cwd: string) => AcpTransport
  version?: string
}

export interface AgentRuntime {
  /** runs one turn; resolves when the agent stops. Events go to `emit` as they happen. */
  turn(input: TurnInput, emit: Emit, signal?: AbortSignal): Promise<void>
  /** the app's answer to a 'fundbun_tool' event */
  toolResult(callId: string, content: string, isError: boolean): boolean
  /** the user's answer to a 'permission' event; null = dismissed */
  permission(requestId: string, optionId: string | null): boolean
  cancel(sessionKey: string): void
  /** called by the MCP bridge (authenticated by the session token) */
  bridge(token: string, payload: JsonObject): Promise<JsonObject>
  /** end one session (new chat) or all of them (shutdown) */
  close(sessionKey?: string): void
}

interface Session {
  key: string
  connectionId: string
  conn: AcpConnection
  sessionId: string
  token: string
  fresh: boolean
  busy: boolean
  emit: Emit | null
  idle?: ReturnType<typeof setTimeout>
  tools: Map<string, (r: { content: string; isError: boolean }) => void>
  perms: Map<string, (optionId: string | null) => void>
  /** the agent's own tool calls seen this session: updates carry only the id, so the title is remembered */
  seen: Map<string, { title: string; kind: string; name: string; fundbun: boolean }>
}

const text = (v: unknown, max = 400): string => (typeof v === 'string' ? v.slice(0, max) : '')
const obj = (v: unknown): JsonObject => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {})
const id = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`

/** The text of an ACP content block ({type:'text', text}); other kinds are named, not shown. */
function blockText(content: unknown): string {
  const c = obj(content)
  if (c.type === 'text' && typeof c.text === 'string') return c.text
  return ''
}

/**
 * Is this tool call one of FundBun's own tools, which the policy gate in the app handles?
 * Only the adapter-assigned tool id counts (`name`, e.g. "mcp__fundbun__get_overview"), matched whole, and only
 * for calls the agent does not class as running, editing, deleting or moving. A title is free text the model can
 * influence, so it is never used: anything not recognised here is put to the user as a question.
 */
export function fundbunToolOf(name: unknown, kind: unknown, names: ReadonlySet<string>): string | null {
  const k = text(kind, 20)
  if (k && k !== 'other') return null
  const m = /^mcp__fundbun__([a-z_]{3,40})$/.exec(text(name, 80))
  return m && names.has(m[1]) ? m[1] : null
}

const UNSAFE_MODE = /bypass|yolo|auto|full|accept|danger|skip/i
const SAFE_MODE_IDS = ['default', 'manual', 'ask', 'supervised', 'read-only', 'readonly', 'suggest']

/**
 * The agent's own "ask before acting" mode, when it offers one. People often leave their coding agent in a
 * no-questions mode; inside a finance app it must ask. Returns null when no clearly safe mode is listed.
 */
export function safeModeOf(modes: unknown): { id: string; current: string; needed: boolean } | null {
  const m = obj(modes)
  const current = text(m.currentModeId, 80)
  const available = (Array.isArray(m.availableModes) ? m.availableModes : []).map((x) => obj(x)).map((x) => ({ id: text(x.id, 80), about: `${text(x.name, 80)} ${text(x.description, 200)}` })).filter((x) => x.id)
  const safe =
    SAFE_MODE_IDS.map((id) => available.find((x) => x.id.toLowerCase() === id)).find(Boolean) ??
    available.find((x) => !UNSAFE_MODE.test(x.id) && /always ask|ask before|ask for approval|manual/i.test(x.about))
  if (!safe || UNSAFE_MODE.test(safe.id)) return null
  return { id: safe.id, current, needed: safe.id !== current }
}

function friendlyStartError(e: unknown, stderr: string, label: string): { code: string; message: string } {
  const raw = `${e instanceof Error ? e.message : ''} ${stderr}`.toLowerCase()
  if (/auth|log ?in|sign ?in|credential|unauthori|401|api key/.test(raw)) {
    return { code: 'agent_signed_out', message: `${label} is not signed in on this computer. Sign in with its own command in a terminal, then try again.` }
  }
  if (/enoent|not found|command not/.test(raw)) return { code: 'agent_missing', message: `${label} could not be started. Is it installed?` }
  return { code: 'agent_failed', message: `${label} could not be started.` }
}

export function createAgentRuntime(opts: AgentRuntimeOptions): AgentRuntime {
  const sessions = new Map<string, Session>()
  const byToken = new Map<string, Session>()
  const toolNames = new Set(llmToolDefinitions().map((t) => t.name))
  const startTransport = opts.transport ?? ((command, args, cwd) => processTransport(command, args, { cwd, env: childEnv() }))

  function end(s: Session): void {
    if (s.idle) clearTimeout(s.idle)
    sessions.delete(s.key)
    byToken.delete(s.token)
    for (const resolve of s.tools.values()) resolve({ content: JSON.stringify({ status: 'failed', error: 'The FundBun session ended.' }), isError: true })
    for (const resolve of s.perms.values()) resolve(null)
    s.tools.clear()
    s.perms.clear()
    s.conn.close()
  }

  function touch(s: Session): void {
    if (s.idle) clearTimeout(s.idle)
    s.idle = setTimeout(() => !s.busy && end(s), IDLE_MS)
    s.idle.unref?.()
  }

  function wire(s: Session): void {
    s.conn.onNotification((method, params) => {
      if (method !== 'session/update' || !s.emit) return
      const u = obj(params.update)
      const kind = u.sessionUpdate
      if (kind === 'agent_message_chunk') {
        const delta = blockText(u.content)
        if (delta) s.emit({ type: 'text', delta })
      } else if (kind === 'agent_thought_chunk') {
        const delta = blockText(u.content)
        if (delta) s.emit({ type: 'thought', delta })
      } else if (kind === 'tool_call' || kind === 'tool_call_update') {
        const callId = text(u.toolCallId, 120)
        if (!callId) return
        const known = s.seen.get(callId)
        // the id and kind the adapter gave when the call was first announced are the ones that count
        const name = known?.name || text(u.name, 80)
        const kindOf = known?.kind || text(u.kind, 20) || 'other'
        const entry = { title: text(u.title, 200) || known?.title || 'Tool', kind: kindOf, name, fundbun: known?.fundbun ?? Boolean(fundbunToolOf(name, kindOf, toolNames)) }
        if (s.seen.size > 500) s.seen.clear()
        s.seen.set(callId, entry)
        // FundBun's own tools are reported by the app when it runs them: only the agent's other tools are listed here
        if (entry.fundbun) return
        const status = text(u.status, 20) || (kind === 'tool_call' ? 'pending' : 'in_progress')
        s.emit({ type: 'tool', id: callId, title: entry.title, kind: entry.kind, status })
      }
    })
    s.conn.onRequest(async (method, params) => {
      if (method !== 'session/request_permission') throw new AcpError('Method not found', -32601)
      const options = (Array.isArray(params.options) ? params.options : []).map((o) => obj(o)).map((o) => ({ id: text(o.optionId, 120), name: text(o.name, 80), kind: text(o.kind, 20) })).filter((o) => o.id)
      const toolCall = obj(params.toolCall)
      const allowOnce = options.find((o) => o.kind === 'allow_once')
      const announced = s.seen.get(text(toolCall.toolCallId, 120))
      // FundBun's tools need no second prompt here: the policy gate in the app decides, and asks for the PIN when it
      // must. Recognised only by the id the adapter announced the call with; allowed for this one call, never "always".
      const mine = announced ? announced.fundbun : Boolean(fundbunToolOf(toolCall.name, toolCall.kind, toolNames))
      if (mine && allowOnce) return { outcome: { outcome: 'selected', optionId: allowOnce.id } }
      if (!s.emit || !options.length) return { outcome: { outcome: 'cancelled' } }
      const requestId = id('perm')
      const chosen = await new Promise<string | null>((resolve) => {
        s.perms.set(requestId, resolve)
        s.emit?.({ type: 'permission', requestId, title: text(toolCall.title, 200) || 'The agent wants to use a tool', detail: describeInput(toolCall.rawInput), options })
      })
      s.perms.delete(requestId)
      return chosen && options.some((o) => o.id === chosen) ? { outcome: { outcome: 'selected', optionId: chosen } } : { outcome: { outcome: 'cancelled' } }
    })
    void s.conn.exited.then(() => {
      if (sessions.get(s.key) === s) {
        s.emit?.({ type: 'error', code: 'agent_exited', message: 'The agent stopped.' })
        end(s)
      }
    })
  }

  async function start(input: TurnInput, emit: Emit): Promise<Session | null> {
    const connection = opts.ai.get(input.connectionId)
    const label = connection?.label ?? 'The agent'
    const cmd = opts.ai.agentCommand(input.connectionId)
    if (!cmd.ok) {
      emit({ type: 'error', code: 'agent_missing', message: cmd.error })
      return null
    }
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = [...sessions.values()].find((x) => !x.busy)
      if (oldest) end(oldest)
    }
    mkdirSync(opts.workspace, { recursive: true, mode: 0o700 })
    emit({ type: 'status', text: `Starting ${label}…` })
    const conn = connectAcp(startTransport(cmd.value.command, cmd.value.args, opts.workspace))
    const token = randomBytes(24).toString('hex')
    try {
      await conn.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'fundbun', title: 'FundBun', version: opts.version ?? '1.0.0' },
      }, START_TIMEOUT_MS)
      const created = await conn.request('session/new', {
        cwd: opts.workspace,
        mcpServers: [{
          name: 'fundbun',
          command: opts.nodePath ?? process.execPath,
          args: [opts.bridgeScript],
          env: [
            { name: 'FUNDBUN_BRIDGE_URL', value: opts.bridgeUrl() },
            { name: 'FUNDBUN_BRIDGE_TOKEN', value: token },
            ...Object.entries(opts.nodeEnv ?? {}).map(([name, value]) => ({ name, value })),
          ],
        }],
      }, START_TIMEOUT_MS)
      const sessionId = text(created.sessionId, 200)
      if (!sessionId) throw new AcpError('The agent did not open a session.')
      // inside a finance app the agent asks before it runs commands or changes files, whatever its usual setting
      const mode = safeModeOf(created.modes)
      let asksFirst = mode !== null && !mode.needed
      if (mode?.needed) {
        asksFirst = await conn.request('session/set_mode', { sessionId, modeId: mode.id }, 20_000).then(() => true, () => false)
      }
      const current = text(obj(created.modes).currentModeId, 80)
      if (!asksFirst && current && UNSAFE_MODE.test(current)) {
        emit({ type: 'status', text: `${label} is set to act without asking ("${current}") and FundBun could not change that. It only works inside its own folder here.` })
      }
      const s: Session = { key: input.sessionKey, connectionId: input.connectionId, conn, sessionId, token, fresh: true, busy: false, emit: null, tools: new Map(), perms: new Map(), seen: new Map() }
      sessions.set(s.key, s)
      byToken.set(token, s)
      wire(s)
      return s
    } catch (e) {
      const err = friendlyStartError(e, conn.stderrTail(), label)
      conn.close()
      opts.ai.markError(input.connectionId, err.message)
      emit({ type: 'error', ...err })
      return null
    }
  }

  return {
    async turn(input, emit, signal) {
      let s = sessions.get(input.sessionKey) ?? null
      if (s && (s.connectionId !== input.connectionId || !s.conn.alive)) {
        end(s)
        s = null
      }
      if (s?.busy) return emit({ type: 'error', code: 'agent_busy', message: 'The agent is still working on the last message.' })
      s ??= await start(input, emit)
      if (!s) return
      const session = s
      session.busy = true
      session.emit = emit
      const onAbort = () => {
        session.conn.notify('session/cancel', { sessionId: session.sessionId })
        for (const resolve of session.perms.values()) resolve(null)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const prompt = session.fresh && input.preamble ? `${input.preamble}\n\n---\n\n${input.text}` : input.text
        session.fresh = false
        const res = await session.conn.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text: prompt }] })
        opts.ai.markOk(input.connectionId)
        emit({ type: 'done', stopReason: text(res.stopReason, 40) || 'end_turn' })
      } catch (e) {
        if (sessions.get(session.key) === session) {
          const err = friendlyStartError(e, session.conn.stderrTail(), opts.ai.get(input.connectionId)?.label ?? 'The agent')
          emit({ type: 'error', code: err.code === 'agent_failed' ? 'agent_turn_failed' : err.code, message: err.code === 'agent_failed' ? 'The agent could not finish this answer.' : err.message })
        }
      } finally {
        signal?.removeEventListener('abort', onAbort)
        session.busy = false
        session.emit = null
        if (sessions.get(session.key) === session) touch(session)
      }
    },
    toolResult(callId, content, isError) {
      for (const s of sessions.values()) {
        const resolve = s.tools.get(callId)
        if (resolve) {
          s.tools.delete(callId)
          resolve({ content, isError })
          return true
        }
      }
      return false
    },
    permission(requestId, optionId) {
      for (const s of sessions.values()) {
        const resolve = s.perms.get(requestId)
        if (resolve) {
          resolve(optionId)
          return true
        }
      }
      return false
    },
    cancel(sessionKey) {
      const s = sessions.get(sessionKey)
      if (!s) return
      s.conn.notify('session/cancel', { sessionId: s.sessionId })
      for (const resolve of s.perms.values()) resolve(null)
    },
    async bridge(token, payload) {
      const s = byToken.get(token)
      if (!s) throw new AcpError('Unknown session', 401)
      if (payload.method === 'tools/list') {
        return { tools: llmToolDefinitions().map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) }
      }
      if (payload.method !== 'tools/call') throw new AcpError('Unknown method', 400)
      const name = text(payload.name, 64)
      if (!toolNames.has(name)) return { content: JSON.stringify({ status: 'denied', reason: 'FundBun has no such tool.' }), isError: true }
      // a tool call outside a turn has nobody to approve it
      if (!s.emit) return { content: JSON.stringify({ status: 'failed', error: 'FundBun is not waiting for this agent right now.' }), isError: true }
      const callId = id('call')
      const result = await new Promise<{ content: string; isError: boolean }>((resolve) => {
        const timer = setTimeout(() => {
          s.tools.delete(callId)
          resolve({ content: JSON.stringify({ status: 'failed', error: 'FundBun did not answer in time.' }), isError: true })
        }, TOOL_TIMEOUT_MS)
        timer.unref?.()
        s.tools.set(callId, (r) => {
          clearTimeout(timer)
          resolve(r)
        })
        s.emit?.({ type: 'fundbun_tool', callId, name, args: obj(payload.arguments) })
      })
      return { content: result.content, isError: result.isError }
    },
    close(sessionKey) {
      if (sessionKey) {
        const s = sessions.get(sessionKey)
        if (s) end(s)
        return
      }
      for (const s of [...sessions.values()]) end(s)
    },
  }
}

/** A short, safe-to-show summary of what an agent's tool was asked to do (a command line, a file path). */
function describeInput(raw: unknown): string {
  const o = obj(raw)
  for (const key of ['command', 'cmd', 'file_path', 'path', 'url', 'query', 'description']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 300)
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(' ').slice(0, 300)
  }
  return ''
}

export function defaultWorkspace(home: string): string {
  return join(home, 'workspace')
}
