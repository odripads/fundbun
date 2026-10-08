import { isSpendingCategory } from '../categories'
import { addDays, dayOfMonth, daysInMonth, endOfMonth, shiftMonth, startOfMonth, ym } from '../dates'
import type { Account, BankState, Bill, CategoryId, ISODate, Minor, Transaction, YearMonth } from '../types'
import { billPaymentDescription, makeBill } from './billing'
import { CHECKING_ID, nextTxnId, potId, sortDrafts, toTransaction, type Draft } from './drafts'
import { datesBetween, organicDrafts, purchaseDraft } from './organic'
import type { PersonaDef } from './personas'
import { pickWeighted, rngFor, samplePrice, timeInWindow, type PriceSpec } from './random'
import { REPEAT_WINDOW_DAYS, avoidAccidentalRepeats } from './repeats'
import type { BillSeriesSpec, MerchantSpec, PersonaScript, PotPlan } from './script-types'
import { getScript } from './scripts'

/** Whole months of history before the current month (CONTRACT §4: 2026-04-01 → 2026-10-22). */
export const HISTORY_MONTHS = 6

/** The checking account never dips below this during generated history (opening balance is topped up). */
const CHECKING_FLOOR: Minor = 20_000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function assertISODate(date: ISODate): void {
  if (!ISO_DATE.test(date) || addDays(date, 0) !== date) throw new Error(`Invalid ISO date "${date}"`)
}

/** b − a in calendar months */
export function monthOffset(a: YearMonth, b: YearMonth): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

function dateInMonth(month: YearMonth, day: number): ISODate {
  return `${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`
}

function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b
}

function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b
}

// ── income & standing orders (shared with SandboxBank.advanceDays) ─────────

export function incomeDrafts(script: PersonaScript, date: ISODate, accountId: string): Draft[] {
  const dom = dayOfMonth(date)
  const dim = daysInMonth(ym(date))
  return script.incomes
    .filter((inc) => Math.min(inc.day, dim) === dom)
    .map((inc) => ({
      accountId,
      date,
      time: inc.time,
      amount: inc.amount,
      merchant: inc.merchant,
      description: `${inc.description} ${ym(date)}`,
      category: 'income' as const,
      channel: inc.channel,
      initiatedBy: 'bank' as const,
    }))
}

/** The persona's standing-order amount for a pot in a month (deterministic per seed + month). */
export function potContribution(script: PersonaScript, seed: number, plan: PotPlan, month: YearMonth): Minor {
  if (!plan.monthly) return 0
  const step = plan.step ?? 100
  const rng = rngFor(seed, script.def.id, 'pot', plan.goalId, month)
  const lo = Math.ceil(plan.monthly[0] / step)
  const hi = Math.floor(plan.monthly[1] / step)
  return rng.int(lo, Math.max(lo, hi)) * step
}

export function potTransferDrafts(plan: PotPlan, date: ISODate, amount: Minor, checkingName: string): Draft[] {
  const base = { date, time: plan.time, category: 'savings' as const, channel: 'bank_transfer' as const, initiatedBy: 'user' as const }
  return [
    { ...base, accountId: CHECKING_ID, amount: -amount, merchant: plan.name, description: `AUTO-SAVE 自动转存 → ${plan.name} pot` },
    { ...base, accountId: potId(plan.goalId), amount, merchant: checkingName, description: `AUTO-SAVE 自动转存 ← ${checkingName}` },
  ]
}

// ── history pieces ─────────────────────────────────────────────────────────

interface Window {
  m0: YearMonth
  start: ISODate
  today: ISODate
}

function storyDrafts(script: PersonaScript, w: Window): Draft[] {
  return script.story.flatMap((s) => {
    const date = dateInMonth(shiftMonth(w.m0, s.monthOffset), s.day)
    if (date < w.start || date > w.today) return []
    const draft: Draft = {
      accountId: CHECKING_ID,
      date,
      time: s.time,
      amount: s.amount,
      merchant: s.merchant,
      description: s.description,
      category: s.category,
      channel: s.channel,
      initiatedBy: s.amount < 0 ? 'user' : 'bank',
    }
    if (s.memo) draft.memo = s.memo
    if (s.flags?.length) draft.flags = [...s.flags]
    return [draft]
  })
}

function payeeName(script: PersonaScript, payeeId: string, fallback: string): string {
  return script.payees.find((p) => p.id === payeeId)?.name ?? fallback
}

