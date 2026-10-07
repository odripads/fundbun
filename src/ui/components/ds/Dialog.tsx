import { useId, type ReactNode, type RefObject } from 'react'
import { cx } from './cx'
import { ModalLayer } from './Modal'
import styles from './Dialog.module.css'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** buttons; stack vertically on narrow screens. Use verb labels ("Delete all data"), not Yes/No. */
  actions?: ReactNode
  /** decorative top element, e.g. a BunMascot */
  media?: ReactNode
  /** destructive / interrupting confirmation: announces as alertdialog */
  alert?: boolean
  dismissible?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  tone?: 'default' | 'danger'
}

export function Dialog({ open, onClose, title, description, children, actions, media, alert = false, dismissible = true, initialFocus, tone = 'default' }: DialogProps) {
  const titleId = useId()
  const descId = useId()
  return (
    <ModalLayer
      open={open}
      onClose={onClose}
      dismissible={dismissible}
      kind="dialog"
      role={alert ? 'alertdialog' : 'dialog'}
      labelledBy={titleId}
      describedBy={description ? descId : undefined}
      initialFocus={initialFocus}
      panelClassName={cx(styles.dialog, tone === 'danger' && styles.danger)}
    >
      {media ? <div className={styles.media}>{media}</div> : null}
      <h2 id={titleId} className={styles.title}>{title}</h2>
      {description ? <p id={descId} className={styles.description}>{description}</p> : null}
      {children != null ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </ModalLayer>
  )
}
