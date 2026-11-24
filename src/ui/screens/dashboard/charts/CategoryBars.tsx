import { useId } from 'react'
import { fmt } from '../../../../core/money'
import type { Currency, YearMonth } from '../../../../core/types'
import { DataTable } from '../../../components/ds'
import { href } from '../../../router'
import { fmtWhole, monthName } from '../../home/model'
import { REST_ID, categorySummary, type CategoryBar, type CategoryBars as CategoryBarsData } from '../model'
import { useChartWidth } from './useChartWidth'
import styles from './charts.module.css'

export interface CategoryBarsProps {
  data: CategoryBarsData
  month: YearMonth
  currency: Currency
  /** the month the app is in: a row links to that category's transactions (an older month keeps its month in the link) */
  currentMonth: YearMonth
}

const ROW = 44
const BAR = 8
const GAP = 2

function rowName(r: CategoryBar, currency: Currency): string {
  const cap = r.limit !== undefined ? `, ${r.overLimit ? 'over' : 'within'} its ${fmtWhole(r.limit, currency)} cap` : ''
  return `${r.label}: ${fmt(r.spent, currency)}, ${r.shareText} of the month${cap}`
}

/**
 * The month's spending by category as ranked bars on one baseline: name and amount with its share on a line, the
 * bar under it. A category with a cap shows the cap as a tick, and what went past it hatched. One hue for every
 * bar: the names carry the identity. Each row opens that category's transactions in Insights.
 */
export function CategoryBars({ data, month, currency, currentMonth }: CategoryBarsProps) {
  const [ref, width] = useChartWidth<HTMLDivElement>(360)
  const hatchId = `cat-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { rows, max } = data
  const height = rows.length * ROW
  const scale = Math.max(1, max)
  const len = (v: number) => Math.max(0, Math.min(width, (v / scale) * width))
  const monthLong = monthName(month)

  return (
    <div className={styles.frame}>
      <div ref={ref} className={styles.plot} style={{ height }}>
        <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={categorySummary(data, month, currency)} focusable="false">
          <defs>
            <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="5" className={styles.hatchInk} />
            </pattern>
          </defs>
          {rows.map((r, i) => {
            const top = i * ROW
            const barY = top + 26
            const full = Math.max(BAR, len(r.spent))
            const capX = r.limit !== undefined ? len(r.limit) : null
            const within = r.overLimit && capX !== null ? Math.max(BAR / 2, capX) : full
            const over = full - within
            const body = (
              <>
                <rect className={styles.rowHit} x="0" y={top + 2} width={width} height={ROW - 4} rx="8" />
                <text className={styles.rowLabel} x="2" y={top + 17}>
                  <tspan>{r.emoji} {r.label}</tspan>
                  {r.overLimit ? <tspan className={styles.rowFlag} dx="6">over cap</tspan> : null}
                </text>
                <text className={styles.rowValue} x={width - 2} y={top + 17} textAnchor="end">
                  <tspan className={styles.rowAmount}>{fmtWhole(r.spent, currency)}</tspan>
                  <tspan dx="6">{r.shareText}</tspan>
                </text>
                <rect className={styles.track} x="0" y={barY} width={width} height={BAR} rx={BAR / 2} />
                {over > GAP + 2 ? (
                  <>
                    <rect className={styles.bar} x="0" y={barY} width={within} height={BAR} rx={BAR / 2} />
                    <rect className={styles.barOver} x={within + GAP} y={barY} width={over - GAP} height={BAR} rx={BAR / 2} />
                    <rect fill={`url(#${hatchId})`} x={within + GAP} y={barY} width={over - GAP} height={BAR} rx={BAR / 2} />
                  </>
                ) : (
                  <rect className={styles.bar} x="0" y={barY} width={full} height={BAR} rx={BAR / 2} />
                )}
                {capX !== null && !r.overLimit && capX < width - 1 ? <rect className={styles.capTick} x={capX - 1} y={barY - 3} width="2" height={BAR + 6} rx="1" /> : null}
              </>
            )
            if (r.id === REST_ID) {
              return (
                <g key={r.id} role="img" aria-label={`${rowName(r, currency)} (${r.folded} smaller categories)`}>
                  {body}
                </g>
              )
            }
            const query: Record<string, string> = { tab: 'transactions', cat: r.id }
            if (month !== currentMonth) query.month = month
            return (
              <a key={r.id} className={styles.rowLink} href={href('insights', [], query)} aria-label={`${rowName(r, currency)}. See these transactions`}>
                {body}
              </a>
            )
          })}
        </svg>
      </div>
      <DataTable
        caption={`Spending by category in ${monthLong}`}
        columns={['Category', 'Spent', 'Share of the month', 'Cap']}
        rows={rows.map((r) => [r.label, fmt(r.spent, currency), r.shareText, r.limit !== undefined ? `${fmt(r.limit, currency)}${r.overLimit ? ' (over)' : ''}` : 'None'])}
      />
    </div>
  )
}
