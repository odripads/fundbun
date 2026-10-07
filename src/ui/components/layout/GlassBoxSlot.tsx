import { Eye, ShieldCheck } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Logo } from '../brand'
import { cx } from '../ds/cx'
import styles from './GlassBoxSlot.module.css'

export interface GlassBoxSlotProps {
  /** the live agent trace / policy decisions / audit chain (built by the glass-box feature) */
  children?: ReactNode
  title?: string
  subtitle?: ReactNode
  /** pulses the live indicator (e.g. while the agent is working) */
  busy?: boolean
  /** render in the page flow instead of as the desktop side panel (e.g. inside a mobile sheet) */
  inline?: boolean
  className?: string
}

/**
 * The desktop "glass box": a window into what the agent is doing, shown beside the phone for judges.
 * This is only the frame; its content is passed in by the shell.
 */
export function GlassBoxSlot({ children, title = 'Glass box', subtitle = 'What the agent sees, decides and records, live.', busy = false, inline = false, className }: GlassBoxSlotProps) {
  const titleId = useId()
  return (
    <aside className={cx(styles.panel, inline && styles.inline, className)} aria-labelledby={titleId}>
      {!inline ? (
        <div className={styles.brandRow}>
          <Logo size={26} withWordmark />
          <span className={styles.sandbox}>Sandbox bank · simulated money</span>
        </div>
      ) : null}
      <div className={styles.card}>
        <header className={styles.header}>
          <span className={styles.lens} aria-hidden="true"><Eye /></span>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          <span className={cx(styles.live, busy && styles.busy)}>
            <span className={styles.liveDot} aria-hidden="true" />
            {busy ? 'Working' : 'Live'}
          </span>
        </header>
        <div className={styles.body}>{children}</div>
        <footer className={styles.footer}>
          <ShieldCheck aria-hidden="true" />
          <span>The model proposes; the policy engine decides. Every step is hash-chained on this device.</span>
        </footer>
      </div>
    </aside>
  )
}
