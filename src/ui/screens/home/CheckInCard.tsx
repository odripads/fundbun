import { Check, Flame, Plus, Sparkles } from 'lucide-react'
import { useId } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CHECKIN_CARD_DAYS } from '../../../core/finance/checkin'
import { plural } from '../../../core/finance/copy'
import { fmtCopy } from '../../../core/money'
import { BunMascot } from '../../components/brand'
import { Button, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import styles from './CheckInCard.module.css'

const selectCheckIn = (s: AppSnapshot) => ({
  view: s.derived.checkIn,
  // over budget, "safe to spend" is zero: the user's own daily amount says more
  plan: s.state.dailyPlan && s.state.dailyPlan.month === s.derived.today.slice(0, 7) ? s.state.dailyPlan.amount : null,
  over: s.derived.mirror?.status === 'over' || s.derived.mirror?.status === 'pace_over',
  // today's number is only meaningful while the mirror looks at the current month
  safe: s.derived.viewDate === s.derived.today ? (s.derived.summary?.safeToSpendToday ?? null) : null,
  currency: s.state.profile?.currency ?? ('CNY' as const),
})

export interface CheckInCardProps {
  /** "Add spending first": open the quick-add sheet (logging a purchase checks in by itself) */
  onAddSpending: () => void
  /** open the daily-amount sheet */
  onPlan?: () => void
}

/**
 * The daily check-in: a seven-day stamp card, a streak, and today's number. Showing up every day is the habit that
 * keeps spending in mind, so it earns a stamp, and a golden bun on every seventh day in a row. Checking in says
 * "nothing else to log today", which makes the day count for Bun's temper too (core/finance/checkin).
 */
export function CheckInCard({ onAddSpending, onPlan }: CheckInCardProps) {
  const app = useApp()
  const toast = useToast()
  const headingId = useId()
  const { view, safe, currency, plan, over } = useSnapshot(selectCheckIn, shallowEqual)
  const toGolden = CHECKIN_CARD_DAYS - (((view.done ? view.streak : view.next) - 1) % CHECKIN_CARD_DAYS) - 1

  function checkIn() {
    const r = app.checkIn()
    if (!r.ok) return
    if (r.earned) toast.show({ tone: 'success', title: 'Golden bun!', message: `${plural(r.streak, 'day')} in a row. That is a full card.` })
  }

  const number =
    plan !== null ? `Your daily amount: ${fmtCopy(plan, currency)}.`
    : safe === null ? null
    : safe > 0 ? `${fmtCopy(safe, currency)} is safe to spend today.`
    : null
  return (
    <section className={styles.card} data-done={view.done || undefined} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>Daily check-in</h2>
        <span className={styles.streak} data-on={view.streak > 0 || undefined}>
          <Flame aria-hidden="true" />
          {view.streak > 0 ? `${view.streak}-day streak` : 'No streak yet'}
        </span>
      </div>

      <ol className={styles.slots} aria-label={`Check-in card: day ${view.done ? ((view.streak - 1) % CHECKIN_CARD_DAYS) + 1 : ((view.next - 1) % CHECKIN_CARD_DAYS) + 1} of ${CHECKIN_CARD_DAYS}`}>
        {view.card.map((slot) => (
          <li key={slot.day} className={styles.slot} data-state={slot.state} data-golden={slot.golden || undefined}>
            <span className={styles.stamp} aria-hidden="true">
              {slot.state === 'stamped' ? <BunMascot mood="happy" size={30} animated={false} /> : slot.golden ? <Sparkles /> : slot.state === 'today' ? <Check /> : slot.day}
            </span>
            <span className={styles.day}>{slot.state === 'today' ? 'Today' : slot.golden ? 'Golden' : `Day ${slot.day}`}</span>
            <span className="sr-only">{slot.state === 'stamped' ? ', checked in' : slot.state === 'today' ? ', open' : ''}</span>
          </li>
        ))}
      </ol>

      {over && plan === null && onPlan ? (
        <button type="button" className={styles.planLink} onClick={onPlan}>
          Over budget? Set a daily amount you can live with
        </button>
      ) : null}

      {view.done ? (
        <p className={styles.note} role="status">
          <strong>Checked in.</strong> {plural(view.streak, 'day')} in a row{view.golden > 0 ? `, ${plural(view.golden, 'golden bun')} so far` : ''}.{' '}
          {toGolden > 0 ? `${plural(toGolden, 'more day')} to a golden bun.` : 'A new card starts tomorrow.'}
          {number ? ` ${number}` : ''}
        </p>
      ) : (
        <>
          <p className={styles.note}>
            {number ? `${number} ` : ''}
            Nothing else to log today? {view.streak > 0 ? `Check in to keep your ${view.streak}-day streak.` : 'Check in, and a streak starts.'}
          </p>
          <div className={styles.actions}>
            <Button size="md" iconStart={<Check />} onClick={checkIn} className={styles.grow}>
              Check in
            </Button>
            <Button size="md" variant="secondary" iconStart={<Plus />} onClick={onAddSpending} className={styles.grow} aria-label="Add spending first (it checks in for you)">
              Add spending
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
