import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CATEGORIES } from '../../../core/categories'
import { ym } from '../../../core/dates'
import type { CategoryId, FinanceContext, Insight, MonthHistoryPoint, MonthSummary, Transaction, YearMonth } from '../../../core/types'
import { EmptyState, Segmented, Tabs, useToast } from '../../components/ds'
import { navigate, useRoute } from '../../router'
import { shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import { CategorySheet } from './CategorySheet'
import { MonthHero } from './MonthHero'
import {
  insightsFor,
  insightsQuery,
  ledgerTxns,
  monthChoices,
  previousComparison,
  resolveMonth,
  resolveTab,
  summaryFor,
  type InsightsTab,
} from './model'
import { OverviewPanel } from './OverviewPanel'
import { PatternsPanel } from './PatternsPanel'
import { RecategorizeSheet } from './RecategorizeSheet'
import { TransactionsPanel } from './TransactionsPanel'
import styles from './InsightsScreen.module.css'

const select = (s: AppSnapshot) => ({
  ctx: s.derived.ctx,
  summary: s.derived.summary,
  history: s.derived.history,
  insights: s.derived.insights,
})

/** Insights: the month in numbers, what Bun noticed, where and when the money went, and every transaction. */
export function InsightsScreen() {
  const d = useSnapshot(select, shallowEqual)
  if (!d.ctx || !d.summary) {
    return <EmptyState mood="sleepy" title="No insights yet" body="Once a few transactions land, Bun will show where your money goes." />
  }
  return <InsightsView ctx={d.ctx} current={d.summary} history={d.history} currentInsights={d.insights} />
}

interface ViewProps {
  ctx: FinanceContext
  current: MonthSummary
  history: MonthHistoryPoint[]
  currentInsights: Insight[]
}

const TAB_LABEL: Record<InsightsTab, string> = { overview: 'Overview', patterns: 'Patterns', transactions: 'Transactions' }

function InsightsView({ ctx, current, history, currentInsights }: ViewProps) {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const loc = useRoute()
  const currency = ctx.profile.currency
  const currentMonth = ym(ctx.bank.today)
  const choices = useMemo(() => monthChoices(history, currentMonth), [history, currentMonth])
  const month = resolveMonth(loc.query.month, choices, currentMonth)
  const tab = resolveTab(loc.query.tab)
  const catFilter = loc.query.cat && loc.query.cat in CATEGORIES ? (loc.query.cat as CategoryId) : null
  const query = loc.query.q ?? ''

  const s = useMemo(() => summaryFor(ctx, month, current), [ctx, month, current])
  const insights = useMemo(() => insightsFor(ctx, month, currentMonth, currentInsights), [ctx, month, currentMonth, currentInsights])
  const comparison = useMemo(() => previousComparison(ctx, s), [ctx, s])
  const potIds = useMemo(() => new Set(ctx.bank.accounts.filter((a) => a.type === 'pot').map((a) => a.id)), [ctx.bank.accounts])
  // the controller's own filter (month / category / search). `ctx` is a dependency on purpose: a new
  // snapshot (e.g. after a recategorise) must re-read the ledger. The pot side of a checking→pot move is
  // dropped so each saving shows once.
  const monthTxns = useMemo(() => ledgerTxns(app.transactions({ month }), potIds), [app, ctx, month, potIds])
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!catFilter && !q) return monthTxns
    return ledgerTxns(app.transactions({ month, ...(catFilter ? { category: catFilter } : {}), ...(q ? { query: q } : {}) }), potIds)
  }, [app, month, catFilter, query, potIds, monthTxns])

  const [sheet, setSheet] = useState<{ cat: CategoryId | null; open: boolean }>({ cat: null, open: false })
  const [recat, setRecat] = useState<{ txn: Transaction | null; open: boolean }>({ txn: null, open: false })

  const setRoute = useCallback(
    (patch: Partial<{ month: YearMonth; tab: InsightsTab; cat: string; q: string }>) => {
      const next = { month, tab, cat: catFilter ?? '', q: query, ...patch }
      navigate('insights', { query: insightsQuery({ ...next, current: currentMonth }), replace: true })
    },
    [month, tab, catFilter, query, currentMonth],
  )

  const ask = useCallback(
    (text: string) => {
      setSheet((x) => ({ ...x, open: false }))
      void app.sendMessage(text).catch(() => undefined)
      navigate('chat')
    },
    [app],
  )

  const sheetTxns = useMemo(() => (sheet.cat ? monthTxns.filter((t) => t.category === sheet.cat) : []), [monthTxns, sheet.cat])

  async function saveCategory(txn: Transaction, category: CategoryId): Promise<boolean> {
    const res = await run(() => app.recategorize(txn.id, category), { errorTitle: 'Couldn’t move that one' })
    if (!res?.ok) return false
    toast.show({
      tone: 'success',
      title: `Filed under ${CATEGORIES[category].label}`,
      message: `Bun will remember ${txn.merchant} next time.`,
    })
    return true
  }

  const panels: Record<InsightsTab, ReactNode> = {
    overview: (
      <OverviewPanel
        s={s}
        insights={insights}
        history={history}
        current={current}
        currency={currency}
        onAsk={ask}
        onOpenCategory={(cat) => setSheet({ cat, open: true })}
        onSelectMonth={(m) => setRoute({ month: m })}
      />
    ),
    patterns: (
      <PatternsPanel s={s} txns={monthTxns} dreams={ctx.dreams} currency={currency} onPickMerchant={(merchant) => setRoute({ tab: 'transactions', q: merchant, cat: '' })} />
    ),
    transactions: (
      <TransactionsPanel
        month={month}
        monthTxns={monthTxns}
        txns={filtered}
        category={catFilter}
        query={query}
        today={ctx.bank.today}
        currency={currency}
        onCategory={(c) => setRoute({ cat: c ?? '' })}
        onQuery={(q) => setRoute({ q })}
        onPick={(txn) => setRecat({ txn, open: true })}
      />
    ),
  }

  return (
    <div className={styles.screen}>
      <Segmented
        label="Month"
        size="sm"
        className={styles.months}
        value={month}
        onChange={(m) => setRoute({ month: m })}
        options={choices.map((c) => ({ value: c.value, label: c.current ? <>{c.short}<span className="sr-only"> (this month)</span></> : c.short }))}
      />

      <MonthHero s={s} comparison={comparison} tone={ctx.profile.tone} currency={currency} />

      <Tabs
        label="Insights views"
        fill
        className={styles.tabs}
        value={tab}
        onChange={(t) => setRoute({ tab: t })}
        items={(Object.keys(TAB_LABEL) as InsightsTab[]).map((id) => ({
          id,
          label: TAB_LABEL[id],
          content: <div key={`${id}:${month}`}>{panels[id]}</div>,
        }))}
      />

      <CategorySheet
        open={sheet.open}
        category={sheet.cat}
        s={s}
        txns={sheetTxns}
        currency={currency}
        onClose={() => setSheet((x) => ({ ...x, open: false }))}
        onAsk={ask}
        onSeeAll={(cat) => {
          setSheet((x) => ({ ...x, open: false }))
          setRoute({ tab: 'transactions', cat, q: '' })
        }}
      />
      <RecategorizeSheet
        open={recat.open}
        txn={recat.txn}
        currency={currency}
        onClose={() => setRecat((x) => ({ ...x, open: false }))}
        onSave={saveCategory}
      />
    </div>
  )
}
