import { useCallback, useSyncExternalStore } from 'react'

export const DASH_BLOCK_IDS = ['hero', 'month', 'checkin', 'trip', 'daily', 'cats', 'six', 'bills', 'goals', 'check', 'txns'] as const
export type DashBlockId = (typeof DASH_BLOCK_IDS)[number]

export const HOME_BLOCK_IDS = ['checkin', 'trip', 'month', 'check', 'bills', 'insights', 'couldve'] as const
export type HomeBlockId = (typeof HOME_BLOCK_IDS)[number]

export const DEFAULT_DASH_ORDER: readonly DashBlockId[] = DASH_BLOCK_IDS
export const DEFAULT_HOME_ORDER: readonly HomeBlockId[] = HOME_BLOCK_IDS

export const DASH_BLOCK_LABEL: Record<DashBlockId, string> = {
  hero: 'Dream Mirror',
  month: 'Month summary',
  checkin: 'Daily check-in',
  trip: 'Alerts',
  daily: 'Daily spending',
  cats: 'By category',
  six: 'Last 6 months',
  bills: 'Bills',
  goals: 'Goals',
  check: 'Should I buy it?',
  txns: 'Transactions',
}

export const HOME_BLOCK_LABEL: Record<HomeBlockId, string> = {
  checkin: 'Daily check-in',
  trip: 'Alerts',
  month: 'This month',
  check: 'Should I buy it?',
  bills: 'Upcoming bills',
  insights: 'Bun noticed',
  couldve: 'Last 6 months',
}

export interface DashLayout {
  order: DashBlockId[]
  hidden: DashBlockId[]
  wide: DashBlockId[]
}

export interface HomeLayout {
  order: HomeBlockId[]
  hidden: HomeBlockId[]
}

export const DASH_LAYOUT_KEY = 'fundbun.layout.dash.v1'
export const HOME_LAYOUT_KEY = 'fundbun.layout.home.v1'

const DASH_EVENT = 'fundbun:layout-dash'
const HOME_EVENT = 'fundbun:layout-home'

export function defaultDashLayout(): DashLayout {
  return { order: [...DEFAULT_DASH_ORDER], hidden: [], wide: [] }
}

export function defaultHomeLayout(): HomeLayout {
  return { order: [...DEFAULT_HOME_ORDER], hidden: [] }
}

function sanitizeOrder<T extends string>(raw: unknown, defaults: readonly T[]): T[] {
  const valid = new Set<string>(defaults)
  const seen = new Set<T>()
  const out: T[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && valid.has(item) && !seen.has(item as T)) {
        seen.add(item as T)
        out.push(item as T)
      }
    }
  }
  for (const d of defaults) {
    if (!seen.has(d)) out.push(d)
  }
  return out
}

function sanitizeIdList<T extends string>(raw: unknown, defaults: readonly T[], exclude: ReadonlySet<T> = new Set()): T[] {
  const valid = new Set<string>(defaults)
  const seen = new Set<T>()
  const out: T[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && valid.has(item) && !exclude.has(item as T) && !seen.has(item as T)) {
        seen.add(item as T)
        out.push(item as T)
      }
    }
  }
  return out
}

const WIDE_EXCLUDED = new Set<DashBlockId>(['hero', 'txns'])

export function sanitizeDashLayout(raw: unknown): DashLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultDashLayout()
  const r = raw as Record<string, unknown>
  return {
    order: sanitizeOrder(r.order, DEFAULT_DASH_ORDER),
    hidden: sanitizeIdList(r.hidden, DEFAULT_DASH_ORDER),
    wide: sanitizeIdList(r.wide, DEFAULT_DASH_ORDER, WIDE_EXCLUDED),
  }
}

export function sanitizeHomeLayout(raw: unknown): HomeLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultHomeLayout()
  const r = raw as Record<string, unknown>
  return {
    order: sanitizeOrder(r.order, DEFAULT_HOME_ORDER),
    hidden: sanitizeIdList(r.hidden, DEFAULT_HOME_ORDER),
  }
}

/** Swap an item with its adjacent sibling among the currently visible order, preserving all other positions. */
export function moveBlock<T extends string>(order: readonly T[], id: T, dir: -1 | 1, hidden: readonly T[] = []): T[] {
  const hiddenSet = new Set(hidden)
  const visible = order.filter((x) => !hiddenSet.has(x))
  const vi = visible.indexOf(id)
  if (vi === -1) return [...order]
  const vj = vi + dir
  if (vj < 0 || vj >= visible.length) return [...order]
  const partner = visible[vj]
  const ai = order.indexOf(id)
  const bi = order.indexOf(partner)
  if (ai === -1 || bi === -1) return [...order]
  const next = [...order]
  next[ai] = partner
  next[bi] = id
  return next
}

/** Move `fromId` to the position of `toId` inside `order`. */
export function reorderBlock<T extends string>(order: readonly T[], fromId: T, toId: T): T[] {
  if (fromId === toId) return [...order]
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from === -1 || to === -1) return [...order]
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}

export function toggleHidden<T extends string>(hidden: readonly T[], id: T): T[] {
  return hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
}

export function toggleWide(wide: readonly DashBlockId[], id: DashBlockId): DashBlockId[] {
  if (WIDE_EXCLUDED.has(id)) return [...wide]
  return wide.includes(id) ? wide.filter((x) => x !== id) : [...wide, id]
}

export function canToggleWide(id: DashBlockId): boolean {
  return !WIDE_EXCLUDED.has(id)
}

