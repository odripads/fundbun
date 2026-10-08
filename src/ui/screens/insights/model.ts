/**
 * Insights view logic (pure, unit-tested). Everything here derives display data from the finance engine's
 * outputs; no money maths happens in components. Money stays integer minor units until Money / fmt.
 */
import { CATEGORIES } from '../../../core/categories'
import { dateLabel, dayOfMonth, daysInMonth, monthLabel, shiftMonth, weekday } from '../../../core/dates'
import { generateInsights, isSpending, mirrorStatus, netSpend, summarizeMonth } from '../../../core/finance'
import { fmt, parseAmount } from '../../../core/money'
import type {
  BunMood,
  CategoryId,
  Currency,
  FinanceContext,
  Insight,
  ISODate,
  Minor,
  MirrorStatus,
  MonthHistoryPoint,
  MonthSummary,
  Tone,
  Transaction,
  YearMonth,
} from '../../../core/types'

// ───────────────────────────── months ─────────────────────────────

export interface MonthChoice {
  value: YearMonth
  /** "Oct" */
  short: string
  /** "October" */
  long: string
  current: boolean
}

export function monthName(m: YearMonth, style: 'long' | 'short' = 'long'): string {
  return monthLabel(m, style).split(' ')[0]
}

/** The selectable months (oldest first), from the engine's 6-month history. */
export function monthChoices(history: MonthHistoryPoint[], current: YearMonth): MonthChoice[] {
  const months = history.length ? history.map((h) => h.month) : [current]
  return months.map((m) => ({ value: m, short: monthName(m, 'short'), long: monthName(m), current: m === current }))
}

/** A month from the URL is honoured only when it is one of the choices. */
export function resolveMonth(requested: string | undefined, choices: MonthChoice[], current: YearMonth): YearMonth {
  return requested && choices.some((c) => c.value === requested) ? requested : current
}

// ───────────────────────────── headline ─────────────────────────────

export interface Comparison {
  /** spending of the comparison period */
  amount: Minor
  /** "Sep 1–22" (same days, current month) or "Sep" (whole month) */
  label: string
  diff: Minor
  /** rounded percent change, null when the comparison period had no spending */
  pct: number | null
}

function inMonthUpTo(t: Transaction, month: YearMonth, lastDay: number): boolean {
  return t.date.startsWith(month) && dayOfMonth(t.date) <= lastDay
}

/**
 * Like-for-like comparison with the previous month: for the current month, the same days of last month
 * (Oct 1–22 vs Sep 1–22); for a finished month, the whole previous month.
 */
export function previousComparison(ctx: FinanceContext, s: MonthSummary): Comparison | null {
  const prev = shiftMonth(s.month, -1)
  const lastDay = s.isCurrent ? s.dayOfMonth : 31
  const txns = ctx.bank.transactions.filter((t) => inMonthUpTo(t, prev, lastDay))
  if (txns.length === 0) return null
  const amount = netSpend(txns)
  const diff = s.spent - amount
  const label = s.isCurrent ? `${monthName(prev, 'short')} 1–${s.dayOfMonth}` : monthName(prev, 'short')
  return { amount, label, diff, pct: amount > 0 ? Math.round((diff / amount) * 100) : null }
}

export function statusOf(s: MonthSummary): MirrorStatus {
  return mirrorStatus(s)
}

/** Bun's face for the month. Gentle tone never gets the burnt bun. */
export function moodFor(status: MirrorStatus, tone: Tone): BunMood {
  switch (status) {
    case 'over':
      return tone === 'gentle' ? 'worried' : 'burnt'
    case 'pace_over':
      return 'worried'
    case 'under':
      return 'happy'
    case 'on_track':
      return 'calm'
    default:
      return 'sleepy'
  }
}

function pick(tone: Tone, copy: Record<Tone, string>): string {
  return copy[tone] ?? copy.gentle
}

function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

