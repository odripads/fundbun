import { useId, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../components/ds'
import styles from './Dashboard.module.css'

export interface DashCardProps {
  /** grid area name (see .grid in Dashboard.module.css) */
  area: string
  title: ReactNode
  /** a quiet line next to the title: the month, what is counted */
  sub?: ReactNode
  /** right side of the header: a "See all" link or a badge */
  action?: ReactNode
  className?: string
  children: ReactNode
}

/** One dashboard card with its own heading: a labelled region on the grid. */
export function DashCard({ area, title, sub, action, className, children }: DashCardProps) {
  const headingId = useId()
  return (
    <section className={cx(styles.card, className)} style={{ gridArea: area } as CSSProperties} aria-labelledby={headingId} data-card={area}>
      <header className={styles.cardHead}>
        <div className={styles.cardTitles}>
          <h2 id={headingId} className={styles.cardTitle}>{title}</h2>
          {sub ? <p className={styles.cardSub}>{sub}</p> : null}
        </div>
        {action ? <div className={styles.cardAction}>{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

/** A grid cell around a component that brings its own card (the Home month, check-in and "Should I buy it?" cards). */
export function DashCell({ area, className, children }: { area: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx(styles.cell, className)} style={{ gridArea: area } as CSSProperties} data-card={area}>
      {children}
    </div>
  )
}
