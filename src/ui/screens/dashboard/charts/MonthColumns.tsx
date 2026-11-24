import { useId } from 'react'
import { fmt } from '../../../../core/money'
import type { Currency } from '../../../../core/types'
import { DataTable } from '../../../components/ds'
import { monthColumnNote, monthColumnsSummary, type MonthColumns as MonthColumnsData } from '../model'
import { BarFrame, type MarkTip } from './BarFrame'
import { axisMoney, bandAt, bands, barHeight, columnPath } from './scale'
import styles from './charts.module.css'

export interface MonthColumnsProps {
  data: MonthColumnsData
  currency: Currency
  height?: number
}

const M = { top: 24, right: 8, bottom: 38, left: 46 }
const GAP = 2

/** Where a column's amount sits: above the bar, or above the target line when that line would run through the text. */
function labelY(barTop: number, targetY: number | null): number {
  return targetY !== null && targetY <= barTop && barTop - targetY < 18 ? targetY - 6 : barTop - 6
}

/**
 * Spent against target for the last months, one column each on a shared scale. The target is a line (one across the
 * plot when every month has the same target, a tick per column when they differ); the part of a month above it is
 * hatched. Every column carries its amount, and the month in progress says "so far".
 */
export function MonthColumns({ data, currency, height = 228 }: MonthColumnsProps) {
  const hatchId = `months-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const { cols, max, ticks } = data
  const plotH = height - M.top - M.bottom
  const baseline = M.top + plotH
  const first = cols[0]?.target ?? null
  const sameTarget = first !== null && cols.every((c) => c.target === first)
  const plotW = (width: number) => Math.max(40, width - M.left - M.right)

  const tip = (i: number): MarkTip => {
    const c = cols[i]
    return { title: `${c.long}${c.current ? ' so far' : ''}`, value: fmt(c.spent, currency), note: monthColumnNote(c, currency) }
  }

  return (
    <BarFrame
      label={`Spending by month, last ${cols.length} months`}
      summary={monthColumnsSummary(data, currency)}
      height={height}
      count={cols.length}
      tip={tip}
      hit={(px, width) => bandAt(px - M.left, cols.length, plotW(width))}
      anchor={(i, width) => {
        const b = bands(cols.length, plotW(width))[i]
        return { x: M.left + b.mid, y: baseline - barHeight(Math.max(cols[i].spent, cols[i].target ?? 0), max, plotH) - 22 }
      }}
      table={
        <DataTable
          caption={`Spent against target, last ${cols.length} months`}
          columns={['Month', 'Spent', 'Target', 'Result']}
          rows={cols.map((c) => [
            `${c.long}${c.current ? ' (so far)' : ''}`,
            fmt(c.spent, currency),
            c.target !== null ? fmt(c.target, currency) : 'No target',
            monthColumnNote(c, currency) ?? 'Counted, no target',
          ])}
        />
      }
    >
      {({ width, active }) => {
        const w = plotW(width)
        const slots = bands(cols.length, w)
        const y = (v: number) => baseline - barHeight(v, max, plotH)
        return (
          <>
            <defs>
              <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="2" height="5" className={styles.hatchInk} />
              </pattern>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? styles.axis : styles.grid} x1={M.left} x2={M.left + w} y1={y(t)} y2={y(t)} />
                <text className={styles.tick} x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{axisMoney(t, max, currency)}</text>
              </g>
            ))}

            {active !== null ? <rect className={styles.band} x={M.left + slots[active].x + 4} y={M.top - 8} width={slots[active].slot - 8} height={plotH + 8} rx="6" /> : null}

            {cols.map((c, i) => {
              const s = slots[i]
              const x = M.left + s.barX
              const full = barHeight(c.spent, max, plotH)
              const within = c.over && c.target !== null ? barHeight(c.target, max, plotH) : full
              const over = full - within
              const cls = c.current ? styles.barToday : styles.bar
              return (
                <g key={c.month}>
                  {full <= 0 ? null : over <= GAP + 1 ? (
                    <path className={cls} d={columnPath(x, baseline, s.bar, Math.max(2, full))} />
                  ) : (
                    <>
                      <rect className={cls} x={x} y={baseline - within} width={s.bar} height={within} />
                      <path className={styles.barOver} d={columnPath(x, baseline - within - GAP, s.bar, over - GAP)} />
                      <path fill={`url(#${hatchId})`} d={columnPath(x, baseline - within - GAP, s.bar, over - GAP)} />
                    </>
                  )}
                  {!sameTarget && c.target !== null ? <line className={styles.targetTick} x1={x - 7} x2={x + s.bar + 7} y1={y(c.target)} y2={y(c.target)} /> : null}
                  <text className={styles.value} x={M.left + s.mid} y={labelY(y(c.spent), sameTarget && c.target !== null ? y(c.target) : null)} textAnchor="middle">{axisMoney(c.spent, max, currency)}</text>
                  <text className={c.current ? styles.xToday : styles.x} x={M.left + s.mid} y={baseline + 16} textAnchor="middle">{c.short}</text>
                  {c.current ? <text className={styles.xSub} x={M.left + s.mid} y={baseline + 30} textAnchor="middle">so far</text> : null}
                </g>
              )
            })}

            {sameTarget && first !== null ? <line className={styles.limit} x1={M.left} x2={M.left + w} y1={y(first)} y2={y(first)} /> : null}
          </>
        )
      }}
    </BarFrame>
  )
}
