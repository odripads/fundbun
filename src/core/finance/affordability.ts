import { CATEGORIES } from '../categories'
import type { AffordabilityResult, CategoryId, FinanceContext, Minor } from '../types'
import { copyFmt, delayPhrase, moneyFmt } from './copy'
import { dreamEquivalents, fallbackMonthlyRate, goalDelayDays, goalProgress, hoursOfWork, primaryGoal } from './dreams'
import { summarizeMonth } from './summary'

const HEADROOM = 0.1

/**
 * "Should I buy it?" — verdict 'go' when the purchase fits the remaining monthly budget with >= 10%
 * headroom and does not breach a category budget; 'think' when it fits but leaves < 10% headroom or
 * breaches a category budget; 'skip' when the month would end over target. Includes hours of work,
 * goal delay days for the primary goal, dream equivalents and plain reasons.
 *
 * "Fits" is judged on the projected month-end (pace + bills still due), not just spend so far, and a
 * purchase the checking balance can't cover is always 'skip'.
 */
export function checkAffordability(ctx: FinanceContext, amount: Minor, label = 'this', category?: CategoryId): AffordabilityResult {
  // the price is exact; balances, projections and targets read as whole yuan from ¥100
  const fx = moneyFmt(ctx.profile.currency)
  const f = copyFmt(ctx.profile.currency)
  const s = summarizeMonth(ctx)
  const price = Math.max(0, Math.round(amount))
  const target = s.target
  const remainingAfter = s.remaining - price
  const projectedAfter = s.projected + price
  const overTargetBy = Math.max(0, projectedAfter - target)
  const headroom = target - projectedAfter

  const row = category ? s.byCategory.find((r) => r.category === category) : undefined
  const catLimit = category ? (row?.limit ?? ctx.budget?.categories.find((c) => c.category === category)?.limit) : undefined
  const catAfter = (row?.spent ?? 0) + price
  const breachesCategory = catLimit !== undefined && catAfter > catLimit
  const checking = ctx.bank.accounts.find((a) => a.type === 'checking')
  const cantPay = !!checking && price > checking.balance

  const goalItem = primaryGoal(ctx.dreams.filter((d) => !d.achievedAt && d.price > 0))
  const progress = goalItem ? goalProgress(goalItem, ctx) : undefined
  const delay = progress ? goalDelayDays(price, progress, fallbackMonthlyRate(ctx.profile)) : 0
  const hours = hoursOfWork(price, ctx.profile)
  const equivalents = dreamEquivalents(price, ctx.dreams, 3)

  const verdict: AffordabilityResult['verdict'] =
    price === 0 ? 'go'
    : cantPay || overTargetBy > 0 ? 'skip'
    : headroom < target * HEADROOM || breachesCategory ? 'think'
    : 'go'

  const reasons: string[] = []
  if (price === 0) reasons.push('Nothing to check — there is no cost.')
  if (cantPay) reasons.push(`Your checking balance (${f(checking!.balance)}) doesn't cover ${fx(price)}.`)
  if (price > 0 && s.projected > target) {
    reasons.push(`You're already on pace to end the month ${f(s.projected - target)} over your ${f(target)} target.`)
  } else if (overTargetBy > 0) {
    reasons.push(`With this, the month would end around ${f(projectedAfter)} — ${f(overTargetBy)} over your ${f(target)} target.`)
  } else if (price > 0) {
    reasons.push(`With this, you'd finish around ${f(projectedAfter)}, leaving ${f(headroom)} of your ${f(target)} target${headroom < target * HEADROOM ? ' — a thin cushion' : ''}.`)
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
    hoursOfWork: hours,
    ...(progress ? { goalName: progress.name, goalDelayDays: delay } : {}),
    equivalents,
    reasons,
  }
}
