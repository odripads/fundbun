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

/**
 * The purchase already on the ledger that a typed-in amount most likely repeats: the same (outflow) amount within
 * `windowDays` of `date`, whatever the shop is called (a statement names it differently from the user). The nearest
 * day wins. The screen warns with it; the user still decides, because two coffees at one price do happen.
 */
export function similarSpend(amount: number, date: string, existing: readonly Transaction[], windowDays = 2): Transaction | undefined {
  const out = Math.abs(amount)
  if (!Number.isFinite(out) || out <= 0 || !date) return undefined
  let best: Transaction | undefined
  let bestGap = Infinity
  for (const t of existing) {
    if (t.amount !== -out || !t.date) continue
    const gap = Math.abs(diffDays(date, t.date))
    if (gap <= windowDays && gap < bestGap) {
      best = t
      bestGap = gap
    }
  }
  return best
}
