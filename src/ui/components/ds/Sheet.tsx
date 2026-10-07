import { X } from 'lucide-react'
import { useId, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { cx } from './cx'
import { IconButton } from './IconButton'
import { ModalLayer } from './Modal'
import styles from './Sheet.module.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** sticky action area, e.g. the action card's Approve / Not now buttons */
  footer?: ReactNode
  /** false while something irreversible is in flight: no Esc, no backdrop, no drag */
  dismissible?: boolean
  /** 'full' fills the frame height (long forms) */
  size?: 'auto' | 'full'
  initialFocus?: RefObject<HTMLElement | null>
  /** decorative or contextual element above the title (e.g. a DreamImage) */
  media?: ReactNode
}

/** Distance (px) or flick speed (px/ms) past which a downward drag dismisses the sheet. */
export const DRAG_DISMISS_PX = 110
export const DRAG_DISMISS_VELOCITY = 0.6

export function shouldDismissDrag(dy: number, ms: number): boolean {
  if (dy <= 0) return false
  return dy > DRAG_DISMISS_PX || (ms > 0 && dy / ms > DRAG_DISMISS_VELOCITY && dy > 24)
}

/** Upward drags resist (rubber band); downward drags follow the finger. */
export function dragOffset(dy: number): number {
  return dy >= 0 ? dy : -Math.sqrt(-dy) * 2
}

/** Bottom sheet: focus-trapped, Escape and backdrop dismiss, drag the handle down to close. */
export function Sheet({ open, onClose, title, description, children, footer, dismissible = true, size = 'auto', initialFocus, media }: SheetProps) {
  const titleId = useId()
  const descId = useId()
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ y: number; t: number } | null>(null)

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!dismissible || (e.target as HTMLElement).closest('button, a, input, textarea, select')) return
    start.current = { y: e.clientY, t: e.timeStamp }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(0)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!start.current) return
    setDrag(e.clientY - start.current.y)
  }
  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    const s = start.current
    if (!s) return
    start.current = null
    setDrag(null)
    if (shouldDismissDrag(e.clientY - s.y, e.timeStamp - s.t)) onClose()
  }

  const dragging = drag !== null
  return (
    <ModalLayer
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      kind="sheet"
      role="dialog"
      labelledBy={titleId}
      describedBy={description ? descId : undefined}
      initialFocus={initialFocus}
      panelClassName={cx(styles.sheet, size === 'full' && styles.full, dragging && styles.dragging)}
      panelStyle={dragging ? { transform: `translateY(${dragOffset(drag)}px)` } : undefined}
    >
      <div className={styles.grab} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.header}>
          {media ? <div className={styles.media}>{media}</div> : null}
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {description ? <p id={descId} className={styles.description}>{description}</p> : null}
          </div>
          {dismissible ? <IconButton label="Close" icon={<X />} size="sm" variant="secondary" onClick={onClose} className={styles.close} /> : null}
        </div>
      </div>
      {children != null ? <div className={styles.body}>{children}</div> : null}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </ModalLayer>
  )
}
