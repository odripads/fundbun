import { decryptJSON, encryptJSON, isVaultBlob } from './security/vault'
import { verifyAudit } from './security/audit'
import { createPin } from './security/pin'
import { stepUp, pinFormatOk } from './controller/safety'
import { exportableState } from './controller/api-user'
import type { AppApi, Result } from './app-api'
import type { AgentEngineFactory } from './agent/host'
import { LlmClient } from './agent/llm'
import { AiClient } from './ai/client'
import type { AgentSession } from './controller/host'
import { uid } from './ids'
import { createAgentEngine } from './agent/runtime'
import { createAgentApi, initialLlmStatus } from './controller/api-agent'
import { createUserApi } from './controller/api-user'
import { createVaultApi } from './controller/api-vault'
import { appendAudit, verifyAuditAnchored } from './controller/audit'
import { STORAGE_KEY, TEST_NOW } from './controller/constants'
import { LOCKED_MSG, expirePending, syncClock, type Core, type LockState } from './controller/core'
import { buildDemoState } from './controller/demo'
import { createEngineHolder } from './controller/engine'
import { createHost } from './controller/host'
import { buildOnboardedState, validateOnboarding } from './controller/onboarding'
import {
  createPersistence,
  defaultStorage,
  memoryStorage,
  type AuditHead,
  type LoadResult,
  type StorageLike,
} from './controller/persistence'
import { emptyState, parseState, safeDefaultMandate } from './controller/state'
import { createStore } from './controller/store'
import { OK, errorMessage, fail, localISODate, safely } from './controller/util'
import type { AppState, ISODateTime } from './types'


/** What a copy for another device is (inside the encryption) and how long its password must be. */
const BACKUP_KIND = 'fundbun-backup'
export const BACKUP_MIN_PASSWORD = 8

export { memoryStorage, type StorageLike }
export { CONSENT_VERSION, DEMO_PIN, DEMO_TODAY, STORAGE_KEY, TEST_NOW } from './controller/constants'

export interface CreateAppOptions {
  /** localStorage in the browser; an in-memory store in Node/tests */
  storage?: StorageLike
  /** LLM gateway base URL (default '/api'); null disables the LLM engine entirely (static/offline builds) */
  llmBaseUrl?: string | null
  /** clock for timestamps (tests/evidence pass a fixed clock) */
  now?: () => Date
  /** storage key */
  storageKey?: string
  /** agent runtime factory (default: createAgentEngine from ./agent/runtime); tests inject fakes */
  engineFactory?: AgentEngineFactory
  /**
   * Deep-freeze every committed state so code that mutates host.state() / snapshots in place throws instead of
   * silently corrupting them (default false; createTestApp turns it on).
   */
  freezeState?: boolean
}

/** AppApi plus controller utilities for tests, scenarios and the evidence runner. */
export interface FundBunApp extends AppApi {
  /** resolves when queued (encrypted) saves have been written */
  flush(): Promise<void>
  /** the user's own AI connections on this computer (null when the app runs without any server) */
  readonly ai: AiClient | null
}

interface Boot {
  state: AppState
  /** write the boot state back (e.g. after recovering from corrupt data) */
  persist: boolean
}

function bootFrom(loaded: LoadResult, lock: LockState, now: ISODateTime, today: string, head: AuditHead | null = null): Boot {
  switch (loaded.kind) {
    case 'empty':
      return { state: emptyState(today), persist: false }
    case 'vault':
      Object.assign(lock, { locked: true, blob: loaded.blob })
      return { state: emptyState(today), persist: false }
    case 'corrupt': {
      const state = emptyState(today)
      appendAudit(state, now, 'system', 'data_wiped', 'Unreadable local data was discarded; starting fresh', { reason: loaded.reason })
      return { state, persist: true }
    }
    case 'plain': {
      const { state } = loaded
      if (!state.profile) return { state, persist: false }
      // anchored: deleting the newest entries from storage is caught too, not only edits
      const check = safely('verifyAudit', () => verifyAuditAnchored(state.audit, head), { ok: false, count: state.audit.length })
      appendAudit(state, now, 'system', 'session_start', 'Session started', {
        auditIntact: check.ok, auditEntries: check.count, ...(check.ok ? {} : { brokenAt: check.brokenAt ?? null }),
      })
      return { state, persist: true }
    }
  }
}

