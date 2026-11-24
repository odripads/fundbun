import { ChevronDown, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CATEGORIES } from '../../../core/categories'
import { Button, IconButton, Money } from '../../components/ds'
import { shallowEqual, useSnapshot } from '../../state'
import { DashCard } from './DashCard'
import { TXN_PAGE, filterTxns, ledgerRows, txnCategories, txnCountLine, txnDate, type TxnCategoryFilter } from './model'
import styles from './Dashboard.module.css'

const selectLedger = (s: AppSnapshot) => ({
  txns: s.state.bank.transactions,
  accounts: s.state.bank.accounts,
  today: s.derived.today,
  currency: s.state.profile?.currency ?? 'CNY',
})

/** The ledger as a table: newest first, with a search box and a category filter, a page at a time. */
export function TransactionsCard({ area }: { area: string }) {
  const { txns, accounts, today, currency } = useSnapshot(selectLedger, shallowEqual)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TxnCategoryFilter>('all')
  const [limit, setLimit] = useState(TXN_PAGE)
  const searchId = useId()
  const selectId = useId()

  const all = useMemo(() => ledgerRows(txns, accounts, today), [txns, accounts, today])
  const options = useMemo(() => txnCategories(all), [all])
  const matching = useMemo(() => filterTxns(all, { query, category }), [all, query, category])
  const shown = matching.slice(0, limit)
  const filtered = query.trim() !== '' || category !== 'all'

  function clear() {
    setQuery('')
    setCategory('all')
    setLimit(TXN_PAGE)
  }

  return (
    <DashCard area={area} title="Recent transactions" sub="Newest first" className={styles.txnCard}>
      <div className={styles.filters}>
        <div className={styles.search}>
          <label htmlFor={searchId} className="sr-only">Search transactions</label>
          <Search aria-hidden="true" className={styles.searchIcon} />
          <input
            id={searchId}
            type="search"
            className={styles.searchInput}
            placeholder="Search merchant or category"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              setLimit(TXN_PAGE)
            }}
            autoComplete="off"
            enterKeyHint="search"
          />
          {query ? <IconButton size="sm" label="Clear search" icon={<X />} onClick={() => setQuery('')} /> : null}
        </div>
        <div className={styles.select}>
          <label htmlFor={selectId} className="sr-only">Filter by category</label>
          <select
            id={selectId}
            className={styles.selectInput}
            value={category}
            onChange={(e) => {
              setCategory(e.currentTarget.value as TxnCategoryFilter)
              setLimit(TXN_PAGE)
            }}
          >
            <option value="all">All categories</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} ({o.count})
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className={styles.selectChevron} />
        </div>
        <p className={styles.count} role="status" aria-live="polite">
          {txnCountLine(shown.length, matching.length, all.length)}
        </p>
      </div>

      {shown.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">Transactions, newest first{filtered ? ' (filtered)' : ''}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.colDate}>Date</th>
                <th scope="col">Merchant</th>
                <th scope="col" className={styles.colCat}>Category</th>
                <th scope="col" className={styles.colAmount}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id}>
                  <td className={styles.colDate}>
                    <span className={styles.date}>{txnDate(t.date, today)}</span>
                    {t.time ? <span className={styles.time}>{t.time}</span> : null}
                  </td>
                  <td className={styles.merchant}>
                    <span className={styles.merchantName}>{t.merchant}</span>
                  </td>
                  <td className={styles.colCat}>
                    <span className={styles.cat}>
                      <span aria-hidden="true">{CATEGORIES[t.category].emoji}</span>
                      <span className={styles.catLabel}>{CATEGORIES[t.category].label}</span>
                    </span>
                  </td>
                  <td className={styles.colAmount}>
                    <Money amount={t.amount} currency={currency} tone="gain" size="md" signed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.noRows}>
          <p>{all.length === 0 ? 'Nothing on the ledger yet. Add a purchase, or import a statement in Bills.' : 'No transactions match. Try another word, or clear the filters.'}</p>
          {filtered ? <Button variant="secondary" size="sm" onClick={clear}>Clear filters</Button> : null}
        </div>
      )}

      {matching.length > shown.length ? (
        <div className={styles.more}>
          <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + TXN_PAGE)}>
            Show {Math.min(TXN_PAGE, matching.length - shown.length)} more
          </Button>
        </div>
      ) : null}
    </DashCard>
  )
}
