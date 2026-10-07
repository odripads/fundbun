import type { FinanceContext, Insight, YearMonth } from '../types'

/**
 * Spending insights for a month: category_up / category_down (vs previous month, >= 20% and >= ¥200),
 * top_merchant, late_night (22:00–04:00 spend, esp. delivery), small_frequent ("latte factor": many
 * purchases < ¥40 adding up), weekend_spike, pace_warning, under_budget, subscription_load, anomaly
 * (from detectAnomalies), savings_rate. Each has a plain-language `why`, evidence numbers, a dream
 * equivalent and, where useful, a suggestedAction. Max 8, most useful first.
 */
export function generateInsights(ctx: FinanceContext, month?: YearMonth): Insight[] {
  throw new Error('TODO generateInsights ' + ctx.profile.name + month)
}
