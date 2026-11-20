import { addDays, addMonths } from '../dates'
import type { Bill, Cadence, ISODate, ManualSubscription, Minor, RecurringSeries, Transaction } from '../types'
import { normalizeMerchant } from './categorize'

/**
 * Subscriptions the user adds by hand: a streaming plan paid by card, a gym paid in cash, anything Bun has not seen
 * on a statement yet. They are listed with the detected ones, count toward the yearly total, and (with no bank
 * connected) become bills to expect on their next date.
 */

const PER_YEAR: Record<Cadence, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }

/** The date after `d` for this cadence. */
export function nextDue(d: ISODate, cadence: Cadence): ISODate {
  if (cadence === 'weekly') return addDays(d, 7)
  if (cadence === 'quarterly') return addMonths(d, 3)
  if (cadence === 'yearly') return addMonths(d, 12)
  return addMonths(d, 1)
}

export function manualSeriesId(sub: Pick<ManualSubscription, 'id'>): string {
  return `rec_manual_${sub.id}`
}

/** A hand-added subscription as a recurring series, so every screen that lists subscriptions shows it. */
export function manualSeries(sub: ManualSubscription): RecurringSeries {
  return {
    id: manualSeriesId(sub),
    merchant: sub.name,
    category: 'subscriptions',
    cadence: sub.cadence,
    averageAmount: sub.amount,
    lastAmount: sub.amount,
    lastDate: sub.addedOn,
    nextExpected: sub.nextDate,
    occurrences: 0,
    txnIds: [],
    confidence: 1,
    isSubscription: true,
    annualCost: sub.amount * PER_YEAR[sub.cadence],
    status: 'active',
    manual: true,
  }
}

/** Detected series plus the hand-added ones, leaving out a hand-added one Bun already detects under the same name. */
export function withManual(detected: RecurringSeries[], subs: readonly ManualSubscription[] | undefined): RecurringSeries[] {
  if (!subs?.length) return detected
  const seen = new Set(detected.map((s) => normalizeMerchant(s.merchant)))
  return [...detected, ...subs.filter((s) => !seen.has(normalizeMerchant(s.name))).map(manualSeries)]
}

const PREFIX = 'exp_manual_'

export function manualBillId(sub: Pick<ManualSubscription, 'id'>, due: ISODate): string {
  return `${PREFIX}${sub.id}_${due}`
}

export function subIdOfBill(bill: Pick<Bill, 'id'>): string | null {
  if (!bill.id.startsWith(PREFIX)) return null
  return bill.id.slice(PREFIX.length, bill.id.length - 11)
}

/** A charge on the ledger that pays this subscription's due date: the same amount, within three days of it. */
export function paidBy(sub: ManualSubscription, txns: readonly Transaction[]): Transaction | undefined {
  return txns.find((t) => t.amount === -sub.amount && Math.abs(Date.parse(t.date) - Date.parse(sub.nextDate)) <= 3 * 86_400_000)
}

/** The bill to expect for a hand-added subscription (no bank connected). */
export function manualBill(sub: ManualSubscription, today: ISODate): Bill {
  return {
    id: manualBillId(sub, sub.nextDate),
    payeeId: '',
    name: sub.name,
    category: 'subscriptions',
    amountDue: sub.amount,
    dueDate: sub.nextDate,
    period: sub.nextDate.slice(0, 7),
    status: sub.nextDate < today ? 'overdue' : 'upcoming',
    source: 'expected',
  }
}

export interface ManualSubscriptionInput {
  name: string
  amount: Minor
  cadence: Cadence
  nextDate: ISODate
}

export function subscriptionInputError(i: Partial<ManualSubscriptionInput>): string | null {
  if (typeof i.name !== 'string' || !i.name.trim()) return 'Give the subscription a name'
  if (i.name.trim().length > 60) return 'Keep the name under 60 characters'
  if (!Number.isSafeInteger(i.amount) || (i.amount as number) <= 0) return 'The price is a positive amount'
  if (!i.cadence || !(i.cadence in PER_YEAR)) return 'Pick how often it is charged'
  if (typeof i.nextDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(i.nextDate)) return 'Pick the next payment date'
  return null
}
