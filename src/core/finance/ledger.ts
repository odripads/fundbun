import { isSpendingCategory } from '../categories'
import { ym } from '../dates'
import type { Account, CategoryId, ISODate, Minor, Transaction, YearMonth } from '../types'

/** Low-level transaction predicates and month totals shared across the finance engine (internal). */

/** Bills and fixed costs: paid on a schedule, so they're projected separately from day-to-day spending. */
export const FIXED_CATEGORIES = new Set<CategoryId>(['housing', 'utilities', 'phone_internet', 'insurance', 'subscriptions'])

export function isReversed(t: Transaction): boolean {
  return t.flags?.includes('reversed') ?? false
}

/** true for outflows in spending categories (excludes income, transfers, goal savings, reversed txns). */
export function isSpending(t: Transaction): boolean {
  return t.amount < 0 && isSpendingCategory(t.category) && !isReversed(t)
}

/**
 * A merchant refund: money back in a spending category. 'other' inflows only count when explicitly
 * flagged, so an uncategorised inflow can't silently wipe out spending.
 */
export function isRefund(t: Transaction): boolean {
  if (t.amount <= 0 || isReversed(t) || !isSpendingCategory(t.category)) return false
  return t.category !== 'other' || (t.flags?.includes('refund') ?? false)
}

/** Contribution to "spent": outflows count positive, refunds net them down. */
export function spendValue(t: Transaction): Minor {
  return isSpending(t) || isRefund(t) ? -t.amount : 0
}

export function inMonth(t: Transaction, month: YearMonth): boolean {
  return ym(t.date) === month
}

export interface MonthSpend {
  total: Minor
  byCategory: Map<CategoryId, { spent: Minor; count: number }>
}

/** Net spending for a month; each category is floored at 0 so a refund of last month's purchase can't go negative. */
export function monthSpend(txns: Transaction[], month: YearMonth, filter: (t: Transaction) => boolean = () => true): MonthSpend {
  const byCategory = new Map<CategoryId, { spent: Minor; count: number }>()
  for (const t of txns) {
    if (!inMonth(t, month) || !filter(t)) continue
    const v = spendValue(t)
    if (v === 0) continue
    const e = byCategory.get(t.category) ?? { spent: 0, count: 0 }
    e.spent += v
    if (isSpending(t)) e.count++
    byCategory.set(t.category, e)
  }
  let total = 0
  for (const e of byCategory.values()) {
    e.spent = Math.max(0, e.spent)
    total += e.spent
  }
  return { total, byCategory }
}

export function monthIncome(txns: Transaction[], month: YearMonth): Minor {
  let s = 0
  for (const t of txns) if (t.amount > 0 && t.category === 'income' && !isReversed(t) && inMonth(t, month)) s += t.amount
  return s
}

export function potAccounts(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.type === 'pot')
}

/**
 * Money kept in goal pots in a month: the NET pot flow — inflows minus withdrawals and money returned to checking
 * (e.g. a removed goal) — floored at 0; reversed (undone) transfers are ignored. Without pots: net 'savings'
 * outflows from checking.
 */
export function savedInMonth(txns: Transaction[], accounts: Account[], month: YearMonth): Minor {
  const pots = new Set(potAccounts(accounts).map((a) => a.id))
  let s = 0
  for (const t of txns) {
    if (!inMonth(t, month) || isReversed(t)) continue
    if (pots.size > 0) {
      if (pots.has(t.accountId)) s += t.amount
    } else if (t.category === 'savings') s -= t.amount
  }
  return Math.max(0, s)
}

export function upTo(txns: Transaction[], today: ISODate): Transaction[] {
  return txns.filter((t) => t.date <= today)
}

/** HH:MM within 22:00–03:59 */
export function isLateNight(t: Transaction): boolean {
  if (t.flags?.includes('late_night')) return true
  if (!t.time) return false
  const h = Number(t.time.slice(0, 2))
  return h >= 22 || h < 4
}
