import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'fundbun:theme'
const THEME_EVENT = 'fundbun:theme'

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark'
}

// in-session copy so the choice still works where storage throws (private windows, blocked site data)
let sessionPref: ThemePreference = 'system'

/** Per-viewer convenience only: stored value, else this session's choice, else 'system'. */
export function readThemePreference(): ThemePreference {
  try {
    const v = globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null
    if (v === null) return sessionPref
    return isThemePreference(v) ? v : 'system'
  } catch {
    return sessionPref
  }
}

/** tokens.css keys dark/light overrides off <html data-theme>; 'system' removes the attribute. */
export function applyThemePreference(pref: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
}

export function writeThemePreference(pref: ThemePreference): void {
  sessionPref = pref
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // storage unavailable — the preference just won't survive a reload
  }
  applyThemePreference(pref)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT))
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(THEME_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(THEME_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** [preference, setPreference] — shared by every caller and kept in sync across tabs. */
export function useThemePreference(): [ThemePreference, (pref: ThemePreference) => void] {
  const pref = useSyncExternalStore(subscribe, readThemePreference, () => 'system' as const)
  useEffect(() => applyThemePreference(pref), [pref])
  const set = useCallback((p: ThemePreference) => writeThemePreference(p), [])
  return [pref, set]
}