/** One tone-aware sentence about the month. Celebrates under-spending, never shames over-spending. */
export function headlineCopy(s: MonthSummary, tone: Tone, currency: Currency): string {
  const f = (m: Minor) => fmt(Math.round(m / 100) * 100, currency)
  const status = statusOf(s)
  const left = Math.max(0, s.daysInMonth - s.dayOfMonth)
  switch (status) {
    case 'over': {
      const over = f(s.spent - s.target)
      if (!s.isCurrent) return pick(tone, { gentle: `Finished ${over} past target. A fresh month is a fresh start.`, cheeky: `Closed ${over} over. We don't talk about it.`, numbers: `Final: ${over} over target.` })
      return pick(tone, {
        gentle: `${over} past your target, ${days(left)} to steer back.`,
        cheeky: `${over} over, with ${days(left)} to go. Bun is sweating.`,
        numbers: `${over} over target · ${days(left)} left.`,
      })
    }
    case 'pace_over': {
      const over = f(s.projected - s.target)
      return pick(tone, {
        gentle: `Heading ${over} past target. Still time to steer.`,
        cheeky: `This pace overshoots by ${over}. Brakes, maybe?`,
        numbers: `Projected ${over} over target.`,
      })
    }
    case 'under': {
      const under = f(s.isCurrent ? s.target - s.projected : s.target - s.spent)
      if (!s.isCurrent) return pick(tone, { gentle: `Finished ${under} under target. Lovely work.`, cheeky: `${under} under. Look at you go.`, numbers: `Final: ${under} under target.` })
      return pick(tone, {
        gentle: `On pace to finish ${under} under. Lovely.`,
        cheeky: `On pace for ${under} under. Who are you?`,
        numbers: `Projected ${under} under target.`,
      })
    }
    case 'on_track':
      return pick(tone, { gentle: 'Right on track this month.', cheeky: 'Bang on target. Suspiciously sensible.', numbers: 'On track for target.' })
    default:
      return s.isCurrent ? 'No spending yet this month.' : 'No spending recorded this month.'
  }
}

// ───────────────────────────── hero meter ─────────────────────────────

export interface Meter {
  /** percent widths on a shared scale */
  spentPct: number
  /** the part of spending up to the target */
  withinPct: number
  projectedPct: number
  targetPct: number
  over: boolean
}

function pctOf(v: number, max: number): number {
  if (!Number.isFinite(v) || max <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((v / max) * 1000) / 10))
}

export function meter(s: MonthSummary): Meter {
  const projected = s.isCurrent ? s.projected : s.spent
  const scale = Math.max(s.target, s.spent, projected, 1)
  return {
    spentPct: pctOf(s.spent, scale),
    withinPct: pctOf(Math.min(s.spent, s.target), scale),
    projectedPct: pctOf(Math.max(projected, s.spent), scale),
    targetPct: pctOf(s.target, scale),
    over: s.spent > s.target,
  }
}

// ───────────────────────────── categories ─────────────────────────────

export interface CategoryRow {
  id: CategoryId
  label: string
  emoji: string
  spent: Minor
  limit?: Minor
  prevMonth: Minor
  count: number
}

/** Spending categories with money or a limit, biggest first. */
export function categoryRows(s: MonthSummary): CategoryRow[] {
  return s.byCategory
    .filter((r) => r.spent > 0 || (r.limit ?? 0) > 0)
    .map((r) => ({
      id: r.category,
      label: CATEGORIES[r.category].label,
      emoji: CATEGORIES[r.category].emoji,
      spent: r.spent,
      ...(r.limit !== undefined ? { limit: r.limit } : {}),
      prevMonth: r.prevMonth ?? 0,
      count: r.count,
    }))
}

// ───────────────────────────── needs / wants / saved ─────────────────────────────

export interface Split {
  needs: Minor
  wants: Minor
  saved: Minor
  income: Minor
  /** the most notable gap against the 50/30/20 guide (as shares of income), or null */
  takeaway: string | null
}

const GUIDE = { needs: 50, wants: 30, saved: 20 }

/** Saving below the guide: credit what was saved, then the concrete step to the guide (never a scolding). */
function savedText(saved: Minor, income: Minor, pct: number, currency: Currency): string {
  const gap = Math.max(0, Math.round((income * GUIDE.saved) / 100) - saved)
  const step = fmt(Math.ceil(gap / 10000) * 10000, currency)
  return saved > 0
    ? `You saved ${pct}% of your income (${fmt(saved, currency)}). About ${step} more a month reaches the ${GUIDE.saved}% guide.`
    : `Nothing has gone to your goals yet. ${step} a month would reach the ${GUIDE.saved}% guide.`
}

