import type { ISODate, RecurringSeries, Transaction } from '../types'

/**
 * Detect recurring series: group outflows by normalised merchant, require >= 2 (monthly/yearly) or >= 3
 * (weekly) occurrences with a consistent interval (median gap within tolerance: weekly 7±2, monthly 30±5,
 * quarterly 91±10, yearly 365±20) and amounts within ±25% of the median (larger deviations become
 * price-change candidates when they persist). Marks isSubscription for subscription-like merchants /
 * category 'subscriptions'. Status 'cancelled' for merchants in cancelledMerchants. Sorted by annualCost desc.
 */
export function detectRecurring(txns: Transaction[], today: ISODate, cancelledMerchants: string[] = []): RecurringSeries[] {
  throw new Error('TODO detectRecurring ' + txns.length + today + cancelledMerchants.length)
}
