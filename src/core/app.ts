import type { AppApi } from './app-api'
import type { AgentEngineFactory } from './agent/host'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface CreateAppOptions {
  /** localStorage in the browser; an in-memory store in Node/tests */
  storage?: StorageLike
  /** LLM gateway base URL; null disables the LLM engine entirely (static/offline builds) */
  llmBaseUrl?: string | null
  /** clock for timestamps (tests/evidence pass a fixed clock) */
  now?: () => Date
  /** storage key */
  storageKey?: string
  /** agent runtime factory (default: createAgentEngine from ./agent/runtime); tests inject fakes */
  engineFactory?: AgentEngineFactory
}

/** Creates the FundBun controller. Implemented in wave 2. */
export function createFundBunApp(opts: CreateAppOptions = {}): AppApi {
  throw new Error('TODO createFundBunApp ' + Object.keys(opts).length)
}

export function memoryStorage(): StorageLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}
