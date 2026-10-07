import { addDays, addMonths, diffDays } from '../dates'
import type { Cadence, CategoryId, ISODate, Minor, RecurringSeries, Transaction } from '../types'
import { merchantInfo, normalizeMerchant } from './categorize'
import { groupBy, mad, mean, median, round1, slugOrHash } from './stats'

interface CadenceRule {
  cadence: Cadence
  days: number
  /** allowed distance of the median gap from `days` */
  tol: number
  /** max MAD of the gaps (regularity) */
  madTol: number
  minOccurrences: number
  perYear: number
  /** calendar months per period (step for nextExpected); weekly uses days */
  months?: number
  /** days after the expected date before an unseen series is considered dead (Plaid's TOMBSTONED) */
  grace: number
}

const CADENCES: CadenceRule[] = [
  { cadence: 'weekly', days: 7, tol: 2, madTol: 2, minOccurrences: 3, perYear: 52, grace: 5 },
  { cadence: 'monthly', days: 30, tol: 5, madTol: 4, minOccurrences: 2, perYear: 12, months: 1, grace: 10 },
  { cadence: 'quarterly', days: 91, tol: 10, madTol: 10, minOccurrences: 2, perYear: 4, months: 3, grace: 20 },
  { cadence: 'yearly', days: 365, tol: 20, madTol: 20, minOccurrences: 2, perYear: 1, months: 12, grace: 30 },
]

/** Utility bills swing with the seasons, so their amounts get a much wider band. */
const VARIABLE_BILL_CATEGORIES = new Set<CategoryId>(['utilities'])
const EXCLUDED_CATEGORIES = new Set<CategoryId>(['income', 'transfer', 'savings'])
const SUBSCRIPTION_TEXT = /会员|订阅|自动续费|连续包月|\bvip\b|subscription|premium|membership/i
const MIN_HIKE: Minor = 100

/** One charge event; exact duplicates (same amount within 2 days) fold into the same event. */
interface ChargeEvent {
  date: ISODate
  amount: Minor
  txns: Transaction[]
}

export function cadenceDays(c: Cadence): number {
  return CADENCES.find((r) => r.cadence === c)!.days
}

export function recurringId(merchant: string): string {
  return `rec_${slugOrHash(merchant)}`
}

function isCandidate(t: Transaction, today: ISODate): boolean {
  return t.amount < 0 && t.date <= today && !EXCLUDED_CATEGORIES.has(t.category) && !t.flags?.includes('reversed')
}

function toEvents(txns: Transaction[]): ChargeEvent[] {
  const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const events: ChargeEvent[] = []
  for (const t of sorted) {
    const amount = -t.amount
    const prev = events[events.length - 1]
    if (prev && prev.amount === amount && diffDays(prev.date, t.date) <= 2) prev.txns.push(t)
    else events.push({ date: t.date, amount, txns: [t] })
  }
  return events
}

function withinPct(a: number, ref: number, pct: number): boolean {
  return Math.abs(a - ref) <= ref * pct
}

/** Same price level: closer than max(¥1, 5%) — anything at least that far apart counts as a change. */
function sameLevel(a: Minor, b: Minor): boolean {
  return Math.abs(a - b) < Math.max(MIN_HIKE, Math.min(a, b) * 0.05)
}

/**
 * Keep the events that belong to the series: amounts within the band around the median, plus a trailing
 * run of >= 2 consistent out-of-band charges (a large price change that has persisted).
 */
function seriesEvents(events: ChargeEvent[], band: number): ChargeEvent[] {
  const med = median(events.map((e) => e.amount))
  let tailStart = events.length
  while (tailStart > 0 && !withinPct(events[tailStart - 1].amount, med, band)) tailStart--
  const tail = events.slice(tailStart)
  const tailPersisted = tail.length >= 2 && tail.every((e) => sameLevel(e.amount, tail[tail.length - 1].amount))
  const body = events.slice(0, tailStart).filter((e) => withinPct(e.amount, med, band))
  return tailPersisted ? [...body, ...tail] : body
}

function matchCadence(events: ChargeEvent[]): { rule: CadenceRule; gapMad: number } | undefined {
  if (events.length < 2) return undefined
  const gaps = events.slice(1).map((e, i) => diffDays(events[i].date, e.date))
  const g = median(gaps)
  const gapMad = mad(gaps, g)
  const rule = CADENCES.find((r) => Math.abs(g - r.days) <= r.tol && gapMad <= r.madTol && events.length >= r.minOccurrences)
  return rule ? { rule, gapMad } : undefined
}

function nextDate(last: ISODate, rule: CadenceRule): ISODate {
  return rule.months ? addMonths(last, rule.months) : addDays(last, rule.days)
}

/**
 * Price rise: the latest charge sits >= max(¥1, 5%) above the median of the up-to-3 charges before the
 * current price level started. Dated at the first charge at the new level ("since Aug 25").
 */
