import { randomUUID } from 'node:crypto'
import type { AiConnection, AiState, ConnectionTest, DetectedAgent, NewConnectionInput } from '../../src/core/ai/types'
import { createAnthropicProvider } from '../providers/anthropic'
import { createOpenAiCompatProvider } from '../providers/openai'
import { ProviderError, type LlmProvider } from '../providers/types'
import { findCommand } from './paths'
import { AGENTS, CUSTOM_AGENT_ID, PRESETS, agentById, presetById } from './presets'
import { PLAIN_CODEC, type AiStore, type SecretCodec, type StoredConnection } from './store'

/** One model call may take this long: models on a laptop are slow to load the first time. */
export const LOCAL_TIMEOUT_MS = 180_000
export const CLOUD_TIMEOUT_MS = 90_000
const LIST_TIMEOUT_MS = 8_000
const MAX_CONNECTIONS = 20
/** Claude models that accept the effort setting; others get the request without it. */
const EFFORT_MODELS = /^claude-(?:fable|opus|sonnet)-/

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface AiServiceOptions {
  store: AiStore
  codec?: SecretCodec
  fetch?: typeof fetch
  /** full path of an installed command, or null (test seam) */
  find?: (bin: string) => string | null
  now?: () => Date
}

export interface ActiveProvider {
  connection: AiConnection
  provider: LlmProvider
  timeoutMs: number
}

export interface AiService {
  state(): AiState
  get(id: string): AiConnection | null
  active(): AiConnection | null
  /** the command line for an agent connection, resolved to full paths; null when it cannot be started */
  agentCommand(id: string): Result<{ command: string; args: string[] }>
  add(input: NewConnectionInput): Promise<Result<AiConnection>>
  update(id: string, patch: { label?: string; model?: string; apiKey?: string }): Result<AiConnection>
  remove(id: string): boolean
  setActive(id: string | null): Result<AiConnection | null>
  models(id: string): Promise<Result<string[]>>
  test(id: string): Promise<ConnectionTest>
  /** the provider behind the active API connection; null when none is active or the active one is an agent */
  activeProvider(): ActiveProvider | null
  markOk(id: string): void
  markError(id: string, message: string): void
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname.endsWith('.localhost')
}

/** https anywhere; plain http only to this computer. Returns the address without a trailing slash. */
export function checkBaseUrl(text: string): Result<{ url: string; local: boolean }> {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, error: 'That address is not a valid URL.' }
  }
  const local = isLocalHost(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { ok: false, error: 'The address must start with https:// (http:// only for this computer).' }
  if (url.username || url.password) return { ok: false, error: 'Put the key in the key box, not in the address.' }
  return { ok: true, value: { url: `${url.origin}${url.pathname}`.replace(/\/+$/, ''), local } }
}

