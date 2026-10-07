import { daysInMonth, shiftMonth, startOfMonth, ym } from '../dates'
import type { Bill, ISODate, YearMonth } from '../types'
import type { BillQuote, BillSeriesSpec, PersonaScript } from './script-types'

export function billId(series: BillSeriesSpec, period: YearMonth): string {
  return `bill_${series.key}_${period}`
}

export function dueDateFor(series: BillSeriesSpec, dueMonth: YearMonth): ISODate {
  const day = Math.min(series.dueDay, daysInMonth(dueMonth))
  return `${dueMonth}-${String(day).padStart(2, '0')}`
}

/** Bills are issued on the 1st, `leadMonths` before the month they are due in. */
export function issueDateFor(series: BillSeriesSpec, dueMonth: YearMonth): ISODate {
  return startOfMonth(shiftMonth(dueMonth, -series.leadMonths))
}

export interface MakeBillOptions {
  quote?: BillQuote
  injection?: string
}

export function makeBill(series: BillSeriesSpec, dueMonth: YearMonth, opts: MakeBillOptions = {}): Bill {
  const period = shiftMonth(dueMonth, series.periodOffset)
  const id = billId(series, period)
  const dueDate = dueDateFor(series, dueMonth)
  const quote = opts.quote ?? series.quote(period)
  return {
    id,
    payeeId: series.payeeId,
    name: series.name,
    category: series.category,
    amountDue: quote.amount,
    dueDate,
    period,
    status: 'upcoming',
    lineItems: quote.lineItems.map((li) => ({ ...li })),
    rawText: series.rawText({ billId: id, period, dueDate, issueDate: issueDateFor(series, dueMonth), quote, injection: opts.injection }),
    source: 'sandbox',
  }
}

/** Bills a persona receives on `date` (the 1st of a month) that are not already in `existing`. */
export function billsIssuedOn(script: PersonaScript, date: ISODate, existing: readonly Bill[]): Bill[] {
  if (date.slice(8) !== '01') return []
  const ids = new Set(existing.map((b) => b.id))
  return script.bills
    .map((series) => makeBill(series, shiftMonth(ym(date), series.leadMonths)))
    .filter((bill) => !ids.has(bill.id))
}

export function billPaymentDescription(bill: Pick<Bill, 'name' | 'period'>, payeeName: string): string {
  return `BILL PAYMENT 缴费 · ${bill.name} ${bill.period} · ${payeeName}`
}

/** The series a bill belongs to (bill ids are `bill_<key>_<period>`). */
export function seriesOf(script: PersonaScript, bill: Pick<Bill, 'id' | 'payeeId'>): BillSeriesSpec | undefined {
  return script.bills.find((s) => s.payeeId === bill.payeeId && bill.id.startsWith(`bill_${s.key}_`))
}
