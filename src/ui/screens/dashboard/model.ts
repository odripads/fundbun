/**
 * Pure view logic for the desk Dashboard. No React, no DOM: unit-tested in model.test.ts.
 * Every amount is integer minor units and comes from the snapshot; the only sums made here are the ones the cards
 * show (a day's spending, the folded tail of the category list, the over-budget share), each covered by a test.
 * Formatting goes through money.fmt.
 */
import { CATEGORIES } from '../../../core/categories'
import { dateLabel, daysInMonth, parseDate } from '../../../core/dates'
import { dayLimitOf, overShare, planFor } from '../../../core/finance'
import { pctText } from '../../../core/finance/copy'
import { FIXED_CATEGORIES, isSpending, spendValue } from '../../../core/finance/ledger'
import { fmt } from '../../../core/money'
import type {
  Account,
  CategoryId,
  Currency,
  DreamItem,
  FinanceContext,
  GoalProgress,
  ISODate,
  Minor,
  MonthHistoryPoint,
  MonthSummary,
  Tone,
  Transaction,
  YearMonth,
} from '../../../core/types'
import { etaFact, groupDreams, isFunded, targetFact } from '../goals/model'
import { fmtWhole, monthName, safeToSpendNote } from '../home/model'
import { niceTicks, trendBars } from '../insights/model'

// ───────────────────────────── this month ─────────────────────────────

export interface MonthVerdict {
  /** 'left': inside the target · 'over': past it */
  kind: 'left' | 'over'
  /** "Left over" / "Over budget" (never "under …": it reads like falling short) */
  label: string
  amount: Minor
  note: string
}

export interface MonthDaily {
  label: string
  amount: Minor
  note: string
}

export interface MonthKpis {
  month: YearMonth
  /** "October" */
  monthLong: string
  /** daily tracking mode: no target, no verdict */
  tracking: boolean
  spent: Minor
  /** null in tracking mode */
  target: Minor | null
  verdict: MonthVerdict | null
  daily: MonthDaily
  daysLeft: number
  savedToGoals: Minor
}

export interface MonthKpiInput {
  summary: MonthSummary
  currency: Currency
  tone: Tone
  tracking: boolean
  /** the user's own daily amount for this month (finance/dailyplan), or null */
  plan: Minor | null
  /** spending on the app's "today" (spentOn) */
  spentToday: Minor
}

/** Everything bought on one day: outflows that are not transfers or goal savings (the Home month card's rule). */
export function spentOn(txns: readonly Transaction[], date: ISODate): Minor {
  let total = 0
  for (const t of txns) {
    if (t.date === date && t.amount < 0 && t.category !== 'transfer' && t.category !== 'savings') total -= t.amount
  }
  return total
}

/** The month card's numbers: spent, target, what is left or over, and the daily amount (as on the Home month card). */
export function monthKpis({ summary: s, currency, tone, tracking, plan, spentToday }: MonthKpiInput): MonthKpis {
  const f = (m: Minor) => fmtWhole(m, currency)
  const monthLong = monthName(s.month)
  const daysLeft = Math.max(0, s.daysInMonth - s.dayOfMonth)
  const base = { month: s.month, monthLong, tracking, spent: s.spent, daysLeft, savedToGoals: s.savedToGoals }
  if (tracking) {
    const perDay = Math.round(s.spent / Math.max(1, s.dayOfMonth))
    return { ...base, target: null, verdict: null, daily: { label: 'Spent today', amount: spentToday, note: `About ${f(perDay)} a day this month.` } }
  }
  const verdict: MonthVerdict =
    s.remaining < 0
      ? { kind: 'over', label: 'Over budget', amount: -s.remaining, note: `${pctText(overShare(s.spent, s.target))} past your ${f(s.target)} target` }
      : {
          kind: 'left',
          label: 'Left over',
          amount: s.remaining,
          note: s.isCurrent ? `of your ${f(s.target)} target, ${daysLeft === 1 ? '1 day' : `${daysLeft} days`} to go` : `of your ${f(s.target)} target`,
        }
  const daily: MonthDaily =
    plan !== null
      ? { label: 'Your daily amount', amount: plan, note: `You set it for the rest of ${monthLong}. Bun judges each day by it.` }
      : { label: 'Safe to spend today', amount: s.safeToSpendToday, note: safeToSpendNote(s, tone, currency) }
  return { ...base, target: s.target, verdict, daily }
}

// ───────────────────────────── daily spending ─────────────────────────────

