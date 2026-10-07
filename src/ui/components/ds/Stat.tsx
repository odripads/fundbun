import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { Sparkline } from './charts/Sparkline'
import styles from './Stat.module.css'

export interface StatDelta {
  /** e.g. "+12% vs Sep" */
  label: ReactNode
  direction: 'up' | 'down' | 'flat'
  /** whether this direction is good news (spending down = good); drives the colour */
  good?: boolean
}

export interface StatProps {
  label: ReactNode
  value: ReactNode
  delta?: StatDelta
  hint?: ReactNode
  /** small trend line under the value */
  trend?: number[]
  trendLabel?: string
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  className?: string
}

const ARROW = { up: <ArrowUpRight />, down: <ArrowDownRight />, flat: <ArrowRight /> }

export function Stat({ label, value, delta, hint, trend, trendLabel, size = 'md', icon, className }: StatProps) {
  const deltaTone = delta ? (delta.good === undefined || delta.direction === 'flat' ? 'neutral' : delta.good ? 'good' : 'bad') : null
  return (
    <div className={cx(styles.stat, styles[size], className)}>
      <div className={styles.label}>
        {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className={styles.value}>{value}</div>
      {delta ? (
        <div className={cx(styles.delta, deltaTone && styles[deltaTone])}>
          <span className={styles.arrow} aria-hidden="true">{ARROW[delta.direction]}</span>
          <span>{delta.label}</span>
        </div>
      ) : null}
      {trend && trend.length > 1 ? (
        <Sparkline values={trend} height={28} label={trendLabel ?? 'Trend'} className={styles.trend} tone="muted" />
      ) : null}
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  )
}
