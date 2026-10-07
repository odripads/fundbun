import { createContext, useContext, useMemo, useRef, useSyncExternalStore } from 'react'
import type { AppSnapshot } from '../../core/app-api'
import type { FundBunApp } from '../../core/app'
import { getEngine, type EngineStatus } from './appInstance'

/** Provided by <AppProvider>; absent → the browser singleton. Tests inject a fake app through it. */
export const EngineContext = createContext<EngineStatus | null>(null)

export class EngineNotReadyError extends Error {
  constructor(reason: string) {
    super(`FundBun engine is not ready: ${reason}`)
    this.name = 'EngineNotReadyError'
  }
}

export function useEngineStatus(): EngineStatus {
  return useContext(EngineContext) ?? getEngine()
}

/** The controller. Screens render only after the shell checked readiness, so this throws only on misuse. */
export function useApp(): FundBunApp {
  const status = useEngineStatus()
  if (!status.ready) throw new EngineNotReadyError(status.error)
  return status.app
}

export type Equality<T> = (a: T, b: T) => boolean

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

interface SelectionCache<T> {
  snapshot: AppSnapshot
  selector: (s: AppSnapshot) => T
  value: T
}

/**
 * Build a memoised getSnapshot for useSyncExternalStore: the selector re-runs only when the snapshot (or the
 * selector) changes, and an equal result keeps the previous reference so consumers don't re-render.
 */
export function createSelection<T>(
  getSnapshot: () => AppSnapshot,
  selector: (s: AppSnapshot) => T,
  isEqual: Equality<T>,
  cache: { current: SelectionCache<T> | null },
): () => T {
  return () => {
    const snapshot = getSnapshot()
    const prev = cache.current
    if (prev && prev.snapshot === snapshot && prev.selector === selector) return prev.value
    const next = selector(snapshot)
    const value = prev && isEqual(prev.value, next) ? prev.value : next
    cache.current = { snapshot, selector, value }
    return value
  }
}

/**
 * Subscribe to a slice of the immutable app snapshot.
 *   const mirror = useSnapshot((s) => s.derived.mirror)
 *   const { spent, target } = useSnapshot((s) => ({ spent: …, target: … }), shallowEqual)
 */
export function useSnapshot<T>(selector: (s: AppSnapshot) => T, isEqual: Equality<T> = Object.is): T {
  const app = useApp()
  const cache = useRef<SelectionCache<T> | null>(null)
  const get = useMemo(() => createSelection(app.getSnapshot, selector, isEqual, cache), [app, selector, isEqual])
  return useSyncExternalStore(app.subscribe, get, get)
}
