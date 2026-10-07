import type { AppSnapshot } from '../app-api'
import { SandboxBank } from '../sandbox/bank'
import type { AppState } from '../types'
import { createDerived, type RuntimeFlags } from './derive'

export type Recipe<T> = (draft: AppState, bank: SandboxBank) => T

export interface StoreDeps {
  /** called after every committed state change (persistence) */
  onCommit(state: AppState, persist: boolean): void
  /** a reason string blocks all mutations (e.g. the vault is locked) */
  blockedReason(): string | null
  /** deep-freeze committed states so accidental in-place mutation throws (tests / scenarios) */
  freeze?: boolean
}

export interface Store {
  /** the last committed (immutable) state */
  get(): AppState
  snapshot(): AppSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Atomic mutation on a structuredClone draft + a live SandboxBank wrapping draft.bank. Commits when the recipe
   * returns, discards the draft when it throws. Nested calls join the outer transaction (no savepoints).
   */
  mutate<T>(recipe: Recipe<T>): T
  /** commit a whole new state (demo load, onboarding, unlock, reset) */
  replace(next: AppState, opts?: { persist?: boolean }): void
  /** runtime-only flags (never persisted): produce a new snapshot with the same state */
  setRuntime(patch: Partial<RuntimeFlags>): void
  runtime(): RuntimeFlags
  inTransaction(): boolean
}

export function createStore(initial: AppState, rt: RuntimeFlags, deps: StoreDeps): Store {
  let state = deps.freeze ? deepFreeze(initial) : initial
  let runtime = rt
  let snap = build()
  let tx: { draft: AppState; bank: SandboxBank } | null = null
  const listeners = new Set<() => void>()

  function build(): AppSnapshot {
    return Object.freeze({ state, derived: createDerived(state, runtime) })
  }

  function emit() {
    for (const l of [...listeners]) {
      try {
        l()
      } catch (e) {
        console.error('[fundbun] subscriber failed:', e)
      }
    }
  }

  function commit(next: AppState, persist: boolean) {
    state = deps.freeze ? deepFreeze(next) : next
    snap = build()
    try {
      deps.onCommit(state, persist)
    } catch (e) {
      console.error('[fundbun] persist failed:', e)
    }
    emit()
  }

  function mutate<T>(recipe: Recipe<T>): T {
    if (tx) return recipe(tx.draft, tx.bank)
    const blocked = deps.blockedReason()
    if (blocked) throw new Error(blocked)
    const draft = cloneState(state)
    const bank = new SandboxBank(draft.bank, { userRules: draft.categoryRules })
    tx = { draft, bank }
    let result: T
    try {
      result = recipe(draft, bank)
      if (isThenable(result)) throw new Error('mutate() recipes must be synchronous')
    } finally {
      tx = null
    }
    // the bank wraps draft.bank; keep them in sync even if an implementation swapped its state object
    draft.bank = bank.state
    commit(draft, true)
    return result
  }

  function replace(next: AppState, opts: { persist?: boolean } = {}) {
    if (tx) throw new Error('replace() cannot run inside mutate()')
    commit(next, opts.persist ?? true)
  }

  return {
    get: () => state,
    snapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    mutate,
    replace,
    setRuntime(patch) {
      runtime = { ...runtime, ...patch }
      snap = build()
      emit()
    },
    runtime: () => runtime,
    inTransaction: () => tx !== null,
  }
}

function isThenable(x: unknown): boolean {
  return typeof x === 'object' && x !== null && typeof (x as { then?: unknown }).then === 'function'
}

/**
 * structuredClone, falling back to a JSON round-trip if something non-cloneable (e.g. a function) slipped into
 * state — otherwise every later mutation would fail and the app would be stuck.
 */
export function cloneState(state: AppState): AppState {
  try {
    return structuredClone(state)
  } catch (e) {
    console.error('[fundbun] state is not structured-cloneable; falling back to JSON:', e)
    return JSON.parse(JSON.stringify(state)) as AppState
  }
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  return value
}
