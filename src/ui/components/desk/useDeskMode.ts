/**
 * Desk mode: on a wide window FundBun is a desktop app (sidebar, dashboard, Bun on the side) instead of the phone
 * layout inside a device frame. The user can still pick the phone view; that choice is a per-viewer convenience
 * kept in localStorage.
 */
import { useSyncExternalStore } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

/** The window must be at least this wide for the desk layout (sidebar + work area + drawer/panel). */
export const DESK_MIN_WIDTH = 900
export const DESK_QUERY = `(min-width: ${DESK_MIN_WIDTH}px)`

/** From this width the right panel sits beside the work area; narrower desk windows open it as a drawer. */
export const PANEL_DOCK_WIDTH = 1280
export const PANEL_DOCK_QUERY = `(min-width: ${PANEL_DOCK_WIDTH}px)`

export type ViewPreference = 'desk' | 'phone'

export const VIEW_STORAGE_KEY = 'fundbun.view'
const VIEW_EVENT = 'fundbun:view'

export function isViewPreference(v: unknown): v is ViewPreference {
  return v === 'desk' || v === 'phone'
}

// in-session copy, so the choice still works where storage throws (private windows, blocked site data)
let sessionPref: ViewPreference | null = null

/** The saved view; 'desk' until the user picks the phone view. */
export function readViewPreference(): ViewPreference {
  try {
    const v = globalThis.localStorage?.getItem(VIEW_STORAGE_KEY) ?? null
    if (isViewPreference(v)) return v
  } catch {
    // storage unavailable: fall through to this session's choice
  }
  return sessionPref ?? 'desk'
}

export function setViewPreference(pref: ViewPreference): void {
  sessionPref = pref
  try {
    globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, pref)
  } catch {
    // storage unavailable: the choice lasts for this session
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VIEW_EVENT))
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(VIEW_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** The saved view, live: re-renders when it changes here or in another tab. */
export function useViewPreference(): ViewPreference {
  return useSyncExternalStore(subscribe, readViewPreference, () => 'phone' as const)
}

/** Is the window wide enough for the desk layout? False where matchMedia is missing (jsdom, SSR). */
export function useDeskViewport(): boolean {
  return useMediaQuery(DESK_QUERY, false)
}

/** Is the window wide enough to dock the side panel beside the content (rather than as a drawer)? */
export function usePanelDocked(): boolean {
  return useMediaQuery(PANEL_DOCK_QUERY, false)
}

/**
 * True when the app should use the desk layout: a window at least DESK_MIN_WIDTH wide and no saved preference for
 * the phone view. Always false where matchMedia is missing, so tests and server renders keep the phone layout.
 */
export function useDeskMode(): boolean {
  const wide = useDeskViewport()
  const pref = useViewPreference()
  return wide && pref !== 'phone'
}

/** The same answer outside React (before the first render, to pick which chunks to load). */
export function isDeskModeNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(DESK_QUERY).matches && readViewPreference() !== 'phone'
  } catch {
    return false
  }
}

// ───────────────────────────── the side panel's own conveniences ─────────────────────────────

export type DeskPanelTab = 'chat' | 'glass'

export const PANEL_OPEN_KEY = 'fundbun.desk.panel'
export const PANEL_TAB_KEY = 'fundbun.desk.panelTab'

/** Whether the side panel was left open ('open' | 'closed'); null when the user has not chosen yet. */
export function readPanelOpen(): boolean | null {
  try {
    const v = globalThis.localStorage?.getItem(PANEL_OPEN_KEY) ?? null
    return v === 'open' ? true : v === 'closed' ? false : null
  } catch {
    return null
  }
}

export function writePanelOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(PANEL_OPEN_KEY, open ? 'open' : 'closed')
  } catch {
    // per-viewer convenience only
  }
}

export function readPanelTab(): DeskPanelTab {
  try {
    return globalThis.localStorage?.getItem(PANEL_TAB_KEY) === 'glass' ? 'glass' : 'chat'
  } catch {
    return 'chat'
  }
}

export function writePanelTab(tab: DeskPanelTab): void {
  try {
    globalThis.localStorage?.setItem(PANEL_TAB_KEY, tab)
  } catch {
    // per-viewer convenience only
  }
}
