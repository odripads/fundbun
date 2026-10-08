import type { AgentHost } from '../agent/host'
import type { LlmClient } from '../agent/llm'
import type { Result } from '../app-api'
import type { SandboxBank } from '../sandbox/bank'
import { diffDays } from '../dates'
import type { AppState, ISODateTime } from '../types'
import { appendAudit } from './audit'
import { advanceClockIn } from './data'
import type { EngineHolder } from './engine'
import type { Persistence } from './persistence'
import type { Store } from './store'
import { attempt, fail, localISODate, safely } from './util'

export const LOCKED_MSG = 'FundBun is locked. Enter your PIN to unlock it.'
export const NOT_SET_UP_MSG = 'Finish setting up FundBun first.'

export interface LockState {
  /** persisted data is an encrypted vault blob that has not been unlocked in this session */
  locked: boolean
  blob: string | null
  /**
   * mirror of the persisted unlock throttle (persistence.unlockThrottle — stored outside the encrypted blob, so a
   * reload doesn't reset it); the mandate's PIN counters live inside the blob
   */
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
  syncClock(core)
  return attempt(() => core.store.mutate((draft, bank) => recipe(draft, bank, core.now())))
}

/** For API methods that return a value: throws when locked / not set up / invalid. */
export function userTxValue<T>(core: Core, recipe: (draft: AppState, bank: SandboxBank, ts: ISODateTime) => T): T {
  if (core.lock.locked) throw new Error(LOCKED_MSG)
  if (!core.store.get().profile) throw new Error(NOT_SET_UP_MSG)
  syncClock(core)
  return core.store.mutate((draft, bank) => recipe(draft, bank, core.now()))
}

/** Which clock a state's "today" follows: demo personas keep the fixed sandbox clock; real-data users the device date. */
export function clockOf(state: Pick<AppState, 'bank'>): 'sandbox' | 'real' {
  return state.bank.personaId ? 'sandbox' : 'real'
}

/** Longest stretch caught up day by day (scheduled payments, overdue bills, tripwires); a longer absence jumps the rest. */
export const MAX_CATCH_UP_DAYS = 731

/**
 * One clock: a real-data user's bank.today follows the device's local date. Moves it forward (never back) one day at a
 * time — scheduled bill payments due in between run, unpaid bills turn overdue, tripwires see each day, a new month
 * retires last month's pace alert — and audits it once (system 'session_start', data.clock 'real'). Demo personas
 * keep their sandbox clock (advanceDays moves it). Called on boot, unlock, before every user action and agent turn,
 * and by AppApi.syncClock (the UI calls it when the page becomes visible again). Never throws; true when it moved.
 */
export function syncClock(core: Core): boolean {
  if (core.lock.locked || core.store.inTransaction()) return false
  const s = core.store.get()
  if (!s.profile || clockOf(s) === 'sandbox') return false
  const real = localISODate(core.clock())
  if (!(real > s.bank.today)) return false
  const moved = safely('syncClock', () => core.store.mutate((draft, bank) => {
    const ts = core.now()
    const from = draft.bank.today
    const days = diffDays(from, real)
    const stepped = Math.min(days, MAX_CATCH_UP_DAYS)
    const { txns, events } = advanceClockIn(draft, bank, stepped, ts)
    if (days > stepped) {
      draft.bank.today = real
      for (const b of draft.bank.bills) if (b.status === 'upcoming' && b.dueDate < real) b.status = 'overdue'
    }
    appendAudit(draft, ts, 'system', 'session_start', `Calendar moved to today (${real})`, {
      clock: 'real', from, to: real, days, txns: txns.length, events: events.length,
    })
    return true
  }), false)
  if (moved) expirePending(core)
  return moved
}

/** Let the runtime expire stale pending actions (on load, after unlock, after the sandbox clock moves). */
export function expirePending(core: Core): void {
  if (core.lock.locked) return
  if (!core.store.get().pending.some((p) => p.status === 'pending')) return
  safely('engine.expire', () => core.engines.get().expire(), undefined)
}
