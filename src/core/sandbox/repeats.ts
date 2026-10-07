import { diffDays } from '../dates'
import type { ISODate, Minor } from '../types'
import { sortDrafts, type Draft } from './drafts'
import type { MerchantSpec } from './script-types'

/**
 * Covers the analysis layer's duplicate rules: 48h for billed categories and "within half the cadence" for
 * habitual purchases it reads as weekly or monthly series.
 */
export const REPEAT_WINDOW_DAYS = 15

export interface BookedCharge {
  merchant: string
  date: ISODate
  /** signed, as on the transaction */
  amount: Minor
}

/** Other prices the merchant could plausibly have charged, closest first. */
export function alternativePrices(spec: MerchantSpec, current: Minor): Minor[] {
  const price = spec.price
  if ('pick' in price) {
    return [...new Set(price.pick)].filter((v) => v !== current).sort((a, b) => Math.abs(a - current) - Math.abs(b - current))
  }
  const step = price.step ?? 100
  const out: Minor[] = []
  for (let k = 1; k <= 30; k++) {
    for (const v of [current + k * step, current - k * step]) if (v >= price.min && v <= price.max) out.push(v)
  }
  return out
}

function isAdjustable(d: Draft): boolean {
  return d.amount < 0 && d.spec !== undefined && !d.spec.repeatable
}

function remember(index: Map<string, BookedCharge[]>, c: BookedCharge): void {
  const list = index.get(c.merchant)
  if (list) list.push(c)
  else index.set(c.merchant, [c])
}

/**
 * Same merchant + same amount a few days apart reads as a double charge downstream, and only the story should
 * plant those. Later generated purchases are re-priced within their merchant spec (or dropped when no price is
 * free). Story, bill and subscription drafts — and the `booked` charges already in the ledger — never move.
 */
export function avoidAccidentalRepeats(drafts: Draft[], booked: readonly BookedCharge[] = []): Draft[] {
  const fixed = new Map<string, BookedCharge[]>()
  for (const c of booked) if (c.amount < 0) remember(fixed, c)
  for (const d of drafts) if (d.amount < 0 && !isAdjustable(d)) remember(fixed, d)
  const kept = new Map<string, BookedCharge[]>()
  const dropped = new Set<Draft>()
  for (const d of sortDrafts(drafts.filter(isAdjustable))) {
    const near = [...(fixed.get(d.merchant) ?? []), ...(kept.get(d.merchant) ?? [])].filter(
      (c) => Math.abs(diffDays(c.date, d.date)) <= REPEAT_WINDOW_DAYS,
    )
    const taken = new Set(near.map((c) => c.amount))
    if (taken.has(d.amount)) {
      const alt = alternativePrices(d.spec!, -d.amount).find((v) => !taken.has(-v))
      if (alt === undefined) {
        dropped.add(d)
        continue
      }
      d.amount = -alt
    }
    remember(kept, d)
  }
  return dropped.size > 0 ? drafts.filter((d) => !dropped.has(d)) : drafts
}