/**
 * When the persona habitually pays a bill it pays by hand: `payLeadDays` before it is due (never before the 1st of
 * the due month), at a time in `payHours`. Deterministic per (seed, persona, bill) — the generated history and
 * SandboxBank.advanceDays share it, so the persona keeps its habit after the clock moves.
 */
export function billPaymentSchedule(script: PersonaScript, seed: number, series: BillSeriesSpec, bill: Pick<Bill, 'id' | 'dueDate'>): { date: ISODate; time: string } {
  const rng = rngFor(seed, script.def.id, 'bill', bill.id)
  const lead = rng.int(series.payLeadDays[0], series.payLeadDays[1])
  const date = maxDate(addDays(bill.dueDate, -lead), startOfMonth(ym(bill.dueDate)))
  return { date, time: timeInWindow(rng, series.payHours) }
}

function billPaymentDraft(script: PersonaScript, seed: number, series: BillSeriesSpec, bill: Bill, w: Window): Draft {
  const plan = billPaymentSchedule(script, seed, series, bill)
  const date = maxDate(plan.date, w.start)
  const name = payeeName(script, series.payeeId, series.name)
  return {
    accountId: CHECKING_ID,
    date,
    time: plan.time,
    amount: -bill.amountDue,
    merchant: name,
    description: billPaymentDescription(bill, name),
    category: series.category,
    channel: series.channel,
    payeeId: series.payeeId,
    billId: bill.id,
    initiatedBy: 'user',
  }
}

/** Every bill from the first history month up to the furthest issued one; past-due ones are paid. */
function historyBills(script: PersonaScript, seed: number, w: Window): { bills: Bill[]; payments: Map<Draft, Bill> } {
  const bills: Bill[] = []
  const payments = new Map<Draft, Bill>()
  for (const series of script.bills) {
    const last = shiftMonth(w.m0, series.leadMonths)
    for (let month = ym(w.start); month <= last; month = shiftMonth(month, 1)) {
      const offset = monthOffset(w.m0, month)
      const period = shiftMonth(month, series.periodOffset)
      const override = script.billOverrides?.find((o) => o.billKey === series.key && o.dueMonthOffset === offset)
      const inj = script.injection
      const injection = inj && inj.billKey === series.key && inj.dueMonthOffset === offset ? inj.text : undefined
      const bill = makeBill(series, month, { quote: override?.quote(period), injection })
      bills.push(bill)
      if (bill.dueDate > w.today) continue
      const draft = billPaymentDraft(script, seed, series, bill, w)
      bill.status = 'paid'
      payments.set(draft, bill)
    }
  }
  return { bills, payments }
}

function historyPotDrafts(script: PersonaScript, seed: number, w: Window): Draft[] {
  const out: Draft[] = []
  for (const plan of script.pots) {
    if (!plan.monthly) continue
    for (let offset = plan.fromMonthOffset ?? -HISTORY_MONTHS; offset <= 0; offset++) {
      const month = shiftMonth(w.m0, offset)
      const date = dateInMonth(month, plan.day)
      if (date < w.start || date > w.today) continue
      out.push(...potTransferDrafts(plan, date, potContribution(script, seed, plan, month), script.account.name))
    }
  }
  return out
}

// ── calibration ────────────────────────────────────────────────────────────

const FILLER_HOURS: Partial<Record<CategoryId, readonly [number, number]>> = {
  dining: [18, 21],
  groceries: [10, 21],
  coffee_tea: [14, 18],
  delivery: [11.5, 20.5],
}

function isSpendingDraft(d: Draft): boolean {
  return d.amount < 0 && isSpendingCategory(d.category) && !d.flags?.includes('reversed')
}

function spendIn(drafts: readonly Draft[], from: ISODate, to: ISODate, filter: (d: Draft) => boolean = () => true): Minor {
  let total = 0
  for (const d of drafts) if (d.date >= from && d.date <= to && isSpendingDraft(d) && filter(d)) total -= d.amount
  return total
}

function minPrice(price: PriceSpec): Minor {
  return 'pick' in price ? Math.min(...price.pick) : price.min
}

function monthTarget(script: PersonaScript, offset: number, drafts: readonly Draft[], from: ISODate, to: ISODate, today: ISODate): Minor | undefined {
  const cal = script.calibration
  if (offset < 0) return cal.months[offset]
  if (dayOfMonth(today) === cal.current.day) return cal.current.total
  const fixed = spendIn(drafts, from, to, (d) => !d.calibratable)
  return fixed + cal.current.dailyVariable * datesBetween(from, to).length
}

