import { CalendarDays, ChartPie, MessageSquareQuote, Moon, Receipt, Repeat, TrendingUp, Wallet } from 'lucide-react'
import { dateLabel, monthLabel } from '../../../../core/dates'
import { fmt } from '../../../../core/money'
import type { BudgetPlan, Cadence, Transaction, TxnFlag } from '../../../../core/types'
import { AiBadge, Badge, BarChart, Card, CardHeader, List, ListItem, Money, ProgressBar } from '../../ds'
import { CategoryAvatar, categoryMeta, useCurrency, useMore, type CardProps } from './shared'
import styles from './cards.module.css'

// ───────────────────────────── breakdown ─────────────────────────────

export function BreakdownCard({ card }: CardProps<'breakdown'>) {
  const currency = useCurrency()
  const items = [...card.items].filter((i) => i.spent > 0).sort((a, b) => b.spent - a.spent)
  const { shown, toggle } = useMore(items, 6)
  const over = card.total - card.target
  return (
    <Card as="section">
      <CardHeader title={`Where ${monthLabel(card.month, 'long').split(' ')[0]} went`} subtitle={`${items.length} categories`} icon={<ChartPie />} />
      <div className={styles.totalRow}>
        <Money amount={card.total} currency={currency} size="lg" />
        <span className={styles.totalOf}>of {fmt(card.target, currency)} target</span>
        {card.target > 0 ? (
          <Badge size="sm" variant={over > 0 ? 'over' : 'under'} className={styles.push}>
            {over > 0 ? `${fmt(over, currency)} over` : `${fmt(-over, currency)} left`}
          </Badge>
        ) : null}
      </div>
      <ProgressBar value={card.total} max={card.target} tone="budget" size="sm" ariaLabel="Month spending against target" className={styles.gapBelow} />
      <BarChart
        label={`${monthLabel(card.month)} spending by category against limits`}
        currency={currency}
        data={shown.map((i) => ({ id: i.category, label: categoryMeta(i.category).label, value: i.spent, limit: i.limit, icon: categoryMeta(i.category).emoji }))}
      />
      {toggle}
    </Card>
  )
}

// ───────────────────────────── transactions ─────────────────────────────

const FLAG_LABEL: Partial<Record<TxnFlag, string>> = {
  duplicate_suspect: 'Possible duplicate',
  late_night: 'Late night',
  price_hike: 'Price went up',
  anomaly: 'Unusual',
  disputed: 'Disputed',
  refund: 'Refund',
  reversed: 'Reversed',
}

function txnWhen(t: Transaction): string {
  return `${dateLabel(t.date)}${t.time ? ` · ${t.time}` : ''}`
}

export function TransactionsCard({ card }: CardProps<'transactions'>) {
  const currency = useCurrency()
  const { shown, toggle } = useMore(card.txns, 5)
  const out = card.txns.reduce((sum, t) => sum + (t.amount < 0 ? -t.amount : 0), 0)
  return (
    <Card as="section" padding="none" className={styles.listCard}>
      <CardHeader title={card.title} subtitle={`${card.txns.length} shown${out ? ` · ${fmt(out, currency)} out` : ''}`} icon={<Receipt />} className={styles.listHeader} />
      <List>
        {shown.map((t) => {
          const flags = (t.flags ?? []).filter((f) => FLAG_LABEL[f])
          return (
            <ListItem
              key={t.id}
              leading={<CategoryAvatar category={t.category} />}
              title={t.merchant}
              subtitle={
                <>
                  <span>{categoryMeta(t.category).label}</span>
                  {flags.length ? (
                    <span className={styles.flags}>
                      {flags.map((f) => (
                        <Badge key={f} size="sm" variant={f === 'duplicate_suspect' || f === 'anomaly' ? 'over' : 'neutral'} icon={f === 'late_night' ? <Moon /> : undefined}>
                          {FLAG_LABEL[f]}
                        </Badge>
                      ))}
                    </span>
                  ) : null}
                  {t.memo ? (
                    // memos come from the counterparty: untrusted, shown as plain text and never acted on
                    <span className={styles.memo}>
                      <MessageSquareQuote aria-hidden="true" />
                      <span className="sr-only">Note from the merchant (not checked): </span>
                      <span className={styles.memoText}>{t.memo}</span>
                    </span>
                  ) : null}
                </>
              }
              trailing={<Money amount={t.amount} currency={currency} size="sm" signed tone="gain" />}
              meta={txnWhen(t)}
            />
          )
        })}
      </List>
      {toggle ? <div className={styles.listFooter}>{toggle}</div> : null}
    </Card>
  )
}

