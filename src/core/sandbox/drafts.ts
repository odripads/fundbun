import type { CategoryId, Currency, ISODate, Initiator, Minor, PayChannel, Transaction, TxnFlag } from '../types'
import type { MerchantSpec } from './script-types'

/** A transaction before it gets an id — plus generation metadata the calibration step needs. */
export interface Draft {
  accountId: string
  date: ISODate
  time?: string
  amount: Minor
  merchant: string
  description: string
  memo?: string
  category: CategoryId
  channel?: PayChannel
  payeeId?: string
  billId?: string
  initiatedBy?: Initiator
  flags?: TxnFlag[]
  /** discretionary spend the monthly calibration may add/remove */
  calibratable?: boolean
  /** story-critical: never removed by calibration */
  protected?: boolean
  /** the merchant spec it was drawn from (lets generation re-price it) */
  spec?: MerchantSpec
}

export const CHECKING_ID = 'chk_main'

export function potId(goalId: string): string {
  return `pot_${goalId}`
}

function compactDate(date: ISODate): string {
  return date.replace(/-/g, '')
}

/** Deterministic, readable ids: txn_20261003_004. Skips ids already in `used` and records the new one. */
export function nextTxnId(date: ISODate, used: Set<string>): string {
  const base = `txn_${compactDate(date)}_`
  let n = 1
  while (used.has(`${base}${String(n).padStart(3, '0')}`)) n++
  const id = `${base}${String(n).padStart(3, '0')}`
  used.add(id)
  return id
}

export function toTransaction(d: Draft, id: string, currency: Currency): Transaction {
  const t: Transaction = {
    id,
    accountId: d.accountId,
    date: d.date,
    amount: d.amount,
    currency,
    merchant: d.merchant,
    description: d.description,
    category: d.category,
    categorySource: 'rule',
    categoryConfidence: 1,
  }
  if (d.time) t.time = d.time
  if (d.memo) t.memo = d.memo
  if (d.channel) t.channel = d.channel
  if (d.payeeId) t.payeeId = d.payeeId
  if (d.billId) t.billId = d.billId
  if (d.initiatedBy) t.initiatedBy = d.initiatedBy
  if (d.flags?.length) t.flags = [...d.flags]
  return t
}

/** Order by date, then time (untimed entries first), then original position. */
export function sortDrafts<T extends { date: ISODate; time?: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      if (a.item.date !== b.item.date) return a.item.date < b.item.date ? -1 : 1
      const ta = a.item.time ?? ''
      const tb = b.item.time ?? ''
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.i - b.i
    })
    .map((x) => x.item)
}
