import type { AffordabilityResult, CategoryId, FinanceContext, Minor } from '../types'

/**
 * "Should I buy it?" — verdict 'go' when the purchase fits the remaining monthly budget with >= 10%
 * headroom and does not breach a category budget; 'think' when it fits but leaves < 10% headroom or
 * breaches a category budget; 'skip' when the month would end over target. Includes hours of work,
 * goal delay days for the primary goal, dream equivalents and plain reasons.
 */
export function checkAffordability(ctx: FinanceContext, amount: Minor, label = 'this', category?: CategoryId): AffordabilityResult {
  throw new Error('TODO checkAffordability ' + ctx.profile.name + amount + label + category)
}