export function split(s: MonthSummary, currency: Currency): Split {
  let needs = 0
  let wants = 0
  for (const r of s.byCategory) {
    const kind = CATEGORIES[r.category].kind
    if (kind === 'need') needs += r.spent
    else if (kind === 'want') wants += r.spent
  }
  const saved = s.savedToGoals
  const income = s.income
  let takeaway: string | null = null
  if (income > 0 && needs + wants + saved > 0) {
    const share = (v: Minor) => Math.round((v / income) * 100)
    const gaps = [
      { key: 'wants', over: share(wants) - GUIDE.wants, text: `Wants took ${share(wants)}% of your income; the 50/30/20 guide says about ${GUIDE.wants}%.` },
      { key: 'needs', over: share(needs) - GUIDE.needs, text: `Needs took ${share(needs)}% of your income; the 50/30/20 guide says about ${GUIDE.needs}%.` },
      { key: 'saved', over: GUIDE.saved - share(saved), text: savedText(saved, income, share(saved), currency) },
    ].filter((g) => g.over >= 3).sort((a, b) => b.over - a.over)
    takeaway = gaps[0]?.text ?? `Needs ${share(needs)}% · wants ${share(wants)}% · saved ${share(saved)}% of income. Right in line with 50/30/20.`
  }
  return { needs, wants, saved, income, takeaway }
}

// ───────────────────────────── 6-month trend ─────────────────────────────

export interface TrendBar {
  month: YearMonth
  short: string
  spent: Minor
  target: Minor
  /** current month only: projected month-end */
  projected?: Minor
  over: boolean
  current: boolean
}

export function trendBars(history: MonthHistoryPoint[], current: MonthSummary | null): TrendBar[] {
  return history.map((h) => {
    const isCurrent = current?.month === h.month
    const projected = isCurrent && current ? Math.max(current.projected, h.spent) : undefined
    return {
      month: h.month,
      short: monthName(h.month, 'short'),
      spent: h.spent,
      target: h.target,
      ...(projected !== undefined && projected > h.spent ? { projected } : {}),
      over: h.target > 0 && h.spent > h.target,
      current: isCurrent,
    }
  })
}

/** "Nice" axis ticks from 0 to at least `max` (3–5 ticks, steps of 1/2/2.5/5 × 10^n). */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const raw = max / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow
  const ticks: number[] = []
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v))
  return ticks
}

// ───────────────────────────── habits (heatmap, merchants) ─────────────────────────────

/** Bills and fixed costs aren't habits: rent at 9am says nothing about when you spend. */
const FIXED = new Set<CategoryId>(['housing', 'utilities', 'phone_internet', 'insurance', 'subscriptions'])

export function isDayToDay(t: Transaction): boolean {
  return isSpending(t) && !FIXED.has(t.category) && !t.billId
}

/** Hours start at 4am so the late-night band (22:00–04:00) is one contiguous block on the right. */
export const HOUR_ORDER = Array.from({ length: 24 }, (_, i) => (i + 4) % 24)
/** Monday-first rows */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

export function isLateHour(h: number): boolean {
  return h >= 22 || h < 4
}

export const BANDS = [
  { id: 'morning', label: 'Morning', range: '04–12', test: (h: number) => h >= 4 && h < 12 },
  { id: 'afternoon', label: 'Afternoon', range: '12–17', test: (h: number) => h >= 12 && h < 17 },
  { id: 'evening', label: 'Evening', range: '17–22', test: (h: number) => h >= 17 && h < 22 },
  { id: 'late', label: 'Late night', range: '22–04', test: isLateHour },
] as const

export interface HeatCell {
  amount: Minor
  count: number
  /** late-night food-delivery orders in this slot */
  delivery: number
}

export interface Heatmap {
  /** [weekdayRow 0=Mon][hour 0..23] */
  cells: HeatCell[][]
  max: Minor
  total: Minor
  count: number
  /** purchases without a time of day (not plotted) */
  untimed: number
  late: { count: number; amount: Minor; delivery: number; deliveryAmount: Minor }
  /** scheduled charges (subscriptions, bills) that happen to bill late at night: not a habit, not plotted */
  lateScheduled: { count: number; amount: Minor }
  busiest: { row: number; hour: number; amount: Minor } | null
  /** [weekdayRow][band] amounts, for the table view */
  bands: Minor[][]
}

export function rowOf(date: ISODate): number {
  return (weekday(date) + 6) % 7
}

export function hourOf(t: Transaction): number | null {
  if (!t.time || !/^\d{1,2}:\d{2}/.test(t.time)) return null
  const h = Number(t.time.split(':')[0])
  return h >= 0 && h < 24 ? h : null
}

