import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { buttonClass, cx } from '../../components/ds'
import { href } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { fmtWhole, monthName } from '../home/model'
import { CategoryBars } from './charts/CategoryBars'
import { DailyBars } from './charts/DailyBars'
import { MonthColumns } from './charts/MonthColumns'
import chart from './charts/charts.module.css'
import { DashCard } from './DashCard'
import { categoryBars, dailySeries, dayLimitFor, monthColumns } from './model'
import styles from './Dashboard.module.css'

const selectCharts = (s: AppSnapshot) => ({
  ctx: s.derived.ctx,
  summary: s.derived.summary,
  history: s.derived.history,
  today: s.derived.today,
  currency: s.state.profile?.currency ?? 'CNY',
  tracking: s.state.profile?.mode === 'tracking',
})

function SeeAll({ to, label, children }: { to: string; label: string; children: string }) {
  return (
    <a className={buttonClass('ghost', 'sm', false, styles.seeAll)} href={to} aria-label={label}>
      {children} <ChevronRight aria-hidden="true" />
    </a>
  )
}

/** Day-to-day spending for each day of the month, against the day limit. */
export function DailyCard({ area }: { area: string }) {
  const { ctx, summary, today, currency } = useSnapshot(selectCharts, shallowEqual)
  const series = useMemo(
    () => (ctx && summary ? dailySeries(ctx.bank.transactions, summary.month, ctx.bank.today, dayLimitFor(ctx, summary), today) : null),
    [ctx, summary, today],
  )
  if (!series) return null
  const monthLong = monthName(series.month)
  return (
    <DashCard area={area} title="Daily spending" sub={`${monthLong}, day-to-day purchases`}>
      {series.total > 0 ? (
        <>
          <DailyBars series={series} currency={currency} />
          <ul className={chart.key} aria-hidden="true">
            <li><span className={chart.swatch} /> Spent that day</li>
            {series.limit !== null && series.overDays > 0 ? <li><span className={cx(chart.swatch, chart.swatchOver)} /> Above the day limit</li> : null}
            {series.limit !== null ? <li><span className={chart.swatchLine} /> Day limit</li> : null}
          </ul>
        </>
      ) : (
        <p className={styles.empty}>No day-to-day spending in {monthLong} yet. Add a purchase and it shows up here.</p>
      )}
      {series.fixed > 0 ? <p className={styles.footnote}>Rent, bills and subscriptions ({fmtWhole(series.fixed, currency)} so far) count toward the month but are left out of these bars.</p> : null}
    </DashCard>
  )
}

/** The month's spending by category, biggest first. */
export function CategoryCard({ area }: { area: string }) {
  const { summary, today, currency } = useSnapshot(selectCharts, shallowEqual)
  const data = useMemo(() => (summary ? categoryBars(summary) : null), [summary])
  if (!summary || !data) return null
  const monthLong = monthName(summary.month)
  const caps = data.rows.some((r) => r.limit !== undefined)
  return (
    <DashCard area={area} title="Spending by category" sub={monthLong} action={<SeeAll to={href('insights')} label="See all insights">Insights</SeeAll>}>
      {data.rows.length > 0 ? (
        <>
          <CategoryBars data={data} month={summary.month} currency={currency} currentMonth={today.slice(0, 7)} />
          {caps ? (
            <ul className={chart.key} aria-hidden="true">
              <li><span className={chart.swatchCap} /> Your cap for the category</li>
              {data.rows.some((r) => r.overLimit) ? <li><span className={cx(chart.swatch, chart.swatchOver)} /> Past the cap</li> : null}
            </ul>
          ) : null}
        </>
      ) : (
        <p className={styles.empty}>No spending in {monthLong} yet.</p>
      )}
    </DashCard>
  )
}

/** Spent against target for the last six months. */
export function MonthsCard({ area }: { area: string }) {
  const { summary, history, currency, tracking } = useSnapshot(selectCharts, shallowEqual)
  const data = useMemo(() => monthColumns(history, summary, tracking), [history, summary, tracking])
  const n = data.cols.length
  const targets = data.cols.filter((c) => c.target !== null)
  const sameTarget = targets.length === n && n > 0 && targets.every((c) => c.target === targets[0].target)
  return (
    <DashCard area={area} title={n === 1 ? 'This month' : `Last ${n} months`} sub={targets.length > 0 ? 'Spent against target' : 'Spent each month'}>
      {n > 0 && data.cols.some((c) => c.spent > 0) ? (
        <>
          <MonthColumns data={data} currency={currency} />
          <ul className={chart.key} aria-hidden="true">
            <li><span className={chart.swatch} /> Spent</li>
            {data.overCount > 0 ? <li><span className={cx(chart.swatch, chart.swatchOver)} /> Over budget</li> : null}
            {sameTarget && targets[0].target !== null ? (
              <li><span className={chart.swatchLine} /> Target {fmtWhole(targets[0].target, currency)}</li>
            ) : targets.length > 0 ? (
              <li><span className={chart.swatchTick} /> Target</li>
            ) : null}
          </ul>
        </>
      ) : (
        <p className={styles.empty}>No months to compare yet.</p>
      )}
    </DashCard>
  )
}