/** Purchases, not rent, utilities or other scheduled payments: the spending a day limit is about (finance/temper). */
export function isDayToDay(t: Transaction): boolean {
  return isSpending(t) && !t.billId && !FIXED_CATEGORIES.has(t.category)
}

/**
 * The day limit to draw on the daily chart, or null when there is none: the temper's own limit (the user's daily
 * amount, their daily tripwire, else an even share of the flexible budget). Daily tracking has no target, so only a
 * line the user set themselves counts there.
 */
export function dayLimitFor(ctx: FinanceContext, s: MonthSummary): Minor | null {
  if (ctx.profile.mode === 'tracking') {
    const plan = planFor(ctx, s.month)
    if (plan) return plan.amount
    const own = ctx.tripwires.find((t) => t.enabled && t.kind === 'daily_over' && t.threshold > 0)
    return own ? own.threshold : null
  }
  const limit = dayLimitOf(ctx, s)
  return limit > 0 ? limit : null
}

export interface DayBar {
  date: ISODate
  /** 1-based day of the month */
  day: number
  /** day-to-day spending on that day */
  amount: Minor
  isToday: boolean
  /** after the date the chart looks from: nothing to draw yet */
  future: boolean
  overLimit: boolean
}

export interface DailySeries {
  month: YearMonth
  days: DayBar[]
  limit: Minor | null
  /** the tallest day */
  max: Minor
  /** day-to-day spending so far (the sum of the bars) */
  total: Minor
  /** rent, bills and subscriptions so far: counted in the month, left out of the bars */
  fixed: Minor
  /** the biggest day (the first one on a tie), or null when nothing was spent */
  peak: DayBar | null
  /** days above the limit */
  overDays: number
  /** days with any day-to-day spending */
  spendDays: number
}

/**
 * One bar per day of `month`: day-to-day spending up to `asOf` (the date the analyses look from). `today` marks the
 * bar of the app's current day, when it falls in this month.
 */