// ───────────────────────────── recurring ─────────────────────────────

const CADENCE: Record<Cadence, string> = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }
const PER: Record<Cadence, string> = { weekly: '/wk', monthly: '/mo', quarterly: '/qtr', yearly: '/yr' }

export function RecurringCard({ card }: CardProps<'recurring'>) {
  const currency = useCurrency()
  const active = card.series.filter((s) => s.status !== 'cancelled')
  const yearly = active.reduce((sum, s) => sum + s.annualCost, 0)
  const sorted = [...card.series].sort((a, b) => b.annualCost - a.annualCost)
  const { shown, toggle } = useMore(sorted, 5)
  return (
    <Card as="section" padding="none" className={styles.listCard}>
      <CardHeader title="Subscriptions & regulars" subtitle={`${active.length} active · ${fmt(yearly, currency)} a year`} icon={<Repeat />} className={styles.listHeader} />
      <List>
        {shown.map((s) => (
          <ListItem
            key={s.id}
            leading={<CategoryAvatar category={s.category} />}
            title={s.merchant}
            subtitle={
              <>
                <span>{CADENCE[s.cadence]} · next {dateLabel(s.nextExpected)}</span>
                {s.priceChange ? (
                  <span className={styles.flags}>
                    <Badge size="sm" variant="warn" icon={<TrendingUp />}>
                      {fmt(s.priceChange.from, currency)} → {fmt(s.priceChange.to, currency)}
                    </Badge>
                  </span>
                ) : null}
                {s.status !== 'active' ? (
                  <span className={styles.flags}>
                    <Badge size="sm" variant="neutral">{s.status === 'cancelled' ? 'Cancelled' : 'Cancelling'}</Badge>
                  </span>
                ) : null}
              </>
            }
            trailing={
              <span className={styles.perRow}>
                <Money amount={s.lastAmount} currency={currency} size="sm" strike={s.status === 'cancelled'} />
                <span className={styles.per}>{PER[s.cadence]}</span>
              </span>
            }
            meta={`${fmt(s.annualCost, currency)} a year`}
          />
        ))}
      </List>
      {toggle ? <div className={styles.listFooter}>{toggle}</div> : null}
    </Card>
  )
}

// ───────────────────────────── budget plan ─────────────────────────────

const METHOD: Record<BudgetPlan['method'], string> = {
  fifty_thirty_twenty: '50/30/20 rule',
  history: 'From your last few months',
  custom: 'Custom',
}

export function BudgetCard({ card }: CardProps<'budget'>) {
  const currency = useCurrency()
  const plan = card.plan
  const rows = [...plan.categories].sort((a, b) => b.limit - a.limit)
  const { shown, toggle } = useMore(rows, 6)
  const max = Math.max(1, ...rows.map((r) => r.limit))
  return (
    <Card as="section">
      <CardHeader
        title={`Budget · ${monthLabel(plan.month, 'long').split(' ')[0]}`}
        subtitle={METHOD[plan.method]}
        icon={<Wallet />}
        action={plan.createdBy === 'agent' ? <AiBadge /> : undefined}
      />
      <div className={styles.totalRow}>
        <Money amount={plan.total} currency={currency} size="lg" />
        <span className={styles.totalOf}>a month</span>
      </div>
      <table className={styles.table}>
        <caption className="sr-only">Monthly limit per category</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Monthly limit</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.category}>
              <th scope="row">
                <span className={styles.tableCat}>
                  <span aria-hidden="true">{categoryMeta(r.category).emoji}</span>
                  {categoryMeta(r.category).label}
                </span>
                <span className={styles.tableBar} aria-hidden="true">
                  <span style={{ width: `${Math.max(4, (r.limit / max) * 100)}%` }} />
                </span>
              </th>
              <td>{fmt(r.limit, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {toggle}
      {plan.rationale ? (
        <p className={styles.rationale}>
          <CalendarDays aria-hidden="true" />
          {plan.rationale}
        </p>
      ) : null}
    </Card>
  )
}
