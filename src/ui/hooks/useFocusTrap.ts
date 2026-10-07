import { useEffect, type RefObject } from 'react'
import { nextTrapTarget, tabbables } from './focus'

export interface FocusTrapOptions {
  /** element to focus on activation; default: first tabbable, else the container */
  initialFocus?: RefObject<HTMLElement | null>
  /** return focus to the previously focused element on deactivation (default true) */
  restoreFocus?: boolean
}

/** Keep keyboard focus inside `ref` while `active`; restores focus to the opener afterwards. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, opts: FocusTrapOptions = {}): void {
  const { initialFocus, restoreFocus = true } = opts
  useEffect(() => {
    const container = ref.current
    if (!active || !container) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = initialFocus?.current ?? tabbables(container)[0] ?? container
    target.focus({ preventScroll: true })

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return
      const next = nextTrapTarget(tabbables(container), document.activeElement, e.shiftKey, container)
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [ref, active, initialFocus, restoreFocus])
}
