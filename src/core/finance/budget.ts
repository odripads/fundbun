import type { BudgetPlan, FinanceContext, YearMonth } from '../types'

/**
 * Propose a monthly budget plan whose category limits sum to profile.targetSpend.
 * 'history': allocate target proportionally to the last 3 months' category medians, trimming 'want'
 *   categories first when history exceeds target (needs are protected).
 * 'fifty_thirty_twenty': needs ≈ 50% of income, wants ≈ 30%, savings 20%, capped to targetSpend.
 * Round limits to whole yuan (multiples of 10 major units when >= 500). Include a one-line rationale.
 */
export function proposeBudget(ctx: FinanceContext, method: BudgetPlan['method'], month: YearMonth): BudgetPlan {
  throw new Error('TODO proposeBudget ' + ctx.profile.name + method + month)
}
