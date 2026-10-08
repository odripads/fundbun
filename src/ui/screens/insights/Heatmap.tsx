import { Moon, Table2 } from 'lucide-react'
import { useId, useState, type CSSProperties } from 'react'
import { fmt } from '../../../core/money'
import type { Currency } from '../../../core/types'
import { Button, cx } from '../../components/ds'
import { BANDS, HOUR_ORDER, WEEKDAYS, WEEKDAYS_LONG, heatLevel, heatSummary, hourLabel, isLateHour, type Heatmap as HeatmapData } from './model'
import styles from './charts.module.css'

export interface HeatmapProps {
  map: HeatmapData
  monthLong: string
  currency: Currency
}

const AXIS_HOURS = new Set([4, 8, 12, 16, 20, 0])
/** first and last column of the late-night band in display order (22:00 → 03:00) */
const LATE_START = HOUR_ORDER.indexOf(22)
const LATE_END = HOUR_ORDER.indexOf(3)

/**
 * When the money goes: weekday rows × 24 hour columns (starting at 04:00 so the late-night band is one
 * block on the right). Intensity is a square-root scale; late-night cells switch to the chili hue, sit in
 * a labelled band and carry a dot when they were food delivery. A visible table view is one tap away.
 */
export function Heatmap({ map, monthLong, currency }: HeatmapProps) {
  const [table, setTable] = useState(false)
  const tableId = useId()
  const summary = heatSummary(map, monthLong, currency)
  const bandStyle = {
    '--band-start': LATE_START,
    '--band-span': LATE_END - LATE_START + 1,
  } as CSSProperties

  return (
    <figure className={styles.heat}>
      <div className={styles.heatGrid} role="img" aria-label={summary} style={bandStyle}>
        <span className={styles.lateBand} aria-hidden="true">
          <span className={styles.lateLabel}>
            <Moon /> late
          </span>
        </span>
        {WEEKDAYS.map((day, r) => (
          <div key={day} className={styles.heatRow}>
            <span className={styles.dayLabel} aria-hidden="true">{day}</span>
            {HOUR_ORDER.map((h) => {
              const c = map.cells[r][h]
              const level = heatLevel(c.amount, map.max)
              return (
                <span
                  key={h}
                  className={cx(styles.cell, level > 0 && styles.cellOn, isLateHour(h) && styles.cellLate, c.delivery > 0 && styles.cellDelivery)}
                  style={level > 0 ? ({ '--l': `${Math.round(level * 100)}%` } as CSSProperties) : undefined}
                  title={c.count ? `${WEEKDAYS_LONG[r]} ${hourLabel(h)}: ${fmt(c.amount, currency)} · ${c.count} ${c.count === 1 ? 'purchase' : 'purchases'}${c.delivery ? ` · ${c.delivery} late delivery` : ''}` : undefined}
                />
              )
            })}
          </div>
        ))}
        <div className={styles.hourAxis} aria-hidden="true">
          <span />
          {HOUR_ORDER.map((h) => (
            <span key={h} className={styles.hourTick}>{AXIS_HOURS.has(h) ? String(h).padStart(2, '0') : ''}</span>
          ))}
        </div>
      </div>

      <div className={styles.heatFoot}>
        <div className={styles.heatKey} aria-hidden="true">
          <span>less</span>
          {[0.2, 0.45, 0.7, 1].map((l) => (
            <span key={l} className={cx(styles.keyCell, styles.cellOn)} style={{ '--l': `${l * 100}%` } as CSSProperties} />
          ))}
          <span>more</span>
          <span className={styles.keySep} />
          <span className={cx(styles.keyCell, styles.cellOn, styles.cellLate, styles.cellDelivery)} style={{ '--l': '70%' } as CSSProperties} />
          <span>late delivery</span>
        </div>
        <Button size="sm" variant="ghost" iconStart={<Table2 />} aria-expanded={table} aria-controls={tableId} onClick={() => setTable((t) => !t)}>
          {table ? 'Hide table' : 'Table'}
        </Button>
      </div>

      <div id={tableId} hidden={!table} className={styles.heatTableWrap}>
        <table className={styles.heatTable}>
          <caption className="sr-only">Day-to-day spending in {monthLong} by weekday and time of day</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {BANDS.map((b) => (
                <th key={b.id} scope="col">
                  {b.label}
                  <span className={styles.bandRange}>{b.range}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAYS.map((day, r) => (
              <tr key={day}>
                <th scope="row">{day}</th>
                {BANDS.map((b, i) => (
                  <td key={b.id} className={cx(b.id === 'late' && map.bands[r][i] > 0 && styles.lateValue)}>
                    {map.bands[r][i] > 0 ? fmt(Math.round(map.bands[r][i] / 100) * 100, currency) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!table ? (
        <div className="sr-only">
          <table>
            <caption>Day-to-day spending in {monthLong} by weekday and time of day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {BANDS.map((b) => <th key={b.id} scope="col">{b.label} ({b.range})</th>)}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS_LONG.map((day, r) => (
                <tr key={day}>
                  <th scope="row">{day}</th>
                  {BANDS.map((b, i) => <td key={b.id}>{fmt(map.bands[r][i], currency)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </figure>
  )
}
