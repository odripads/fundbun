import { CircleCheck, Layers, Sparkles, TrendingUp } from 'lucide-react'
import { dateLabel } from '../../../core/dates'
import { fmt } from '../../../core/money'
import type { Currency, PendingAction, RecurringSeries, Tone } from '../../../core/types'
import { Badge, EmptyState, Money } from '../../components/ds'
import { PinHint, ProposeButton, type ActionRunner } from './actions'
import { CADENCE_LABEL, CADENCE_SUFFIX, cancelAction, isActiveSub, savedLine, subscriptionGroups, subscriptionTotals, subsSummary, type SubscriptionGroup } from './billsView'
import { NICHE_ICON } from './icons'
import { subscriptionNiche } from '../../../core/finance/categorize'
import { BillsSection } from './Section'
import shared from './sections.module.css'
import styles from './subscriptions.module.css'

export interface SubscriptionsSectionProps {
  currency: Currency
  tone: Tone
  recurring: RecurringSeries[]
  awaiting: PendingAction[]
  runner: ActionRunner
}

/** Every subscription Bun detected: overlapping services grouped, price changes flagged, Cancel via the policy gate. */
export function SubscriptionsSection({ currency, tone, recurring, awaiting, runner }: SubscriptionsSectionProps) {
  const { overlaps, rest } = subscriptionGroups(recurring)
  const totals = subscriptionTotals(recurring)
  const hasAny = overlaps.length > 0 || rest.length > 0

  return (
    <BillsSection
      section="subscriptions"
      eyebrow="Recurring"
      title="Subscriptions"
      aside={
        totals.activeCount > 0 ? (
          <span className={shared.asideMoney}>
            <Money amount={totals.annual} currency={currency} size="md" />
            <span className={shared.asideLabel}>a year</span>
          </span>
        ) : undefined
      }
      lead={
        hasAny ? (
          <>
            <span>{subsSummary(totals, currency)}</span>
            <PinHint tool="cancel_subscription">Cancelling needs your PIN</PinHint>
          </>
        ) : undefined
      }
    >
      {totals.saved > 0 ? (
        <p className={styles.saved} role="status">
          <Sparkles aria-hidden="true" />
          <span>{savedLine(tone, totals.saved, totals.cancelled.map((s) => s.merchant), currency)}</span>
        </p>
      ) : null}

      {!hasAny ? (
        <div className={styles.empty}>
          <EmptyState compact mood="happy" title="No subscriptions spotted" body="When Bun sees the same charge come back every month, it shows up here." />
        </div>
      ) : null}

      {overlaps.map((g) => (
        <OverlapGroup key={g.key} group={g} currency={currency} awaiting={awaiting} runner={runner} />
      ))}

      {rest.length > 0 ? (
        <section className={styles.group} aria-labelledby="subs-rest-title">
          <div className={styles.groupHead}>
            <div className={styles.groupText}>
              <h3 id="subs-rest-title" className={styles.groupTitle}>
                {overlaps.length > 0 ? 'Everything else' : 'Your subscriptions'}
              </h3>
            </div>
          </div>
          <ul className={styles.rows}>
            {rest.map((s) => (
              <SubRow key={s.id} series={s} currency={currency} awaiting={awaiting} runner={runner} />
            ))}
          </ul>
        </section>
      ) : null}
    </BillsSection>
  )
}

function OverlapGroup({ group, currency, awaiting, runner }: { group: SubscriptionGroup; currency: Currency; awaiting: PendingAction[]; runner: ActionRunner }) {
  const titleId = `subs-${group.key}-title`
  const active = group.items.filter(isActiveSub).length
  return (
    <section className={styles.group} data-overlap={group.overlap || undefined} aria-labelledby={titleId}>
      <div className={styles.groupHead}>
        <span className={styles.groupIcon} aria-hidden="true">
          {NICHE_ICON[group.key]}
        </span>
        <div className={styles.groupText}>
          <h3 id={titleId} className={styles.groupTitle}>
            {group.label}
          </h3>
          <p className={styles.groupMeta}>
            {group.overlap
              ? `${active} services doing one job · ${fmt(group.monthly, currency)} a month together`
              : `Down to ${active} ${active === 1 ? 'service' : 'services'} · ${fmt(group.monthly, currency)} a month`}
          </p>
        </div>
        {group.overlap ? (
          <Badge size="sm" variant="warn" icon={<Layers />}>
            Overlap
          </Badge>
        ) : (
          <Badge size="sm" variant="under" icon={<CircleCheck />}>
            Sorted
          </Badge>
        )}
      </div>
      <ul className={styles.rows}>
        {group.items.map((s) => (
          <SubRow key={s.id} series={s} currency={currency} awaiting={awaiting} runner={runner} grouped />
        ))}
      </ul>
    </section>
  )
}

function SubRow({ series, currency, awaiting, runner, grouped = false }: { series: RecurringSeries; currency: Currency; awaiting: PendingAction[]; runner: ActionRunner; grouped?: boolean }) {
  const active = isActiveSub(series)
  const hike = series.priceChange && series.priceChange.to > series.priceChange.from ? series.priceChange : undefined
  const niche = subscriptionNiche(series.merchant) ?? 'other'
  return (
    <li className={styles.row} data-status={series.status}>
      <span className={styles.rowIcon} data-grouped={grouped || undefined} aria-hidden="true">
        {grouped ? series.merchant.charAt(0).toUpperCase() : NICHE_ICON[niche]}
      </span>
      <div className={styles.rowMain}>
        <p className={styles.rowName}>{series.merchant}</p>
        <p className={styles.rowMeta}>
          {active ? (
            <span>
              {CADENCE_LABEL[series.cadence]} · {fmt(series.annualCost, currency)} a year
            </span>
          ) : series.status === 'cancelled' ? (
            <span className={styles.kept}>Keeping {fmt(series.annualCost, currency)} a year</span>
          ) : (
            <span>Cancellation on its way</span>
          )}
        </p>
        {hike && active ? (
          <Badge size="sm" variant="warn" icon={<TrendingUp />} className={styles.hike} title={`Price went up on ${dateLabel(hike.date)}`}>
            {fmt(hike.from, currency)} → {fmt(hike.to, currency)} since {dateLabel(hike.date)}
          </Badge>
        ) : null}
      </div>
      <div className={styles.rowEnd}>
        <span className={styles.price}>
          <Money amount={series.lastAmount} currency={currency} size="md" strike={series.status === 'cancelled'} tone={active ? 'neutral' : 'muted'} />
          <span className={styles.per}>{CADENCE_SUFFIX[series.cadence]}</span>
        </span>
        {active ? (
          <ProposeButton
            action={cancelAction(series)}
            awaiting={awaiting}
            run={runner.run}
            busy={runner.busy}
            variant="secondary"
            size="sm"
            label="Cancel"
            ariaLabel={`Cancel ${series.merchant}`}
            className={styles.cancel}
          />
        ) : series.status === 'cancelled' ? (
          <Badge size="sm" variant="under" icon={<CircleCheck />}>
            Cancelled
          </Badge>
        ) : (
          <Badge size="sm" variant="info">
            Cancelling
          </Badge>
        )}
      </div>
    </li>
  )
}