export function heatmap(txns: Transaction[], month: YearMonth): Heatmap {
  const cells: HeatCell[][] = WEEKDAYS.map(() => Array.from({ length: 24 }, () => ({ amount: 0, count: 0, delivery: 0 })))
  const bands: Minor[][] = WEEKDAYS.map(() => BANDS.map(() => 0))
  const late = { count: 0, amount: 0, delivery: 0, deliveryAmount: 0 }
  const lateScheduled = { count: 0, amount: 0 }
  let total = 0
  let count = 0
  let untimed = 0
  for (const t of txns) {
    if (!t.date.startsWith(month)) continue
    if (!isDayToDay(t)) {
      const fh = isSpending(t) ? hourOf(t) : null
      if (fh !== null && isLateHour(fh)) {
        lateScheduled.count++
        lateScheduled.amount += -t.amount
      }
      continue
    }
    const h = hourOf(t)
    if (h === null) {
      untimed++
      continue
    }
    const r = rowOf(t.date)
    const v = -t.amount
    const cell = cells[r][h]
    cell.amount += v
    cell.count++
    total += v
    count++
    bands[r][BANDS.findIndex((b) => b.test(h))] += v
    if (isLateHour(h)) {
      late.count++
      late.amount += v
      if (t.category === 'delivery') {
        cell.delivery++
        late.delivery++
        late.deliveryAmount += v
      }
    }
  }
  let max = 0
  let busiest: Heatmap['busiest'] = null
  cells.forEach((row, r) =>
    row.forEach((c, hour) => {
      if (c.amount > max) {
        max = c.amount
        busiest = { row: r, hour, amount: c.amount }
      }
    }),
  )
  return { cells, max, total, count, untimed, late, lateScheduled, busiest, bands }
}

