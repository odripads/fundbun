import type { SandboxPurchase } from '../app-api'
import { ym } from '../dates'
import { uid } from '../ids'
import { fmt } from '../money'
import type { SandboxBank } from '../sandbox/bank'
import type { CsvImportResult } from '../sandbox/csv'
import type { AppState, CategoryId, ISODateTime, Transaction, TripwireEvent, YearMonth } from '../types'
import { appendAudit } from './audit'
import { applyTripwires, currencyOf, retireStaleEvents } from './tripwires'
import { isIntIn, isNonEmptyString, isPosInt } from './util'

export function txnKey(t: Pick<Transaction, 'date' | 'amount' | 'merchant'>): string {
  return `${t.date}|${t.amount}|${t.merchant.trim().toLowerCase()}`
}

function byDateTime(a: Transaction, b: Transaction): number {
  const ka = `${a.date} ${a.time ?? ''}`
  const kb = `${b.date} ${b.time ?? ''}`
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/**
 * Merge imported transactions, skipping ones already present (same date + amount + merchant). Counts are
 * multiset-aware: re-importing a file skips every row, while two identical coffees in a new file both land.
 */
export function mergeTransactions(draft: AppState, incoming: Transaction[]): { added: Transaction[]; duplicates: number } {
  const existing = new Map<string, number>()
  for (const t of draft.bank.transactions) existing.set(txnKey(t), (existing.get(txnKey(t)) ?? 0) + 1)
  const ids = new Set(draft.bank.transactions.map((t) => t.id))
  const added: Transaction[] = []
  let duplicates = 0
  for (const t of incoming) {
    const k = txnKey(t)
    const left = existing.get(k) ?? 0
    if (left > 0) {
      existing.set(k, left - 1)
      duplicates++
      continue
    }
    const txn = ids.has(t.id) ? { ...t, id: uid('txn') } : t
    ids.add(txn.id)
    added.push(txn)
  }
  draft.bank.transactions = [...draft.bank.transactions, ...added].sort(byDateTime)
  return { added, duplicates }
}

export interface TxnFilter {
  month?: YearMonth
  category?: CategoryId
  query?: string
}

/** Filtered transactions, newest first. */
export function filterTransactions(txns: Transaction[], f: TxnFilter = {}): Transaction[] {
  const q = f.query?.trim().toLowerCase()
  const match = (t: Transaction) =>
    (!f.month || t.date.startsWith(f.month)) &&
    (!f.category || t.category === f.category) &&
    (!q || [t.merchant, t.description, t.memo ?? ''].some((s) => s.toLowerCase().includes(q)))
  return txns.filter(match).sort((a, b) => byDateTime(b, a))
}

export function purchaseError(p: SandboxPurchase): string | null {
  if (!p || !isNonEmptyString(p.merchant)) return 'A sandbox purchase needs a merchant'
  if (!isPosInt(p.amount)) return 'A sandbox purchase needs a positive whole amount'
  return null
}

export function simulatePurchaseIn(
  draft: AppState,
  bank: SandboxBank,
  p: SandboxPurchase,
  ts: ISODateTime,
): { txn: Transaction; events: TripwireEvent[] } {
  // the bank keeps `time` only when it is a valid HH:MM
  const txn = bank.simulatePurchase({ merchant: p.merchant.trim(), amount: p.amount, category: p.category, memo: p.memo, time: typeof p.time === 'string' ? p.time : undefined })
  draft.bank = bank.state
  const events = applyTripwires(draft, [txn], ts)
  appendAudit(draft, ts, 'user', 'sandbox_event', `Sandbox purchase: ${fmt(p.amount, currencyOf(draft))} at ${txn.merchant}${txn.time ? ` (${txn.time})` : ''}`, {
    txnId: txn.id, merchant: txn.merchant, amount: txn.amount, category: txn.category, events: events.length, ...(txn.time ? { time: txn.time } : {}),
  })
  return { txn, events }
}

/**
 * Move the bank's clock forward one day at a time. Each day's new transactions are checked against the tripwires
 * ON that day, so month-level alerts (month_pct, category_pct, pace_over) see the month they belong to — one jump of
 * ten days fires exactly what ten one-day steps fire. Crossing into a new month retires the finished month's pace
 * alerts (retireStaleEvents). Runs inside a mutation; no audit entry of its own.
 */
export function advanceClockIn(
  draft: AppState,
  bank: SandboxBank,
  n: number,
  ts: ISODateTime,
): { txns: Transaction[]; events: TripwireEvent[] } {
  const txns: Transaction[] = []
  const events: TripwireEvent[] = []
  for (let i = 0; i < n; i++) {
    const month = ym(draft.bank.today)
    const day = bank.advanceDays(1)
    draft.bank = bank.state
    txns.push(...day)
    if (ym(draft.bank.today) !== month) retireStaleEvents(draft)
    events.push(...applyTripwires(draft, day, ts))
  }
  return { txns, events }
}

export function advanceDaysIn(
  draft: AppState,
  bank: SandboxBank,
  n: number,
  ts: ISODateTime,
): { txns: Transaction[]; events: TripwireEvent[] } {
  if (!isIntIn(n, 1, 366)) throw new Error('Advance the sandbox clock by 1–366 days')
  const from = draft.bank.today
  const { txns, events } = advanceClockIn(draft, bank, n, ts)
  appendAudit(draft, ts, 'user', 'sandbox_event', `Sandbox clock advanced ${n} day(s): ${from} → ${bank.state.today}`, {
    days: n, from, to: bank.state.today, txns: txns.length, events: events.length,
  })
  return { txns, events }
}

export interface ImportSummary {
  added: number
  skipped: number
  errors: string[]
}

/**
 * Merge a parsed CSV import into the draft. Only this month's new rows are fed to the tripwires, so importing
 * months of history does not flood the user with stale "single purchase" alerts.
 */
export function importParsedIn(draft: AppState, parsed: CsvImportResult, ts: ISODateTime): ImportSummary {
  const { added, duplicates } = mergeTransactions(draft, parsed.transactions)
  const month = ym(draft.bank.today)
  applyTripwires(draft, added.filter((t) => ym(t.date) === month), ts)
  appendAudit(draft, ts, 'user', 'data_import', `Imported ${added.length} transaction(s) from CSV`, {
    added: added.length, duplicates, skipped: parsed.skipped, errors: parsed.errors.length, format: parsed.format,
  })
  return { added: added.length, skipped: parsed.skipped + duplicates, errors: parsed.errors }
}
