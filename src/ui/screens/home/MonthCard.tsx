import { CalendarDays, PiggyBank, TrendingUp } from 'lucide-react'
import { useId, type CSSProperties } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { Badge, Card, Money } from '../../components/ds'
import { shallowEqual, useSnapshot } from '../../state'
import { fmtWhole, monthName, monthTrack, monthTrackSummary, paceLine, safeToSpendNote } from './model'
import styles from './MonthCard.module.css'

const selectMonth = (s: AppSnapshot) => ({
  summary: s.derived.summary,
  currency: s.state.profile?.currency ?? 'CNY',
  tone: s.state.profile?.tone ?? 'gentle',
})

function align(pct: number): 'start' | 'center' | 'end' {
  return pct < 18 ? 'start' : pct > 82 ? 'end' : 'center'
}

/** Spent vs target with today's even pace and the projected month end, then safe-to-spend today. */
export function MonthCard() {
  const { summary: s, currency, tone } = useSnapshot(selectMonth, shallowEqual)
  const headingId = useId()
  if (!s) return null
  const t = monthTrack(s)
  const over = s.spent > s.target
  const overWidth = Math.max(0, t.spentPct - t.withinPct)

  return (
    <Card as="section" padding="lg" className={styles.card} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>{monthName(s.month)} so far</h2>
        <Badge size="sm" icon={<CalendarDays />}>{t.daysLeft === 1 ? '1 day left' : `${t.daysLeft} days left`}</Badge>
      </div>

      <p className={styles.amounts}>
        <Money amount={s.spent} currency={currency} size="xl" decimals={false} tone={over ? 'over' : 'neutral'} />
        <span className={styles.of}>of {fmtWhole(s.target, currency)} target</span>
      </p>

      <div className={styles.track} role="img" aria-label={monthTrackSummary(s, currency)} data-tone={t.tone}>
        <div className={styles.bar}>
          <span className={styles.projected} style={{ width: `${t.projectedPct}%` }} />
          <span className={styles.within} style={{ width: `${t.withinPct}%` }} />
          {overWidth > 0 ? <span className={styles.over} style={{ left: `${t.withinPct}%`, width: `${overWidth}%` }} /> : null}
        </div>
        <span className={styles.marker} data-kind="target" data-align={align(t.targetPct)} style={{ '--at': `${t.targetPct}%` } as CSSProperties}>
          <span className={styles.markerLabel}>Target</span>
        </span>
        <span className={styles.marker} data-kind="pace" data-align={align(t.pacePct)} style={{ '--at': `${t.pacePct}%` } as CSSProperties}>
          <span className={styles.markerLabel}>Even pace today</span>
        </span>
      </div>

      <p className={styles.paceRow} data-tone={t.tone}>
        <span className={styles.paceText} data-ahead={t.aheadOfPace || undefined}>
          <TrendingUp aria-hidden="true" />
          {paceLine(s, currency)}
        </span>
        <span className={styles.projectedText}>
          <span className={styles.swatch} aria-hidden="true" />
          Ends near {fmtWhole(s.projected, currency)}
        </span>
      </p>

      <div className={styles.split}>
        <div className={styles.safe}>
          <p className={styles.label}>Safe to spend today</p>
          <Money amount={s.safeToSpendToday} currency={currency} size="hero" decimals={false} className={styles.safeMoney} />
          <p className={styles.note}>{safeToSpendNote(s, tone, currency)}</p>
        </div>
        <div className={styles.saved}>
          <p className={styles.label}>
            <PiggyBank aria-hidden="true" className={styles.savedIcon} />
            Saved to goals
          </p>
          <Money amount={s.savedToGoals} currency={currency} size="lg" decimals={false} tone={s.savedToGoals > 0 ? 'under' : 'neutral'} signed={s.savedToGoals > 0} />
          <p className={styles.note}>{s.savedToGoals > 0 ? 'this month — nice.' : 'this month, so far'}</p>
        </div>
      </div>
    </Card>
  )
}
