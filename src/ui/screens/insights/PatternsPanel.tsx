import { ChevronRight, Moon } from 'lucide-react'
import { CATEGORIES } from '../../../core/categories'
import { goalEquivalent } from '../../../core/finance'
import { fmt } from '../../../core/money'
import type { Currency, DreamItem, MonthSummary, Transaction } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { Card, EmptyState, Money, SectionHeader } from '../../components/ds'
import { Heatmap } from './Heatmap'
import { heatmap, monthName, topMerchants, type Heatmap as HeatmapData, type MerchantRow } from './model'
import styles from './panels.module.css'

function LateNight({ map, monthLong, currency, dreams }: { map: HeatmapData; monthLong: string; currency: Currency; dreams: DreamItem[] }) {
  const late = map.late
  if (late.count === 0) {
    return (
      <div className={styles.lateCalm}>
        <BunMascot mood="sleepy" size={56} animated />
        <p>
          <strong>No late-night spending in {monthLong}.</strong> Bun slept soundly.
        </p>
      </div>
    )
  }
  const dream = goalEquivalent(late.amount, dreams)
  return (
    <div className={styles.late}>
      <span className={styles.lateIcon} aria-hidden="true">
        <Moon />
      </span>
      <div className={styles.lateText}>
        <p className={styles.lateLabel}>After 10pm in {monthLong}</p>
        <p className={styles.lateFigure}>
          <Money amount={late.amount} currency={currency} size="lg" decimals={false} />
          <span className={styles.lateCount}>
            {late.count} {late.count === 1 ? 'purchase' : 'purchases'}
            {late.delivery ? ` · ${late.delivery} food delivery` : ''}
          </span>
        </p>
        {map.lateScheduled.count ? (
          <p className={styles.lateNote}>
            Plus {map.lateScheduled.count} {map.lateScheduled.count === 1 ? 'subscription that renews' : 'subscriptions that renew'} after midnight ({fmt(map.lateScheduled.amount, currency)}) — scheduled, not a habit.
          </p>
        ) : null}
        {dream ? (
          <p className={styles.lateDream}>
            <DreamImage image={dream.image} alt="" size={24} />
            <span>= {dream.label}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

function MerchantList({ rows, currency, onPick }: { rows: MerchantRow[]; currency: Currency; onPick: (merchant: string) => void }) {
  const top = rows[0]?.amount ?? 1
  return (
    <ol className={styles.merchants}>
      {rows.map((r, i) => (
        <li key={r.merchant}>
          <button
            type="button"
            className={styles.merchant}
            onClick={() => onPick(r.merchant)}
            aria-label={`${r.merchant}: ${fmt(r.amount, currency)}, ${r.count} ${r.count === 1 ? 'purchase' : 'purchases'}, ${r.share}% of spending${r.late ? `, ${r.late} late at night` : ''}. Show transactions`}
          >
            <span className={styles.rank} aria-hidden="true">{i + 1}</span>
            <span className={styles.merchantEmoji} aria-hidden="true">{CATEGORIES[r.category].emoji}</span>
            <span className={styles.merchantMain}>
              <span className={styles.merchantName}>{r.merchant}</span>
              <span className={styles.merchantMeta}>
                {r.count} {r.count === 1 ? 'purchase' : 'purchases'}
                {r.late ? (
                  <>
                    {' · '}
                    <span className={styles.lateTag}>
                      <Moon aria-hidden="true" />
                      {r.late} late
                    </span>
                  </>
                ) : null}
              </span>
              <span className={styles.shareTrack} aria-hidden="true">
                <span className={styles.shareFill} style={{ width: `${Math.max(3, (r.amount / top) * 100)}%`, animationDelay: `${i * 70}ms` }} />
              </span>
            </span>
            <span className={styles.merchantAmount}>
              <Money amount={r.amount} currency={currency} size="md" decimals={false} />
              <span className={styles.merchantShare}>{r.share}%</span>
            </span>
            <ChevronRight aria-hidden="true" className={styles.chev} />
          </button>
        </li>
      ))}
    </ol>
  )
}

export interface PatternsPanelProps {
  s: MonthSummary
  txns: Transaction[]
  dreams: DreamItem[]
  currency: Currency
  onPickMerchant: (merchant: string) => void
}

/** Habits: when the money goes (the time-of-day heatmap with the late-night band) and where (top merchants). */
export function PatternsPanel({ s, txns, dreams, currency, onPickMerchant }: PatternsPanelProps) {
  const monthLong = monthName(s.month)
  const map = heatmap(txns, s.month)
  const merchants = topMerchants(txns, s.month, s.spent, 5)
  return (
    <div className={styles.panel}>
      <section className={styles.section} aria-labelledby="ins-when">
        <SectionHeader id="ins-when" eyebrow="Day-to-day purchases, by hour" title="When you spend" />
        <Card padding="lg" className={styles.chartCard}>
          {map.count ? (
            <>
              <LateNight map={map} monthLong={monthLong} currency={currency} dreams={dreams} />
              <Heatmap map={map} monthLong={monthLong} currency={currency} />
              <p className={styles.footnote}>Rent, bills and subscriptions are left out: they run on a schedule, not a habit.</p>
            </>
          ) : (
            <EmptyState compact mood="sleepy" title="No timed purchases" body={`Nothing day-to-day with a time stamp in ${monthLong}.`} />
          )}
        </Card>
      </section>

      <section className={styles.section} aria-labelledby="ins-where">
        <SectionHeader id="ins-where" eyebrow="Rent and bills left out" title="Top places" />
        {merchants.length ? (
          <Card padding="none" className={styles.listCard}>
            <MerchantList rows={merchants} currency={currency} onPick={onPickMerchant} />
          </Card>
        ) : (
          <Card>
            <EmptyState compact mood="calm" title="No day-to-day spending" body={`Nothing to rank in ${monthLong}.`} />
          </Card>
        )}
      </section>
    </div>
  )
}
