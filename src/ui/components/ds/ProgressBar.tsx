import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import { budgetTone, percentOf, type ProgressTone } from './progress'
import styles from './ProgressBar.module.css'

export interface ProgressMarker {
  value: number
  /** short label shown under the marker, e.g. "today" or "target" */
  label?: string
}

export interface ProgressBarProps {
  value: number
  max?: number
  /** 'budget' picks under/warn/over from value/max */
  tone?: ProgressTone | 'budget'
  size?: 'sm' | 'md' | 'lg'
  /** visible label above the bar (also the accessible name) */
  label?: ReactNode
  /** accessible name when there's no visible label */
  ariaLabel?: string
  /** right-aligned text above the bar, e.g. "¥7,200 of ¥9,500" */
  valueLabel?: ReactNode
  /** spoken value, e.g. "76% of target"; defaults to the rounded percentage */
  valueText?: string
  markers?: ProgressMarker[]
  className?: string
}

export function ProgressBar({ value, max = 100, tone = 'accent', size = 'md', label, ariaLabel, valueLabel, valueText, markers = [], className }: ProgressBarProps) {
  const pct = percentOf(value, max)
  const resolved = tone === 'budget' ? budgetTone(value, max) : tone
  const over = value > max && max > 0
  const labelId = useId()
  return (
    <div className={cx(styles.root, styles[size], className)}>
      {label || valueLabel ? (
        <div className={styles.head}>
          {label ? <span className={styles.label} id={labelId}>{label}</span> : <span />}
          {valueLabel ? <span className={styles.value}>{valueLabel}</span> : null}
        </div>
      ) : null}
      <div
        className={cx(styles.track, styles[resolved])}
        role="progressbar"
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(Math.min(value, max) * 100) / 100}
        aria-valuetext={valueText ?? `${Math.round((value / (max || 1)) * 100)}%${over ? ' (over)' : ''}`}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} data-over={over || undefined} />
        {markers.map((m, i) => (
          <span key={i} className={styles.marker} style={{ left: `${percentOf(m.value, max)}%` }} aria-hidden="true">
            {m.label ? <span className={styles.markerLabel}>{m.label}</span> : null}
          </span>
        ))}
      </div>
    </div>
  )
}