/**
 * Nudge a month's discretionary spend toward the script's target: remove random unprotected discretionary
 * purchases while over, then add filler purchases while under. Keeps the demo numbers stable for every seed.
 */
function calibrateMonth(drafts: Draft[], script: PersonaScript, seed: number, month: YearMonth, from: ISODate, to: ISODate, target: Minor, tolerance: Minor): Draft[] {
  const rng = rngFor(seed, script.def.id, 'calibrate', month)
  let diff = target - spendIn(drafts, from, to)
  const removable = drafts.filter((d) => d.date >= from && d.date <= to && isSpendingDraft(d) && d.calibratable && !d.protected)
  const removed = new Set<Draft>()
  while (diff < -tolerance && removable.length > 0) {
    const [r] = removable.splice(rng.int(0, removable.length - 1), 1)
    removed.add(r)
    diff -= r.amount
  }
  const added: Draft[] = []
  const days = datesBetween(from, to)
  while (diff > tolerance) {
    const options: MerchantSpec[] = script.fillers.filter((m) => minPrice(m.price) <= diff)
    if (options.length === 0) break
    const m = pickWeighted(rng, options)
    const amount = Math.min(samplePrice(rng, m.price), Math.floor(diff / 100) * 100)
    if (amount <= 0) break
    added.push(purchaseDraft(rng, m, rng.pick(days), FILLER_HOURS[m.category] ?? [11, 22], CHECKING_ID, amount))
    diff -= amount
  }
  return [...drafts.filter((d) => !removed.has(d)), ...added]
}

function calibrate(drafts: Draft[], script: PersonaScript, seed: number, w: Window): Draft[] {
  let result = drafts
  for (let offset = -HISTORY_MONTHS; offset <= 0; offset++) {
    const month = shiftMonth(w.m0, offset)
    const from = maxDate(startOfMonth(month), w.start)
    const to = minDate(endOfMonth(month), w.today)
    if (from > to) continue
    const target = monthTarget(script, offset, result, from, to, w.today)
    if (target === undefined) continue
    const tolerance = offset < 0 ? script.calibration.tolerance.past : script.calibration.tolerance.current
    result = calibrateMonth(result, script, seed, month, from, to, target, tolerance)
  }
  return result
}

// ── opening balances & accounts ────────────────────────────────────────────

function openingDraft(accountId: string, date: ISODate, amount: Minor): Draft {
  return {
    accountId,
    date,
    time: '00:00',
    amount,
    merchant: 'Opening balance',
    description: 'BALANCE B/F 期初余额 · balance brought forward',
    category: 'transfer',
    channel: 'bank_transfer',
    initiatedBy: 'bank',
  }
}

/** Lowest running balance of an account across the (sorted) drafts, starting from zero. */
function lowestRunningBalance(drafts: readonly Draft[], accountId: string): Minor {
  let balance = 0
  let lowest = 0
  for (const d of sortDrafts(drafts.filter((x) => x.accountId === accountId))) {
    balance += d.amount
    lowest = Math.min(lowest, balance)
  }
  return lowest
}

function openingDrafts(script: PersonaScript, seed: number, drafts: readonly Draft[], start: ISODate): Draft[] {
  const out: Draft[] = []
  const lowest = lowestRunningBalance(drafts, CHECKING_ID)
  const needed = Math.ceil((CHECKING_FLOOR - lowest) / 10_000) * 10_000
  out.push(openingDraft(CHECKING_ID, start, Math.max(script.account.openingBalance, needed)))
  for (const plan of script.pots) {
    if (plan.targetBalance === undefined) continue
    const id = potId(plan.goalId)
    const contributed = drafts.filter((d) => d.accountId === id).reduce((s, d) => s + d.amount, 0)
    const k = Math.floor((plan.targetBalance * 0.01) / 1_000)
    const jitter = rngFor(seed, script.def.id, 'opening', plan.goalId).int(-k, k) * 1_000
    const opening = Math.max(0, plan.targetBalance - contributed + jitter)
    if (opening > 0) out.push(openingDraft(id, start, opening))
  }
  return out
}

