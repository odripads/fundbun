import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Where sheets, dialogs and toasts render. AppFrame provides an element inside the phone frame so overlays
 * stay inside the device on desktop; without a provider they fall back to document.body.
 */
export const OverlayRootContext = createContext<HTMLElement | null>(null)

export function useOverlayRoot(): HTMLElement | null {
  const root = useContext(OverlayRootContext)
  if (root) return root
  return typeof document === 'undefined' ? null : document.body
}

export function Portal({ children }: { children: ReactNode }) {
  const root = useOverlayRoot()
  return root ? createPortal(children, root) : null
}
