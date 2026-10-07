import { useId } from 'react'
import type { Currency } from '../../../../core/types'
import { cx } from '../cx'
import { DataTable } from './DataTable'
import { moneyFormat, type ValueFormat } from './format'
import { colorFor, foldOther, pct, percentLabel, stackSegments, type ChartDatum } from './geometry'
import { Legend } from './Legend'
import styles from './Charts.module.css'

export interface StackedBarMarker {
  value: number
  label: string
}

export interface StackedBarProps {
  data: ChartDatum[]
  label: string
  /** scale total; larger than the sum leaves an empty remainder (e.g. spent vs target) */
  total?: number
  markers?: StackedBarMarker[]
  height?: number
  legend?: boolean
  maxSegments?: number
  currency?: Currency
  format?: ValueFormat
  className?: string
}

export function stackedSummary(label: string, data: ChartDatum[], f: ValueFormat, total?: number): string {
  const sum = data.reduce((s, d) => s + d.value, 0)
  if (sum === 0) return `${label}: no data`
  const parts = data.map((d) => `${d.label} ${f(d.value)} (${percentLabel(d.value / sum)})`).join(', ')
  return `${label}, ${f(sum)}${total && total > sum ? ` of ${f(total)}` : ''}: ${parts}.`
}

/** One horizontal bar split into parts (needs / wants / savings, or spent vs remaining), with optional markers. */
export function StackedBar({ data, label, total, markers = [], height = 16, legend = true, maxSegments = 6, currency = 'CNY', format, className }: StackedBarProps) {
  const f = format ?? moneyFormat(currency)
  const clipId = `stack${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const folded = foldOther(data, maxSegments)
  const sum = folded.reduce((s, d) => s + d.value, 0)
  const scale = Math.max(sum, total ?? 0, ...markers.map((m) => m.value))
  const segs = stackSegments(folded.map((d) => d.value), scale)
  const pad = markers.some((m) => m.label) ? 18 : 0

  return (
    <figure className={cx(styles.figure, className)}>
      <div role="img" aria-label={stackedSummary(label, folded, f, total) + markers.map((m) => ` ${m.label}: ${f(m.value)}.`).join('')}>
        <svg width="100%" height={height + pad} aria-hidden="true" className={styles.stackSvg}>
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width="100%" height={height} rx={height / 2} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <rect x="0" y="0" width="100%" height={height} className={styles.track} />
            {folded.map((d, i) => (segs[i].width > 0 ? <rect key={d.id} x={`${segs[i].start}%`} y="0" width={`${segs[i].width}%`} height={height} fill={colorFor(d, i)} /> : null))}
            {segs.slice(1).map((s, i) => (s.width > 0 && segs[i].width > 0 ? <line key={i} x1={`${s.start}%`} x2={`${s.start}%`} y1="0" y2={height} className={styles.gap} /> : null))}
          </g>
          {markers.map((m) => {
            const x = `${pct(m.value, scale)}%`
            return (
              <g key={m.label}>
                <line x1={x} x2={x} y1={-3} y2={height + 3} className={styles.limitRing} />
                <line x1={x} x2={x} y1={-3} y2={height + 3} className={styles.limitLine} />
                {m.label ? <text x={x} y={height + 16} className={styles.markerText} textAnchor={pct(m.value, scale) > 85 ? 'end' : pct(m.value, scale) < 15 ? 'start' : 'middle'}>{m.label}</text> : null}
              </g>
            )
          })}
        </svg>
      </div>
      {legend ? <Legend items={folded.map((d, i) => ({ id: d.id, label: d.label, color: colorFor(d, i), value: f(d.value), share: sum ? percentLabel(d.value / sum) : undefined }))} /> : null}
      <DataTable caption={label} columns={['Part', 'Amount', 'Share']} rows={folded.map((d) => [d.label, f(d.value), sum ? percentLabel(d.value / sum) : '0%'])} />
    </figure>
  )
}
