import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CATEGORIES } from '../../../core/categories'
import { netSpend } from '../../../core/finance'
import { fmt } from '../../../core/money'
import type { CategoryId, Currency, ISODate, Transaction, YearMonth } from '../../../core/types'
import { Badge, Button, Card, Chip, EmptyState, IconButton, List, ListItem, Money, TextField } from '../../components/ds'
import { categoryCounts, groupByDay, monthName, txnSubtitle } from './model'
import styles from './panels.module.css'

const PAGE = 40

export interface TransactionsPanelProps {
  month: YearMonth
  /** every ledger row of the month (newest first), before search/category filtering */
  monthTxns: Transaction[]
  /** the filtered rows (app.transactions with month/category/query) */
  txns: Transaction[]
  category: CategoryId | null
  query: string
  today: ISODate
  currency: Currency
  onCategory: (c: CategoryId | null) => void
  onQuery: (q: string) => void
  onPick: (t: Transaction) => void
}

const FLAG_LABEL: Partial<Record<NonNullable<Transaction['flags']>[number], { text: string; variant: 'over' | 'under' | 'warn' | 'neutral' }>> = {
  duplicate_suspect: { text: 'Duplicate?', variant: 'over' },
  refund: { text: 'Refund', variant: 'under' },
  disputed: { text: 'Disputed', variant: 'warn' },
  price_hike: { text: 'Price up', variant: 'warn' },
}

function flagBadge(t: Transaction) {
  const f = t.flags?.map((x) => FLAG_LABEL[x]).find(Boolean)
  return f ? <Badge size="sm" variant={f.variant}>{f.text}</Badge> : null
}

/** Search + category filter over the month's ledger; tap a row to re-file it (and teach Bun the merchant). */
export function TransactionsPanel({ month, monthTxns, txns, category, query, today, currency, onCategory, onQuery, onPick }: TransactionsPanelProps) {
  const [limit, setLimit] = useState(PAGE)
  const counts = useMemo(() => categoryCounts(monthTxns), [monthTxns])
  const groups = useMemo(() => groupByDay(txns.slice(0, limit), today), [txns, limit, today])
  // net of refunds, the same way the month's total is counted
  const spent = useMemo(() => netSpend(txns), [txns])
  const filtered = Boolean(category || query.trim())
  const monthLong = monthName(month)

  return (
    <div className={styles.panel}>
      <div className={styles.filters}>
        <TextField
          type="search"
          label="Search transactions"
          hideLabel
          placeholder={`Search ${monthLong}`}
          prefix={<Search className={styles.searchIcon} />}
          suffix={query ? <IconButton size="sm" label="Clear search" icon={<X />} onClick={() => onQuery('')} /> : null}
          value={query}
          onChange={(e) => {
            setLimit(PAGE)
            onQuery(e.target.value)
          }}
          enterKeyHint="search"
          autoComplete="off"
        />
        <div className={styles.chips} role="group" aria-label="Filter by category">
          <Chip size="sm" selected={category === null} onClick={() => onCategory(null)}>
            All · {monthTxns.length}
          </Chip>
          {counts.map((c) => (
            <Chip
              key={c.id}
              size="sm"
              selected={category === c.id}
              onClick={() => {
                setLimit(PAGE)
                onCategory(category === c.id ? null : c.id)
              }}
              icon={<span>{CATEGORIES[c.id].emoji}</span>}
            >
              {CATEGORIES[c.id].label} · {c.count}
            </Chip>
          ))}
        </div>
      </div>

      <p className={styles.resultLine} role="status" aria-live="polite">
        <strong>{txns.length}</strong> {txns.length === 1 ? 'transaction' : 'transactions'}
        {spent > 0 ? <> · {fmt(spent, currency)} spent</> : null}
        {filtered ? (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              onQuery('')
              onCategory(null)
            }}
          >
            Clear filters
          </button>
        ) : null}
      </p>

      {groups.length ? (
        <div className={styles.days}>
          {groups.map((g) => (
            <section key={g.date} className={styles.day} aria-label={g.label}>
              <h3 className={styles.dayHead}>
                <span>{g.label}</span>
                {g.spent > 0 ? <span className={styles.daySpent}>{fmt(g.spent, currency)}</span> : null}
              </h3>
              <List card dividers>
                {g.txns.map((t) => (
                  <ListItem
                    key={t.id}
                    leading={CATEGORIES[t.category].emoji}
                    title={t.merchant}
                    subtitle={txnSubtitle(t)}
                    trailing={<Money amount={t.amount} currency={currency} tone="gain" size="md" signed />}
                    meta={flagBadge(t)}
                    onClick={() => onPick(t)}
                    ariaLabel={`${t.merchant}, ${fmt(t.amount, currency, { signed: true })}, ${txnSubtitle(t)}. Change category`}
                  />
                ))}
              </List>
            </section>
          ))}
          {txns.length > limit ? (
            <Button variant="secondary" fullWidth onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, txns.length - limit)} more
            </Button>
          ) : null}
        </div>
      ) : (
        <Card>
          <EmptyState
            compact
            mood="calm"
            title={filtered ? 'No matches' : `Nothing in ${monthLong}`}
            body={filtered ? 'Try another word or clear the filters.' : 'No transactions this month yet.'}
            action={filtered ? <Button variant="secondary" size="sm" onClick={() => { onQuery(''); onCategory(null) }}>Clear filters</Button> : undefined}
          />
        </Card>
      )}
    </div>
  )
}
