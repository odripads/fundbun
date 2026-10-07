import type { ReactNode } from 'react'
import type { BunMood } from '../../../core/types'
import { BunMascot } from '../brand'
import { cx } from './cx'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  title: ReactNode
  body?: ReactNode
  /** primary/secondary buttons */
  action?: ReactNode
  mood?: BunMood
  /** replaces the mascot (e.g. a DreamImage or an icon) */
  illustration?: ReactNode
  compact?: boolean
  className?: string
}

export function EmptyState({ title, body, action, mood = 'calm', illustration, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.root, compact && styles.compact, className)}>
      <div className={styles.art} aria-hidden="true">
        {illustration ?? <BunMascot mood={mood} size={compact ? 64 : 96} animated />}
      </div>
      <h3 className={styles.title}>{title}</h3>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
