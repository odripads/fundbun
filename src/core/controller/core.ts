import type { AgentHost } from '../agent/host'
import type { LlmClient } from '../agent/llm'
import type { Result } from '../app-api'
import type { SandboxBank } from '../sandbox/bank'
import type { AppState, ISODateTime } from '../types'
import type { EngineHolder } from './engine'
import type { Persistence } from './persistence'
import type { Store } from './store'
import { attempt, fail, safely } from './util'

export const LOCKED_MSG = 'FundBun is locked. Enter your PIN to unlock it.'
export const NOT_SET_UP_MSG = 'Finish setting up FundBun first.'

export interface LockState {
  /** persisted data is an encrypted vault blob that has not been unlocked in this session */
  locked: boolean
  blob: string | null
  /** in-memory unlock throttling (the mandate's counters live inside the encrypted blob) */
  failures: number
  lockedUntil: number
}

/** Everything the API modules share. */
export interface Core {
  store: Store
  persistence: Persistence
  engines: EngineHolder
  host: AgentHost
  llmClient: LlmClient | null
  clock(): Date
  now(): ISODateTime
  lock: LockState
}

export type UserRecipe = (draft: AppState, bank: SandboxBank, ts: ISODateTime) => Result

/**
 * A user-initiated change that needs an onboarded, unlocked app. Never throws: errors become failed Results.
 * Note that a recipe RETURNING a failure still commits (needed so PIN-failure counters persist).
 */
export function userTx(core: Core, recipe: UserRecipe): Result {
  if (core.lock.locked) return fail(LOCKED_MSG)
  if (!core.store.get().profile) return fail(NOT_SET_UP_MSG)
  return attempt(() => core.store.mutate((draft, bank) => recipe(draft, bank, core.now())))
}

/** For API methods that return a value: throws when locked / not set up / invalid. */
export function userTxValue<T>(core: Core, recipe: (draft: AppState, bank: SandboxBank, ts: ISODateTime) => T): T {
  if (core.lock.locked) throw new Error(LOCKED_MSG)
  if (!core.store.get().profile) throw new Error(NOT_SET_UP_MSG)
  return core.store.mutate((draft, bank) => recipe(draft, bank, core.now()))
}

/** Let the runtime expire stale pending actions (on load, after unlock, after the sandbox clock moves). */
export function expirePending(core: Core): void {
  if (core.lock.locked) return
  if (!core.store.get().pending.some((p) => p.status === 'pending')) return
  safely('engine.expire', () => core.engines.get().expire(), undefined)
}
