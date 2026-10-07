import { useEffect } from 'react'

/** <html data-scroll-locked> — global.css freezes the page and the device screen while it is set. */
export const SCROLL_LOCK_ATTR = 'data-scroll-locked'

let locks = 0

export function acquireScrollLock(): () => void {
  if (typeof document === 'undefined') return () => {}
  locks += 1
  document.documentElement.setAttribute(SCROLL_LOCK_ATTR, '')
  let released = false
  return () => {
    if (released) return
    released = true
    locks = Math.max(0, locks - 1)
    if (locks === 0) document.documentElement.removeAttribute(SCROLL_LOCK_ATTR)
  }
}

/** Ref-counted so stacked overlays (a dialog over a sheet) unlock only when the last one closes. */
export function useScrollLock(active: boolean): void {
  useEffect(() => (active ? acquireScrollLock() : undefined), [active])
}
