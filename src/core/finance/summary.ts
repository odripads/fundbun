import { isSpendingCategory } from '../categories'
import { addDays, dayOfMonth, daysInMonth, diffDays, endOfMonth, monthsBack, shiftMonth, startOfMonth, ym } from '../dates'
import type {
  Bill,
  CategoryId,
  CategorySpend,
  FinanceContext,
  ISODate,
  Minor,
  MonthHistoryPoint,
  MonthSummary,
  RecurringSeries,
  Transaction,
  YearMonth,
} from '../types'
import { roundMajor } from '../money'
import { detectAnomalies } from './anomalies'
import { normalizeMerchant } from './categorize'
import { FIXED_CATEGORIES, isSpending, monthIncome, monthSpend, savedInMonth, spendValue, upTo } from './ledger'
import { detectRecurring } from './recurring'

export { isSpending } from './ledger'

/** Only big one-offs leave the run rate; a run of "anomalies" at 2× is more likely a new normal. */
const ONE_OFF_RATIO = 3

/** Spending transactions (outflows) optionally restricted to a month. */
export function spendingTxns(txns: Transaction[], month?: YearMonth): Transaction[] {
  return txns.filter((t) => isSpending(t) && (!month || ym(t.date) === month))
}

/** Unpaid bills that fall due in `month` (for the current month, also anything already overdue). */
export function unpaidBillsDue(bills: Bill[], month: YearMonth, includeOverdue: boolean): Bill[] {
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  return bills.filter((b) => b.status !== 'paid' && b.dueDate <= end && (includeOverdue || b.dueDate >= start))
}

/** A bill for this month (paid or not) already accounts for the series' charge: paid ones are in `spent`, unpaid in billsDue. */
function billsCover(series: RecurringSeries, monthBills: Bill[], byId: Map<string, Transaction>): boolean {
  const seriesPayees = new Set(series.txnIds.map((id) => byId.get(id)?.payeeId).filter(Boolean))
  return monthBills.some((b) => normalizeMerchant(b.name) === series.merchant || seriesPayees.has(b.payeeId))
}

function isFixedSeries(s: RecurringSeries): boolean {
  return s.isSubscription || FIXED_CATEGORIES.has(s.category)
}

/**
 * Fixed charges (subscriptions etc.) still expected in `month` that no bill already accounts for. A charge
 * whose expected date has passed without arriving still counts — it hasn't been paid yet.
 */
function expectedRecurring(series: RecurringSeries[], ctx: FinanceContext, month: YearMonth, byId: Map<string, Transaction>): Minor {
  const start = startOfMonth(month)
  const end = endOfMonth(month)
  const monthBills = ctx.bank.bills.filter((b) => b.dueDate <= end && (b.dueDate >= start || b.status !== 'paid'))
  let total = 0
  for (const s of series) {
    if (s.status !== 'active' || !isFixedSeries(s) || billsCover(s, monthBills, byId)) continue
    const weekly = s.cadence === 'weekly'
    for (let d = s.nextExpected; d <= end; d = addDays(d, 7)) {
      if (d >= start) total += s.lastAmount
      if (!weekly) break
    }
  }
  return total
}

function variableSpend(txns: Transaction[], month: YearMonth, isVariable: (t: Transaction) => boolean): Minor {
  return monthSpend(txns, month, isVariable).total
}

/** Average daily variable spend over the 3 months before `month`, counting only days the history covers. */
function baselineDailyVariable(
  txns: Transaction[],
  month: YearMonth,
  today: ISODate,
  isVariable: (t: Transaction) => boolean,
): number | undefined {
  if (txns.length === 0) return undefined
  const first = txns.reduce((min, t) => (t.date < min ? t.date : min), txns[0].date)
  let total = 0
  let days = 0
  for (const m of monthsBack(shiftMonth(month, -1), 3)) {
    const start = startOfMonth(m) > first ? startOfMonth(m) : first
    const end = endOfMonth(m) < today ? endOfMonth(m) : today
    if (start > end) continue
    days += diffDays(start, end) + 1
    total += variableSpend(txns, m, isVariable)
  }
  return days > 0 ? total / days : undefined
}

/**
 * Pace model (research note §5): spent so far + remaining days × blended daily variable rate + bills and
 * fixed charges still due. The rate blends this month's pace with the trailing-3-month baseline, weighted by
 * how much of the month has passed; outliers are excluded from the rate so one big purchase doesn't
 * project a huge month.
 */