export function findPriceChange(events: { date: ISODate; amount: Minor }[]): RecurringSeries['priceChange'] {
  if (events.length < 2) return undefined
  const last = events[events.length - 1].amount
  let start = events.length - 1
  while (start > 0 && sameLevel(events[start - 1].amount, last)) start--
  if (start === 0) return undefined
  const from = median(events.slice(Math.max(0, start - 3), start).map((e) => e.amount))
  const rise = last - from
  if (rise < MIN_HIKE || last < from * 1.05) return undefined
  return { from: Math.round(from), to: last, pct: round1((rise / from) * 100), date: events[start].date }
}

function mostCommonCategory(txns: Transaction[]): CategoryId {
  const counts = groupBy(txns, (t) => t.category)
  let best: CategoryId = txns[0].category
  for (const [cat, ts] of counts) if (ts.length > (counts.get(best)?.length ?? 0)) best = cat
  return best
}

function isSubscriptionLike(merchant: string, category: CategoryId, txns: Transaction[]): boolean {
  if (category === 'subscriptions') return true
  if (merchantInfo(merchant)?.subscription) return true
  return txns.some((t) => SUBSCRIPTION_TEXT.test(t.description))
}

function confidenceFor(occurrences: number, gapMad: number, stableAmounts: boolean): number {
  const base = occurrences >= 6 ? 0.88 : occurrences >= 4 ? 0.8 : occurrences === 3 ? 0.7 : 0.55
  return Math.min(0.98, Math.round((base + (gapMad <= 1 ? 0.05 : 0) + (stableAmounts ? 0.05 : 0)) * 100) / 100)
}

function buildSeries(
  merchant: string,
  txns: Transaction[],
  today: ISODate,
  cancelled: Set<string>,
): RecurringSeries | undefined {
  const category = mostCommonCategory(txns)
  const band = VARIABLE_BILL_CATEGORIES.has(category) ? 0.6 : 0.25
  const events = seriesEvents(toEvents(txns), band)
  const match = matchCadence(events)
  if (!match) return undefined
  const { rule, gapMad } = match
  const amounts = events.map((e) => e.amount)
  const med = median(amounts)
  const stableAmounts = amounts.every((a) => sameLevel(a, med))
  // two look-alike charges a month apart are common by chance; only near-identical amounts count
  if (events.length === 2 && !sameLevel(amounts[0], amounts[1])) return undefined

  const last = events[events.length - 1]
  const nextExpected = nextDate(last.date, rule)
  const isCancelled = cancelled.has(merchant.toLowerCase())
  if (!isCancelled && diffDays(nextExpected, today) > rule.grace) return undefined

  const priceChange = VARIABLE_BILL_CATEGORIES.has(category) ? undefined : findPriceChange(events)
  const seriesTxns = events.flatMap((e) => e.txns)
  return {
    id: recurringId(merchant),
    merchant,
    category,
    cadence: rule.cadence,
    averageAmount: Math.round(mean(amounts)),
    lastAmount: last.amount,
    lastDate: last.date,
    nextExpected,
    occurrences: events.length,
    txnIds: seriesTxns.map((t) => t.id),
    confidence: confidenceFor(events.length, gapMad, stableAmounts),
    isSubscription: isSubscriptionLike(merchant, category, seriesTxns),
    annualCost: last.amount * rule.perYear,
    ...(priceChange ? { priceChange } : {}),
    status: isCancelled ? 'cancelled' : 'active',
  }
}

/**
 * Detect recurring series: group outflows by normalised merchant, require >= 2 (monthly/yearly) or >= 3
 * (weekly) occurrences with a consistent interval (median gap within tolerance: weekly 7±2, monthly 30±5,
 * quarterly 91±10, yearly 365±20) and amounts within ±25% of the median (larger deviations become
 * price-change candidates when they persist). Marks isSubscription for subscription-like merchants /
 * category 'subscriptions'. Status 'cancelled' for merchants in cancelledMerchants. Sorted by annualCost desc.
 *
 * Series whose next charge is overdue by more than a grace period are dropped (Plaid's "tombstoned"),
 * unless the merchant was cancelled — those stay visible with status 'cancelled'.
 */
export function detectRecurring(txns: Transaction[], today: ISODate, cancelledMerchants: string[] = []): RecurringSeries[] {
  const cancelled = new Set(cancelledMerchants.map((m) => normalizeMerchant(m).toLowerCase()))
  const groups = groupBy(
    txns.filter((t) => isCandidate(t, today)),
    (t) => normalizeMerchant(t.merchant),
  )
  const out: RecurringSeries[] = []
  for (const [merchant, group] of groups) {
    const s = buildSeries(merchant, group, today, cancelled)
    if (s) out.push(s)
  }
  return out.sort((a, b) => b.annualCost - a.annualCost || a.merchant.localeCompare(b.merchant))
}
