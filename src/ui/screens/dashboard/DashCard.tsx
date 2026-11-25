import { createContext, useContext, useId, type CSSProperties, type ReactNode } from 'react'
import { cx } from '../../components/ds'
import styles from './Dashboard.module.css'

export interface DashTileMeta {
  framed: boolean
  wide: boolean
}

/**
 * Provides layout state to a dashboard block. When `framed` is true (Customize mode), the outer frame
 * carries `data-card` and `data-wide` so `[data-card]` remains unique per block.
 */
export const DashTileContext = createContext<DashTileMeta>({ framed: false, wide: false })

export interface DashCardProps {
  /** card id (`data-card`) */
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
  const { framed, wide } = useContext(DashTileContext)
  return (
    <section
      className={cx(styles.card, className)}
      aria-labelledby={headingId}
      data-card={framed ? undefined : area}
      data-wide={!framed && wide ? 'true' : undefined}
    >
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
export function DashCell({ area, style, className, children }: { area: string; style?: CSSProperties; className?: string; children: ReactNode }) {
  const { framed, wide } = useContext(DashTileContext)
  return (
    <div
      className={cx(styles.cell, className)}
      style={style}
      data-card={framed ? undefined : area}
      data-wide={!framed && wide ? 'true' : undefined}
    >
      {children}
    </div>
  )
}