export function dailySeries(txns: readonly Transaction[], month: YearMonth, asOf: ISODate, limit: Minor | null, today: ISODate = asOf): DailySeries {
  const byDay = new Map<ISODate, Minor>()
  let fixed = 0
  for (const t of txns) {
    if (!t.date.startsWith(month) || t.date > asOf) continue
    if (isDayToDay(t)) byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amount)
    else fixed += Math.max(0, spendValue(t))
  }
  const days: DayBar[] = []
  let max = 0
  let total = 0
  let overDays = 0
  let spendDays = 0
  let peak: DayBar | null = null
  for (let day = 1; day <= daysInMonth(month); day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`
    const future = date > asOf
    const amount = future ? 0 : (byDay.get(date) ?? 0)
    const bar: DayBar = { date, day, amount, isToday: date === today, future, overLimit: limit !== null && amount > limit }
    days.push(bar)
    total += amount
    if (amount > 0) spendDays++
    if (bar.overLimit) overDays++
    if (amount > max) {
      max = amount
      peak = bar
    }
  }
  return { month, days, limit, max, total, fixed, peak, overDays, spendDays }
}

/** One sentence that carries the chart for anyone who cannot see it. */
export function dailySummary(d: DailySeries, currency: Currency): string {
  const f = (m: Minor) => fmt(m, currency)
  const monthLong = monthName(d.month)
  if (d.total <= 0 || !d.peak) return `No day-to-day spending in ${monthLong} yet.`
  const parts = [`Day-to-day spending in ${monthLong}: ${f(d.total)} over ${d.spendDays === 1 ? '1 day' : `${d.spendDays} days`}.`, `Biggest day: ${dateLabel(d.peak.date)}, ${f(d.peak.amount)}.`]
  if (d.limit !== null) parts.push(`Day limit ${f(d.limit)}: ${d.overDays === 0 ? 'no day went over it' : d.overDays === 1 ? '1 day went over it' : `${d.overDays} days went over it`}.`)
  const today = d.days.find((b) => b.isToday)
  if (today) parts.push(`Today: ${f(today.amount)}.`)
  return parts.join(' ')
}

// ───────────────────────────── categories ─────────────────────────────

/** id of the row that folds the smaller categories together */
export const REST_ID = 'rest' as const

export interface CategoryBar {
  id: CategoryId | typeof REST_ID
  label: string
  emoji: string
  spent: Minor
  /** share of the month's spending, 0..100 (unrounded) */
  share: number
  /** "34%", "<1%" */
  shareText: string
  /** the category's own cap, when it has one */
  limit?: Minor
  overLimit: boolean
  /** number of categories folded into this row (only on the rest row) */
  folded?: number
}

export interface CategoryBars {
  rows: CategoryBar[]
  /** the month's spending the shares are of */
  total: Minor
  /** the biggest row */
  max: Minor
}

/** "34%" for a 0..100 share; anything real but under one percent reads "<1%". */
export function shareText(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%'
  if (share < 1) return '<1%'
  return `${Math.round(share)}%`
}

/**
 * The month's spending by category, biggest first. Past `max` rows the smallest ones are folded into one
 * "Everything else" row, so the list never grows a tail nobody reads.
 */
export function categoryBars(s: MonthSummary, max = 7): CategoryBars {
  const spentRows = s.byCategory
    .filter((r) => r.spent > 0)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.spent - a.r.spent || a.i - b.i)
    .map(({ r }) => r)
  const total = spentRows.reduce((sum, r) => sum + r.spent, 0)
  const share = (v: Minor) => (total > 0 ? (v / total) * 100 : 0)
  const keep = spentRows.length > max ? spentRows.slice(0, Math.max(1, max - 1)) : spentRows
  const tail = spentRows.slice(keep.length)
  const rows: CategoryBar[] = keep.map((r) => ({
    id: r.category,
    label: CATEGORIES[r.category].label,
    emoji: CATEGORIES[r.category].emoji,
    spent: r.spent,
    share: share(r.spent),
    shareText: shareText(share(r.spent)),
    ...(r.limit !== undefined && r.limit > 0 ? { limit: r.limit } : {}),
    overLimit: r.limit !== undefined && r.limit > 0 && r.spent > r.limit,
  }))
  if (tail.length > 0) {
    const rest = tail.reduce((sum, r) => sum + r.spent, 0)
    rows.push({ id: REST_ID, label: 'Everything else', emoji: '🫧', spent: rest, share: share(rest), shareText: shareText(share(rest)), overLimit: false, folded: tail.length })
  }
  return { rows, total, max: rows.reduce((m, r) => Math.max(m, r.spent), 0) }
}

export function categorySummary(c: CategoryBars, month: YearMonth, currency: Currency): string {
  const monthLong = monthName(month)
  if (c.rows.length === 0) return `No spending in ${monthLong} yet.`
  const top = c.rows[0]
  return `Spending by category in ${monthLong}, ${fmt(c.total, currency)} in all. Biggest: ${top.label}, ${fmt(top.spent, currency)} (${top.shareText}).`
}

// ───────────────────────────── the last six months ─────────────────────────────

export interface MonthColumn {
  month: YearMonth
  /** "Oct" */
  short: string
  /** "October" */
  long: string
  spent: Minor
  /** null in tracking mode (and for a month without a target) */
  target: Minor | null
  over: boolean
  /** spent past the target (0 when not over) */
  overBy: Minor
  /** what is left of the target (0 when over, or without a target) */
  left: Minor
  /** the month in progress */
  current: boolean
}

export interface MonthColumns {
  cols: MonthColumn[]
  /** top of the value axis (a round number at or above every bar and target) */
  max: Minor
  /** round axis ticks from 0 to max, in minor units */
  ticks: Minor[]
  overCount: number
}

/** Spent against target for the months in `history` (oldest first), on one shared scale with round ticks. */
export function monthColumns(history: readonly MonthHistoryPoint[], current: MonthSummary | null, tracking: boolean): MonthColumns {
  const cols: MonthColumn[] = trendBars([...history], current).map((b) => {
    const target = !tracking && b.target > 0 ? b.target : null
    const over = target !== null && b.spent > target
    return {
      month: b.month,
      short: b.short,
      long: monthName(b.month),
      spent: b.spent,
      target,
      over,
      overBy: over && target !== null ? b.spent - target : 0,
      left: !over && target !== null ? target - b.spent : 0,
      current: b.current,
    }
  })
  const top = cols.reduce((m, c) => Math.max(m, c.spent, c.target ?? 0), 0)
  const ticks = niceTicks(top, 3)
  return { cols, max: Math.max(1, ticks[ticks.length - 1] ?? 0), ticks, overCount: cols.filter((c) => c.over).length }
}

/** How a month stands against its target, in the app's words (the good state is "left over", never "under"). */
export function monthColumnNote(c: MonthColumn, currency: Currency): string | undefined {
  if (c.target === null) return undefined
  if (c.over) return `${fmt(c.overBy, currency)} over budget`
  return c.current ? `${fmt(c.left, currency)} left before the ${fmtWhole(c.target, currency)} target` : `${fmt(c.left, currency)} left over`
}

export function monthColumnsSummary(m: MonthColumns, currency: Currency): string {
  if (m.cols.length === 0) return 'No months to compare yet.'
  const f = (v: Minor) => fmt(v, currency)
  const n = m.cols.length
  const last = m.cols[n - 1]
  const lead = `Spending for the last ${n === 1 ? 'month' : `${n} months`}.`
  const now = `${last.long}${last.current ? ' so far' : ''}: ${f(last.spent)}${last.target !== null ? ` of a ${f(last.target)} target${last.over ? `, ${f(last.overBy)} over budget` : ''}` : ''}.`
  const hasTargets = m.cols.some((c) => c.target !== null)
  const tally = hasTargets ? ` ${m.overCount === 0 ? 'No month went over budget.' : `${m.overCount} of ${n} ${n === 1 ? 'month' : 'months'} went over budget.`}` : ''
  return `${lead} ${now}${tally}`
}

// ───────────────────────────── goals ─────────────────────────────

export interface GoalRow {
  id: string
  name: string
  image: string
  kind: DreamItem['kind']
  saved: Minor
  price: Minor
  /** 0..100 */
  pct: number
  funded: boolean
  /** the target-date fact when the goal has a deadline, else the pace fact: "By Dec 2028" / "Aug 2029" / "—" */
  factValue: string
  factSub: string
  /** only set when the goal has its own deadline */
  onSchedule?: boolean
}

/** Every open dream (goals first, then treats) with its progress and its date fact. */
export function goalRows(dreams: DreamItem[], progress: GoalProgress[], currency: Currency): GoalRow[] {
  const groups = groupDreams(dreams, progress)
  return [...groups.goals, ...groups.treats].map(({ item, progress: p }) => {
    const target = targetFact(p, currency)
    const fact = target ?? etaFact(p)
    return {
      id: item.id,
      name: item.name,
      image: item.image,
      kind: item.kind,
      saved: p?.saved ?? 0,
      price: item.price,
      pct: Math.max(0, Math.min(100, p?.pct ?? 0)),
      funded: isFunded(p),
      factValue: fact.value,
      factSub: fact.sub,
      ...(target ? { onSchedule: target.onSchedule } : {}),
    }
  })
}

// ───────────────────────────── transactions ─────────────────────────────

/** rows shown before "Show more" */
export const TXN_PAGE = 50

export type TxnCategoryFilter = CategoryId | 'all'

export interface TxnFilter {
  query: string
  category: TxnCategoryFilter
}

/**
 * The ledger as the user knows it, newest first: nothing dated after today, and without the pot side of a
 * checking→pot move (that is the same money twice).
 */
export function ledgerRows(txns: readonly Transaction[], accounts: readonly Account[], today: ISODate): Transaction[] {
  const pots = new Set(accounts.filter((a) => a.type === 'pot').map((a) => a.id))
  return txns
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.date <= today && !pots.has(t.accountId))
    .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : (b.t.time ?? '').localeCompare(a.t.time ?? '') || b.i - a.i))
    .map(({ t }) => t)
}

/** Search by merchant, bank description or category name (every word must match), then by category. */
export function filterTxns(rows: readonly Transaction[], filter: TxnFilter): Transaction[] {
  const words = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((t) => {
    if (filter.category !== 'all' && t.category !== filter.category) return false
    if (words.length === 0) return true
    const hay = `${t.merchant} ${t.description} ${CATEGORIES[t.category].label}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

export interface TxnCategoryOption {
  id: CategoryId
  label: string
  count: number
}

/** The categories that appear on the ledger, by name, each with its number of rows. */
export function txnCategories(rows: readonly Transaction[]): TxnCategoryOption[] {
  const counts = new Map<CategoryId, number>()
  for (const t of rows) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  return [...counts.entries()].map(([id, count]) => ({ id, label: CATEGORIES[id].label, count })).sort((a, b) => a.label.localeCompare(b.label))
}

/** "Oct 22" in the current year, "Dec 30, 2025" in another one. */
export function txnDate(date: ISODate, today: ISODate): string {
  if (date.slice(0, 4) === today.slice(0, 4)) return dateLabel(date)
  return parseDate(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** "Showing 50 of 864" / "12 transactions" / "No transactions match" */
export function txnCountLine(shown: number, matching: number, all: number): string {
  if (matching === 0) return all === 0 ? 'No transactions yet' : 'No transactions match'
  const noun = matching === 1 ? 'transaction' : 'transactions'
  const of = matching === all ? `${matching.toLocaleString('en-US')} ${noun}` : `${matching.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} ${noun}`
  return shown < matching ? `Showing ${shown.toLocaleString('en-US')} of ${of}` : of
}
