import { ArrowDownRight, Repeat, Sparkles } from 'lucide-react'
import { monthLabel, ym } from '../../../core/dates'
import { fmt } from '../../../core/money'
import type { Bill, BillFinding, Currency, DreamItem, ISODate, RecurringSeries, Tone } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { Money } from '../../components/ds'
import { dueThisMonth, heroLine, moodFor, relativeDay, severityCounts, subscriptionDream, subscriptionTotals, subsSummary } from './billsView'
import type { SectionKey } from './jump'
import styles from './BillsScreen.module.css'

export interface BillsHeroProps {
  currency: Currency
  tone: Tone
  today: ISODate
  bills: Bill[]
  findings: BillFinding[]
  recurring: RecurringSeries[]
  dreams: DreamItem[]
  onJump: (key: SectionKey) => void
}

/** Summary header: still to pay this month, subscriptions per year (in dream items) and what Bun found. */
export function BillsHero({ currency, tone, today, bills, findings, recurring, dreams, onJump }: BillsHeroProps) {
  const month = monthLabel(ym(today)).split(' ')[0]
  const due = dueThisMonth(bills, today)
  const subs = subscriptionTotals(recurring)
  const dream = subscriptionDream(subs.annual, dreams)
  const counts = severityCounts(findings)
  const toCheck = counts.alert + counts.warn

  return (
    <section className={styles.hero} aria-labelledby="bills-hero-title">
      <span className={styles.heroGlow} aria-hidden="true" />
      <div className={styles.heroTop}>
        <div className={styles.heroText}>
          <h2 id="bills-hero-title" className={styles.eyebrow}>
            {due.count > 0 ? `Still to pay in ${month}` : bills.length === 0 ? `Bills in ${month}` : `${month} is all paid`}
          </h2>
          <Money amount={due.total} currency={currency} size="hero" tone={due.count > 0 ? 'neutral' : 'under'} />
          <p className={styles.heroMeta}>
            {due.count > 0
              ? `${due.count} ${due.count === 1 ? 'bill' : 'bills'}${due.next ? ` · next one ${relativeDay(due.next.dueDate, today).toLowerCase()}` : ''}`
              : bills.length === 0
                ? 'No bills yet — paste one into the X-ray below'
                : 'Nothing else due this month'}
          </p>
        </div>
        <BunMascot mood={moodFor(findings)} size={84} className={styles.heroBun} />
      </div>

      <p className={styles.heroSay}>{heroLine(tone, findings)}</p>

      <div className={styles.tiles}>
        <button type="button" className={styles.tile} onClick={() => onJump('subscriptions')}>
          <span className={styles.tileLabel}>
            <Repeat aria-hidden="true" />
            Subscriptions
          </span>
          <span className={styles.tileValue}>
            <Money amount={subs.annual} currency={currency} size="lg" />
            <span className={styles.per}>a year</span>
          </span>
          <span className={styles.tileMeta}>{subs.activeCount > 0 ? `${subs.activeCount} active · ${fmt(subs.monthly, currency)}/mo` : subsSummary(subs, currency)}</span>
          <ArrowDownRight className={styles.tileGo} aria-hidden="true" />
        </button>
        <button type="button" className={styles.tile} onClick={() => onJump('findings')}>
          <span className={styles.tileLabel}>
            <Sparkles aria-hidden="true" />
            Bun found
          </span>
          <span className={styles.tileValue}>
            <span className={styles.count}>{toCheck}</span>
            <span className={styles.per}>to check</span>
          </span>
          <span className={styles.tileMeta}>
            {toCheck === 0 ? (
              findings.length > 0 ? `All calm · ${findings.length} FYI` : 'All calm'
            ) : (
              <>
                {counts.alert > 0 ? (
                  <span className={styles.sev} data-tone="over">
                    {counts.alert} urgent
                  </span>
                ) : null}
                {counts.warn > 0 ? (
                  <span className={styles.sev} data-tone="warn">
                    {counts.warn} worth a look
                  </span>
                ) : null}
              </>
            )}
          </span>
          <ArrowDownRight className={styles.tileGo} aria-hidden="true" />
        </button>
      </div>

      {dream ? (
        <div className={styles.dreamStrip}>
          <DreamImage image={dream.image} alt="" size={52} glow className={styles.dreamImg} />
          <p className={styles.dreamText}>
            <span className={styles.dreamCap}>Every year, your subscriptions cost</span>
            <strong>{dream.label}</strong>
          </p>
        </div>
      ) : null}
    </section>
  )
}
