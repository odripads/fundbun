import { CATEGORIES } from '../categories'
import { dateLabel } from '../dates'
import { potFor } from '../finance/dreams'
import { billMerchant } from '../finance/xray'
import { clipForDisplay } from '../security/redact'
import { fmt, fmtCopy } from '../money'
import { checkingAccount } from '../security/policy'
import type {
  Account,
  AppState,
  BankState,
  Bill,
  CategoryId,
  Currency,
  DreamItem,
  FinanceContext,
  ISODate,
  ISODateTime,
  Minor,
  RecurringSeries,
} from '../types'
import type { NluContext } from './nlu'

/** Small shared helpers for the agent runtime (formatting, lookups, masking). */

export const PENDING_TTL_MIN = 10

export function ctxOf(state: AppState): FinanceContext | null {
  if (!state.profile) return null
  const { profile, bank, dreams, budget, tripwires } = state
  return { profile, bank, dreams, budget, tripwires }
}

export function currencyOf(state: AppState): Currency {
  return state.profile?.currency ?? checkingAccount(state.bank)?.currency ?? 'CNY'
}

/** Exact money: one bill, one transaction, a price, an amount the user asked to move. */
export function money(state: AppState): (m: Minor) => string {
  const currency = currencyOf(state)
  return (m) => fmt(m, currency)
}

/** Money for prose (totals, targets, projections, averages): whole units from ¥100 — see money.fmtCopy. */
export function moneyCopy(state: AppState): (m: Minor) => string {
  const currency = currencyOf(state)
  return (m) => fmtCopy(m, currency)
}

/**
 * Facts the user told FundBun themselves — target, income and dream prices. Every turn may quote them, so
 * they are part of each turn's grounding sources (a true "your ¥9,500 target" must never be stripped).
 */
export function profileFacts(state: AppState): Record<string, unknown> {
  const p = state.profile
  if (!p) return {}
  return {
    targetSpend: p.targetSpend,
    monthlyIncome: p.monthlyIncome,
    dreamPrices: state.dreams.filter((d) => d.price > 0).map((d) => d.price),
  }
}

export function categoryLabel(c: CategoryId | string | undefined): string {
  return c && Object.prototype.hasOwnProperty.call(CATEGORIES, c) ? CATEGORIES[c as CategoryId].label : 'Other'
}

export function shortDate(d: ISODate | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  try {
    return dateLabel(d)
  } catch {
    return d
  }
}

export function addMinutes(iso: ISODateTime, minutes: number): ISODateTime {
  const ms = Date.parse(iso)
  return new Date((Number.isFinite(ms) ? ms : Date.now()) + minutes * 60_000).toISOString()
}

export function addSeconds(iso: ISODateTime, seconds: number): ISODateTime {
  return addMinutes(iso, seconds / 60)
}

export function isAfter(a: ISODateTime | undefined, b: ISODateTime): boolean {
  if (!a) return false
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) && x > y
}

export function checkingOf(bank: BankState): Account | undefined {
  return checkingAccount(bank)
}

export function accountLabel(acc: Account | undefined): string {
  if (!acc) return 'your checking account'
  return acc.maskedNumber ? `${acc.name} ${acc.maskedNumber}` : acc.name
}

export function findDream(state: AppState, id: unknown): DreamItem | undefined {
  return typeof id === 'string' ? state.dreams.find((d) => d.id === id) : undefined
}

export function potOf(state: AppState, dream: DreamItem): Account | undefined {
  return potFor(dream, state.bank.accounts)
}

export function findBill(state: AppState, id: unknown): Bill | undefined {
  return typeof id === 'string' ? state.bank.bills.find((b) => b.id === id) : undefined
}

export function unpaidBills(state: AppState): Bill[] {
  return state.bank.bills
    .filter((b) => b.status !== 'paid' && !b.paidTxnId)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
}

/** Dreams the user can still save toward (goals first, then treats). */
export function openDreams(state: AppState): DreamItem[] {
  const open = state.dreams.filter((d) => !d.achievedAt && d.price > 0)
  return [...open.filter((d) => d.kind === 'goal'), ...open.filter((d) => d.kind !== 'goal')]
}

export function activeSubscriptions(series: RecurringSeries[]): RecurringSeries[] {
  return series.filter((s) => s.isSubscription && s.status === 'active')
}

export function nluContextOf(state: AppState, recurring: RecurringSeries[]): NluContext {
  return {
    currency: currencyOf(state),
    today: state.bank.today,
    goals: state.dreams.map((d) => ({ id: d.id, name: d.name })),
    bills: unpaidBills(state).map((b) => ({ id: b.id, name: b.name })),
    recurring: recurring.map((r) => ({ id: r.id, merchant: r.merchant })),
    merchants: [...new Set(state.bank.transactions.map((t) => t.merchant))].slice(0, 2000),
  }
}

/**
 * What the chat stores for a pasted bill instead of the bill itself ("Pasted a bill · Shenzhen Power Supply ·
 * 2,341 chars"): the text is untrusted, possibly huge, and may carry account numbers — it is X-rayed, never kept.
 */
export function pastedBillLine(text: string): string {
  const raw = String(text ?? '')
  let merchant: string | undefined
  try {
    merchant = billMerchant(raw)
  } catch {
    merchant = undefined
  }
  const name = merchant ? clipForDisplay(merchant, 40) : ''
  return ['Pasted a bill', name, `${raw.length.toLocaleString('en-US')} chars`].filter(Boolean).join(' · ')
}

/** Long digit runs (account / card numbers) → "•••• 1234". Amounts with separators are left alone. */
export function maskDigits(s: string): string {
  return s.replace(/\d[\d\s-]{6,}\d/g, (run) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(run.trim())) return run
    const digits = run.replace(/\D/g, '')
    return digits.length >= 8 ? `•••• ${digits.slice(-4)}` : run
  })
}

/** Args as they may appear in traces / audit: long text shortened, account-like digit runs masked. */
export function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args ?? {})) {
    if (typeof v === 'string') out[k] = v.length > 80 ? `[${v.length} chars]` : maskDigits(v)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else out[k] = '[object]'
  }
  return out
}

/** Copy of args with every string masked (stored for prohibited calls that will never execute). */
export function maskArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args ?? {})) out[k] = typeof v === 'string' ? maskDigits(v).slice(0, 200) : v
  return out
}

/** Drop undefined fields (keeps tool data compact and JSON-stable). */
export function compact<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as T
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'Unknown error'
}

export function firstName(state: AppState): string {
  return state.profile?.name.trim().split(/\s+/)[0] ?? ''
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10
}

export function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0
}

export function pctLabel(p: number): string {
  return p < 10 ? `${round1(p)}%` : `${Math.round(p)}%`
}

export function normalizeName(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Fuzzy name match score 0..1 (token overlap, substring). */
export function nameScore(query: string, name: string): number {
  const q = normalizeName(query)
  const n = normalizeName(name)
  if (!q || !n) return 0
  if (q === n) return 1
  if (n.includes(q) || q.includes(n)) return 0.85
  const qt = new Set(q.split(' ').filter((w) => w.length > 1))
  const nt = n.split(' ').filter((w) => w.length > 1)
  if (!qt.size || !nt.length) return 0
  const hits = nt.filter((w) => qt.has(w) || [...qt].some((x) => x.length >= 4 && (w.startsWith(x) || x.startsWith(w)))).length
  return hits / Math.max(nt.length, 1) * 0.8
}
