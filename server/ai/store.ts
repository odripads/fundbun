import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionKind } from '../../src/core/ai/types'

/**
 * Where the user's AI connections live on this computer: one JSON file in the FundBun home folder
 * (~/.fundbun by default), readable only by the user's account. Keys go through a SecretCodec first:
 * the desktop app passes one backed by the operating system's keychain; the plain local server keeps them
 * as they are (the file's permissions are the protection, and the app says so).
 */
export interface SecretCodec {
  /** how keys are kept, in plain words for the settings screen */
  readonly describe: string
  encode(plain: string): string
  decode(stored: string): string
}

export const PLAIN_CODEC: SecretCodec = {
  describe: 'Keys are kept in a file on this computer that only your user account can read.',
  encode: (plain) => `plain:${plain}`,
  decode: (stored) => (stored.startsWith('plain:') ? stored.slice(6) : ''),
}

export interface StoredConnection {
  id: string
  kind: ConnectionKind
  presetId: string
  label: string
  baseUrl?: string
  model?: string
  /** encoded by the SecretCodec; never sent to the app */
  secret?: string
  command?: string[]
  createdAt: string
  okAt?: string
  lastError?: string
}

export interface StoredAi {
  version: 1
  connections: StoredConnection[]
  activeId: string | null
}

export const EMPTY_AI: StoredAi = { version: 1, connections: [], activeId: null }

export function defaultHome(env: Record<string, string | undefined> = process.env): string {
  return env.FUNDBUN_HOME?.trim() || join(homedir(), '.fundbun')
}

export interface AiStore {
  readonly home: string
  load(): StoredAi
  save(next: StoredAi): void
}

/** File store: atomic writes (temp + rename), folder 0700, file 0600. A damaged file reads as empty, never throws. */
export function createFileStore(home: string): AiStore {
  const file = join(home, 'connections.json')
  return {
    home,
    load() {
      try {
        if (!existsSync(file)) return structuredClone(EMPTY_AI)
        return normalise(JSON.parse(readFileSync(file, 'utf8')))
      } catch {
        return structuredClone(EMPTY_AI)
      }
    },
    save(next) {
      mkdirSync(home, { recursive: true, mode: 0o700 })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
      renameSync(tmp, file)
      try {
        chmodSync(file, 0o600)
      } catch {
        // best effort on file systems without POSIX modes
      }
    },
  }
}

export function createMemoryStore(initial: StoredAi = EMPTY_AI, home = '/tmp/fundbun-test'): AiStore {
  let state = structuredClone(initial)
  return { home, load: () => structuredClone(state), save: (next) => void (state = structuredClone(next)) }
}

const KINDS = new Set<ConnectionKind>(['openai_compat', 'anthropic', 'agent'])
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)

/** Keep only well-formed connections: a hand-edited or half-written file must not crash the server. */
export function normalise(raw: unknown): StoredAi {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { connections?: unknown; activeId?: unknown }
  const connections: StoredConnection[] = []
  for (const item of Array.isArray(r.connections) ? r.connections.slice(0, 50) : []) {
    const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const id = str(c.id, 64)
    const kind = c.kind as ConnectionKind
    const presetId = str(c.presetId, 64)
    const label = str(c.label, 80)
    if (!id || !KINDS.has(kind) || !presetId || !label) continue
    const out: StoredConnection = { id, kind, presetId, label, createdAt: str(c.createdAt, 40) ?? new Date(0).toISOString() }
    const baseUrl = str(c.baseUrl, 300)
    const model = str(c.model, 120)
    const secret = str(c.secret, 8000)
    if (baseUrl) out.baseUrl = baseUrl
    if (model) out.model = model
    if (secret) out.secret = secret
    if (Array.isArray(c.command) && c.command.length && c.command.length <= 24 && c.command.every((a) => typeof a === 'string' && a.length <= 400)) out.command = c.command as string[]
    const okAt = str(c.okAt, 40)
    const lastError = str(c.lastError, 200)
    if (okAt) out.okAt = okAt
    if (lastError) out.lastError = lastError
    connections.push(out)
  }
  const activeId = typeof r.activeId === 'string' && connections.some((c) => c.id === r.activeId) ? r.activeId : null
  return { version: 1, connections, activeId }
}
