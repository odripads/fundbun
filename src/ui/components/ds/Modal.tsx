import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useScrollLock } from '../../hooks/useScrollLock'
import { cx } from './cx'
import { isTopModal, pushModal } from './modalStack'
import { Portal } from './overlay'
import { usePresence } from './usePresence'
import styles from './Modal.module.css'

export interface ModalLayerProps {
  open: boolean
  onClose: () => void
  /** false: Escape and backdrop clicks do nothing (e.g. while a payment is executing) */
  dismissible: boolean
  kind: 'sheet' | 'dialog'
  role: 'dialog' | 'alertdialog'
  labelledBy: string
  describedBy?: string
  initialFocus?: RefObject<HTMLElement | null>
  panelClassName?: string
  panelStyle?: CSSProperties
  panelRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}

const EXIT_MS = 260

/** Shared plumbing for Sheet and Dialog: portal, presence, backdrop, focus trap, Escape, scroll lock. */
export function ModalLayer({ open, onClose, dismissible, kind, role, labelledBy, describedBy, initialFocus, panelClassName, panelStyle, panelRef, children }: ModalLayerProps) {
  const presence = usePresence(open, EXIT_MS)
  const ownRef = useRef<HTMLDivElement | null>(null)
  const ref = panelRef ?? ownRef
  const id = useRef(Symbol('modal')).current

  useEffect(() => (open ? pushModal(id) : undefined), [open, id])
  useScrollLock(open)
  useFocusTrap(ref, open, { initialFocus })

  useEffect(() => {
    if (!open || !dismissible) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isTopModal(id)) {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, dismissible, id, onClose])

  if (presence === 'closed') return null
  return (
    <Portal>
      <div className={cx(styles.layer, styles[kind])} data-state={presence}>
        <div
          className={styles.backdrop}
          aria-hidden="true"
          onClick={() => {
            if (dismissible && isTopModal(id)) onClose()
          }}
        />
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          className={cx(styles.panel, panelClassName)}
          style={panelStyle}
        >
          {children}
        </div>
      </div>
    </Portal>
  )
}
