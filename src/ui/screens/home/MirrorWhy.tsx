import { Settings2 } from 'lucide-react'
import type { AppSnapshot } from '../../../core/app-api'
import { Money } from '../../components/ds'
import { href } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { TONE_LABEL, delayReason, hoursReason, itemReason, statusRule } from './model'
import styles from './MirrorWhy.module.css'

const selectWhy = (s: AppSnapshot) => ({
  mirror: s.derived.mirror,
  currency: s.state.profile?.currency ?? 'CNY',
  income: s.state.profile?.monthlyIncome ?? 0,
  workHours: s.state.profile?.workHoursPerMonth ?? 174,
  dayOfMonth: s.derived.summary?.dayOfMonth ?? 0,
  daysInMonth: s.derived.summary?.daysInMonth ?? 0,
})

/** The body of the "Why am I seeing this?" sheet: the four numbers, then the rule behind each part of the mirror. */
export function MirrorWhy() {
  const { mirror, currency, income, workHours, dayOfMonth, daysInMonth } = useSnapshot(selectWhy, shallowEqual)
  if (!mirror) return null
  const over = mirror.status === 'over' || mirror.status === 'pace_over'
  const deltaLabel = mirror.status === 'over' ? 'Over target' : mirror.status === 'pace_over' ? 'Projected over' : mirror.status === 'under' ? 'Projected under' : 'Difference'
  const reasons = [
    { title: 'The rule', text: statusRule(mirror.status) },
    { title: 'Why this dream', text: itemReason(mirror, currency) },
    { title: 'Hours of work', text: hoursReason(mirror, income, workHours, currency) },
    { title: 'Goal delay', text: delayReason(mirror, currency) },
  ].filter((r): r is { title: string; text: string } => Boolean(r.text))

  return (
    <div className={styles.root}>
      <dl className={styles.numbers}>
        <div className={styles.cell}>
          <dt>Spent so far</dt>
          <dd><Money amount={mirror.spent} currency={currency} size="lg" decimals={false} /></dd>
          {daysInMonth ? <span className={styles.sub}>day {dayOfMonth} of {daysInMonth}</span> : null}
        </div>
        <div className={styles.cell}>
          <dt>Your target</dt>
          <dd><Money amount={mirror.target} currency={currency} size="lg" decimals={false} /></dd>
          <span className={styles.sub}>you set it</span>
        </div>
        <div className={styles.cell}>
          <dt>Projected month end</dt>
          <dd><Money amount={mirror.projected} currency={currency} size="lg" decimals={false} /></dd>
          <span className={styles.sub}>pace + bills still due</span>
        </div>
        <div className={styles.cell} data-tone={over ? 'over' : mirror.status === 'under' ? 'under' : undefined}>
          <dt>{deltaLabel}</dt>
          <dd><Money amount={mirror.delta} currency={currency} size="lg" decimals={false} tone={over ? 'over' : mirror.status === 'under' ? 'under' : 'neutral'} /></dd>
          <span className={styles.sub}>{over ? 'what the mirror shows' : 'yours to keep'}</span>
        </div>
      </dl>

      <ol className={styles.reasons}>
        {reasons.map((r) => (
          <li key={r.title}>
            <p className={styles.reasonTitle}>{r.title}</p>
            <p className={styles.reasonText}>{r.text}</p>
          </li>
        ))}
      </ol>

      <p className={styles.tone}>
        Written in your <strong>{TONE_LABEL[mirror.tone]}</strong> voice.{' '}
        <a href={href('settings', [], { s: 'profile' })} className={styles.link}>
          <Settings2 aria-hidden="true" />
          Change it in Settings
        </a>
      </p>
    </div>
  )
}
