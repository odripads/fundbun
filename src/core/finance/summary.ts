import type { FinanceContext, MonthHistoryPoint, MonthSummary, Transaction, YearMonth } from '../types'

/** true for outflows in spending categories (excludes income, transfers, goal savings, reversed txns). */
export function isSpending(t: Transaction): boolean {
  throw new Error('TODO isSpending ' + t.id)
}

/** Spending transactions (outflows) optionally restricted to a month. */
export function spendingTxns(txns: Transaction[], month?: YearMonth): Transaction[] {
  throw new Error('TODO spendingTxns ' + txns.length + month)
}

/**
 * Month summary. `month` defaults to the month of ctx.bank.today. For the current month, `projected`
 * uses a pace model (spent-so-far + remaining days × blended daily rate, where the blended rate mixes
 * this month's discretionary pace with the prior 3 months' average, and known upcoming bills are added).
 * For past months projected = spent.
 */
export function summarizeMonth(ctx: FinanceContext, month?: YearMonth): MonthSummary {
  throw new Error('TODO summarizeMonth ' + ctx.profile.name + month)
}

/** Last `months` months (oldest first, including the current one). */
export function monthHistory(ctx: FinanceContext, months: number): MonthHistoryPoint[] {
  throw new Error('TODO monthHistory ' + months + ctx.profile.name)
}
