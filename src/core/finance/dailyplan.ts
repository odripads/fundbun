import { addDays } from '../dates'
import type { DailyPlan, FinanceContext, ISODate, Minor, MonthSummary } from '../types'
import { MINOR_PER_MAJOR } from '../money'
import { copyFmt, delayPhrase } from './copy'
import { fallbackMonthlyRate, goalDelayDays, goalProgress, primaryGoal } from './dreams'
import { FIXED_CATEGORIES, isSpending, upTo } from './ledger'
import { unpaidBillsDue } from './summary'

/**
 * The daily amount: when the month runs over, "spend nothing until the 1st" is not a plan anyone keeps. So Bun
 * asks what the user can realistically live on per day for the rest of the month, shows what that costs their
 * goal, and from then on judges each day by that amount (finance/temper uses it as the day limit).
 */

/** How many recent days the usual daily spending is averaged over. */
export const USUAL_WINDOW_DAYS = 28

/** The plan set for the month in `s`, if any. */
export function planFor(ctx: Pick<FinanceContext, 'dailyPlan'>, month: string): DailyPlan | undefined {
  return ctx.dailyPlan && ctx.dailyPlan.month === month && ctx.dailyPlan.amount > 0 ? ctx.dailyPlan : undefined
}

/** Average day-to-day spending per day (no rent, bills or subscriptions) over the last USUAL_WINDOW_DAYS days. */
export function usualDaily(ctx: FinanceContext): Minor {
  const today = ctx.bank.today
  const from = addDays(today, -USUAL_WINDOW_DAYS)
  let total = 0
  let first: ISODate | undefined
  for (const t of upTo(ctx.bank.transactions, today)) {
    if (t.date <= from || !isSpending(t) || t.billId || FIXED_CATEGORIES.has(t.category)) continue
    total -= t.amount
    if (!first || t.date < first) first = t.date
  }
  if (!first) return 0
  // a newer user is averaged over the days they have, not over 28
  const days = Math.min(USUAL_WINDOW_DAYS, Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000) + 1))
  return Math.round(total / days)
}

export interface PlanImpact {
  amount: Minor
  /** days it covers, today included */
  days: number
  /** where the month ends: spent so far, plus the amount each day left, plus bills still due */
  monthEnd: Minor
  /** monthEnd - target (negative = left over) */
  vsTarget: Minor
  goal?: {
    name: string
    /** how many days the overshoot pushes the goal back (0 when the month lands on target) */
    delayDays: number
    /** the goal's new estimate, when it has one */
    etaDate?: ISODate
    targetDate?: ISODate
    /** the new estimate lands after the user's own date */
    afterTarget?: boolean
  }
  /** one sentence, said in the sheet and in chat */
  text: string
}

/** What living on `amount` a day for the rest of the month in `s` means for the month and the main goal. */
export function planImpact(ctx: FinanceContext, s: MonthSummary, amount: Minor): PlanImpact {
  const f = copyFmt(ctx.profile.currency)
  const today = ctx.bank.today
  const days = s.isCurrent ? Math.max(1, s.daysInMonth - s.dayOfMonth + 1) : 0
  let spentToday = 0
  for (const t of ctx.bank.transactions) if (t.date === today && isSpending(t) && !t.billId && !FIXED_CATEGORIES.has(t.category)) spentToday -= t.amount
  const billsDue = s.isCurrent ? unpaidBillsDue(ctx.bank.bills, s.month, true).reduce((sum, b) => sum + Math.max(0, b.amountDue), 0) : 0
  // today counts what is still to come today; the days after it count in full
  const monthEnd = s.spent + (days > 0 ? Math.max(0, amount - spentToday) + amount * (days - 1) : 0) + billsDue
  const vsTarget = monthEnd - s.target
  const main = primaryGoal(ctx.dreams.filter((d) => !d.achievedAt && d.price > 0 && d.kind === 'goal'))
  let goal: PlanImpact['goal']
  if (main) {
    const p = goalProgress(main, ctx)
    const delayDays = vsTarget > 0 ? goalDelayDays(vsTarget, p, fallbackMonthlyRate(ctx.profile)) : 0
    const etaDate = p.etaDate ? addDays(p.etaDate, delayDays) : undefined
    goal = {
      name: main.name,
      delayDays,
      ...(etaDate ? { etaDate } : {}),
      ...(main.targetDate ? { targetDate: main.targetDate, ...(etaDate ? { afterTarget: etaDate > main.targetDate } : {}) } : {}),
    }
  }
  const month = s.month
  const lead = `At ${f(amount)} a day, ${monthName(month)} ends around ${f(monthEnd)}`
  const verdict = vsTarget > 0 ? `, ${f(vsTarget)} over your ${f(s.target)} target.` : `, within your ${f(s.target)} target.`
  const cost = goal
    ? goal.delayDays > 0
      ? ` That moves your ${goal.name} ${delayPhrase(goal.delayDays)} further away${goal.afterTarget ? ', past the date you set' : ''}.`
      : ` Your ${goal.name} stays on schedule.`
    : ''
  return { amount, days, monthEnd, vsTarget, ...(goal ? { goal } : {}), text: `${lead}${verdict}${cost}` }
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
}

/**
 * Amounts to offer, lowest first: the even share of what is left of the target (when there is any), the day limit,
 * and the user's usual day, plus a tighter and a middle step. Whole currency units, at least 1, no duplicates.
 */
export function planOptions(ctx: FinanceContext, s: MonthSummary, dayLimit: Minor): Minor[] {
  const unit = MINOR_PER_MAJOR[ctx.profile.currency] ?? 100
  const step = 10 * unit
  const round = (m: number) => Math.max(unit, Math.round(m / step) * step || unit)
  const usual = usualDaily(ctx)
  const daysLeft = Math.max(1, s.daysInMonth - s.dayOfMonth + 1)
  const leftShare = s.remaining > 0 ? Math.floor(s.remaining / daysLeft) : 0
  const raw = [usual * 0.5, usual * 0.75, usual, dayLimit, leftShare].filter((m) => m > 0)
  return [...new Set(raw.map(round))].sort((a, b) => a - b).slice(0, 4)
}
