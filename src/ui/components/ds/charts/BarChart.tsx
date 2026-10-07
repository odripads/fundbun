import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Currency } from '../../../../core/types'
import { cx } from '../cx'
import { DataTable } from './DataTable'
import { moneyFormat, type ValueFormat } from './format'
import { pct, scaleMax } from './geometry'
import styles from './Charts.module.css'

export interface BarDatum {
  id: string
  label: string
  value: number
  /** budget/limit for this row → a marker; the part past it is drawn in the over colour */
  limit?: number
  /** emoji or icon shown before the label (identity is carried by text, not colour) */
  icon?: ReactNode
}

export interface BarChartProps {
  data: BarDatum[]
  /** chart title for assistive tech, e.g. "October spending by category" */
  label: string
  currency?: Currency
  format?: ValueFormat
  /** fixed scale maximum (default: the largest value or limit) */
  max?: number
  /** rows become buttons (e.g. tap a category to filter) */
  onSelect?: (id: string) => void
  className?: string
}

export interface BarRow extends BarDatum {
  valuePct: number
  limitPct: number | null
  over: boolean
  overBy: number
}

/** Row geometry for a horizontal bar chart sharing one scale across rows. */
export function barRows(data: BarDatum[], max?: number): BarRow[] {
  const scale = max && max > 0 ? max : scaleMax(data.map((d) => d.value), data.map((d) => d.limit ?? 0))
  return data.map((d) => {
    const over = d.limit !== undefined && d.value > d.limit
    return {
      ...d,
      valuePct: pct(d.value, scale),
      limitPct: d.limit !== undefined ? pct(d.limit, scale) : null,
      over,
      overBy: over ? d.value - (d.limit ?? 0) : 0,
    }
  })
}

export function barSummary(label: string, rows: BarRow[], f: ValueFormat): string {
  if (rows.length === 0) return `${label}: no data`
  const top = rows.reduce((a, b) => (b.value > a.value ? b : a))
  const over = rows.filter((r) => r.over)
  const overText = over.length ? `; over limit: ${over.map((r) => `${r.label} by ${f(r.overBy)}`).join(', ')}` : '; all within limits'
  const hasLimits = rows.some((r) => r.limitPct !== null)
  return `${label}. ${rows.length} categories; largest ${top.label} at ${f(top.value)}${hasLimits ? overText : ''}.`
}

function Bar({ row }: { row: BarRow }) {
  const splitAt = row.over && row.limitPct !== null ? row.limitPct : null
  return (
    <svg className={styles.barSvg} width="100%" height="12" aria-hidden="true">
      <rect className={styles.track} x="0" y="2" width="100%" height="8" rx="4" />
      {row.valuePct > 0 ? (
        splitAt !== null ? (
          <>
            <rect className={styles.barOver} x="0" y="2" width={`${row.valuePct}%`} height="8" rx="4" />
            <rect className={styles.barFill} x="0" y="2" width={`${splitAt}%`} height="8" rx="4" />
          </>
        ) : (
          <rect className={styles.barFill} x="0" y="2" width={`${row.valuePct}%`} height="8" rx="4" />
        )
      ) : null}
      {row.limitPct !== null ? (
        <g className={styles.limit}>
          <line x1={`${row.limitPct}%`} x2={`${row.limitPct}%`} y1="-1" y2="13" className={styles.limitRing} />
          <line x1={`${row.limitPct}%`} x2={`${row.limitPct}%`} y1="-1" y2="13" className={styles.limitLine} />
        </g>
      ) : null}
    </svg>
  )
}

/** Horizontal category bars on one shared scale, with limit markers and an over-limit overflow. */
export function BarChart({ data, label, currency = 'CNY', format, max, onSelect, className }: BarChartProps) {
  const f = format ?? moneyFormat(currency)
  const rows = barRows(data, max)
  const summary = barSummary(label, rows, f)

  const rowBody = (r: BarRow) => (
    <>
      <span className={styles.rowHead}>
        {r.icon ? <span className={styles.rowIcon} aria-hidden="true">{r.icon}</span> : null}
        <span className={styles.rowLabel}>{r.label}</span>
        <span className={styles.rowValue}>
          {f(r.value)}
          {r.limit !== undefined ? <span className={styles.rowLimit}> / {f(r.limit)}</span> : null}
        </span>
      </span>
      <Bar row={r} />
      {r.over ? (
        <span className={styles.overNote}>
          <TriangleAlert aria-hidden="true" /> {f(r.overBy)} over
        </span>
      ) : null}
    </>
  )

  if (onSelect) {
    return (
      <figure className={cx(styles.figure, className)}>
        <ul className={styles.barList} aria-label={summary}>
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={cx(styles.barRow, styles.barButton)}
                onClick={() => onSelect(r.id)}
                aria-label={`${r.label}: ${f(r.value)}${r.limit !== undefined ? ` of ${f(r.limit)} limit` : ''}${r.over ? `, ${f(r.overBy)} over` : ''}`}
              >
                {rowBody(r)}
              </button>
            </li>
          ))}
        </ul>
      </figure>
    )
  }

  return (
    <figure className={cx(styles.figure, className)}>
      <div role="img" aria-label={summary} className={styles.barList}>
        {rows.map((r) => <div key={r.id} className={styles.barRow}>{rowBody(r)}</div>)}
      </div>
      <DataTable
        caption={label}
        columns={['Category', 'Amount', 'Limit', 'Status']}
        rows={rows.map((r) => [r.label, f(r.value), r.limit !== undefined ? f(r.limit) : '—', r.over ? `Over by ${f(r.overBy)}` : r.limit !== undefined ? 'Within limit' : '—'])}
      />
    </figure>
  )
}
