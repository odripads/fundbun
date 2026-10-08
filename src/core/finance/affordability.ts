import { CATEGORIES } from '../categories'
import type { AffordabilityResult, CategoryId, FinanceContext, Minor } from '../types'
import { copyFmt, delayPhrase, delayShort, moneyFmt } from './copy'
import { dreamEquivalents, fallbackMonthlyRate, goalDelayDays, goalProgress, hoursOfWork, primaryGoal } from './dreams'
import { PACE_FROM_DAY, PACE_OVER } from './mirror'
import { summarizeMonth, unpaidBillsDue } from './summary'

const HEADROOM = 0.1

/**
 * "Should I buy it?" — one verdict rule shared with the Dream Mirror (finance/mirror):
 *  · 'skip' when checking can't cover it, when the month is already over target (or this purchase takes spending
 *    past it), or when — with the purchase — the month heads more than 5% over target (the mirror's pace band)
 *    and the price is more than today's safe-to-spend;
 *  · 'think' when it fits but the month would end over target (within the band, or the purchase is within today's
 *    safe-to-spend while the pace runs hot), leaves < 10% headroom, or breaches a category budget;
 *  · 'go' otherwise.
 * Where the month is heading is the projection (pace + bills still due) — except in the first PACE_FROM_DAY days,
 * when projections are noise and the mirror gives no pace verdict: then it is spending so far + bills still due.
 * `basis` says which, and `projectedAfter` is that month-end with the purchase. Includes hours of work, goal delay
 * days (and `delayText`, the one short form shared by every surface) for the primary goal, dream equivalents and
 * plain reasons.
 */
export function checkAffordability(ctx: FinanceContext, amount: Minor, label = 'this', category?: CategoryId): AffordabilityResult {
  // the price is exact; balances, projections and targets read as whole yuan from ¥100
  const fx = moneyFmt(ctx.profile.currency)
  const f = copyFmt(ctx.profile.currency)
  const s = summarizeMonth(ctx)
  const price = Math.max(0, Math.round(amount))
  const target = s.target
  const early = s.isCurrent && s.dayOfMonth < PACE_FROM_DAY
  const billsDue = s.isCurrent ? unpaidBillsDue(ctx.bank.bills, s.month, true).reduce((t, b) => t + Math.max(0, b.amountDue), 0) : 0
  // where the month is heading before this purchase — on the same basis as the mirror's verdict
  const heading = early ? s.spent + billsDue : s.projected
  const basis: AffordabilityResult['basis'] = early ? 'spent_and_bills' : 'projection'
  const band = target * PACE_OVER
  const remainingAfter = s.remaining - price
  const projectedAfter = heading + price
  const overTargetBy = Math.max(0, projectedAfter - target)
  const headroom = target - projectedAfter

  const row = category ? s.byCategory.find((r) => r.category === category) : undefined
  const catLimit = category ? (row?.limit ?? ctx.budget?.categories.find((c) => c.category === category)?.limit) : undefined
  const catAfter = (row?.spent ?? 0) + price
  const breachesCategory = catLimit !== undefined && catAfter > catLimit
  const checking = ctx.bank.accounts.find((a) => a.type === 'checking')
  const cantPay = !!checking && price > checking.balance
  const alreadyOver = s.spent > target
  const takesOver = !alreadyOver && s.spent + price > target
  const fitsToday = price <= s.safeToSpendToday
  const runsHot = projectedAfter > band

  const goalItem = primaryGoal(ctx.dreams.filter((d) => !d.achievedAt && d.price > 0))
  const progress = goalItem ? goalProgress(goalItem, ctx) : undefined
  const delay = progress ? goalDelayDays(price, progress, fallbackMonthlyRate(ctx.profile)) : 0
  const hours = hoursOfWork(price, ctx.profile)
  const equivalents = dreamEquivalents(price, ctx.dreams, 3)

  const verdict: AffordabilityResult['verdict'] =
    price === 0 ? 'go'
    : cantPay || alreadyOver || takesOver || (runsHot && !fitsToday) ? 'skip'
    : overTargetBy > 0 || headroom < target * HEADROOM || breachesCategory ? 'think'
    : 'go'

  const reasons: string[] = []
  if (price === 0) reasons.push('Nothing to check — there is no cost.')
  if (cantPay) reasons.push(`Your checking balance (${f(checking!.balance)}) doesn't cover ${fx(price)}.`)
  if (price > 0) {
    if (alreadyOver) reasons.push(`You're already ${f(s.spent - target)} over your ${f(target)} target this month.`)
    else if (takesOver) reasons.push(`It takes your spending ${f(s.spent + price - target)} past your ${f(target)} target.`)
    else if (heading > band) {
      reasons.push(`You're already on pace to end the month ${f(heading - target)} over your ${f(target)} target${fitsToday ? ` — it fits today's safe-to-spend, so it's your call` : ''}.`)
    } else if (overTargetBy > 0) {
      reasons.push(`With this, the month would end around ${f(projectedAfter)} — ${f(overTargetBy)} over your ${f(target)} target.`)
    } else {
      reasons.push(`With this, you'd finish around ${f(projectedAfter)}, leaving ${f(headroom)} of your ${f(target)} target${headroom < target * HEADROOM ? ' — a thin cushion' : ''}.`)
    }
    if (early) reasons.push(`It's early in the month, so that counts what you've spent plus bills still due — not a projection.`)
  }
  if (breachesCategory) reasons.push(`${CATEGORIES[category!].label} would reach ${f(catAfter)} of its ${f(catLimit!)} budget.`)
  if (price > 0) {
    reasons.push(remainingAfter >= 0 ? `Left to spend this month after it: ${f(remainingAfter)}.` : `It takes you ${f(-remainingAfter)} past this month's target.`)
    reasons.push(`Safe to spend today: ${f(s.safeToSpendToday)}.`)
    if (hours > 0) reasons.push(`It's about ${hours} hours of work.`)
    if (progress && delay > 0) reasons.push(`It pushes your ${progress.name} back ${delayPhrase(delay)}.`)
    if (equivalents[0]) reasons.push(`It equals ${equivalents[0].label}.`)
  }

  return {
    amount: price,
    label,
    verdict,
    safeToSpendToday: s.safeToSpendToday,
    remainingAfter,
    overTargetBy,
    projectedAfter,
    basis,
    hoursOfWork: hours,
    ...(progress ? { goalName: progress.name, goalDelayDays: delay, ...(delay > 0 ? { delayText: delayShort(delay) } : {}) } : {}),
    equivalents,
    reasons,
  }
}
