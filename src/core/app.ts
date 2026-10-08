import type { AppApi, Result } from './app-api'
import type { AgentEngineFactory } from './agent/host'
import { LlmClient } from './agent/llm'
import { createAgentEngine } from './agent/runtime'
import { createAgentApi, initialLlmStatus } from './controller/api-agent'
import { createUserApi } from './controller/api-user'
import { createVaultApi } from './controller/api-vault'
import { appendAudit, verifyAuditAnchored } from './controller/audit'
import { STORAGE_KEY, TEST_NOW } from './controller/constants'
import { LOCKED_MSG, expirePending, type Core, type LockState } from './controller/core'
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
import { emptyState } from './controller/state'
import { createStore } from './controller/store'
import { OK, errorMessage, fail, localISODate, safely } from './controller/util'
import type { AppState, ISODateTime } from './types'

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
  const lock: LockState = { locked: false, blob: null, failures: 0, lockedUntil: 0 }

  const loaded = persistence.load()
  const boot = bootFrom(loaded, lock, now(), today(), persistence.auditHead())
  // nothing (or nothing readable) to protect: whatever chain starts now gets a fresh anchor
  if (loaded.kind === 'empty' || loaded.kind === 'corrupt') persistence.resetAuditHead()
  const store = createStore(boot.state, { llm: initialLlmStatus(llmClient !== null), busy: 0 }, {
    onCommit: (state, persist) => {
      if (persist && !lock.locked) persistence.save(state)
    },
    blockedReason: () => (lock.locked ? LOCKED_MSG : null),
    freeze: opts.freezeState ?? false,
    now,
  })
  if (boot.persist) persistence.save(boot.state)

  const host = createHost({ store, now, llmClient })
  const engines = createEngineHolder(opts.engineFactory ?? createAgentEngine, host)
  const core: Core = { store, persistence, engines, host, llmClient, clock, now, lock }
  const agentApi = createAgentApi(core)
  /** re-probe the gateway whenever LLM use may have become possible (new profile, consent, unlock) */
  const recheckLlm = () => {
    if (llmClient) void agentApi.checkLlm()
  }
  const userApi = createUserApi(core, recheckLlm)
  const vaultApi = createVaultApi(core, recheckLlm)
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
    ...agentApi,
    ...userApi,
    ...vaultApi,
    flush: async () => void (await persistence.flush()),
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