export function createAiService(opts: AiServiceOptions): AiService {
  const { store } = opts
  const codec = opts.codec ?? PLAIN_CODEC
  const fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const find = opts.find ?? ((bin: string) => findCommand(bin))
  const now = () => (opts.now?.() ?? new Date()).toISOString()

  const isLocal = (c: StoredConnection): boolean => {
    if (c.kind !== 'openai_compat' || !c.baseUrl) return false
    try {
      return isLocalHost(new URL(c.baseUrl).hostname)
    } catch {
      return false
    }
  }
  const view = (c: StoredConnection): AiConnection => ({
    id: c.id, kind: c.kind, presetId: c.presetId, label: c.label, hasKey: Boolean(c.secret), local: isLocal(c), createdAt: c.createdAt,
    ...(c.baseUrl ? { baseUrl: c.baseUrl } : {}), ...(c.model ? { model: c.model } : {}), ...(c.command ? { command: c.command } : {}),
    ...(c.okAt ? { okAt: c.okAt } : {}), ...(c.lastError ? { lastError: c.lastError } : {}),
  })
  const secretOf = (c: StoredConnection): string => {
    if (!c.secret) return ''
    try {
      return codec.decode(c.secret)
    } catch {
      return ''
    }
  }
  const mutate = (id: string, change: (c: StoredConnection) => void): StoredConnection | null => {
    const data = store.load()
    const c = data.connections.find((x) => x.id === id)
    if (!c) return null
    change(c)
    store.save(data)
    return c
  }
  const stored = (id: string): StoredConnection | null => store.load().connections.find((c) => c.id === id) ?? null

  function providerFor(c: StoredConnection, timeoutMs?: number): Result<{ provider: LlmProvider; timeoutMs: number }> {
    if (c.kind === 'agent') return { ok: false, error: 'An agent answers through its own session, not this route.' }
    if (!c.model) return { ok: false, error: 'Pick a model for this connection first.' }
    const local = isLocal(c)
    const limit = timeoutMs ?? (local ? LOCAL_TIMEOUT_MS : CLOUD_TIMEOUT_MS)
    const key = secretOf(c)
    if (c.kind === 'anthropic') {
      if (!key) return { ok: false, error: 'This connection has no key.' }
      const provider = createAnthropicProvider({ apiKey: key, model: c.model, effort: EFFORT_MODELS.test(c.model) ? 'low' : null, fallbacks: false, timeoutMs: limit - 2000, maxRetries: 1 })
      return { ok: true, value: { provider: { ...provider, name: c.label, complete: provider.complete }, timeoutMs: limit } }
    }
    if (!c.baseUrl) return { ok: false, error: 'This connection has no address.' }
    const wire = presetById(c.presetId)?.wire
    const provider = createOpenAiCompatProvider({
      baseUrl: c.baseUrl, apiKey: key, model: c.model, timeoutMs: limit - 2000, fetch: fetchImpl,
      extraBody: wire?.extraBody ?? {}, ...(wire?.maxTokensParam ? { maxTokensParam: wire.maxTokensParam } : {}), label: c.label,
    })
    return { ok: true, value: { provider, timeoutMs: limit } }
  }

  async function listModels(c: StoredConnection): Promise<Result<string[]>> {
    if (c.kind === 'agent') return { ok: true, value: [] }
    const key = secretOf(c)
    const anthropic = c.kind === 'anthropic'
    const url = anthropic ? 'https://api.anthropic.com/v1/models?limit=100' : `${c.baseUrl ?? ''}/models`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (anthropic) Object.assign(headers, { 'x-api-key': key, 'anthropic-version': '2023-06-01' })
    else if (key) headers.Authorization = `Bearer ${key}`
    try {
      const res = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        if (res.status === 401 || res.status === 403) return { ok: false, error: 'The provider did not accept this key.' }
        return { ok: false, error: `The provider could not list its models (HTTP ${res.status}).` }
      }
      const body = (await res.json()) as { data?: unknown; models?: unknown }
      const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
      const ids = rows
        .map((r) => (r && typeof r === 'object' ? ((r as { id?: unknown; name?: unknown }).id ?? (r as { name?: unknown }).name) : r))
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 120)
        .map((id) => id.replace(/^models\//, ''))
      return { ok: true, value: [...new Set(ids)].slice(0, 300) }
    } catch {
      return { ok: false, error: isLocal(c) ? 'Nothing is answering at that address. Is the app running?' : 'Could not reach the provider.' }
    }
  }

  function detected(): DetectedAgent[] {
    return AGENTS.map((a) => ({ ...a, installed: Boolean(find(a.bin)) }))
  }

  return {
    state() {
      const data = store.load()
      return {
        local: true,
        presets: PRESETS.map(({ wire: _wire, ...p }) => p),
        agents: detected(),
        connections: data.connections.map(view),
        activeId: data.activeId,
        keyStorage: codec.describe,
      }
    },
    get: (id) => {
      const c = stored(id)
      return c ? view(c) : null
    },
    active() {
      const data = store.load()
      const c = data.connections.find((x) => x.id === data.activeId)
      return c ? view(c) : null
    },
    agentCommand(id) {
      const c = stored(id)
      if (!c || c.kind !== 'agent') return { ok: false, error: 'That is not an agent connection.' }
      if (c.presetId === CUSTOM_AGENT_ID) {
        const [bin, ...args] = c.command ?? []
        const full = bin ? (bin.includes('/') ? bin : find(bin)) : null
        if (!full) return { ok: false, error: `The command "${bin ?? ''}" was not found on this computer.` }
        return { ok: true, value: { command: full, args } }
      }
      const preset = agentById(c.presetId)
      if (!preset) return { ok: false, error: 'FundBun does not know this agent any more.' }
      if (preset.launch.via === 'bin') {
        const full = find(preset.bin)
        if (!full) return { ok: false, error: `${preset.name} is not installed on this computer (the "${preset.bin}" command was not found).` }
        return { ok: true, value: { command: full, args: [...preset.launch.args] } }
      }
      const npx = find('npx')
      if (!npx) return { ok: false, error: `${preset.name} needs Node.js (the "npx" command was not found).` }
      return { ok: true, value: { command: npx, args: ['-y', preset.launch.package, ...preset.launch.args] } }
    },
    async add(input) {
      const data = store.load()
      if (data.connections.length >= MAX_CONNECTIONS) return { ok: false, error: 'That is a lot of connections. Remove one first.' }
      const presetId = clean(input.presetId, 64)
      const id = `ai_${randomUUID().slice(0, 12)}`
      const createdAt = now()
      const agent = agentById(presetId)
      if (agent || presetId === CUSTOM_AGENT_ID) {
        const command = Array.isArray(input.command) ? input.command.map((a) => clean(a, 400)).filter(Boolean).slice(0, 24) : []
        if (presetId === CUSTOM_AGENT_ID && !command.length) return { ok: false, error: 'Type the command that starts the agent.' }
        const c: StoredConnection = { id, kind: 'agent', presetId, label: clean(input.label, 80) || agent?.name || command[0], createdAt, ...(presetId === CUSTOM_AGENT_ID ? { command } : {}) }
        data.connections.push(c)
        data.activeId ??= id
        store.save(data)
        return { ok: true, value: view(c) }
      }
      const preset = presetById(presetId)
      if (!preset) return { ok: false, error: 'Unknown kind of connection.' }
      const key = clean(input.apiKey, 4000)
      if (preset.needsKey && !key) return { ok: false, error: `${preset.name} needs a key.` }
      const c: StoredConnection = { id, kind: preset.kind, presetId, label: clean(input.label, 80) || preset.name, createdAt }
      if (preset.kind === 'openai_compat') {
        const checked = checkBaseUrl(preset.baseUrl ?? clean(input.baseUrl, 300))
        if (!checked.ok) return checked
        c.baseUrl = checked.value.url
      }
      if (key) c.secret = codec.encode(key)
      c.model = clean(input.model, 120) || preset.defaultModel || undefined
      if (!c.model) {
        // ask the endpoint what it has, so the user starts with something that exists
        const listed = await listModels(c)
        if (!listed.ok) return listed
        c.model = listed.value[0]
      }
      if (!c.model) delete c.model
      data.connections.push(c)
      data.activeId ??= id
      store.save(data)
      return { ok: true, value: view(c) }
    },
    update(id, patch) {
      const label = patch.label === undefined ? undefined : clean(patch.label, 80)
      const model = patch.model === undefined ? undefined : clean(patch.model, 120)
      const key = patch.apiKey === undefined ? undefined : clean(patch.apiKey, 4000)
      const c = mutate(id, (x) => {
        if (label) x.label = label
        if (model) x.model = model
        if (key) x.secret = codec.encode(key)
        delete x.lastError
      })
      return c ? { ok: true, value: view(c) } : { ok: false, error: 'That connection no longer exists.' }
    },
    remove(id) {
      const data = store.load()
      const before = data.connections.length
      data.connections = data.connections.filter((c) => c.id !== id)
      if (data.connections.length === before) return false
      if (data.activeId === id) data.activeId = data.connections[0]?.id ?? null
      store.save(data)
      return true
    },
    setActive(id) {
      const data = store.load()
      if (id === null) {
        data.activeId = null
        store.save(data)
        return { ok: true, value: null }
      }
      const c = data.connections.find((x) => x.id === id)
      if (!c) return { ok: false, error: 'That connection no longer exists.' }
      data.activeId = id
      store.save(data)
      return { ok: true, value: view(c) }
    },
    async models(id) {
      const c = stored(id)
      return c ? listModels(c) : { ok: false, error: 'That connection no longer exists.' }
    },
    async test(id) {
      const started = Date.now()
      const c = stored(id)
      if (!c) return { ok: false, ms: 0, error: 'That connection no longer exists.' }
      const built = providerFor(c, 60_000)
      if (!built.ok) return { ok: false, ms: 0, error: built.error }
      try {
        const res = await built.value.provider.complete({
          system: 'You are a connection test. When a tool is offered, call it.',
          messages: [{ role: 'user', content: 'Call the ping tool once with word "bun".' }],
          tools: [{ name: 'ping', description: 'Connection test. Call it with the word you were given.', input_schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } }],
          maxTokens: 256,
        })
        const tools = res.content.some((b) => b.type === 'tool_use' && b.name === 'ping')
        mutate(id, (x) => {
          x.okAt = now()
          delete x.lastError
        })
        return { ok: true, ms: Date.now() - started, model: res.model, tools }
      } catch (e) {
        const error = e instanceof ProviderError ? e.message : 'The connection test failed.'
        mutate(id, (x) => void (x.lastError = error))
        return { ok: false, ms: Date.now() - started, error }
      }
    },
    activeProvider() {
      const data = store.load()
      const c = data.connections.find((x) => x.id === data.activeId)
      if (!c || c.kind === 'agent') return null
      const built = providerFor(c)
      return built.ok ? { connection: view(c), provider: built.value.provider, timeoutMs: built.value.timeoutMs } : null
    },
    markOk(id) {
      mutate(id, (x) => {
        x.okAt = now()
        delete x.lastError
      })
    },
    markError(id, message) {
      mutate(id, (x) => void (x.lastError = message.slice(0, 200)))
    },
  }
}
