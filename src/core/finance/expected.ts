import { addDays, dayOfMonth, daysInMonth, shiftMonth, ym } from '../dates'
import type { BankState, Bill, ISODate, ManualSubscription, RecurringSeries, Transaction, YearMonth } from '../types'
import { detectRecurring } from './recurring'
import { manualBill, manualBillId, nextDue, paidBy, subIdOfBill } from './subscriptions'

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

/** Payments the user recorded with "Mark as paid" (controller/api-user.markBillPaid). */
export const MARKED_PAID_PREFIX = 'manual_bill_'

interface SeriesView {
  series: RecurringSeries
  /** the name as the user's statement writes it */
  name: string
  /** the day of the month it usually lands on (monthly charges) */
  day: number
  /** the last month a statement shows it in */
  seenPeriod: YearMonth
  seenTxnId?: string
}

function viewOf(series: RecurringSeries, byId: Map<string, Transaction>): SeriesView | null {
  const all = series.txnIds.map((id) => byId.get(id)).filter((t): t is Transaction => !!t)
  // a payment the user marked by hand says when they tapped the button, not when the bill falls due
  const own = all.filter((t) => !t.id.startsWith(MARKED_PAID_PREFIX))
  const base = (own.length ? own : all).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const last = base[base.length - 1]
  if (!last) return null
  const days = base.map((t) => dayOfMonth(t.date)).sort((a, b) => a - b)
  return { series, name: last.merchant, day: days[Math.floor(days.length / 2)], seenPeriod: ym(last.date), seenTxnId: last.id }
}

/**
 * The bills a user without a connected bank can expect, read off their own ledger: one per repeating charge
 * (rent, phone, a subscription) that is due soon or a little overdue, at the amount it last cost. They are
 * predictions, and the screen says so.
 *
 * A monthly charge is expected on its usual day in the month after the last one covered, where "covered" means a
 * statement shows it or the user marked it as paid (`paidThrough`, by series id). Paying early therefore never
 * moves next month's date. Other cadences use the detector's own next date.
 */
export function expectedBills(recurring: RecurringSeries[], txns: Transaction[], today: ISODate, paidThrough: ReadonlyMap<string, YearMonth> = new Map()): Bill[] {
  const byId = new Map(txns.map((t) => [t.id, t]))
  const from = addDays(today, -EXPECTED_STALE_DAYS)
  const to = addDays(today, EXPECTED_HORIZON_DAYS)
  const out: Bill[] = []
  for (const s of recurring) {
    if (s.status !== 'active' || s.cadence === 'weekly' || s.confidence < EXPECTED_MIN_CONFIDENCE || s.lastAmount <= 0) continue
    const v = viewOf(s, byId)
    if (!v) continue
    let dueDate = s.nextExpected
    if (s.cadence === 'monthly') {
      const paid = paidThrough.get(s.id)
      const period = shiftMonth(paid && paid > v.seenPeriod ? paid : v.seenPeriod, 1)
      dueDate = `${period}-${String(Math.min(v.day, daysInMonth(period))).padStart(2, '0')}`
    }
    if (dueDate < from || dueDate > to) continue
    const period = ym(dueDate)
    out.push({
      id: expectedBillId(s.id, period),
      payeeId: '',
      name: v.name,
      category: s.category,
      amountDue: s.lastAmount,
      dueDate,
      period,
      status: dueDate < today ? 'overdue' : 'upcoming',
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
export function syncExpectedBills(bank: BankState, subs: ManualSubscription[] = []): void {
  if (hasBank(bank)) return
  syncManualSubs(bank, subs)
  const recurring = detectRecurring(bank.transactions, bank.today, bank.cancelledMerchants)
  const byId = new Map(bank.transactions.map((t) => [t.id, t]))
  const views = new Map<string, SeriesView>()
  for (const s of recurring) {
    const v = viewOf(s, byId)
    if (v) views.set(s.id, v)
  }
  const paidThrough = new Map<string, YearMonth>()
  for (const b of bank.bills) {
    if (b.source !== 'expected' || b.status !== 'paid') continue
    const id = seriesIdOf(b)
    if ((paidThrough.get(id) ?? '') < b.period) paidThrough.set(id, b.period)
  }
  const fresh = new Map(expectedBills(recurring, bank.transactions, bank.today, paidThrough).map((b) => [b.id, b]))
  const keepPaidFrom = addDays(bank.today, -PAID_KEEP_DAYS)
  const kept: Bill[] = []
  for (const b of bank.bills) {
    if (b.source !== 'expected' || subIdOfBill(b)) {
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
      // no longer expected: a statement now shows this month's charge (paid), or the bill went stale (dropped)
      const v = views.get(seriesIdOf(b))
      if (v && v.seenPeriod >= b.period) kept.push({ ...b, status: 'paid', paidTxnId: v.seenTxnId })
    }
  }
  bank.bills = [...kept, ...fresh.values()].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}

/**
 * Hand-added subscriptions as bills to expect: one per subscription on its next date, once it is within the
 * horizon. A charge for it on the ledger (same amount, within three days) pays it and moves the subscription on to
 * its next date; so does "Mark as paid". A removed subscription's open bill goes with it.
 */
function syncManualSubs(bank: BankState, subs: ManualSubscription[]): void {
  const live = new Set(subs.map((s) => s.id))
  bank.bills = bank.bills.filter((b) => {
    const id = subIdOfBill(b)
    return !id || live.has(id) || b.status === 'paid'
  })
  const horizon = addDays(bank.today, EXPECTED_HORIZON_DAYS)
  for (const sub of subs) {
    // a statement row already pays it: close that bill and move on (a few rounds catch up a long absence)
    for (let i = 0; i < 24; i++) {
      const txn = paidBy(sub, bank.transactions)
      if (!txn) break
      const id = manualBillId(sub, sub.nextDate)
      const open = bank.bills.find((b) => b.id === id)
      if (open) {
        open.status = 'paid'
        open.paidTxnId = txn.id
      }
      sub.nextDate = nextDue(sub.nextDate, sub.cadence)
    }
    if (sub.nextDate > horizon) continue
    const id = manualBillId(sub, sub.nextDate)
    const existing = bank.bills.find((b) => b.id === id)
    if (!existing) bank.bills.push(manualBill(sub, bank.today))
    else if (existing.status !== 'paid') {
      existing.name = sub.name
      existing.amountDue = sub.amount
      existing.status = sub.nextDate < bank.today ? 'overdue' : 'upcoming'
    }
  }
}