function projectMonth(ctx: FinanceContext, month: YearMonth, day: number, spent: Minor, billsDue: Minor): Minor {
  const today = ctx.bank.today
  const txns = upTo(ctx.bank.transactions, today)
  const series = detectRecurring(txns, today, ctx.bank.cancelledMerchants)
  const fixedMerchants = new Set(series.filter(isFixedSeries).map((s) => s.merchant))
  const outliers = new Set(detectAnomalies(txns, today).filter((a) => a.amount >= a.typical * ONE_OFF_RATIO).map((a) => a.txnId))
  const isVariable = (t: Transaction) =>
    !FIXED_CATEGORIES.has(t.category) && !t.billId && !t.recurringId && !outliers.has(t.id) && !fixedMerchants.has(normalizeMerchant(t.merchant))

  const dim = daysInMonth(month)
  const currentRate = day > 0 ? variableSpend(txns, month, isVariable) / day : 0
  const baseline = baselineDailyVariable(txns, month, today, isVariable)
  const w = day / dim
  const rate = baseline === undefined ? currentRate : w * currentRate + (1 - w) * baseline
  const byId = new Map(txns.map((t) => [t.id, t]))
  const projected = spent + rate * (dim - day) + billsDue + expectedRecurring(series, ctx, month, byId)
  // a forecast has no business showing fen
  return Math.max(spent, roundMajor(projected, ctx.profile.currency))
}

function budgetLimits(ctx: FinanceContext, month: YearMonth): Map<CategoryId, Minor> {
  const plan = ctx.budget
  if (!plan || plan.month > month) return new Map()
  return new Map(plan.categories.map((c) => [c.category, c.limit]))
}

function categoryRows(
  current: ReturnType<typeof monthSpend>,
  prev: ReturnType<typeof monthSpend>,
  limits: Map<CategoryId, Minor>,
): CategorySpend[] {
  const cats = new Set<CategoryId>([...current.byCategory.keys(), ...limits.keys()])
  const rows: CategorySpend[] = []
  for (const category of cats) {
    if (!isSpendingCategory(category)) continue
    const e = current.byCategory.get(category) ?? { spent: 0, count: 0 }
    const limit = limits.get(category)
    rows.push({
      category,
      spent: e.spent,
      count: e.count,
      ...(limit !== undefined ? { limit, pct: limit > 0 ? Math.round((e.spent / limit) * 1000) / 10 : 0 } : {}),
      prevMonth: prev.byCategory.get(category)?.spent ?? 0,
    })
  }
  return rows.sort((a, b) => b.spent - a.spent || (b.limit ?? 0) - (a.limit ?? 0))
}

/**
 * Month summary. `month` defaults to the month of ctx.bank.today. For the current month, `projected`
 * uses a pace model (spent-so-far + remaining days × blended daily rate, where the blended rate mixes
 * this month's discretionary pace with the prior 3 months' average, and known upcoming bills are added).
 * For past months projected = spent.
 *
 * `spent` nets merchant refunds; reversed transactions (and their reversals) are ignored entirely.
 * safeToSpendToday = max(0, remaining − unpaid bills due this month) / days left including today.
 */
export function summarizeMonth(ctx: FinanceContext, month?: YearMonth): MonthSummary {
  const today = ctx.bank.today
  const current = ym(today)
  const m = month ?? current
  const isCurrent = m === current
  const isPast = m < current
  const dim = daysInMonth(m)
  const day = isCurrent ? dayOfMonth(today) : isPast ? dim : 0
  const txns = upTo(ctx.bank.transactions, today)
  const spend = monthSpend(txns, m)
  const target = ctx.profile.targetSpend
  const billsDue = isPast ? 0 : unpaidBillsDue(ctx.bank.bills, m, isCurrent).reduce((s, b) => s + b.amountDue, 0)
  const projected = isPast ? spend.total : projectMonth(ctx, m, day, spend.total, billsDue)
  const remaining = target - spend.total
  const daysLeft = isPast ? 0 : dim - day + (isCurrent ? 1 : 0)
  return {
    month: m,
    income: monthIncome(txns, m),
    spent: spend.total,
    target,
    byCategory: categoryRows(spend, monthSpend(txns, shiftMonth(m, -1)), budgetLimits(ctx, m)),
    daysInMonth: dim,
    dayOfMonth: day,
    projected,
    dailyAvg: day > 0 ? Math.round(spend.total / day) : 0,
    safeToSpendToday: daysLeft > 0 ? Math.floor(Math.max(0, remaining - billsDue) / daysLeft) : 0,
    remaining,
    savedToGoals: savedInMonth(txns, ctx.bank.accounts, m),
    isCurrent,
  }
}

/** Last `months` months (oldest first, including the current one). */
export function monthHistory(ctx: FinanceContext, months: number): MonthHistoryPoint[] {
  const txns = upTo(ctx.bank.transactions, ctx.bank.today)
  return monthsBack(ym(ctx.bank.today), Math.max(0, Math.floor(months))).map((month) => ({
    month,
    spent: monthSpend(txns, month).total,
    target: ctx.profile.targetSpend,
    income: monthIncome(txns, month),
  }))
}

/** Net spend of the given transactions (refunds net, reversed ignored). */
export function netSpend(txns: Transaction[]): Minor {
  return Math.max(0, txns.reduce((s, t) => s + spendValue(t), 0))
}
