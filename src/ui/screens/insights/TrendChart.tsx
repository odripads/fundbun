import { TriangleAlert } from 'lucide-react'
import { CURRENCY_SYMBOL, fmt } from '../../../core/money'
import type { Currency, YearMonth } from '../../../core/types'
import { cx } from '../../components/ds'
import { monthName, shortAmount, trendGeometry, trendSummary, type TrendBar } from './model'
import styles from './charts.module.css'

export interface TrendChartProps {
  bars: TrendBar[]
  selected: YearMonth
  currency: Currency
  onSelect: (month: YearMonth) => void
}

/** bottom offset of a value inside the bar zone (the plot area minus the month labels) */
function zoneBottom(pct: number): string {
  return `calc(var(--xh) + (100% - var(--xh)) * ${(pct / 100).toFixed(4)})`
}

function axisLabel(m: number, currency: Currency): string {
  return m === 0 ? `${CURRENCY_SYMBOL[currency]}0` : `${CURRENCY_SYMBOL[currency]}${shortAmount(m, currency)}`
}

/**
 * Six months of spending against target on one shared, labelled scale. The part of a month above target
 * is hatched and its label carries a warning icon; the current month shows its projected month-end as a
 * dashed ghost. Each
 * column is a button that switches the screen to that month.
 */
export function TrendChart({ bars, selected, currency, onSelect }: TrendChartProps) {
  const g = trendGeometry(bars)
  const sameTarget = bars.length > 0 && bars.every((b) => b.target === bars[0].target)
  const targetPct = sameTarget ? g.bars[0]?.targetPct ?? 0 : null
  const pace = bars.find((b) => b.projected !== undefined)

  return (
    <figure className={styles.trend}>
      <div className={styles.plot}>
        <div className={styles.yAxis} aria-hidden="true">
          {g.ticks.map((t) => (
            <span key={t} className={styles.yTick} style={{ bottom: `${(t / g.max) * 100}%` }}>
              {axisLabel(t, currency)}
            </span>
          ))}
        </div>
        <div className={styles.area}>
          {g.ticks.map((t) => (
            <span key={t} className={styles.grid} style={{ bottom: zoneBottom((t / g.max) * 100) }} aria-hidden="true" />
          ))}
          {targetPct !== null ? <span className={styles.targetLine} style={{ bottom: zoneBottom(targetPct) }} aria-hidden="true" /> : null}
          <ol className={styles.cols} aria-label="Spending by month — choose a month to see it">
            {bars.map((b, i) => {
              const geo = g.bars[i]
              const over = b.over
              const label = `${monthName(b.month)}${b.current ? ' so far' : ''}: ${fmt(b.spent, currency)} of a ${fmt(b.target, currency)} target${over ? `, ${fmt(b.spent - b.target, currency)} over` : ''}${b.projected ? `, heading for ${fmt(b.projected, currency)}` : ''}`
              return (
                <li key={b.month} className={styles.col}>
                  <button
                    type="button"
                    className={cx(styles.colButton, b.month === selected && styles.selected)}
                    aria-pressed={b.month === selected}
                    aria-label={label}
                    onClick={() => onSelect(b.month)}
                  >
                    <span className={styles.barZone} aria-hidden="true">
                      {geo.projectedPct !== null ? (
                        <span className={cx(styles.ghost, (b.projected ?? 0) <= b.target && styles.ghostUnder)} style={{ height: `${geo.projectedPct}%` }} />
                      ) : null}
                      <span className={cx(styles.bar, over && styles.barOver, b.current && styles.barCurrent)} style={{ height: `${geo.spentPct}%`, animationDelay: `${i * 60}ms` }}>
                        {/* over months: within-target part stays gold, only the overspend is hatched */}
                        {over ? <span className={styles.barBase} style={{ height: `${(b.target / b.spent) * 100}%` }} /> : null}
                      </span>
                      {targetPct === null ? <span className={styles.targetMark} style={{ bottom: `${geo.targetPct}%` }} /> : null}
                      <span className={cx(styles.value, over && styles.valueOver)} style={{ bottom: `calc(${Math.max(geo.spentPct, geo.projectedPct ?? 0)}% + 4px)` }}>
                        {over ? <TriangleAlert /> : null}
                        {shortAmount(b.spent, currency)}
                      </span>
                    </span>
                    <span className={styles.xLabel} aria-hidden="true">
                      {b.short}
                      {b.current ? <span className={styles.nowDot} /> : null}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
      </div>

      <ul className={styles.legend} aria-hidden="true">
        <li><span className={cx(styles.swatch, styles.swatchIn)} /> Within target</li>
        {bars.some((b) => b.over) ? <li><span className={cx(styles.swatch, styles.swatchOver)} /> Over target</li> : null}
        {pace ? <li><span className={cx(styles.swatch, styles.swatchGhost, (pace.projected ?? 0) <= pace.target && styles.swatchGhostUnder)} /> Pace</li> : null}
        <li><span className={styles.swatchLine} /> Target{sameTarget && bars[0] ? ` ${fmt(bars[0].target, currency)}` : ''}</li>
      </ul>
      <figcaption className={styles.caption}>{trendSummary(bars, currency)}</figcaption>

      <div className="sr-only">
        <table>
          <caption>Spending vs target, last {bars.length} months</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Spent</th>
              <th scope="col">Target</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((b) => (
              <tr key={b.month}>
                <th scope="row">{monthName(b.month)}{b.current ? ' (so far)' : ''}</th>
                <td>{fmt(b.spent, currency)}</td>
                <td>{fmt(b.target, currency)}</td>
                <td>{b.over ? `Over by ${fmt(b.spent - b.target, currency)}` : b.projected ? `Heading for ${fmt(b.projected, currency)}` : 'Within target'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
