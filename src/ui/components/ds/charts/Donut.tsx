import { useState, type ReactNode } from 'react'
import type { Currency } from '../../../../core/types'
import { cx } from '../cx'
import { DataTable } from './DataTable'
import { moneyFormat, type ValueFormat } from './format'
import { colorFor, donutArcs, foldOther, percentLabel, type ChartDatum } from './geometry'
import { Legend } from './Legend'
import styles from './Charts.module.css'

export interface DonutProps {
  data: ChartDatum[]
  label: string
  size?: number
  thickness?: number
  /** centre content, e.g. the total */
  children?: ReactNode
  legend?: boolean
  /** at most this many segments; the rest fold into "Other" (part-to-whole reads poorly past ~6) */
  maxSegments?: number
  currency?: Currency
  format?: ValueFormat
  className?: string
}

export function donutSummary(label: string, data: ChartDatum[], f: ValueFormat): string {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return `${label}: no data`
  const parts = data.map((d) => `${d.label} ${f(d.value)} (${percentLabel(d.value / total)})`)
  return `${label}, total ${f(total)}: ${parts.join(', ')}.`
}

/** Part-to-whole ring with a 2px surface gap between segments, a centre slot and a legend. */
export function Donut({ data, label, size = 168, thickness = 20, children, legend = true, maxSegments = 6, currency = 'CNY', format, className }: DonutProps) {
  const f = format ?? moneyFormat(currency)
  const folded = foldOther(data, maxSegments)
  const [active, setActive] = useState<string | null>(null)
  const r = (size - thickness) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  const arcs = donutArcs(folded.map((d) => d.value), circumference)
  const total = folded.reduce((s, d) => s + d.value, 0)

  return (
    <figure className={cx(styles.figure, styles.donutFigure, className)}>
      <div className={styles.donut} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={donutSummary(label, folded, f)}>
          <circle cx={c} cy={c} r={r} className={styles.ringTrack} strokeWidth={thickness} />
          {folded.map((d, i) =>
            arcs[i].length > 0 ? (
              <circle
                key={d.id}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={colorFor(d, i)}
                strokeWidth={thickness}
                strokeDasharray={`${arcs[i].length} ${circumference}`}
                strokeDashoffset={arcs[i].offset}
                transform={`rotate(-90 ${c} ${c})`}
                className={cx(styles.segment, active !== null && active !== d.id && styles.dim)}
              />
            ) : null,
          )}
        </svg>
        {children != null ? <div className={styles.donutCentre}>{children}</div> : null}
      </div>
      {legend ? (
        <Legend
          items={folded.map((d, i) => ({ id: d.id, label: d.label, color: colorFor(d, i), value: f(d.value), share: total ? percentLabel(d.value / total) : undefined }))}
          onHover={setActive}
        />
      ) : null}
      <DataTable caption={label} columns={['Category', 'Amount', 'Share']} rows={folded.map((d) => [d.label, f(d.value), total ? percentLabel(d.value / total) : '0%'])} />
    </figure>
  )
}
