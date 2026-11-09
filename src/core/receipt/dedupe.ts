/**
 * Duplicate detection for a receipt candidate against existing transactions. Mirrors the `txnKey` logic in
 * `src/core/controller/data.ts` (same `${date}|${amount}|${merchant}` identity), but with a small date window
 * instead of an exact date — so a re-scanned receipt that lands a day off still reads as "already added".
 */
import { diffDays } from '../dates'
import type { SpendingCandidate, Transaction } from '../types'

/** A candidate is treated as a likely duplicate of a transaction within this many days. */
export const DUPLICATE_WINDOW_DAYS = 3

/** Same merchant + same (outflow) amount + within `DUPLICATE_WINDOW_DAYS` — the UI warns before adding. */
export function looksDuplicate(candidate: SpendingCandidate, existing: readonly Transaction[]): boolean {
  const merchant = candidate.merchant.trim().toLowerCase()
  const amount = Math.abs(candidate.amount)
  if (!merchant || !Number.isFinite(amount) || amount <= 0) return false
  return existing.some((t) => {
    if (t.merchant.trim().toLowerCase() !== merchant) return false
    // an outflow that matches the (positive) candidate amount; refunds/inflows never count as a duplicate spend
    if (t.amount !== -amount) return false
    if (!t.date) return false
    return Math.abs(diffDays(candidate.date, t.date)) <= DUPLICATE_WINDOW_DAYS
  })
}