export function isDashDefault(l: DashLayout): boolean {
  return (
    l.hidden.length === 0 &&
    l.wide.length === 0 &&
    l.order.length === DEFAULT_DASH_ORDER.length &&
    l.order.every((id, i) => id === DEFAULT_DASH_ORDER[i])
  )
}

export function isHomeDefault(l: HomeLayout): boolean {
  return (
    l.hidden.length === 0 &&
    l.order.length === DEFAULT_HOME_ORDER.length &&
    l.order.every((id, i) => id === DEFAULT_HOME_ORDER[i])
  )
}

let sessionDash: DashLayout = defaultDashLayout()
let sessionDashRaw: string | null = null
let sessionDashCached: DashLayout = sessionDash

let sessionHome: HomeLayout = defaultHomeLayout()
let sessionHomeRaw: string | null = null
let sessionHomeCached: HomeLayout = sessionHome

function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string, event: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // storage unavailable: keep session copy
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(event))
}

function removeRaw(key: string, event: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // storage unavailable
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(event))
}

export function readDashLayout(): DashLayout {
  const raw = readRaw(DASH_LAYOUT_KEY)
  if (raw === null) return sessionDash
  if (raw === sessionDashRaw) return sessionDashCached
  try {
    sessionDashCached = sanitizeDashLayout(JSON.parse(raw))
  } catch {
    sessionDashCached = defaultDashLayout()
  }
  sessionDashRaw = raw
  return sessionDashCached
}

export function writeDashLayout(next: DashLayout): void {
  const clean = sanitizeDashLayout(next)
  sessionDash = clean
  const raw = JSON.stringify(clean)
  sessionDashRaw = raw
  sessionDashCached = clean
  writeRaw(DASH_LAYOUT_KEY, raw, DASH_EVENT)
}

export function resetDashLayout(): void {
  const clean = defaultDashLayout()
  sessionDash = clean
  sessionDashRaw = null
  sessionDashCached = clean
  removeRaw(DASH_LAYOUT_KEY, DASH_EVENT)
}

export function readHomeLayout(): HomeLayout {
  const raw = readRaw(HOME_LAYOUT_KEY)
  if (raw === null) return sessionHome
  if (raw === sessionHomeRaw) return sessionHomeCached
  try {
    sessionHomeCached = sanitizeHomeLayout(JSON.parse(raw))
  } catch {
    sessionHomeCached = defaultHomeLayout()
  }
  sessionHomeRaw = raw
  return sessionHomeCached
}

export function writeHomeLayout(next: HomeLayout): void {
  const clean = sanitizeHomeLayout(next)
  sessionHome = clean
  const raw = JSON.stringify(clean)
  sessionHomeRaw = raw
  sessionHomeCached = clean
  writeRaw(HOME_LAYOUT_KEY, raw, HOME_EVENT)
}

export function resetHomeLayout(): void {
  const clean = defaultHomeLayout()
  sessionHome = clean
  sessionHomeRaw = null
  sessionHomeCached = clean
  removeRaw(HOME_LAYOUT_KEY, HOME_EVENT)
}

const SERVER_DASH = defaultDashLayout()
const SERVER_HOME = defaultHomeLayout()

function subscribe(eventName: string, key: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === key) onChange()
    }
    window.addEventListener(eventName, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(eventName, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }
}

const subscribeDash = subscribe(DASH_EVENT, DASH_LAYOUT_KEY)
const subscribeHome = subscribe(HOME_EVENT, HOME_LAYOUT_KEY)

export function useDashLayout() {
  const layout = useSyncExternalStore(subscribeDash, readDashLayout, () => SERVER_DASH)
  const move = useCallback((id: DashBlockId, dir: -1 | 1, hiddenScope: readonly DashBlockId[] = layout.hidden) => {
    writeDashLayout({ ...layout, order: moveBlock(layout.order, id, dir, hiddenScope) })
  }, [layout])
  const reorder = useCallback((fromId: DashBlockId, toId: DashBlockId) => {
    writeDashLayout({ ...layout, order: reorderBlock(layout.order, fromId, toId) })
  }, [layout])
  const toggleHide = useCallback((id: DashBlockId) => {
    writeDashLayout({ ...layout, hidden: toggleHidden(layout.hidden, id) })
  }, [layout])
  const flipWide = useCallback((id: DashBlockId) => {
    writeDashLayout({ ...layout, wide: toggleWide(layout.wide, id) })
  }, [layout])
  const reset = useCallback(() => resetDashLayout(), [])
  return { layout, move, reorder, toggleHide, toggleWide: flipWide, reset, isDefault: isDashDefault(layout) }
}

export function useHomeLayout() {
  const layout = useSyncExternalStore(subscribeHome, readHomeLayout, () => SERVER_HOME)
  const move = useCallback((id: HomeBlockId, dir: -1 | 1, hiddenScope: readonly HomeBlockId[] = layout.hidden) => {
    writeHomeLayout({ ...layout, order: moveBlock(layout.order, id, dir, hiddenScope) })
  }, [layout])
  const reorder = useCallback((fromId: HomeBlockId, toId: HomeBlockId) => {
    writeHomeLayout({ ...layout, order: reorderBlock(layout.order, fromId, toId) })
  }, [layout])
  const toggleHide = useCallback((id: HomeBlockId) => {
    writeHomeLayout({ ...layout, hidden: toggleHidden(layout.hidden, id) })
  }, [layout])
  const reset = useCallback(() => resetHomeLayout(), [])
  return { layout, move, reorder, toggleHide, reset, isDefault: isHomeDefault(layout) }
}
