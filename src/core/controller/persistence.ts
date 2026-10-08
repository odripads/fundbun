import { encryptJSON, isVaultBlob } from '../security/vault'
import type { AppState, AuditEntry } from '../types'
import { AUDIT_HEAD_SUFFIX, VAULT_PREFIX } from './constants'
import { parseState } from './state'
import { errorMessage } from './util'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * The newest audit entry of the last state actually written to storage, kept under its own key
 * (`<key>.audit-head`). A hash chain cannot show that its newest entries were deleted; this anchor can.
 */
export interface AuditHead {
  hash: string
  /** entries in the saved log (no pruning: equals the head's seq) */
  count: number
  seq: number
}

/**
 * Vault unlock throttle, kept OUTSIDE the encrypted blob (`<key>.unlock`) so a page reload can't reset it: the count of
 * wrong PINs since the last lock-out, when the current lock-out ends, and how many lock-outs in a row (each doubles).
 */
export interface UnlockThrottle {
  failures: number
  lockedUntil: number
  lockouts: number
}

export const UNLOCK_THROTTLE_SUFFIX = '.unlock'

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
  /** the recorded audit head, or null when none (fresh device, wiped, unreadable) */
  auditHead(): AuditHead | null
  /** forget the anchor — only when a NEW audit chain intentionally starts (demo load, unreadable data) */
  resetAuditHead(): void
  /** the persisted vault unlock throttle (zeros when none or unreadable) */
  unlockThrottle(): UnlockThrottle
  /** persist it; null clears it (after a successful unlock, a wipe or turning the vault off) */
  setUnlockThrottle(t: UnlockThrottle | null): void
}

export function looksEncrypted(raw: string): boolean {
  if (raw.startsWith(VAULT_PREFIX)) return true
  try {
    return isVaultBlob(raw)
  } catch {
    return false
  }
}

function isAuditHead(v: unknown): v is AuditHead {
  if (!v || typeof v !== 'object') return false
  const h = v as Record<string, unknown>
  return typeof h.hash === 'string' && /^[0-9a-f]{64}$/.test(h.hash) && Number.isSafeInteger(h.count) && (h.count as number) >= 1 && Number.isSafeInteger(h.seq)
}

/** true when `audit` still contains the anchored head at its position (the chain only grew since). */
export function extendsHead(audit: readonly AuditEntry[], head: AuditHead): boolean {
  return audit.length >= head.count && audit[head.count - 1]?.hash === head.hash
}

const NO_THROTTLE: UnlockThrottle = { failures: 0, lockedUntil: 0, lockouts: 0 }

function nonNeg(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0
}

export function createPersistence(storage: StorageLike, key: string): Persistence {
  const headKey = `${key}${AUDIT_HEAD_SUFFIX}`
  const throttleKey = `${key}${UNLOCK_THROTTLE_SUFFIX}`

  function unlockThrottle(): UnlockThrottle {
    try {
      const raw = storage.getItem(throttleKey)
      if (!raw) return { ...NO_THROTTLE }
      const t: unknown = JSON.parse(raw)
      if (!t || typeof t !== 'object') return { ...NO_THROTTLE }
      const r = t as Record<string, unknown>
      return { failures: nonNeg(r.failures), lockedUntil: nonNeg(r.lockedUntil), lockouts: nonNeg(r.lockouts) }
    } catch {
      return { ...NO_THROTTLE }
    }
  }

  function setUnlockThrottle(t: UnlockThrottle | null) {
    try {
      if (!t || (t.failures === 0 && t.lockedUntil === 0 && t.lockouts === 0)) storage.removeItem(throttleKey)
      else storage.setItem(throttleKey, JSON.stringify({ failures: t.failures, lockedUntil: t.lockedUntil, lockouts: t.lockouts }))
    } catch (e) {
      console.error('[fundbun] unlock throttle write failed:', e)
    }
  }
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

  function auditHead(): AuditHead | null {
    try {
      const raw = storage.getItem(headKey)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      return isAuditHead(parsed) ? { hash: parsed.hash, count: parsed.count, seq: parsed.seq } : null
    } catch {
      return null
    }
  }

  /**
   * Record the head of a state that was just written. The anchor only moves forward along the same chain: if
   * the saved log no longer contains the anchored entry (newest entries deleted from storage), the old anchor
   * is kept so the truncation stays detectable.
   */
  function writeHead(audit: readonly AuditEntry[]) {
    const head = audit[audit.length - 1]
    if (!head) return
    const prev = auditHead()
    if (prev && !extendsHead(audit, prev)) return
    try {
      storage.setItem(headKey, JSON.stringify({ hash: head.hash, count: audit.length, seq: head.seq }))
    } catch (e) {
      console.error('[fundbun] audit head write failed:', e)
    }
  }

  function resetAuditHead() {
    try {
      storage.removeItem(headKey)
    } catch (e) {
      console.error('[fundbun] audit head remove failed:', e)
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
        if (gen === generation && write(blob)) writeHead(state.audit)
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
    if (write(JSON.stringify(state))) writeHead(state.audit)
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
    resetAuditHead()
    setUnlockThrottle(null)
  }

  return {
    load,
    save,
    flush,
    wipe,
    setVaultPin: (pin) => void (vaultPin = pin),
    hasVaultPin: () => vaultPin !== null,
    auditHead,
    resetAuditHead,
    unlockThrottle,
    setUnlockThrottle,
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
