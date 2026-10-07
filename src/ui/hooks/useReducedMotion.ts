import { useEffect, useSyncExternalStore } from 'react'
import { useMediaQuery } from './useMediaQuery'

/** The in-app "Reduce motion" setting is mirrored onto <html data-motion="reduce"> so CSS can honour it too. */
export const MOTION_ATTR = 'data-motion'

function subscribeAttr(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {}
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: [MOTION_ATTR] })
  return () => obs.disconnect()
}

function attrReduced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.getAttribute(MOTION_ATTR) === 'reduce'
}

/** True when the OS asks for reduced motion or the user switched it on in FundBun settings. */
export function useReducedMotion(): boolean {
  const media = useMediaQuery('(prefers-reduced-motion: reduce)')
  const setting = useSyncExternalStore(subscribeAttr, attrReduced, () => false)
  return media || setting
}

/** Apply the in-app setting to the document (call once, from the shell). */
export function useMotionPreference(reduce: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    if (reduce) root.setAttribute(MOTION_ATTR, 'reduce')
    else root.removeAttribute(MOTION_ATTR)
  }, [reduce])
}
