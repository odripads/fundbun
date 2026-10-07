import { encryptJSON, isVaultBlob } from '../security/vault'
import type { AppState } from '../types'
import { VAULT_PREFIX } from './constants'
import { parseState } from './state'
import { errorMessage } from './util'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type LoadResult =
  | { kind: 'empty' }
  | { kind: 'plain'; state: AppState }
  | { kind: 'vault'; blob: string }
  | { kind: 'corrupt'; reason: string }

export interface Persistence {
  load(): LoadResult
  /** plaintext JSON, or — when state.settings.vault — an encrypted blob written by a sequential save queue */
  save(state: AppState): void
  /** resolves when queued encrypted saves are written; reports the last save error, if any */
  flush(): Promise<{ ok: boolean; error?: string }>
  /** remove the stored data and cancel queued saves */
  wipe(): void
  /** the vault PIN is held in memory only, for this session */
  setVaultPin(pin: string | null): void
  hasVaultPin(): boolean
}

export function looksEncrypted(raw: string): boolean {
  if (raw.startsWith(VAULT_PREFIX)) return true
  try {
    return isVaultBlob(raw)
  } catch {
    return false
  }
}

export function createPersistence(storage: StorageLike, key: string): Persistence {
  let vaultPin: string | null = null
  // bumped by plaintext saves / wipes so in-flight encrypted writes never land afterwards
  let generation = 0
  let queued: AppState | null = null
  let running: Promise<void> | null = null
  let lastError: string | undefined

  function read(): string | null {
    try {
      return storage.getItem(key)
    } catch (e) {
      console.error('[fundbun] storage read failed:', e)
      return null
    }
  }

  function write(value: string): boolean {
    try {
      storage.setItem(key, value)
      lastError = undefined
      return true
    } catch (e) {
      lastError = `Could not save: ${errorMessage(e)}`
      console.error('[fundbun] storage write failed:', e)
      return false
    }
  }

  function load(): LoadResult {
    const raw = read()
    if (raw === null || raw === '') return { kind: 'empty' }
    if (looksEncrypted(raw)) return { kind: 'vault', blob: raw }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { kind: 'corrupt', reason: 'stored data is not valid JSON' }
    }
    const state = parseState(parsed)
    if (!state) return { kind: 'corrupt', reason: 'stored data is not a FundBun v1 state' }
    // plaintext on disk means the vault is not active, whatever the flag says
    state.settings.vault = false
    return { kind: 'plain', state }
  }

  async function drain() {
    while (queued) {
      const state = queued
      queued = null
      const pin = vaultPin
      const gen = generation
      if (!pin) break
      try {
        const blob = await encryptJSON(state, pin)
        if (gen === generation) write(blob)
      } catch (e) {
        lastError = `Encryption failed: ${errorMessage(e)}`
        console.error('[fundbun] vault encryption failed:', e)
      }
    }
    running = null
  }

  function save(state: AppState) {
    if (state.settings.vault) {
      if (!vaultPin) {
        // never fall back to plaintext when the user asked for encryption
        console.warn('[fundbun] vault is on but no key is held; not saving')
        return
      }
      queued = state
      if (!running) running = drain()
      return
    }
    generation++
    queued = null
    write(JSON.stringify(state))
  }

  async function flush() {
    while (running) await running
    return lastError ? { ok: false, error: lastError } : { ok: true }
  }

  function wipe() {
    generation++
    queued = null
    vaultPin = null
    lastError = undefined
    try {
      storage.removeItem(key)
    } catch (e) {
      console.error('[fundbun] storage remove failed:', e)
    }
  }

  return {
    load,
    save,
    flush,
    wipe,
    setVaultPin: (pin) => void (vaultPin = pin),
    hasVaultPin: () => vaultPin !== null,
  }
}

export function memoryStorage(): StorageLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

/** window.localStorage when usable (it can throw in private modes), otherwise an in-memory store. */
export function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage
    if (ls) {
      const probe = '__fundbun_probe__'
      ls.setItem(probe, '1')
      ls.removeItem(probe)
      return ls
    }
  } catch {
    // fall through
  }
  return memoryStorage()
}
