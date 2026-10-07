import type { DreamEquivalent, DreamItem, FinanceContext, GoalProgress, Minor, Profile } from '../types'

/** The goal shown by default: first non-achieved item of kind 'goal' (fallback: most expensive item). */
export function primaryGoal(dreams: DreamItem[]): DreamItem | undefined {
  throw new Error('TODO primaryGoal ' + dreams.length)
}

/** Progress from the item's pot balance; monthlyRate = average net pot inflow over the last 3 months. */
export function goalProgress(item: DreamItem, ctx: FinanceContext): GoalProgress {
  throw new Error('TODO goalProgress ' + item.id + ctx.profile.name)
}

export function allGoalProgress(ctx: FinanceContext): GoalProgress[] {
  throw new Error('TODO allGoalProgress ' + ctx.profile.name)
}

/**
 * Express `amount` in dream items, most relatable first: whole items the amount buys (largest affordable
 * first, e.g. "2× New sneakers"), then the fraction of the primary goal ("38% of your Birkin").
 */
export function dreamEquivalents(amount: Minor, dreams: DreamItem[], max = 3): DreamEquivalent[] {
  throw new Error('TODO dreamEquivalents ' + amount + dreams.length + max)
}

/** Days by which spending `amount` delays a goal at its current monthly saving rate (0 if no rate). */
export function goalDelayDays(amount: Minor, progress: GoalProgress, fallbackMonthlyRate: Minor): number {
  throw new Error('TODO goalDelayDays ' + amount + progress.itemId + fallbackMonthlyRate)
}

/** amount ÷ (monthlyIncome ÷ workHoursPerMonth), one decimal. */
export function hoursOfWork(amount: Minor, profile: Profile): number {
  throw new Error('TODO hoursOfWork ' + amount + profile.name)
}
