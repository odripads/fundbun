/**
 * Pure view logic for the Goals screen. No React, no DOM — unit-tested in model.test.ts.
 * Every amount is integer minor units; formatting goes through money.fmt.
 */
import { diffDays, parseDate } from '../../../core/dates'
import { fmt, MINOR_PER_MAJOR } from '../../../core/money'
import type { Account, Bill, Currency, DreamItem, GoalProgress, ISODate, Minor, Tone } from '../../../core/types'

export function fmtWhole(m: Minor, currency: Currency): string {
  return fmt(m, currency, { decimals: false })
}

/** Everything sitting in goal pots. */
export function totalInPots(accounts: Account[]): Minor {
  return accounts.filter((a) => a.type === 'pot').reduce((s, a) => s + Math.max(0, a.balance), 0)
}

export interface DreamRow {
  item: DreamItem
  progress?: GoalProgress
}

export interface DreamGroups {
  goals: DreamRow[]
  treats: DreamRow[]
  achieved: DreamRow[]
}

/** Open goals, then treats, then achieved — each in the user's own order. */
export function groupDreams(dreams: DreamItem[], progress: GoalProgress[]): DreamGroups {
  const byId = new Map(progress.map((p) => [p.itemId, p]))
  const row = (item: DreamItem): DreamRow => ({ item, progress: byId.get(item.id) })
  return {
    goals: dreams.filter((d) => !d.achievedAt && d.kind === 'goal').map(row),
    treats: dreams.filter((d) => !d.achievedAt && d.kind === 'treat').map(row),
    achieved: dreams.filter((d) => d.achievedAt).map(row),
  }
}

export function isFunded(p?: GoalProgress): boolean {
  return !!p && p.price > 0 && p.saved >= p.price
}

export interface Fact {
  value: string
  sub: string
}

/** The ETA tile: a month as the value, the pace phrase underneath. */
export function etaFact(p?: GoalProgress): Fact {
  if (!p) return { value: '—', sub: 'No pot yet' }
  if (isFunded(p)) return { value: 'Ready', sub: 'Fully funded' }
  if (!p.monthlyRate || p.monthlyRate <= 0 || p.etaMonths === undefined || !p.etaDate) return { value: '—', sub: 'Add monthly to see it' }
  const m = p.etaMonths
  const sub = m < 1 ? 'under a month' : m < 24 ? `~${Math.round(m)} mo at your pace` : `~${Number((m / 12).toFixed(1))} yrs at your pace`
  return { value: monthYear(p.etaDate), sub }
}

/** 'Aug 2029' */
export function monthYear(d: ISODate): string {
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function remainingOf(p?: GoalProgress): Minor {
  return p ? Math.max(0, p.price - p.saved) : 0
}

export interface QuickAmount {
  amount: Minor
  label: string
}

/** Preset stash amounts that fit both what's left on the goal and what's in checking, plus "the rest". */
export function quickAmounts(remaining: Minor, available: Minor, currency: Currency): QuickAmount[] {
  const unit = MINOR_PER_MAJOR[currency]
  const cap = Math.min(remaining, Math.max(0, available))
  const presets = [100, 200, 500, 1000].map((n) => n * unit).filter((a) => a < cap)
  const out: QuickAmount[] = presets.slice(0, 3).map((a) => ({ amount: a, label: fmtWhole(a, currency) }))
  if (remaining > 0 && remaining <= available) out.push({ amount: remaining, label: `The rest · ${fmtWhole(remaining, currency)}` })
  return out
}

/** Validation for a user-typed contribution; null when it's fine to move. */
/** True when the typed amount carries a minus sign (parseAmount alone would silently drop it). */
export function isNegativeInput(text: string): boolean {
  return /^\s*[-−–]/.test(text)
}

export const NEGATIVE_AMOUNT_ERROR = 'Amounts go into the pot — to take money out, ask Bun to move it back to checking'

/** Why a contribution can't go ahead (null when it can). Pass the typed `text` so a minus sign is caught. */
export function contributionError(amount: Minor | null, available: Minor, currency: Currency, text?: string): string | null {
  if (text !== undefined && isNegativeInput(text)) return NEGATIVE_AMOUNT_ERROR
  if (amount === null || !Number.isFinite(amount)) return 'Type an amount, like 300'
  if (amount <= 0) return 'The amount needs to be more than zero'
  if (amount > available) return `That’s more than your checking balance (${fmtWhole(available, currency)})`
  return null
}

/** Unpaid bills due within `days` of today — what checking still has to cover. */
export function billsDueWithin(bills: Bill[], today: ISODate, days = 14): Minor {
  return bills
    .filter((b) => b.status !== 'paid' && diffDays(today, b.dueDate) <= days)
    .reduce((s, b) => s + b.amountDue, 0)
}

/** A gentle liquidity note when a stash would leave checking short of the bills due soon. */
export function liquidityNote(available: Minor, amount: Minor, billsDue: Minor, currency: Currency): string | null {
  const left = available - amount
  if (amount <= 0 || billsDue <= 0 || left >= billsDue) return null
  return `This leaves ${fmtWhole(Math.max(0, left), currency)} in checking — less than the ${fmtWhole(billsDue, currency)} in bills due in the next two weeks.`
}

/** Saved % after adding `amount` (capped at 100, one decimal). */
export function pctAfterAdding(p: GoalProgress | undefined, amount: Minor): number {
  if (!p || p.price <= 0) return 0
  return Math.min(100, Math.round(((p.saved + Math.max(0, amount)) / p.price) * 1000) / 10)
}

export interface Celebration {
  title: string
  body: string
}

/** Celebrate saving — never spending. Treats get a calm "planned for it" note. */
export function celebrationCopy(item: DreamItem, saved: Minor, tone: Tone, currency: Currency): Celebration {
  const f = (m: Minor) => fmtWhole(m, currency)
  if (item.kind === 'treat') {
    return {
      title: `${item.name} — enjoyed, guilt-free`,
      body: tone === 'numbers' ? `${f(item.price)} treat, planned ahead.` : 'You planned for this one. That’s the whole point.',
    }
  }
  const amount = saved > 0 ? saved : item.price
  return {
    title: `${item.name} — achieved!`,
    body:
      tone === 'cheeky' ? `Look at you. ${f(amount)}, saved the slow way. Bun is doing a little dance.`
      : tone === 'numbers' ? `${f(amount)} saved toward a ${f(item.price)} goal.`
      : `You saved ${f(amount)} for this. That took real patience — well done.`,
  }
}

/** "2 goals · 1 treat" */
export function countsLine(groups: DreamGroups): string {
  const parts: string[] = []
  const g = groups.goals.length
  const t = groups.treats.length
  if (g) parts.push(`${g} ${g === 1 ? 'goal' : 'goals'}`)
  if (t) parts.push(`${t} ${t === 1 ? 'treat' : 'treats'}`)
  if (groups.achieved.length) parts.push(`${groups.achieved.length} achieved`)
  return parts.join(' · ')
}
