import { addDays, ym } from '../dates'
import type { BankState, Bill, ISODate, RecurringSeries, Transaction } from '../types'
import { detectRecurring } from './recurring'

/**
 * FundBun works in two steps.
 *
 * Without a bank connected (a user's own statements, receipts and typed-in purchases), Bun watches and reminds: a
 * bill is paid in the user's bank app and then marked as paid here; a pot is an envelope the user sets money aside
 * in. With a bank connected, the same screens can act: pay the bill, move the money, behind the PIN and the safety
 * rules. Today the only connected bank is the simulated one behind the demo personas.
 */
export function hasBank(bank: Pick<BankState, 'personaId'>): boolean {
  return !!bank.personaId
}

/** How far ahead an expected bill is listed. */
export const EXPECTED_HORIZON_DAYS = 35
/** A repeating charge must be at least this certain to become an expected bill. */
export const EXPECTED_MIN_CONFIDENCE = 0.6
/** An expected bill this far past due with no charge seen is dropped: the charge has probably stopped. */
export const EXPECTED_STALE_DAYS = 21
/** Paid expected bills are kept this long, as history. */
const PAID_KEEP_DAYS = 120
const PREFIX = 'exp_'

export function expectedBillId(seriesId: string, period: string): string {
  return `${PREFIX}${seriesId}_${period}`
}

function seriesIdOf(bill: Bill): string {
  return bill.id.slice(PREFIX.length, bill.id.length - bill.period.length - 1)
}

/**
 * The bills a user without a connected bank can expect, read off their own ledger: one per repeating charge
 * (rent, phone, a subscription) that is due soon or a little overdue, at the amount it last cost. They are
 * predictions, and the screen says so.
 */
export function expectedBills(recurring: RecurringSeries[], txns: Transaction[], today: ISODate): Bill[] {
  const byId = new Map(txns.map((t) => [t.id, t]))
  const from = addDays(today, -EXPECTED_STALE_DAYS)
  const to = addDays(today, EXPECTED_HORIZON_DAYS)
  const out: Bill[] = []
  for (const s of recurring) {
    if (s.status !== 'active' || s.cadence === 'weekly' || s.confidence < EXPECTED_MIN_CONFIDENCE || s.lastAmount <= 0) continue
    if (s.nextExpected < from || s.nextExpected > to) continue
    const period = ym(s.nextExpected)
    out.push({
      id: expectedBillId(s.id, period),
      payeeId: '',
      // the name as the user's statement writes it
      name: byId.get(s.txnIds[s.txnIds.length - 1] ?? '')?.merchant ?? s.merchant,
      category: s.category,
      amountDue: s.lastAmount,
      dueDate: s.nextExpected,
      period,
      status: s.nextExpected < today ? 'overdue' : 'upcoming',
      source: 'expected',
    })
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}

/**
 * Bring a no-bank user's expected bills up to date with their ledger (call after anything that changes it or the
 * date). A bill whose charge has since shown up on a statement is marked paid; one that went stale is dropped;
 * bills the user marked as paid, and bills from anywhere else, are left alone. Does nothing when a bank is connected.
 */
export function syncExpectedBills(bank: BankState): void {
  if (hasBank(bank)) return
  const recurring = detectRecurring(bank.transactions, bank.today, bank.cancelledMerchants)
  const series = new Map(recurring.map((s) => [s.id, s]))
  const fresh = new Map(expectedBills(recurring, bank.transactions, bank.today).map((b) => [b.id, b]))
  const keepPaidFrom = addDays(bank.today, -PAID_KEEP_DAYS)
  const kept: Bill[] = []
  for (const b of bank.bills) {
    if (b.source !== 'expected') {
      kept.push(b)
      continue
    }
    const now = fresh.get(b.id)
    fresh.delete(b.id)
    if (b.status === 'paid') {
      if (b.dueDate >= keepPaidFrom) kept.push(b)
    } else if (now) {
      kept.push({ ...b, name: now.name, amountDue: now.amountDue, dueDate: now.dueDate, status: now.status })
    } else {
      // no longer expected: either the charge arrived (the series moved on to its next date) or it went stale
      const s = series.get(seriesIdOf(b))
      if (s && s.lastDate >= addDays(b.dueDate, -10)) kept.push({ ...b, status: 'paid', paidTxnId: s.txnIds[s.txnIds.length - 1] })
    }
  }
  bank.bills = [...kept, ...fresh.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}
