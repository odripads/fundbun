import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { cx } from '../ds/cx'
import styles from './Disclosure.module.css'

export interface DisclosureProps {
  /** the toggle's label */
  summary: ReactNode
  /** small text after the label, e.g. "2 rules" */
  meta?: ReactNode
  icon?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  /** 'inline' = a text-link style toggle; 'bar' = a full-width row */
  variant?: 'inline' | 'bar'
}

/** "Why?" / "How Bun got this" — a button with aria-expanded controlling a region (content mounts when open). */
export function Disclosure({ summary, meta, icon, children, defaultOpen = false, className, variant = 'inline' }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={cx(styles.root, styles[variant], open && styles.open, className)}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
        <span className={styles.summary}>
          {summary}
          {meta ? <span className={styles.meta}> · {meta}</span> : null}
        </span>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </button>
      <div id={id} className={styles.panel} hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  )
}
