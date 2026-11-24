import { CalendarDays, PiggyBank, TrendingUp } from 'lucide-react'
import type { AppSnapshot } from '../../../core/app-api'
import { Badge, Money, ProgressBar } from '../../components/ds'
import { shallowEqual, useSnapshot } from '../../state'
import { fmtWhole, monthTrack, monthTrackSummary, paceLine } from '../home/model'
import { DashCard } from './DashCard'
import { monthKpis, spentOn } from './model'
import styles from './Dashboard.module.css'

const selectMonth = (s: AppSnapshot) => ({
  summary: s.derived.summary,
  currency: s.state.profile?.currency ?? 'CNY',
  tone: s.state.profile?.tone ?? 'gentle',
  tracking: s.state.profile?.mode === 'tracking',
  // the user's own daily amount for this month (finance/dailyplan), shown instead of "safe to spend"
  plan: s.state.dailyPlan && s.state.dailyPlan.month === s.derived.today.slice(0, 7) ? s.state.dailyPlan.amount : null,
  spentToday: spentOn(s.state.bank.transactions, s.derived.today),
})

/**
 * This month in four numbers: spent, target, what is left over or over budget, and the daily amount. Daily tracking
 * has no target, so it shows the count and today's spending instead (as the Home month card does).
 */
export function MonthPanel({ area }: { area: string }) {
  const { summary: s, currency, tone, tracking, plan, spentToday } = useSnapshot(selectMonth, shallowEqual)
  if (!s) return null
  const k = monthKpis({ summary: s, currency, tone, tracking, plan, spentToday })
  const t = monthTrack(s)
  const daysBadge = tracking ? 'Daily tracking' : k.daysLeft === 1 ? '1 day left' : `${k.daysLeft} days left`

  return (
    <DashCard area={area} title={`${k.monthLong} so far`} action={<Badge size="sm" icon={<CalendarDays />}>{daysBadge}</Badge>}>
      <dl className={styles.kpis}>
        <div className={styles.kpi}>
          <dt>Spent</dt>
          <dd>
            <Money amount={k.spent} currency={currency} size="lg" decimals={false} tone={k.verdict?.kind === 'over' ? 'over' : 'neutral'} />
          </dd>
        </div>
        {k.target !== null ? (
          <div className={styles.kpi}>
            <dt>Target</dt>
            <dd>
              <Money amount={k.target} currency={currency} size="lg" decimals={false} />
            </dd>
          </div>
        ) : null}
        {k.verdict ? (
          <div className={styles.kpi} data-tone={k.verdict.kind}>
            <dt>{k.verdict.label}</dt>
            <dd>
              <Money amount={k.verdict.amount} currency={currency} size="lg" decimals={false} tone={k.verdict.kind === 'over' ? 'over' : 'under'} />
              <span className={styles.kpiNote}>{k.verdict.note}</span>
            </dd>
          </div>
        ) : null}
        <div className={styles.kpi}>
          <dt>{k.daily.label}</dt>
          <dd>
            <Money amount={k.daily.amount} currency={currency} size="lg" decimals={false} />
            <span className={styles.kpiNote}>{k.daily.note}</span>
          </dd>
        </div>
      </dl>

      {k.target !== null ? (
        <>
          <ProgressBar
            value={k.spent}
            max={k.target}
            tone="budget"
            size="md"
            ariaLabel={`${k.monthLong} spending against the target`}
            valueText={monthTrackSummary(s, currency)}
            markers={s.isCurrent ? [{ value: t.paceAmount, label: 'Even pace today' }] : []}
            className={styles.monthBar}
          />
          <p className={styles.monthLine}>
            <span>
              <TrendingUp aria-hidden="true" />
              {paceLine(s, currency)}
            </span>
            {s.isCurrent ? <span>Ends near {fmtWhole(s.projected, currency)}</span> : null}
          </p>
        </>
      ) : null}

      <p className={styles.monthSaved}>
        <PiggyBank aria-hidden="true" />
        <span>
          Saved to goals this month: <strong>{fmtWhole(k.savedToGoals, currency)}</strong>
        </span>
      </p>
    </DashCard>
  )
}
