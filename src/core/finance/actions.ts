import { CATEGORIES } from '../categories'
import { MINOR_PER_MAJOR } from '../money'
import type { CategoryId, Currency, FinanceContext, Minor, MonthSummary, SuggestedAction } from '../types'
import { moneyFmt } from './copy'
import { goalProgress, primaryGoal } from './dreams'

/** Suggested-action builders shared by the mirror and insights (internal). Code builds every CTA, never prose. */

export function majorUnits(n: number, currency: Currency): Minor {
  return n * MINOR_PER_MAJOR[currency]
}

export function roundDownTo10(m: Minor, currency: Currency): Minor {
  const ten = majorUnits(10, currency)
  return Math.floor(m / ten) * ten
}

/**
 * "Stash ¥X in <goal>": the full surplus of a finished month, half of a projected one (it isn't banked yet),
 * capped at what the goal still needs. Never a purchase.
 */
export function stashAction(ctx: FinanceContext, s: MonthSummary, surplus: Minor): SuggestedAction | undefined {
  const goal = primaryGoal(ctx.dreams.filter((d) => !d.achievedAt && d.price > 0))
  if (!goal || goal.kind !== 'goal' || surplus <= 0) return undefined
  const currency = ctx.profile.currency
  const progress = goalProgress(goal, ctx)
  const raw = s.isCurrent ? surplus / 2 : surplus
  const capped = Math.min(raw, Math.max(0, goal.price - progress.saved))
  const amount = capped >= majorUnits(10, currency) ? roundDownTo10(capped, currency) : Math.floor(capped)
  if (amount < majorUnits(1, currency)) return undefined
  return { tool: 'transfer_to_goal', args: { goalId: goal.id, amount }, label: `Stash ${moneyFmt(currency)(amount)} in ${goal.name}` }
}

/** A budget cap ~15% under the category's usual level (min ¥50), rounded down to ¥10. */
export function capCategoryAction(ctx: FinanceContext, category: CategoryId, usual: Minor): SuggestedAction {
  const currency = ctx.profile.currency
  const limit = Math.max(majorUnits(50, currency), roundDownTo10(usual * 0.85, currency))
  return { tool: 'set_category_budget', args: { category, limit }, label: `Cap ${CATEGORIES[category].label} at ${moneyFmt(currency)(limit)}` }
}

/** Over/pace-over CTA on the biggest 'want' category: a tripwire when it already has a budget, otherwise a cap. */
export function overspendAction(ctx: FinanceContext, s: MonthSummary): SuggestedAction {
  const row = s.byCategory.filter((r) => CATEGORIES[r.category].kind === 'want' && r.spent > 0).sort((a, b) => b.spent - a.spent)[0]
  if (!row) return { tool: 'create_tripwire', args: { kind: 'pace_over', threshold: 100 }, label: 'Warn me before I overshoot' }
  const label = CATEGORIES[row.category].label
  const hasTripwire = ctx.tripwires.some((t) => t.enabled && t.kind === 'category_pct' && t.category === row.category)
  if (row.limit !== undefined && !hasTripwire) {
    return { tool: 'create_tripwire', args: { kind: 'category_pct', threshold: 80, category: row.category }, label: `Alert me at 80% of ${label}` }
  }
  const usual = row.limit ?? (s.isCurrent ? Math.max(row.prevMonth ?? 0, row.spent) : row.spent)
  return capCategoryAction(ctx, row.category, usual)
}

/** "Alert me on days over ¥X", where X is an even share of the monthly target. */
export function dailyTripwireAction(ctx: FinanceContext, s: MonthSummary): SuggestedAction {
  const currency = ctx.profile.currency
  const threshold = Math.max(majorUnits(50, currency), roundDownTo10(s.target / s.daysInMonth, currency))
  return { tool: 'create_tripwire', args: { kind: 'daily_over', threshold }, label: `Alert me on days over ${moneyFmt(currency)(threshold)}` }
}
