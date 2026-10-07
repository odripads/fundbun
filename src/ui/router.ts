/**
 * Hash router: `#/<route>/<param>…?<query>`. Hash routing keeps the static GitHub-Pages build working
 * without server rewrites. Pure parsing/formatting functions + a tiny useSyncExternalStore hook.
 */
import { useMemo, useSyncExternalStore } from 'react'

export const ROUTES = ['onboarding', 'home', 'insights', 'bills', 'chat', 'goals', 'settings', 'activity', 'gallery'] as const
export type RouteName = (typeof ROUTES)[number]

/** The five bottom-bar slots, left to right. `chat` is the raised centre "Ask Bun" button. */
export const TABS = ['home', 'insights', 'chat', 'bills', 'goals'] as const
export type TabId = (typeof TABS)[number]

/**
 * `app`  — phone layout with optional top/tab bars (desktop: device frame + glass box)
 * `bare` — phone layout without bars (onboarding, lock screen)
 * `wide` — full-width page without the device frame (design-system gallery)
 */
export type Chrome = 'app' | 'bare' | 'wide'

export interface RouteMeta {
  title: string
  chrome: Chrome
  /** which tab is highlighted; null hides nothing but highlights no tab */
  tab: TabId | null
  /** the shell renders the TopBar; false → the screen renders its own <TopBar> */
  topBar: boolean
  tabBar: boolean
  /** "up" destination for the TopBar back button; absent → no back button */
  parent?: RouteName
  /** redirect to onboarding when the user has not onboarded yet */
  requiresOnboarding: boolean
}

export const ROUTE_META: Record<RouteName, RouteMeta> = {
  onboarding: { title: 'Welcome', chrome: 'bare', tab: null, topBar: false, tabBar: false, requiresOnboarding: false },
  home: { title: 'Home', chrome: 'app', tab: 'home', topBar: true, tabBar: true, requiresOnboarding: true },
  insights: { title: 'Insights', chrome: 'app', tab: 'insights', topBar: true, tabBar: true, requiresOnboarding: true },
  bills: { title: 'Bills', chrome: 'app', tab: 'bills', topBar: true, tabBar: true, requiresOnboarding: true },
  chat: { title: 'Ask Bun', chrome: 'app', tab: 'chat', topBar: false, tabBar: false, parent: 'home', requiresOnboarding: true },
  goals: { title: 'Goals', chrome: 'app', tab: 'goals', topBar: true, tabBar: true, requiresOnboarding: true },
  settings: { title: 'Settings', chrome: 'app', tab: null, topBar: true, tabBar: false, parent: 'home', requiresOnboarding: true },
  activity: { title: 'Activity', chrome: 'app', tab: null, topBar: true, tabBar: false, parent: 'home', requiresOnboarding: true },
  gallery: { title: 'Design system', chrome: 'wide', tab: null, topBar: false, tabBar: false, requiresOnboarding: false },
}

export interface Location {
  /** null when the hash is empty or names an unknown route */
  route: RouteName | null
  /** decoded path segments after the route, e.g. `#/goals/dream_birkin` → ['dream_birkin'] */
  params: string[]
  query: Record<string, string>
}

export function isRouteName(value: string): value is RouteName {
  return (ROUTES as readonly string[]).includes(value)
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Parse `location.hash` (with or without the leading `#`). Never throws. */
export function parseHash(hash: string): Location {
  const body = hash.replace(/^#/, '')
  const qIndex = body.indexOf('?')
  const path = qIndex === -1 ? body : body.slice(0, qIndex)
  const search = qIndex === -1 ? '' : body.slice(qIndex + 1)
  const segments = path.split('/').filter((s) => s !== '' && s !== '.' && s !== '..').map(safeDecode)
  const head = (segments[0] ?? '').toLowerCase()
  const query: Record<string, string> = Object.fromEntries(new URLSearchParams(search))
  return isRouteName(head) ? { route: head, params: segments.slice(1), query } : { route: null, params: [], query }
}

/** Build a hash for a route: buildHash('goals', ['dream_birkin'], { tab: 'pots' }) → '#/goals/dream_birkin?tab=pots' */
export function buildHash(route: RouteName, params: string[] = [], query: Record<string, string> = {}): string {
  const path = [route, ...params.map(encodeURIComponent)].join('/')
  const search = new URLSearchParams(query).toString()
  return `#/${path}${search ? `?${search}` : ''}`
}

export interface Resolution {
  route: RouteName
  /** the hash the address bar should show when it differs from the current one */
  redirectTo: string | null
}

/**
 * Decide which screen to render. Synchronous so a guarded route never flashes before its redirect.
 * Onboarded users may still open #/onboarding explicitly (the onboarding screen owns its own finish step).
 */
export function resolveRoute(loc: Location, opts: { onboarded: boolean }): Resolution {
  const fallback: RouteName = opts.onboarded ? 'home' : 'onboarding'
  if (loc.route === null) return { route: fallback, redirectTo: buildHash(fallback) }
  if (!opts.onboarded && ROUTE_META[loc.route].requiresOnboarding) {
    return { route: 'onboarding', redirectTo: buildHash('onboarding') }
  }
  return { route: loc.route, redirectTo: null }
}

// ───────────────────────────── browser bindings ─────────────────────────────

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash
}

export function subscribeHash(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export interface NavigateOptions {
  params?: string[]
  query?: Record<string, string>
  /** replace the current history entry instead of pushing a new one */
  replace?: boolean
}

export function navigate(route: RouteName, opts: NavigateOptions = {}): void {
  setHash(buildHash(route, opts.params, opts.query), opts.replace)
}

/** Set the hash; `replace` swaps the history entry and still notifies subscribers. */
export function setHash(hash: string, replace = false): void {
  if (typeof window === 'undefined' || window.location.hash === hash) return
  if (!replace) {
    window.location.hash = hash
    return
  }
  window.history.replaceState(window.history.state, '', hash)
  // replaceState does not fire hashchange
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function href(route: RouteName, params?: string[], query?: Record<string, string>): string {
  return buildHash(route, params, query)
}

/** The current location; re-renders on hash changes. */
export function useRoute(): Location {
  const hash = useSyncExternalStore(subscribeHash, currentHash, () => '')
  return useMemo(() => parseHash(hash), [hash])
}