/** 0..1 intensity on a square-root scale so a few big slots don't wash out the rest. */
export function heatLevel(amount: Minor, max: Minor): number {
  if (amount <= 0 || max <= 0) return 0
  return Math.round(Math.max(0.12, Math.sqrt(amount / max)) * 100) / 100
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

export function heatSummary(map: Heatmap, monthLong: string, currency: Currency): string {
  if (map.count === 0) return `No timed day-to-day purchases in ${monthLong}.`
  const f = (m: Minor) => fmt(m, currency)
  const parts = [`When you spend in ${monthLong}: ${map.count} day-to-day purchases, ${f(map.total)}.`]
  if (map.busiest) parts.push(`Busiest slot: ${WEEKDAYS_LONG[map.busiest.row]} ${hourLabel(map.busiest.hour)}, ${f(map.busiest.amount)}.`)
  parts.push(map.late.count > 0
    ? `Late night (22:00–04:00): ${map.late.count} purchases, ${f(map.late.amount)}${map.late.delivery ? `, ${map.late.delivery} of them food delivery` : ''}.`
    : 'Nothing bought late at night.')
  return parts.join(' ')
}

export interface MerchantRow {
  merchant: string
  amount: Minor
  count: number
  category: CategoryId
  /** share of the month's total spending, 0..100 */
  share: number
  late: number
}

/** Top day-to-day merchants (rent, bills and subscriptions excluded, as in the engine's top_merchant insight). */
export function topMerchants(txns: Transaction[], month: YearMonth, monthSpent: Minor, n = 5): MerchantRow[] {
  const by = new Map<string, { amount: Minor; count: number; late: number; cats: Map<CategoryId, Minor> }>()
  for (const t of txns) {
    if (!t.date.startsWith(month) || !isDayToDay(t)) continue
    const e = by.get(t.merchant) ?? { amount: 0, count: 0, late: 0, cats: new Map() }
    e.amount += -t.amount
    e.count++
    const h = hourOf(t)
    if (h !== null && isLateHour(h)) e.late++
    e.cats.set(t.category, (e.cats.get(t.category) ?? 0) - t.amount)
    by.set(t.merchant, e)
  }
  return [...by.entries()]
    .map(([merchant, e]) => ({
      merchant,
      amount: e.amount,
      count: e.count,
      late: e.late,
      category: [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0][0],
      share: monthSpent > 0 ? Math.round((e.amount / monthSpent) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.merchant.localeCompare(b.merchant))
    .slice(0, n)
}

// ───────────────────────────── transactions ─────────────────────────────

export interface DayGroup {
  date: ISODate
  label: string
  /** net outflow of the day's spending (positive) */
  spent: Minor
  txns: Transaction[]
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return 'Today'
  return `${WEEKDAY_SHORT[weekday(date)]}, ${dateLabel(date)}`
}

/** Group newest-first transactions by day, keeping order. */
export function groupByDay(txns: Transaction[], today: ISODate): DayGroup[] {
  const out: DayGroup[] = []
  for (const t of txns) {
    let g = out[out.length - 1]
    if (!g || g.date !== t.date) {
      g = { date: t.date, label: dayLabel(t.date, today), spent: 0, txns: [] }
      out.push(g)
    }
    g.txns.push(t)
    if (isSpending(t)) g.spent += -t.amount
  }
  return out
}

/** Category filter chips: the month's categories by number of transactions. */
export function categoryCounts(txns: Transaction[]): { id: CategoryId; count: number }[] {
  const m = new Map<CategoryId, number>()
  for (const t of txns) m.set(t.category, (m.get(t.category) ?? 0) + 1)
  return [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

export function txnSubtitle(t: Transaction): string {
  const parts = [CATEGORIES[t.category].label]
  if (t.time) parts.push(t.time)
  const h = hourOf(t)
  if (h !== null && isLateHour(h) && isSpending(t)) parts.push('late')
  if (t.categorySource === 'user') parts.push('edited')
  return parts.join(' · ')
}

/** "Oct 22 · 00:52 · late night" — when it happened, for rows that already show the category. */
export function txnWhen(t: Transaction): string {
  const parts = [dateLabel(t.date)]
  if (t.time) parts.push(t.time)
  const h = hourOf(t)
  if (h !== null && isLateHour(h) && isSpending(t)) parts.push('late night')
  return parts.join(' · ')
}

/** Categories offered when re-filing a transaction: spending first, then the non-spending kinds. */
export function pickerCategories(): CategoryId[] {
  const all = Object.keys(CATEGORIES) as CategoryId[]
  const spending = all.filter((c) => CATEGORIES[c].kind === 'need' || CATEGORIES[c].kind === 'want')
  return [...spending, 'savings', 'transfer', 'income']
}

// ───────────────────────────── insights ─────────────────────────────

const LABELS: Record<string, string> = {
  spent: 'Spent',
  projected: 'Projected month-end',
  target: 'Target',
  dayOfMonth: 'Day of month',
  daysInMonth: 'Days in month',
  safeToSpendToday: 'Safe to spend today',
  thisMonth: 'This month',
  comparedWith: 'Compared with',
  change: 'Change',
  pct: 'Change',
  count: 'Purchases',
  total: 'Total',
  topCategory: 'Mostly',
  topCategorySharePct: 'Share of that category',
  yearly: 'A year at this rate',
  monthly: 'Per month',
  annual: 'Per year',
  weekendDays: 'Weekend days',
  weekdays: 'Weekdays',
  perWeekendDay: 'Per weekend day',
  perWeekday: 'Per weekday',
  ratio: 'Weekend vs weekday',
  merchant: 'Merchant',
  sharePct: 'Share of spending',
  amount: 'Amount',
  typical: 'Typical',
  score: 'Unusualness score',
  date: 'Date',
  saved: 'Saved to goals',
  income: 'Income',
  ratePct: 'Savings rate',
  surplus: 'Surplus',
  goalPct: 'Goal progress',
}

const COUNT_KEYS = new Set(['count', 'dayOfMonth', 'daysInMonth', 'weekendDays', 'weekdays'])
const HIDDEN_KEYS = new Set(['txnId'])

export function humanize(key: string): string {
  if (LABELS[key]) return LABELS[key]
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface EvidenceRow {
  key: string
  label: string
  value: string
}

/** The numbers behind an insight, formatted by what they are (money, counts, percents, ratios, labels). */
export function evidenceRows(evidence: Record<string, number | string>, currency: Currency): EvidenceRow[] {
  const rows: EvidenceRow[] = []
  for (const [key, raw] of Object.entries(evidence)) {
    if (HIDDEN_KEYS.has(key)) continue
    let value: string
    if (typeof raw === 'string') {
      if (key === 'topCategory' && raw in CATEGORIES) value = CATEGORIES[raw as CategoryId].label
      else if (key === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) value = dateLabel(raw)
      else value = raw
    } else if (!Number.isFinite(raw)) continue
    else if (/pct$/i.test(key)) value = `${key === 'pct' && raw > 0 ? '+' : ''}${Number(raw.toFixed(1))}%`
    else if (COUNT_KEYS.has(key)) value = String(Math.round(raw))
    else if (key === 'ratio') value = `${raw}×`
    else if (key === 'score') value = raw.toFixed(1)
    else value = fmt(Math.round(raw), currency, { signed: key === 'change' })
    rows.push({ key, label: humanize(key), value })
  }
  return rows
}

export type SeverityView = { label: string; tone: 'over' | 'under' | 'accent' }

export function severityView(s: Insight['severity']): SeverityView {
  if (s === 'warn') return { label: 'Heads-up', tone: 'over' }
  if (s === 'positive') return { label: 'Nice one', tone: 'under' }
  return { label: 'Pattern', tone: 'accent' }
}

/** A question the on-device engine understands (breakdown intent with category + month slots). */
export function askAboutCategory(category: CategoryId, month: YearMonth): string {
  return `How much did I spend on ${CATEGORIES[category].label.toLowerCase()} in ${monthName(month)}?`
}

// ───────────────────────────── URL state ─────────────────────────────

export const TABS = ['overview', 'patterns', 'transactions'] as const
export type InsightsTab = (typeof TABS)[number]

export function resolveTab(t: string | undefined): InsightsTab {
  return (TABS as readonly string[]).includes(t ?? '') ? (t as InsightsTab) : 'overview'
}

/** Only non-default values go into the hash so `#/insights` stays clean. */
export function insightsQuery(state: { month: YearMonth; tab: InsightsTab; current: YearMonth; q?: string; cat?: string }): Record<string, string> {
  const q: Record<string, string> = {}
  if (state.month !== state.current) q.month = state.month
  if (state.tab !== 'overview') q.tab = state.tab
  if (state.cat) q.cat = state.cat
  if (state.q) q.q = state.q
  return q
}

// ───────────────────────────── month data ─────────────────────────────

/** The engine's derived summary for the current month; past months are summarised on demand. */
export function summaryFor(ctx: FinanceContext, month: YearMonth, current: MonthSummary | null): MonthSummary {
  return current && current.month === month ? current : summarizeMonth(ctx, month)
}

/** derived.insights for the current month; past months run the same generator for that month. */
export function insightsFor(ctx: FinanceContext, month: YearMonth, currentMonth: YearMonth, current: Insight[]): Insight[] {
  return month === currentMonth ? current : generateInsights(ctx, month)
}

/** Ledger rows the user recognises: the pot side of a checking→pot move is the same money twice. */
export function ledgerTxns(txns: Transaction[], potIds: ReadonlySet<string>): Transaction[] {
  return potIds.size ? txns.filter((t) => !potIds.has(t.accountId)) : txns
}

// ───────────────────────────── headline stats ─────────────────────────────

export interface StatView {
  /** money for the value slot */
  amount: Minor
  label: string
  /** delta line, e.g. "over target" / "+23% vs Sep 1–22" */
  note: string
  direction: 'up' | 'down' | 'flat'
  /** whether this is good news (spending less = good) */
  good?: boolean
}

export function vsTargetStat(s: MonthSummary): StatView {
  const diff = s.spent - s.target
  if (diff > 0) return { amount: diff, label: 'Over target', note: `${pctText(diff, s.target)} over`, direction: 'up', good: false }
  const left = -diff
  if (s.isCurrent) return { amount: left, label: 'Left to target', note: `${Math.max(0, s.daysInMonth - s.dayOfMonth)} days left`, direction: 'down', good: true }
  return { amount: left, label: 'Under target', note: `${pctText(left, s.target)} under`, direction: 'down', good: true }
}

export function vsPrevStat(c: Comparison | null): StatView | null {
  if (!c) return null
  const flat = c.pct !== null ? Math.abs(c.pct) < 2 : c.diff === 0
  const note = flat ? 'about the same' : c.pct === null ? 'new spending' : `${Math.abs(c.pct)}% ${c.diff > 0 ? 'more' : 'less'}`
  return {
    amount: c.amount,
    label: `vs ${c.label}`,
    note,
    direction: flat ? 'flat' : c.diff > 0 ? 'up' : 'down',
    good: flat ? undefined : c.diff < 0,
  }
}

export function dailyStat(s: MonthSummary): StatView {
  const days = s.isCurrent ? s.dayOfMonth : s.daysInMonth
  return { amount: s.dailyAvg, label: 'Per day', note: `${days}-day average`, direction: 'flat' }
}

function pctText(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : ''
}

// ───────────────────────────── needs / wants / saved slices ─────────────────────────────

export interface SplitSlice {
  id: 'needs' | 'wants' | 'saved' | 'unspent'
  label: string
  value: Minor
  /** share of income, 0..100 (null without income) */
  pct: number | null
  /** 50/30/20 guide share, when the slice has one */
  guide?: number
  color: string
}

const SLICE_COLOR = { needs: 'var(--chart-1)', wants: 'var(--chart-2)', saved: 'var(--chart-3)', unspent: 'var(--chart-track)' }

/**
 * The month as shares of income. The leftover slice makes the ring add up to income, so the percentages
 * mean the same thing as the 50/30/20 guide (share of income), not share of spending.
 */
export function splitSlices(sp: Split, isCurrent: boolean): SplitSlice[] {
  const used = sp.needs + sp.wants + sp.saved
  const left = Math.max(0, sp.income - used)
  const base = Math.max(sp.income, used)
  const pct = (v: Minor) => (sp.income > 0 ? Math.round((v / sp.income) * 100) : null)
  const slices: SplitSlice[] = [
    { id: 'needs', label: 'Needs', value: sp.needs, pct: pct(sp.needs), guide: GUIDE.needs, color: SLICE_COLOR.needs },
    { id: 'wants', label: 'Wants', value: sp.wants, pct: pct(sp.wants), guide: GUIDE.wants, color: SLICE_COLOR.wants },
    { id: 'saved', label: 'Saved', value: sp.saved, pct: pct(sp.saved), guide: GUIDE.saved, color: SLICE_COLOR.saved },
  ]
  if (left > 0 && base > 0) slices.push({ id: 'unspent', label: isCurrent ? 'Not spent yet' : 'Left over', value: left, pct: pct(left), color: SLICE_COLOR.unspent })
  return slices
}

/** "over" when a want/need share runs past the guide, or saving falls short of it (3-point tolerance). */
export function guideStatus(s: SplitSlice): 'over' | 'under' | 'ok' | null {
  if (s.guide === undefined || s.pct === null) return null
  const gap = s.pct - s.guide
  if (s.id === 'saved') return gap <= -3 ? 'under' : 'ok'
  return gap >= 3 ? 'over' : 'ok'
}

// ───────────────────────────── trend chart ─────────────────────────────

export interface TrendGeometry {
  ticks: number[]
  max: number
  /** percent heights on the shared scale */
  bars: { spentPct: number; targetPct: number; projectedPct: number | null }[]
}

export function trendGeometry(bars: TrendBar[]): TrendGeometry {
  const top = Math.max(1, ...bars.map((b) => Math.max(b.spent, b.target, b.projected ?? 0)))
  // a little headroom for the value labels; ticks never run past the scale so the bars use the height
  const max = Math.round(top * 1.12)
  const ticks = niceTicks(max, 4).filter((t) => t <= max)
  const h = (v: number) => pctOf(v, max)
  return {
    ticks,
    max,
    bars: bars.map((b) => ({ spentPct: h(b.spent), targetPct: h(b.target), projectedPct: b.projected !== undefined ? h(b.projected) : null })),
  }
}

/** Bar-top labels: "9.6k" / "850" (major units, no symbol: the axis carries the currency). */
export function shortAmount(m: Minor, currency: Currency): string {
  const major = m / (currency === 'JPY' ? 1 : 100)
  if (major >= 1000) return `${Number((major / 1000).toFixed(major >= 100000 ? 0 : 1))}k`
  return String(Math.round(major))
}

export function trendSummary(bars: TrendBar[], currency: Currency): string {
  const done = bars.filter((b) => !b.current)
  if (bars.length === 0) return 'No months to compare yet.'
  const over = done.filter((b) => b.over).length
  const avg = done.length ? Math.round(done.reduce((s, b) => s + b.spent, 0) / done.length) : 0
  const cur = bars.find((b) => b.current)
  const parts: string[] = []
  const avgText = fmt(Math.round(avg / 100) * 100, currency)
  if (done.length && over === 0) parts.push(`All ${done.length} finished months came in under target, averaging ${avgText}.`)
  else if (done.length) parts.push(`${over} of the last ${done.length} finished months went over target; they averaged ${avgText}.`)
  if (cur) parts.push(`${monthName(cur.month)} so far: ${fmt(Math.round(cur.spent / 100) * 100, currency)}${cur.projected ? `, heading for about ${fmt(Math.round(cur.projected / 100) * 100, currency)}` : ''}.`)
  return parts.join(' ')
}

// ───────────────────────────── budget edit ─────────────────────────────

export type LimitParse = { ok: true; value: Minor } | { ok: false; error: string }

/** A monthly limit typed by the user: whole amount, 0 removes the limit, capped at 10× the target. */
export function parseLimit(text: string, currency: Currency, target: Minor): LimitParse {
  const t = text.trim()
  if (t === '') return { ok: false, error: 'Enter an amount, or 0 to remove the limit.' }
  const v = parseAmount(t, currency)
  if (v === null || !Number.isFinite(v) || v < 0) return { ok: false, error: `Enter an amount like ${fmt(50000, currency, { bare: true })}.` }
  const whole = Math.round(v / 100) * 100
  if (target > 0 && whole > target * 10) return { ok: false, error: `That's more than 10× your monthly target.` }
  return { ok: true, value: whole }
}

// ───────────────────────────── ask Bun ─────────────────────────────

/** A question the on-device engine routes well for an insight (breakdown, search, overview…). */
export function askAboutInsight(i: Insight, month: YearMonth): string {
  const m = monthName(month)
  if (typeof i.evidence.merchant === 'string') return `Show me my ${i.evidence.merchant} spending in ${m}`
  switch (i.kind) {
    case 'pace_warning':
    case 'under_budget':
      return `How am I doing in ${m}?`
    case 'subscription_load':
      return 'What subscriptions do I have?'
    case 'savings_rate':
      return 'How are my goals going?'
    case 'weekend_spike':
      return 'What are my spending insights?'
    default:
      return i.category ? askAboutCategory(i.category, month) : 'What are my spending insights?'
  }
}

/**
 * The dream chip already says "= 1.3% of your Birkin 25", so a closing "That's 1.3% of your Birkin 25."
 * sentence in the body is dropped. Sentences that add a number ("The extra ¥1,008 = …") are kept.
 */
export function bodyWithoutDream(body: string, label: string): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const trimmed = body.replace(new RegExp(`\\s*That's ${esc}( you kept)?\\.\\s*$`), '').trim()
  return trimmed || body
}

/** Order insights so the most useful comes first; the engine already scores them, this keeps that order stable. */
/**
 * The category sheet's comparison line. A month in progress compares like with like — the previous month up to
 * the same day (CategorySpend.prevMonthToDate) — and then names the whole previous month; a finished month
 * compares with all of the previous one.
 */
export function categoryCompareText(s: MonthSummary, category: CategoryId, currency: Currency): string {
  const row = s.byCategory.find((r) => r.category === category)
  const spent = row?.spent ?? 0
  const prev = row?.prevMonth ?? 0
  const prevMonth = shiftMonth(s.month, -1)
  const pctChange = (base: Minor) => (base > 0 ? Math.round(((spent - base) / base) * 100) : null)
  const changeText = (c: number | null, where: string) => (c !== null && c !== 0 ? ` (${c > 0 ? '+' : '−'}${Math.abs(c)}% ${where})` : '')
  if (prev <= 0) return `Nothing here in ${monthName(prevMonth)}.`
  if (!s.isCurrent) return `${monthName(prevMonth)}: ${fmt(prev, currency)}${changeText(pctChange(prev), `in ${monthName(s.month, 'short')}`)}`
  const day = Math.min(s.dayOfMonth, daysInMonth(prevMonth))
  const toDate = row?.prevMonthToDate ?? 0
  return `By ${monthName(prevMonth, 'short')} ${day}: ${fmt(toDate, currency)}${changeText(pctChange(toDate), 'now')} · all of ${monthName(prevMonth)}: ${fmt(prev, currency)}`
}

/** The month an engine insight id belongs to (`ins_<kind>_<YYYY-MM>[_<key>]`), if it carries one. */
export function insightMonthOf(id: string | undefined): YearMonth | undefined {
  const m = id?.match(/^ins_[a-z_]+?_(\d{4}-\d{2})(?:_|$)/)
  return m ? m[1] : undefined
}

/**
 * For a deep link (#/insights/<insightId>): should the folded list start expanded so the linked card is visible?
 * The featured card and the first SHOW-1 others are always shown.
 */
export function needsExpandFor(id: string | undefined, list: Insight[], shown: number): boolean {
  if (!id) return false
  const i = list.findIndex((x) => x.id === id)
  return i >= shown
}

export function featuredInsight(list: Insight[]): { featured: Insight | null; rest: Insight[] } {
  return { featured: list[0] ?? null, rest: list.slice(1) }
}