function balanceOf(transactions: readonly Transaction[], accountId: string): Minor {
  let total = 0
  for (const t of transactions) if (t.accountId === accountId) total += t.amount
  return total
}

function buildAccounts(script: PersonaScript, transactions: readonly Transaction[]): Account[] {
  const currency = script.def.currency
  const checking: Account = {
    id: CHECKING_ID,
    name: script.account.name,
    type: 'checking',
    balance: balanceOf(transactions, CHECKING_ID),
    currency,
    maskedNumber: script.account.maskedNumber,
  }
  const pots = script.pots.map<Account>((plan) => ({
    id: potId(plan.goalId),
    name: plan.name,
    type: 'pot',
    balance: balanceOf(transactions, potId(plan.goalId)),
    currency,
    goalId: plan.goalId,
  }))
  return [checking, ...pots]
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Deterministically generate ~6 months of history ending at `today` for a persona: salary on payday,
 * rent, utilities (seasonal), phone/internet, subscriptions (with one mid-history price hike), groceries,
 * delivery (Meituan/Ele.me, incl. late-night), milk tea/coffee (Heytea, Luckin, Mixue, Starbucks), DiDi /
 * metro, Taobao/JD/Pinduoduo shopping, entertainment, occasional big purchases, monthly goal-pot
 * contributions. Uses src/core/rng.ts with `seed`. Transactions sorted ascending, categorised directly by
 * the generator (categorySource 'rule', confidence 1). Accounts: checking + one pot per goal (`pot_<goalId>`).
 */
export function generateHistory(persona: PersonaDef, today: ISODate, seed: number): BankState {
  assertISODate(today)
  const script = getScript(persona.id)
  if (!script) throw new Error(`No sandbox script for persona "${persona.id}"`)
  const m0 = ym(today)
  const w: Window = { m0, start: startOfMonth(shiftMonth(m0, -HISTORY_MONTHS)), today }

  let drafts: Draft[] = []
  for (const date of datesBetween(w.start, today)) {
    const offset = monthOffset(m0, ym(date))
    drafts.push(...incomeDrafts(script, date, CHECKING_ID))
    drafts.push(...organicDrafts(script, seed, date, { accountId: CHECKING_ID, cancelled: [], monthOffset: offset, intensity: script.intensity?.[offset] ?? 1 }))
  }
  drafts.push(...storyDrafts(script, w))
  drafts = avoidAccidentalRepeats(drafts)
  const { bills, payments } = historyBills(script, seed, w)
  drafts.push(...payments.keys())
  drafts = avoidAccidentalRepeats(calibrate(drafts, script, seed, w))
  drafts.push(...historyPotDrafts(script, seed, w))
  drafts = [...openingDrafts(script, seed, drafts, w.start), ...drafts]

  const used = new Set<string>()
  const ids = new Map<Draft, string>()
  const transactions = sortDrafts(drafts).map((d) => {
    const id = nextTxnId(d.date, used)
    ids.set(d, id)
    return toTransaction(d, id, persona.currency)
  })
  for (const [draft, bill] of payments) bill.paidTxnId = ids.get(draft)

  return {
    accounts: buildAccounts(script, transactions),
    transactions,
    payees: script.payees.map((p) => ({ ...p })),
    bills,
    disputes: [],
    cancelledMerchants: [],
    today,
    seed,
    personaId: persona.id,
  }
}

/**
 * Generate the organic transactions (discretionary habits + subscription charges) for a single new day,
 * deterministic by (seed, persona, date) and the recent ledger. Does not mutate `bank`; ids are unique against
 * its transactions.
 * Salary, bills and standing orders are the bank's job (SandboxBank.advanceDays). Unknown personas → [].
 */
export function generateDay(bank: BankState, date: ISODate): Transaction[] {
  assertISODate(date)
  const script = getScript(bank.personaId)
  const checking = bank.accounts.find((a) => a.type === 'checking')
  if (!script || !checking) return []
  const since = addDays(date, -REPEAT_WINDOW_DAYS)
  const recent = bank.transactions.filter((t) => t.date >= since && t.date <= date)
  const drafts = avoidAccidentalRepeats(organicDrafts(script, bank.seed, date, { accountId: checking.id, cancelled: bank.cancelledMerchants }), recent)
  const used = new Set(bank.transactions.map((t) => t.id))
  return sortDrafts(drafts).map((d) => toTransaction(d, nextTxnId(date, used), checking.currency))
}
