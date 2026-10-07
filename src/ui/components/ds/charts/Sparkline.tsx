import { useId } from 'react'
import type { Currency } from '../../../../core/types'
import { cx } from '../cx'
import { DataTable } from './DataTable'
import { moneyFormat, type ValueFormat } from './format'
import { areaPath, linePath, sparkPoints, sparkY } from './geometry'
import styles from './Charts.module.css'

export type SparkTone = 'accent' | 'under' | 'over' | 'info' | 'muted'

export interface SparklineProps {
  values: number[]
  /** x labels for the table twin (e.g. month names) */
  labels?: string[]
  /** accessible chart title */
  label: string
  height?: number
  tone?: SparkTone
  area?: boolean
  /** end-point dot */
  showEnd?: boolean
  /** reference line (e.g. the monthly target) */
  reference?: number
  referenceLabel?: string
  currency?: Currency
  format?: ValueFormat
  className?: string
}

export function sparkSummary(label: string, values: number[], f: ValueFormat): string {
  if (values.length === 0) return `${label}: no data`
  const first = values[0]
  const last = values[values.length - 1]
  const trend = last > first ? 'up' : last < first ? 'down' : 'flat'
  return `${label}: ${values.length} points, ${trend} from ${f(first)} to ${f(last)}; high ${f(Math.max(...values))}, low ${f(Math.min(...values))}.`
}

export function Sparkline({ values, labels, label, height = 40, tone = 'accent', area = true, showEnd = true, reference, referenceLabel = 'Reference', currency = 'CNY', format, className }: SparklineProps) {
  const f = format ?? moneyFormat(currency)
  const gradId = `spark${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const domain = reference !== undefined ? { min: Math.min(reference, ...values), max: Math.max(reference, ...values) } : {}
  const pts = sparkPoints(values, domain)
  const end = pts[pts.length - 1]
  const refY = reference !== undefined ? sparkY(reference, values, domain) : null
  const summary = sparkSummary(label, values, f) + (reference !== undefined ? ` ${referenceLabel}: ${f(reference)}.` : '')
  return (
    <figure className={cx(styles.figure, styles.spark, styles[`tone-${tone}`], className)}>
      <div role="img" aria-label={summary}>
        <svg width="100%" height={height} className={styles.sparkSvg} aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className={styles.areaStopTop} />
              <stop offset="100%" className={styles.areaStopBottom} />
            </linearGradient>
          </defs>
          {refY !== null ? <line x1="0" x2="100%" y1={`${refY}%`} y2={`${refY}%`} className={styles.reference} /> : null}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
            {area && pts.length > 1 ? <path d={areaPath(pts)} fill={`url(#${gradId})`} /> : null}
            {pts.length > 1 ? <path d={linePath(pts)} className={styles.line} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {showEnd && end ? <circle cx={`${end.x}%`} cy={`${end.y}%`} r="4" className={styles.endDot} /> : null}
        </svg>
      </div>
      <DataTable
        caption={label}
        columns={['Point', 'Value']}
        rows={values.map((v, i) => [labels?.[i] ?? String(i + 1), f(v)])}
      />
    </figure>
  )
}
