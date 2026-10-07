import type { ReactNode } from 'react'
import { cx } from './cx'
import { budgetTone, percentOf, ringGeometry, type ProgressTone } from './progress'
import styles from './ProgressRing.module.css'

export interface ProgressRingProps {
  value: number
  max?: number
  size?: number
  thickness?: number
  tone?: ProgressTone | 'budget'
  /** centre content, e.g. a percentage or a <DreamImage/> */
  children?: ReactNode
  /** accessible name, e.g. "MacBook Air saved" */
  label: string
  valueText?: string
  className?: string
}

export function ProgressRing({ value, max = 100, size = 120, thickness = 10, tone = 'accent', children, label, valueText, className }: ProgressRingProps) {
  const pct = percentOf(value, max)
  const resolved = tone === 'budget' ? budgetTone(value, max) : tone
  const { radius, circumference, offset } = ringGeometry(size, thickness, pct)
  const c = size / 2
  return (
    <div
      className={cx(styles.root, styles[resolved], className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(Math.min(value, max) * 100) / 100}
      aria-valuetext={valueText ?? `${Math.round(pct)}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={styles.svg}>
        <circle className={styles.track} cx={c} cy={c} r={radius} strokeWidth={thickness} />
        <circle
          className={styles.fill}
          cx={c}
          cy={c}
          r={radius}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
          opacity={pct === 0 ? 0 : 1}
        />
      </svg>
      {children != null ? <div className={styles.centre}>{children}</div> : null}
    </div>
  )
}
