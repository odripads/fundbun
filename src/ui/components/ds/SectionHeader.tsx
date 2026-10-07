import type { ReactNode } from 'react'
import { cx } from './cx'
import styles from './SectionHeader.module.css'

export interface SectionHeaderProps {
  title: ReactNode
  /** small uppercase label above the title */
  eyebrow?: ReactNode
  /** e.g. a ghost "See all" button */
  action?: ReactNode
  level?: 2 | 3
  id?: string
  className?: string
}

export function SectionHeader({ title, eyebrow, action, level = 2, id, className }: SectionHeaderProps) {
  const H = `h${level}` as 'h2' | 'h3'
  return (
    <div className={cx(styles.root, className)}>
      <div className={styles.text}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <H id={id} className={cx(styles.title, level === 3 && styles.small)}>{title}</H>
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