/** Creates the FundBun controller: the single AppApi used by the React UI, the scenario runner and the tests. */
export function createFundBunApp(opts: CreateAppOptions = {}): FundBunApp {
  const clock = opts.now ?? (() => new Date())
  const now = () => clock().toISOString()
  const today = () => localISODate(clock())
  const persistence = createPersistence(opts.storage ?? defaultStorage(), opts.storageKey ?? STORAGE_KEY)
  const llmBaseUrl = opts.llmBaseUrl === undefined ? '/api' : opts.llmBaseUrl
  const llmClient = llmBaseUrl === null ? null : new LlmClient(llmBaseUrl)
  const aiClient = llmBaseUrl === null ? null : new AiClient(llmBaseUrl)
  // one agent conversation at a time: New chat (and a reload) start a fresh one; Stop aborts the reply in flight
  let sessionKey = uid('chat')
  let sessionFresh = true
  let stopper = new AbortController()
  const session: AgentSession = {
    key: () => sessionKey,
    fresh: () => sessionFresh,
    used: () => void (sessionFresh = false),
    signal: () => {
      if (stopper.signal.aborted) stopper = new AbortController()
      return stopper.signal
    },
  }
  const newAgentSession = () => {
    // only a session an agent was actually started for needs closing
    if (!sessionFresh) void aiClient?.close(sessionKey)
    sessionKey = uid('chat')
    sessionFresh = true
  }
  const stopReply = () => {
    stopper.abort()
    void aiClient?.cancel(sessionKey)
  }
  const lock: LockState = { locked: false, blob: null, failures: 0, lockedUntil: 0 }

  const loaded = persistence.load()
  const boot = bootFrom(loaded, lock, now(), today(), persistence.auditHead())
  // nothing (or nothing readable) to protect: whatever chain starts now gets a fresh anchor
  if (loaded.kind === 'empty' || loaded.kind === 'corrupt') persistence.resetAuditHead()
  const store = createStore(boot.state, { llm: initialLlmStatus(llmClient !== null), busy: 0, live: null }, {
    onCommit: (state, persist) => {
      if (persist && !lock.locked) persistence.save(state)
    },
    blockedReason: () => (lock.locked ? LOCKED_MSG : null),
    freeze: opts.freezeState ?? false,
    now,
  })
  if (boot.persist) persistence.save(boot.state)

  const host = createHost({ store, now, llmClient, aiClient, session })
  const engines = createEngineHolder(opts.engineFactory ?? createAgentEngine, host)
  const core: Core = { store, persistence, engines, host, llmClient, aiClient, clock, now, lock, newAgentSession, stopReply }
  const agentApi = createAgentApi(core)
  /** re-probe the gateway whenever LLM use may have become possible (new profile, consent, unlock) */
  const recheckLlm = () => {
    if (llmClient) void agentApi.checkLlm()
  }
  const userApi = createUserApi(core, recheckLlm)
  const vaultApi = createVaultApi(core, recheckLlm)
  // one clock: a real-data user's calendar catches up with the device date (persona sandboxes keep theirs)
  syncClock(core)
  expirePending(core)
  if (store.get().profile) recheckLlm()

  function completeOnboarding(input: Parameters<AppApi['completeOnboarding']>[0]): Result {
    if (lock.locked) return fail(LOCKED_MSG)
    const errors = validateOnboarding(input)
    if (errors.length) return fail(errors.join('; '))
    let next: AppState
    try {
      next = buildOnboardedState(input, store.get(), now(), today())
    } catch (e) {
      return fail(errorMessage(e))
    }
    persistence.setVaultPin(null)
    engines.reset()
    store.replace(next)
    recheckLlm()
    return OK
  }

  function loadDemo(personaId = 'mei'): void {
    if (lock.locked) {
      console.warn('[fundbun] loadDemo ignored: the vault is locked')
      return
    }
    const next = buildDemoState(personaId, now())
    persistence.setVaultPin(null)
    // the demo starts a fresh audit chain, so it gets a fresh anchor
    persistence.resetAuditHead()
    engines.reset()
    store.replace(next)
    recheckLlm()
  }

  /**
   * A copy for another device: the user's data encrypted with a password they pick (PBKDF2 → AES-GCM, as the vault).
   * FundBun has no server, so this file is how data moves. Making one needs the current PIN (it is everything at
   * once), and the copy carries no PIN hash and no lockout state: the new device sets its own PIN.
   */
  async function exportBackup(password: string, pin: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    if (lock.locked || !store.get().profile) return { ok: false, error: LOCKED_MSG }
    if (typeof password !== 'string' || password.length < BACKUP_MIN_PASSWORD) return { ok: false, error: `Use a password of at least ${BACKUP_MIN_PASSWORD} characters` }
    const allowed = store.mutate((draft) => {
      const v = stepUp(draft, pin, 'Save a copy for another device', now())
      if (v.ok) appendAudit(draft, now(), 'user', 'data_export', 'Saved an encrypted copy for another device', { transactions: draft.bank.transactions.length })
      return v
    })
    if (!allowed.ok) return { ok: false, error: allowed.error ?? 'Wrong PIN' }
    const s = exportableState(store.get())
    // no vault password, no PIN, no lockout counters: the copy is data, not access
    const mandate = { ...s.mandate, failedPinAttempts: 0 }
    delete mandate.pinLockedUntil
    const state: AppState = { ...s, mandate, settings: { ...s.settings, vault: false } }
    try {
      const text = await encryptJSON({ kind: BACKUP_KIND, v: 1, exportedAt: now(), state }, password)
      return { ok: true, text }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  }

  /**
   * Restore a copy made by exportBackup. Only on a device with nobody set up (the start screen, or after Log out),
   * so it can never replace someone's data or roll back their PIN lockout. The user sets a new PIN, and Bun's
   * permissions start at the careful defaults again (raised later in Settings, with that PIN). The restored audit
   * chain is verified and the result recorded.
   */
  async function restoreBackup(text: string, password: string, newPin: string): Promise<Result> {
    if (lock.locked) return fail(LOCKED_MSG)
    if (store.get().profile) return fail('Someone is set up on this device. Log out first, then restore.')
    if (!pinFormatOk(newPin)) return fail('Pick a new PIN: 4–6 digits, not 1234 or 1111')
    if (typeof text !== 'string' || !isVaultBlob(text.trim())) return fail('That isn’t a FundBun copy. Pick the file you saved with “Move to another device”.')
    let raw: unknown
    try {
      raw = await decryptJSON(text.trim(), password)
    } catch {
      return fail('That password doesn’t open this copy.')
    }
    const payload = raw as { kind?: unknown; state?: unknown }
    const state = payload && payload.kind === BACKUP_KIND ? parseState(payload.state) : null
    if (!state || !state.profile) return fail('This copy couldn’t be read.')
    const audit = safely('verifyAudit', () => verifyAudit(state.audit), { ok: false } as ReturnType<typeof verifyAudit>)
    // permissions are not carried over: careful defaults and the new PIN
    state.mandate = { ...safeDefaultMandate(), autonomy: 'suggest', ...createPin(newPin), failedPinAttempts: 0 }
    state.pending = []
    state.settings = { ...state.settings, vault: false }
    persistence.setVaultPin(null)
    persistence.resetAuditHead()
    engines.reset()
    appendAudit(state, now(), 'user', 'data_import', 'Restored from a copy made on another device', {
      transactions: state.bank.transactions.length, auditIntact: audit.ok, auditEntries: state.audit.length,
    })
    store.replace(state)
    syncClock(core)
    recheckLlm()
    return OK
  }

  /** PIPL right to deletion: wipe storage + memory; a fresh audit chain records the wipe (not persisted). */
  function resetAll(): void {
    persistence.wipe()
    Object.assign(lock, { locked: false, blob: null, failures: 0, lockedUntil: 0 })
    engines.reset()
    const state = emptyState(today())
    appendAudit(state, now(), 'user', 'data_wiped', 'All local data deleted at the user\'s request')
    store.replace(state, { persist: false })
  }

  return {
    getSnapshot: () => store.snapshot(),
    subscribe: (listener) => store.subscribe(listener),
    isOnboarded: () => !lock.locked && store.get().profile !== null,
    completeOnboarding,
    loadDemo,
    resetAll,
    exportBackup,
    restoreBackup,
    ...agentApi,
    ...userApi,
    ...vaultApi,
    syncClock: () => syncClock(core),
    flush: async () => void (await persistence.flush()),
    ai: aiClient,
  }
}

/**
 * A controller for tests / scenarios: in-memory storage, no LLM gateway, fixed clock 2026-10-22T10:00+08:00,
 * deep-frozen committed states (in-place mutation outside host.mutate() throws).
 */
export function createTestApp(opts: CreateAppOptions = {}): FundBunApp {
  return createFundBunApp({
    storage: memoryStorage(),
    llmBaseUrl: null,
    now: () => new Date(TEST_NOW),
    freezeState: true,
    ...opts,
  })
}
