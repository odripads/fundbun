import { useId } from 'react'
import { dateLabel, weekday } from '../../../../core/dates'
import { fmt } from '../../../../core/money'
import type { Currency } from '../../../../core/types'
import { DataTable } from '../../../components/ds'
import { fmtWhole, monthName } from '../../home/model'
import { dailySummary, type DailySeries, type DayBar } from '../model'
import { BarFrame, type MarkTip } from './BarFrame'
import { axisMoney, bandAt, bands, barHeight, columnPath, dayTicks, valueScale } from './scale'
import styles from './charts.module.css'

export interface DailyBarsProps {
  series: DailySeries
  currency: Currency
  height?: number
}

const M = { top: 22, right: 8, bottom: 36, left: 46 }
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** surface gap between the part of a bar inside the day limit and the part above it */
const GAP = 2

function limitNote(bar: DayBar, series: DailySeries, currency: Currency): string | undefined {
  if (bar.future) return 'Not yet'
  if (series.limit === null) return bar.amount === 0 ? 'Nothing logged' : undefined
  if (bar.overLimit) return `Over the ${fmtWhole(series.limit, currency)} day limit`
  return bar.amount === 0 ? 'Nothing logged' : `Within the ${fmtWhole(series.limit, currency)} day limit`
}

/**
 * Day-to-day spending for each day of the month: one column per day, the day limit as a labelled line, the part of
 * a day above it hatched, and today marked on the axis. Days that have not happened are left empty.
 */
export function DailyBars({ series, currency, height = 228 }: DailyBarsProps) {
  const hatchId = `daily-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { days, limit } = series
  const scale = valueScale(Math.max(series.max, limit !== null ? limit * 1.3 : 0))
  const plotH = height - M.top - M.bottom
  const baseline = M.top + plotH
  const today = days.find((d) => d.isToday) ?? null
  const ticks = new Set(dayTicks(days.length, today ? today.day : null))
  const monthLong = monthName(series.month)

  const tip = (i: number): MarkTip => {
    const d = days[i]
    return { title: `${WEEKDAY[weekday(d.date)]}, ${dateLabel(d.date)}${d.isToday ? ' · today' : ''}`, value: fmt(d.amount, currency), note: limitNote(d, series, currency) }
  }
  const plotW = (width: number) => Math.max(40, width - M.left - M.right)

  return (
    <BarFrame
      label={`Daily spending in ${monthLong}`}
      summary={dailySummary(series, currency)}
      height={height}
      count={days.length}
      selectable={(i) => !days[i].future}
      tip={tip}
      hit={(px, width) => bandAt(px - M.left, days.length, plotW(width))}
      anchor={(i, width) => {
        const b = bands(days.length, plotW(width), 18)[i]
        return { x: M.left + b.mid, y: baseline - barHeight(days[i].amount, scale.max, plotH) - 8 }
      }}
      table={
        <DataTable
          caption={`Day-to-day spending for each day of ${monthLong}`}
          columns={limit !== null ? ['Day', 'Spent', 'Against the day limit'] : ['Day', 'Spent']}
          rows={days
            .filter((d) => !d.future)
            .map((d) => {
              const row = [`${dateLabel(d.date)}${d.isToday ? ' (today)' : ''}`, fmt(d.amount, currency)]
              return limit !== null ? [...row, d.overLimit ? 'Over' : 'Within'] : row
            })}
        />
      }
    >
      {({ width, active }) => {
        const w = plotW(width)
        const slots = bands(days.length, w, 18)
        const y = (v: number) => baseline - barHeight(v, scale.max, plotH)
        const limitY = limit !== null ? y(limit) : null
        return (
          <>
            <defs>
              <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="2" height="5" className={styles.hatchInk} />
              </pattern>
            </defs>

            {scale.ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? styles.axis : styles.grid} x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} />
                <text className={styles.tick} x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{axisMoney(t, scale.max, currency)}</text>
              </g>
            ))}

            {active !== null ? <rect className={styles.band} x={M.left + slots[active].x} y={M.top - 6} width={slots[active].slot} height={plotH + 6} rx="4" /> : null}

            {days.map((d, i) => {
              const s = slots[i]
              const x = M.left + s.barX
              if (d.future) return <rect key={d.date} className={styles.pending} x={x} y={baseline - 2} width={s.bar} height="2" rx="1" />
              if (d.amount <= 0) return null
              const full = barHeight(d.amount, scale.max, plotH)
              const within = limit !== null && d.overLimit ? barHeight(limit, scale.max, plotH) : full
              const over = full - within
              const cls = d.isToday ? styles.barToday : styles.bar
              if (over <= GAP + 1) return <path key={d.date} className={cls} d={columnPath(x, baseline, s.bar, Math.max(2, full), 3)} />
              return (
                <g key={d.date}>
                  <rect className={cls} x={x} y={baseline - within} width={s.bar} height={within} />
                  <path className={styles.barOver} d={columnPath(x, baseline - within - GAP, s.bar, over - GAP, 3)} />
                  <path fill={`url(#${hatchId})`} d={columnPath(x, baseline - within - GAP, s.bar, over - GAP, 3)} />
                </g>
              )
            })}

            {limitY !== null && limit !== null ? (
              <g>
                <line className={styles.limit} x1={M.left} x2={M.left + w} y1={limitY} y2={limitY} />
                <text className={styles.limitLabel} x={M.left + w} y={limitY - 6} textAnchor="end">Day limit {fmtWhole(limit, currency)}</text>
              </g>
            ) : null}

            {series.peak && series.peak.amount > 0 ? (
              <text
                className={styles.value}
                x={Math.max(M.left + 22, Math.min(M.left + w - 22, M.left + slots[series.peak.day - 1].mid))}
                y={y(series.peak.amount) - 6}
                textAnchor="middle"
              >
                {fmtWhole(series.peak.amount, currency)}
              </text>
            ) : null}

            {days.map((d, i) =>
              ticks.has(d.day) ? (
                <text key={d.date} className={d.isToday ? styles.xToday : styles.x} x={M.left + slots[i].mid} y={baseline + 15} textAnchor="middle">{d.day}</text>
              ) : null,
            )}
            {today ? (
              <g>
                <path className={styles.todayMark} d={`M${M.left + slots[today.day - 1].mid - 4} ${baseline + 20}h8l-4 -4z`} />
                <text className={styles.xToday} x={Math.max(M.left + 16, Math.min(M.left + w - 16, M.left + slots[today.day - 1].mid))} y={baseline + 32} textAnchor="middle">Today</text>
              </g>
            ) : null}
          </>
        )
      }}
    </BarFrame>
  )
}
