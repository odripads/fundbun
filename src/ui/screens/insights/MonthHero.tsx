import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Target } from 'lucide-react'
import { useId } from 'react'
import { fmt } from '../../../core/money'
import type { Currency, MonthSummary, Tone } from '../../../core/types'
import { BunMascot } from '../../components/brand'
import { Money, cx } from '../../components/ds'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { dailyStat, headlineCopy, meter, monthName, moodFor, statusOf, vsPrevStat, vsTargetStat, type Comparison, type StatView } from './model'
import { useCountUp } from './useCountUp'
import styles from './MonthHero.module.css'

export interface MonthHeroProps {
  s: MonthSummary
  comparison: Comparison | null
  tone: Tone
  currency: Currency
}

const ARROW = { up: <ArrowUpRight />, down: <ArrowDownRight />, flat: <ArrowRight /> }

function StatTile({ stat, currency, delay }: { stat: StatView; currency: Currency; delay: number }) {
  const tone = stat.good === undefined ? 'flat' : stat.good ? 'good' : 'bad'
  return (
    <div className={styles.tile} style={{ animationDelay: `${delay}ms` }}>
      <dt className={styles.tileLabel}>{stat.label}</dt>
      <dd className={styles.tileValue}>
        <Money amount={stat.amount} currency={currency} decimals={false} size="lg" className={styles.tileMoney} />
      </dd>
      <dd className={cx(styles.tileNote, styles[tone])}>
        {stat.good !== undefined ? <span className={styles.tileArrow} aria-hidden="true">{ARROW[stat.direction]}</span> : null}
        <span>{stat.note}</span>
      </dd>
    </div>
  )
}

/**
 * The month at a glance: the spend in big Fraunces numerals, a meter on one honest scale (target tick,
 * over-target hatch, the pace ghost for the current month), Bun's mood, and three headline stats.
 */
export function MonthHero({ s, comparison, tone, currency }: MonthHeroProps) {
  const headingId = useId()
  const reduced = useReducedMotion()
  const shown = useCountUp(s.spent, !reduced)
  const status = statusOf(s)
  const m = meter(s)
  const monthLong = monthName(s.month)
  const vsTarget = vsTargetStat(s)
  const vsPrev = vsPrevStat(comparison)
  const daily = dailyStat(s)
  const projected = s.isCurrent && s.projected > s.spent ? s.projected : null
  const overBy = Math.max(0, s.spent - s.target)
  const meterLabel = `${fmt(s.spent, currency)} spent of a ${fmt(s.target, currency)} target${overBy > 0 ? `, ${fmt(overBy, currency)} over` : ''}${projected ? `; heading for about ${fmt(projected, currency)} by month-end` : ''}.`

  return (
    <section className={styles.hero} data-status={status} aria-labelledby={headingId}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={cx(styles.orb, styles.orbA)} />
        <span className={cx(styles.orb, styles.orbB)} />
      </div>

      <div className={styles.top}>
        <div className={styles.figure}>
          <h2 id={headingId} className={styles.eyebrow}>
            <CalendarDays aria-hidden="true" />
            {s.isCurrent ? `${monthLong} · day ${s.dayOfMonth} of ${s.daysInMonth}` : `${monthLong} · final`}
          </h2>
          <p className={styles.big}>
            <span aria-hidden="true">
              <Money amount={shown} currency={currency} size="hero" decimals={false} tone={status === 'over' ? 'over' : 'neutral'} />
            </span>
            <span className="sr-only">{fmt(s.spent, currency)} spent</span>
          </p>
          <p className={styles.of}>
            spent of your <strong>{fmt(s.target, currency)}</strong> target
          </p>
        </div>
        <div className={styles.bun}>
          <span className={styles.bunGlow} aria-hidden="true" />
          <BunMascot mood={moodFor(status, tone)} size={84} animated />
        </div>
      </div>

      <div className={styles.meter} role="img" aria-label={meterLabel}>
        <div className={styles.track} key={s.month}>
          <span className={styles.fill} style={{ width: `${m.withinPct}%` }} />
          {m.over ? <span className={styles.overFill} style={{ left: `${m.targetPct}%`, width: `${Math.max(0, m.spentPct - m.targetPct)}%` }} /> : null}
          {projected ? <span className={styles.pace} style={{ left: `${m.spentPct}%`, width: `${Math.max(0, m.projectedPct - m.spentPct)}%` }} /> : null}
          <span className={styles.tick} style={{ left: `${m.targetPct}%` }} />
        </div>
        <div className={styles.meterKey} aria-hidden="true">
          <span className={styles.keyItem}>
            <Target />
            Target {fmt(s.target, currency, { decimals: false })}
          </span>
          {projected ? (
            <span className={cx(styles.keyItem, styles.keyPace)}>
              <span className={styles.paceSwatch} />
              Heading for {fmt(Math.round(projected / 100) * 100, currency)}
            </span>
          ) : overBy > 0 ? (
            <span className={cx(styles.keyItem, styles.keyOver)}>
              <span className={styles.overSwatch} />
              Over by {fmt(overBy, currency, { decimals: false })}
            </span>
          ) : null}
        </div>
      </div>

      <p className={styles.headline}>{headlineCopy(s, tone, currency)}</p>

      <dl className={styles.stats}>
        <StatTile stat={vsTarget} currency={currency} delay={0} />
        {vsPrev ? <StatTile stat={vsPrev} currency={currency} delay={60} /> : null}
        <StatTile stat={daily} currency={currency} delay={120} />
      </dl>
    </section>
  )
}
