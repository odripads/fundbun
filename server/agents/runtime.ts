import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent } from '../../src/core/ai/types'
import { llmToolDefinitions } from '../../src/core/agent/specs'
import { childEnv } from '../ai/paths'
import type { AiService } from '../ai/service'
import { MAX_MODEL_ID } from '../ai/store'
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
/** a live test of an agent: npx may download the adapter the first time, so it gets a minute */
export const PROBE_TIMEOUT_MS = 60_000
/** how long a test's model list is reused before the agent is asked again */
export const PROBE_CACHE_MS = 5 * 60_000
const MAX_MODEL_OPTIONS = 200

export type Emit = (event: AgentEvent) => void

export interface TurnInput {
  connectionId: string
  /** the app's name for this conversation; a new key starts a fresh agent session */
  sessionKey: string
  text: string
  /** FundBun's rules for the agent: sent once, at the start of a session */
  preamble: string
}

/** One model an agent offers: its id (what the agent is told) and the name people read. */
export interface AgentModelOption {
  id: string
  name: string
}

/** The models an agent reported when it opened a session, and which one it is using. */
export interface DiscoveredAgentModels {
  /** the id of the agent's "model" setting (session/set_config_option); absent for the older session/set_model */
  configId?: string
  current?: string
  options: AgentModelOption[]
}

/** What a live test of an agent found: it started, asks first, and offers these models. */
export type ProbeResult =
  | { ok: true; ms: number; currentModel?: string; currentModelName?: string; options: AgentModelOption[] }
  | { ok: false; ms: number; error: string }

export interface AgentRuntimeOptions {
  /** the connections; update() is used quietly, to remember the model an agent reported */
  ai: Pick<AiService, 'get' | 'agentCommand' | 'markOk' | 'markError' | 'update'>
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
  /** test seam: milliseconds now, for the test cache */
  now?: () => number
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
  /** start the agent, check it asks first, read its models, and stop it again */
  probe(connectionId: string, opts?: { useCache?: boolean }): Promise<ProbeResult>
  /** end every session of one connection (its model changed, or it was removed) and forget its test */
  closeByConnection(connectionId: string): void
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
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : [])

/** The text of an ACP content block ({type:'text', text}); other kinds are named, not shown. */
function blockText(content: unknown): string {
  const c = obj(content)
  if (c.type === 'text' && typeof c.text === 'string') return c.text
  return ''
}

/**
 * Is this tool call one of FundBun's own tools, which the policy gate in the app handles?
 * Only the adapter-assigned tool id counts (`name`, e.g. "mcp__fundbun__get_overview" or "mcp_fundbun_get_overview"),
 * matched whole, and only for calls the agent does not class as running, editing, deleting or moving. A title is
 * free text the model can influence, so it is never used: anything not recognised here is put to the user as a question.
 */
