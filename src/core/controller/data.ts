import { syncExpectedBills } from '../finance/expected'
import type { SandboxPurchase } from '../app-api'
import { diffDays, ym } from '../dates'
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

/** A statement's own order number (WeChat Pay / Alipay): the real identity of a transaction. */
const ORDER_ID_RE = /^(?:wx|ali)_\d{10,}$/
/** Rows that came from a statement file. */
const FILE_ID_RE = /^(?:wx|ali|csv)_/
/** Spending the user typed in, scanned or had captured from an email before any statement arrived. */
const HAND_ID_RE = /^(?:manual|receipt|em)_/
/** A statement row and a hand-entered purchase of the same amount this many days apart are the same purchase. */
export const RECONCILE_WINDOW_DAYS = 2

export interface MergeResult {
  added: Transaction[]
  /** rows already on the ledger (the same file again, or an overlapping export) */
  duplicates: number
  /** statement rows that matched a purchase the user had already typed in, scanned or captured: counted once */
  matched: number
}

/**
 * Merge new transactions into the ledger without counting anything twice. People keep several accounts, export
 * overlapping files and also type purchases in as they remember them, so a row is judged in this order:
 *
 * 1. Typed in by hand ("manual_"): always added. The user said it happened; the screen warns first if it looks
 *    like one they already have. Only the very same entry sent twice (a double tap: same id) is one purchase.
 * 2. Same order number as a row on the ledger (WeChat Pay / Alipay files carry one): the same transaction.
 * 3. Same date, amount and merchant as a ledger row not yet paired: a duplicate — unless both rows carry order
 *    numbers and they differ, which makes them two real purchases. Pairing is one to one, so re-importing a file
 *    skips every row while two identical coffees in a new file both land.
 * 4. A statement row whose amount equals a hand-entered purchase within RECONCILE_WINDOW_DAYS days (the shop is
 *    usually worded differently): the same purchase, kept once in the user's own words. Nearest date wins.
 * 5. Otherwise it is new.
 *
 * Known limit: two statement files that describe the same purchase with different shop names (a WeChat Pay export
 * and the bank card that funded it) cannot be told apart from two purchases, so both are kept.
 */
export function mergeTransactions(draft: AppState, incoming: Transaction[]): MergeResult {
  const ledger = draft.bank.transactions
  const ids = new Set(ledger.map((t) => t.id))
  const byKey = new Map<string, Transaction[]>()
  for (const t of ledger) {
    const k = txnKey(t)
    const list = byKey.get(k)
    if (list) list.push(t)
    else byKey.set(k, [t])
  }
  const hand = ledger.filter((t) => t.amount < 0 && HAND_ID_RE.test(t.id))
  /** ledger rows already paired with an incoming row in this merge */
  const paired = new Set<string>()
  const added: Transaction[] = []
  let duplicates = 0
  let matched = 0

  for (const t of incoming) {
    if (t.id.startsWith('manual_')) {
      // every typed-in entry has its own id, so the same id again is the same submit replayed
      if (ids.has(t.id)) {
        duplicates++
        continue
      }
    } else {
      const order = ORDER_ID_RE.test(t.id)
      if (order && ids.has(t.id)) {
        paired.add(t.id)
        duplicates++
        continue
      }
      const twin = (byKey.get(txnKey(t)) ?? []).find((e) => !paired.has(e.id) && !(order && ORDER_ID_RE.test(e.id)))
      if (twin) {
        paired.add(twin.id)
        duplicates++
        continue
      }
      if (t.amount < 0 && FILE_ID_RE.test(t.id)) {
        let best: Transaction | undefined
        let bestGap = Infinity
        for (const h of hand) {
          if (paired.has(h.id) || h.amount !== t.amount || h.currency !== t.currency) continue
          const gap = Math.abs(diffDays(h.date, t.date))
          if (gap <= RECONCILE_WINDOW_DAYS && gap < bestGap) {
            best = h
            bestGap = gap
          }
        }
        if (best) {
          paired.add(best.id)
          matched++
          continue
        }
      }
    }
    const txn = ids.has(t.id) ? { ...t, id: uid('txn') } : t
    ids.add(txn.id)
    added.push(txn)
  }
  draft.bank.transactions = [...ledger, ...added].sort(byDateTime)
  return { added, duplicates, matched }
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
  /** rows not added: unreadable or not purchases, already on the ledger, or matched to a hand-entered purchase */
  skipped: number
  /** of the skipped rows, how many matched a purchase the user had already typed in or scanned */
  matched: number
  errors: string[]
}

/**
 * Merge a parsed CSV import into the draft. Only this month's new rows are fed to the tripwires, so importing
 * months of history does not flood the user with stale "single purchase" alerts.
 */
export function importParsedIn(draft: AppState, parsed: CsvImportResult, ts: ISODateTime): ImportSummary {
  const { added, duplicates, matched } = mergeTransactions(draft, parsed.transactions)
  syncExpectedBills(draft.bank)
  const month = ym(draft.bank.today)
  applyTripwires(draft, added.filter((t) => ym(t.date) === month), ts)
  appendAudit(draft, ts, 'user', 'data_import', `Imported ${added.length} transaction(s) from CSV`, {
    added: added.length, duplicates, matched, skipped: parsed.skipped, errors: parsed.errors.length, format: parsed.format,
  })
  return { added: added.length, skipped: parsed.skipped + duplicates + matched, matched, errors: parsed.errors }
}
