import type { BillFinding, FinanceContext, RecurringSeries } from '../types'

/**
 * Bill analysis findings: price_hike (recurring series whose latest amount rose >= 5%), duplicate_charge
 * (same merchant + same amount within 48h, or two charges of one subscription in one period), due_soon
 * (unpaid bill due within 5 days), overdue, bill_spike (utility bill >= 25% above its 3-period average),
 * subscription_overlap (2+ active subscriptions in the same niche, e.g. video streaming / music),
 * annual_cost (total yearly subscription cost, with a dream-item equivalent in the detail text).
 * Each finding carries evidence numbers and, where sensible, a suggestedAction (cancel_subscription,
 * dispute_transaction, pay_bill, set_bill_reminder). Sorted by severity (alert > warn > info).
 */
export function analyzeBills(ctx: FinanceContext, recurring: RecurringSeries[]): BillFinding[] {
  throw new Error('TODO analyzeBills ' + ctx.profile.name + recurring.length)
}
