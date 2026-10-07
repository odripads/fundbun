import { useCallback, useSyncExternalStore } from 'react'

function mql(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
}

/** Live media-query match; `fallback` is used where matchMedia is unavailable (SSR, jsdom). */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = mql(query)
    if (!list) return () => {}
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  const get = () => mql(query)?.matches ?? fallback
  return useSyncExternalStore(subscribe, get, () => fallback)
}

export const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY)
}
