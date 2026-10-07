import { CATEGORIES } from '../categories'
import { addDays } from '../dates'
import { fmt } from '../money'
import type { CategoryId, ISODate, Minor, Transaction } from '../types'
import { normalizeMerchant } from './categorize'
import { isSpending } from './ledger'
import { groupBy, mad, meanAbsDeviation, median, round2 } from './stats'

export interface Anomaly {
  txnId: string
  /** robust z-score */
  score: number
  reason: string
  category: CategoryId
  amount: Minor
  /** median amount for this category */
  typical: Minor
}

const WINDOW_DAYS = 120
const MIN_SAMPLES = 6
const MIN_MERCHANT_SAMPLES = 4
const Z_FLAG = 3.5
/** Practical significance: a statistically odd ¥40 coffee next to ¥30 ones isn't worth a user's attention. */
const MIN_RATIO = 2
const IGNORED = new Set<CategoryId>(['housing', 'insurance', 'savings', 'transfer', 'income'])

/**
 * Modified z-scores of `xs` (Iglewicz–Hoaglin). When MAD is 0 (many identical prices) fall back to the
 * mean-absolute-deviation form, 1.253314 × MeanAD; when that is 0 too every value is identical → all 0.
 */
export function modifiedZ(xs: number[]): number[] {
  const med = median(xs)
  const m = mad(xs, med)
  if (m > 0) return xs.map((x) => (0.6745 * (x - med)) / m)
  const meanAd = meanAbsDeviation(xs, med)
  return xs.map((x) => (meanAd > 0 ? (x - med) / (1.253314 * meanAd) : 0))
}

/**
 * Robust outlier detection per category over the last 120 days: modified z = 0.6745 × (x − median) / MAD;
 * flag |z| > 3.5 with at least 6 samples in the category; ignore housing/insurance/savings/transfers.
 *
 * x is ln(amount): personal spending is heavily right-skewed, and on the raw scale every ¥300 order in a
 * ¥80-median category would flag. Only unusually LARGE amounts are reported (a tiny purchase isn't news),
 * and only when at least 2× the typical amount. A purchase must also be >= 2× its own merchant's typical
 * amount when that merchant has >= 4 samples, so mixed categories (¥3 metro rides and ¥45 DiDi trips are
 * both "transport") don't flag every taxi.
 */
export function detectAnomalies(txns: Transaction[], today: ISODate): Anomaly[] {
  const since = addDays(today, -WINDOW_DAYS)
  const pool = txns.filter((t) => isSpending(t) && t.date > since && t.date <= today && !IGNORED.has(t.category))
  const byMerchant = scoreGroups(groupBy(pool, (t) => normalizeMerchant(t.merchant)), MIN_MERCHANT_SAMPLES)
  const byCategory = scoreGroups(groupBy(pool, (t) => t.category), MIN_SAMPLES)
  const out: Anomaly[] = []
  for (const t of pool) {
    const cat = byCategory.get(t.id)
    if (!cat || !standsOut(t, cat)) continue
    // must also be odd for this merchant (a usual DiDi fare in a metro-heavy category is not news); with few
    // merchant samples the z-score is unreliable, so only the 2× rule applies
    const merchant = byMerchant.get(t.id)
    if (merchant && (merchant.n >= MIN_SAMPLES ? !standsOut(t, merchant) : -t.amount < merchant.typical * MIN_RATIO)) continue
    out.push(toAnomaly(t, t.category, cat.z, cat.typical, merchant?.typical))
  }
  return out.sort((a, b) => b.score - a.score || a.txnId.localeCompare(b.txnId))
}

interface GroupScore {
  z: number
  typical: Minor
  n: number
}

function standsOut(t: Transaction, g: GroupScore): boolean {
  return g.z > Z_FLAG && -t.amount >= g.typical * MIN_RATIO
}

function scoreGroups(groups: Map<string, Transaction[]>, minSamples: number): Map<string, GroupScore> {
  const out = new Map<string, GroupScore>()
  for (const group of groups.values()) {
    if (group.length < minSamples) continue
    const z = modifiedZ(group.map((t) => Math.log(-t.amount)))
    const typical = Math.round(median(group.map((t) => -t.amount)))
    group.forEach((t, i) => out.set(t.id, { z: z[i], typical, n: group.length }))
  }
  return out
}

/** The reason compares with the merchant's own usual amount when there is one — "9× your usual DiDi trip" beats "18× a metro ride". */
function toAnomaly(t: Transaction, category: CategoryId, score: number, typical: Minor, merchantTypical?: Minor): Anomaly {
  const amount = -t.amount
  const money = (m: Minor) => fmt(m, t.currency)
  const ref = merchantTypical ?? typical
  const times = ref > 0 ? Math.round(amount / ref) : 0
  const reason = merchantTypical !== undefined
    ? `${money(amount)} at ${t.merchant} is about ${times}× what you usually spend there (${money(merchantTypical)}).`
    : `${money(amount)} at ${t.merchant} is about ${times}× your typical ${CATEGORIES[category].label.toLowerCase()} purchase (${money(typical)}).`
  return { txnId: t.id, score: round2(score), reason, category, amount, typical }
}