export function fundbunToolOf(name: unknown, kind: unknown, names: ReadonlySet<string>): string | null {
  const k = text(kind, 20)
  if (k && k !== 'other') return null
  const m = /^(?:mcp__fundbun__|mcp_fundbun_)([a-z_]{3,40})$/.exec(text(name, 80))
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

export class UnsafeModeError extends Error {
  constructor(public readonly mode: string) {
    super('unsafe mode')
    this.name = 'UnsafeModeError'
  }
}

/**
 * Leaves the session in a mode that asks the user before the agent acts, or reports that it cannot.
 * No modes reported: ACP's default is that the agent asks (session/request_permission), so that is accepted.
 * A reported mode that acts without asking must be switched to a safe one; if that is impossible, the answer is no.
 */
export async function asksFirst(conn: Pick<AcpConnection, 'request'>, sessionId: string, modes: unknown): Promise<boolean> {
  const reported = obj(modes)
  const current = text(reported.currentModeId, 80)
  const listed = Array.isArray(reported.availableModes) && reported.availableModes.length > 0
  if (!current && !listed) return true
  const safe = safeModeOf(modes)
  if (!safe) return Boolean(current) && !UNSAFE_MODE.test(current) && !listed
  if (!safe.needed) return true
  return conn.request('session/set_mode', { sessionId, modeId: safe.id }, 20_000).then(() => true, () => false)
}

/** A model id as FundBun keeps it: trimmed, and empty when it is too long to store (cut short, it would name no model). */
function modelIdOf(v: unknown): string {
  const modelId = text(v, 1000).trim()
  return modelId.length <= MAX_MODEL_ID ? modelId : ''
}

interface ModelList {
  options: AgentModelOption[]
  add(idValue: unknown, nameValue: unknown): void
}

/**
 * Collects the models an agent offers: ids checked (one too long to store is left out, never cut), names capped,
 * duplicates dropped, and the list capped with one place kept for the model in use, so it is always a choice.
 */
function modelList(current: string): ModelList {
  const options: AgentModelOption[] = []
  const seen = new Set<string>()
  const add = (idValue: unknown, nameValue: unknown): void => {
    if (options.length >= MAX_MODEL_OPTIONS) return
    const modelId = modelIdOf(idValue)
    if (!modelId || seen.has(modelId)) return
    if (current && modelId !== current && !seen.has(current) && options.length >= MAX_MODEL_OPTIONS - 1) return
    seen.add(modelId)
    options.push({ id: modelId, name: text(nameValue, 120).trim() || modelId })
  }
  return { options, add }
}

function modelsFound(configId: string, current: string, models: ModelList): DiscoveredAgentModels {
  // the model in use is always one of the choices (a place was kept for it)
  if (current) models.add(current, current)
  return { ...(configId ? { configId } : {}), ...(current ? { current } : {}), options: models.options }
}

/**
 * The models an agent offers, read from its session/new answer. Two shapes exist:
 *   configOptions: [{ id: 'model', category: 'model', currentValue, options }] (options flat, or in groups)
 *   models: { currentModelId, availableModels: [{ modelId, name }] } (the older one)
 * The answer comes from another program, so every field is checked and the list is capped.
 */
export function extractAgentModels(created: JsonObject): DiscoveredAgentModels {
  const config = list(created.configOptions, 100).map(obj).find((c) => c.category === 'model' || c.id === 'model')
  if (config) {
    const current = modelIdOf(config.currentValue)
    const models = modelList(current)
    for (const item of list(config.options, 500).map(obj)) {
      if (Array.isArray(item.options)) {
        for (const inner of list(item.options, 500).map(obj)) models.add(inner.value, inner.name)
      } else models.add(item.value, item.name)
    }
    if (models.options.length || current) return modelsFound(text(config.id, 120).trim(), current, models)
  }
  // no usable model setting: try the older shape
  const legacy = obj(created.models)
  const current = modelIdOf(legacy.currentModelId)
  const models = modelList(current)
  for (const item of list(legacy.availableModels, 500).map(obj)) models.add(item.modelId, item.name)
  return modelsFound('', current, models)
}

/** Switches the model: the agent's answer ({} when nothing had to be sent), or null when it cannot be done. */
async function switchAgentModel(conn: Pick<AcpConnection, 'request'>, sessionId: string, modelId: string, models: DiscoveredAgentModels): Promise<JsonObject | null> {
  const wanted = modelId.trim()
  if (!wanted || wanted === models.current) return {}
  if (models.options.length && !models.options.some((o) => o.id === wanted)) return null
  try {
    if (models.configId) return obj(await conn.request('session/set_config_option', { sessionId, configId: models.configId, value: wanted }, 20_000))
    return obj(await conn.request('session/set_model', { sessionId, modelId: wanted }, 20_000))
  } catch {
    return null
  }
}

/**
 * Switches a session to the model the user picked. True when it is already in use (or none was picked), or the
 * agent accepted the switch; false when the agent refused, failed, or never offered that model.
 */
export async function applyAgentModel(conn: Pick<AcpConnection, 'request'>, sessionId: string, modelId: string, discovered: DiscoveredAgentModels): Promise<boolean> {
  return (await switchAgentModel(conn, sessionId, modelId, discovered)) !== null
}

/**
 * The session's modes after a model switch. Changing the model can change other settings, the permission mode
 * among them, and the agent reports it in its answer (a "mode" config option) or in a current_mode_update.
 */
export function modesAfterSwitch(modes: unknown, reply: JsonObject, reportedMode: string): unknown {
  const option = list(reply.configOptions, 100).map(obj).find((c) => c.category === 'mode' || c.id === 'mode')
  const current = text(option?.currentValue, 80) || reportedMode
  return current ? { ...obj(modes), currentModeId: current } : modes
}

export class AgentModelError extends Error {
  constructor(public readonly model: string) {
    super('model unavailable')
    this.name = 'AgentModelError'
  }
}

export class ProbeTimeoutError extends Error {
  constructor() {
    super('probe timed out')
    this.name = 'ProbeTimeoutError'
  }
}

function friendlyStartError(e: unknown, stderr: string, label: string): { code: string; message: string } {
  if (e instanceof UnsafeModeError) {
    return { code: 'agent_unsafe_mode', message: `${label} is set to act without asking${e.mode ? ` ("${e.mode}")` : ''} and FundBun could not switch it to ask first, so FundBun will not use it. Change its permission mode, then try again.` }
  }
  if (e instanceof AgentModelError) {
    return { code: 'agent_model_unavailable', message: `${label} could not switch to the model "${e.model}", so FundBun did not start it. Pick another model in Your AI, then try again.` }
  }
  if (e instanceof ProbeTimeoutError) {
    return { code: 'agent_timeout', message: `${label} did not answer in time. The first start can take a minute while it downloads; try again.` }
  }
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
  const clock = opts.now ?? (() => Date.now())
  /** the last successful test of each connection, and the tests still running (one at a time per connection) */
  const probeCache = new Map<string, { at: number; result: ProbeResult }>()
  const probing = new Map<string, Promise<ProbeResult>>()
  /** each running test's agent, and the connection it tests */
  const probeConns = new Map<AcpConnection, string>()
  /**
   * How often each connection was changed (closeByConnection). A start or a test notes it before the agent starts;
   * when it moved on meanwhile, what that agent found or runs on may no longer be what Your AI shows.
   */
  const generations = new Map<string, number>()
  const generationOf = (connectionId: string): number => generations.get(connectionId) ?? 0

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

  /**
   * initialize, session/new, the model, and the ask-first check: the same for a chat and for a test.
   * `wanted` reads the model the user picked once the session is open, so a pick made while the agent was starting
   * counts. The ask-first check comes last: switching the model can change the agent's mode too.
   */
  async function openSession(conn: AcpConnection, mcpServers: JsonObject[], wanted?: () => string): Promise<{ sessionId: string; models: DiscoveredAgentModels; picked: string }> {
    let reportedMode = ''
    conn.onNotification((method, params) => {
      const u = obj(params.update)
      if (method === 'session/update' && u.sessionUpdate === 'current_mode_update') reportedMode = text(u.currentModeId, 80)
    })
    await conn.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'fundbun', title: 'FundBun', version: opts.version ?? '1.0.0' },
    }, START_TIMEOUT_MS)
    const created = await conn.request('session/new', { cwd: opts.workspace, mcpServers }, START_TIMEOUT_MS)
    const sessionId = text(created.sessionId, 200)
    if (!sessionId) throw new AcpError('The agent did not open a session.')
    const models = extractAgentModels(created)
    // The model the user picked, or the agent's own when none was picked. Fail closed: when the agent cannot
    // switch to the picked model, it is not started on another one without saying so.
    const picked = wanted?.() ?? ''
    const reply = await switchAgentModel(conn, sessionId, picked, models)
    if (!reply) throw new AgentModelError(picked)
    // Inside a finance app the agent must ask before it runs commands or changes files, whatever its usual setting.
    // Fail closed: an agent left in a no-questions mode that FundBun cannot switch is not used at all.
    const modes = modesAfterSwitch(created.modes, reply, reportedMode)
    if (!(await asksFirst(conn, sessionId, modes))) {
      throw new UnsafeModeError(text(obj(modes).currentModeId, 80))
    }
    return { sessionId, models, picked }
  }

  /**
   * Writes down the model a session runs on (the agent's own when none was picked, or the picked one's name), quietly:
   * nothing changed for the sessions already running. Only while the stored model is still the one the session read:
   * a model the user picked meanwhile is never written over.
   */
  function remember(connectionId: string, picked: string, models: DiscoveredAgentModels): void {
    const model = picked || models.current
    const stored = opts.ai.get(connectionId)
    if (!model || !stored || (stored.model ?? '') !== picked) return
    const name = models.options.find((o) => o.id === model)?.name
    if (picked && (stored.modelName || !name)) return
    opts.ai.update(connectionId, { model, ...(name ? { modelName: name } : {}) }, { quiet: true })
  }

  /** Starts a session; 'changed' when the connection changed in Your AI while the agent was starting. */
  async function startOnce(input: TurnInput, emit: Emit): Promise<Session | null | 'changed'> {
    const label = opts.ai.get(input.connectionId)?.label ?? 'The agent'
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
    let generation = generationOf(input.connectionId)
    const conn = connectAcp(startTransport(cmd.value.command, cmd.value.args, opts.workspace))
    const token = randomBytes(24).toString('hex')
    try {
      const { sessionId, models, picked } = await openSession(conn, [{
        name: 'fundbun',
        command: opts.nodePath ?? process.execPath,
        args: [opts.bridgeScript],
        env: [
          { name: 'FUNDBUN_BRIDGE_URL', value: opts.bridgeUrl() },
          { name: 'FUNDBUN_BRIDGE_TOKEN', value: token },
          ...Object.entries(opts.nodeEnv ?? {}).map(([name, value]) => ({ name, value })),
        ],
      }], () => {
        // read once the session is open, so a model picked while the agent was starting is the one it runs on
        generation = generationOf(input.connectionId)
        return opts.ai.get(input.connectionId)?.model ?? ''
      })
      // changed again after that (or removed): this session may run on a model Your AI no longer names
      if (generationOf(input.connectionId) !== generation || !opts.ai.get(input.connectionId)) {
        conn.close()
        return 'changed'
      }
      remember(input.connectionId, picked, models)
      const s: Session = { key: input.sessionKey, connectionId: input.connectionId, conn, sessionId, token, fresh: true, busy: false, emit: null, tools: new Map(), perms: new Map(), seen: new Map() }
      sessions.set(s.key, s)
      byToken.set(token, s)
      wire(s)
      return s
    } catch (e) {
      const err = friendlyStartError(e, conn.stderrTail(), label)
      conn.close()
      // a failure that may be about the settings the user just changed is not reported: the next try uses the new ones
      if (generationOf(input.connectionId) !== generation) return 'changed'
      opts.ai.markError(input.connectionId, err.message)
      emit({ type: 'error', ...err })
      return null
    }
  }

  /**
   * Starts a session on the connection as Your AI shows it. A model picked (or the connection removed) while the
   * agent was starting means one more start, so a session never runs on a model the app no longer names.
   */
  async function start(input: TurnInput, emit: Emit): Promise<Session | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const s = await startOnce(input, emit)
      if (s !== 'changed') return s
    }
    const label = opts.ai.get(input.connectionId)?.label ?? 'The agent'
    emit({ type: 'error', code: 'agent_changed', message: `${label} was changed in Your AI while it was starting. Send your message again.` })
    return null
  }

  /**
   * One live test: start the agent, open a session (no FundBun tools), read its models, stop it.
   * null when the connection changed while it ran (its agent was stopped): that test says nothing about it now.
   */
  async function runProbe(connectionId: string): Promise<ProbeResult | null> {
    const started = clock()
    const label = opts.ai.get(connectionId)?.label ?? 'The agent'
    const cmd = opts.ai.agentCommand(connectionId)
    if (!cmd.ok) {
      opts.ai.markError(connectionId, cmd.error)
      return { ok: false, ms: 0, error: cmd.error }
    }
    mkdirSync(opts.workspace, { recursive: true, mode: 0o700 })
    const generation = generationOf(connectionId)
    const conn = connectAcp(startTransport(cmd.value.command, cmd.value.args, opts.workspace))
    probeConns.set(conn, connectionId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProbeTimeoutError()), PROBE_TIMEOUT_MS)
      timer.unref?.()
    })
    try {
      const { models } = await Promise.race([openSession(conn, []), deadline])
      if (generationOf(connectionId) !== generation) return null
      const currentName = models.options.find((o) => o.id === models.current)?.name
      opts.ai.markOk(connectionId)
      return {
        ok: true,
        ms: clock() - started,
        ...(models.current ? { currentModel: models.current } : {}),
        ...(currentName ? { currentModelName: currentName } : {}),
        options: models.options,
      }
    } catch (e) {
      if (generationOf(connectionId) !== generation) return null
      const err = friendlyStartError(e, conn.stderrTail(), label)
      opts.ai.markError(connectionId, err.message)
      return { ok: false, ms: clock() - started, error: err.message }
    } finally {
      if (timer) clearTimeout(timer)
      probeConns.delete(conn)
      conn.close()
    }
  }

  /** A live test, reused for five minutes when asked to, and one at a time per connection (callers share it). */
  function probe(connectionId: string, o?: { useCache?: boolean }): Promise<ProbeResult> {
    const cached = probeCache.get(connectionId)
    if (o?.useCache && cached && clock() - cached.at < PROBE_CACHE_MS) return Promise.resolve(cached.result)
    if (!o?.useCache) probeCache.delete(connectionId)
    const running = probing.get(connectionId)
    if (running) return running
    const p: Promise<ProbeResult> = runProbe(connectionId)
      .catch((): ProbeResult => ({ ok: false, ms: 0, error: 'The agent could not be started.' }))
      .then((r) => {
        // the connection changed while it was tested: test it again as it is now, or say it is gone
        if (!r) return opts.ai.get(connectionId) ? probe(connectionId) : { ok: false as const, ms: 0, error: 'That connection no longer exists.' }
        if (probing.get(connectionId) === p) {
          probing.delete(connectionId)
          if (r.ok) probeCache.set(connectionId, { at: clock(), result: r })
          else probeCache.delete(connectionId)
        }
        return r
      })
    probing.set(connectionId, p)
    return p
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
      for (const conn of [...probeConns.keys()]) conn.close()
    },
    probe,
    closeByConnection(connectionId) {
      generations.set(connectionId, generationOf(connectionId) + 1)
      const label = opts.ai.get(connectionId)?.label ?? 'The agent'
      for (const s of [...sessions.values()]) {
        if (s.connectionId !== connectionId) continue
        // an answer still coming stops here: it says so, so the app does not take the cut-off text for a whole answer
        if (s.busy) s.emit?.({ type: 'error', code: 'agent_changed', message: `${label} was changed in Your AI, so this answer stopped. Send your message again.` })
        end(s)
      }
      // a test still running is stopped with its agent: whoever waits for it gets a test of the connection as it is now
      for (const [conn, tested] of [...probeConns]) if (tested === connectionId) conn.close()
      probeCache.delete(connectionId)
      probing.delete(connectionId)
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
