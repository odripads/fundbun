import { dateLabel, diffDays } from '../dates'
import { MINOR_PER_MAJOR } from '../money'
import type { Bill, BillFinding, CategoryId, FinanceContext, Minor, RecurringSeries, Transaction } from '../types'
import { normalizeMerchant, subscriptionNiche, type SubscriptionNiche } from './categorize'
import { copyFmt, type Fmt, listJoin, moneyFmt, plural } from './copy'
import { dreamEquivalents } from './dreams'
import { isReversed, isSpending } from './ledger'
import { cadenceDays } from './recurring'
import { groupBy, mean, round1 } from './stats'

const DUE_SOON_DAYS = 5
const SPIKE_RATIO = 1.25
const DUPLICATE_WINDOW_DAYS = 2
/** Card-dispute windows are ~60 days; older doubles aren't actionable. */
const DUPLICATE_LOOKBACK_DAYS = 60
/** Identical charges this close together (minutes) read as one purchase charged twice. */
const INSTANT_WINDOW_MINUTES = 10
/** Below this, two identical charges are usually two real purchases (two metro rides, two coffees). */
const SMALL_PURCHASE_MAJOR = 20
/** Categories billed by a provider, where an identical charge twice is suspicious even outside a known series. */
const BILLED_CATEGORIES = new Set<CategoryId>(['subscriptions', 'utilities', 'phone_internet', 'housing', 'insurance', 'education'])
/** Habitual everyday purchases: repeating the same fare / the same drink is normal, never a double charge. */
const EVERYDAY_CATEGORIES = new Set<CategoryId>(['transport', 'coffee_tea'])
const NICHE_LABEL: Record<SubscriptionNiche, string> = {
  video: 'video streaming',
  music: 'music streaming',
  cloud: 'cloud storage',
  fitness: 'gym & fitness',
  software: 'app',
  gaming: 'gaming',
}
const SEVERITY_RANK: Record<BillFinding['severity'], number> = { alert: 0, warn: 1, info: 2 }

function monthly(s: RecurringSeries): Minor {
  return Math.round(s.annualCost / 12)
}

// ───────────────────────────── price hikes ─────────────────────────────

function priceHikes(series: RecurringSeries[], f: Fmt, c: Fmt): BillFinding[] {
  return series
    .filter((s) => s.status === 'active' && s.priceChange && s.priceChange.to > s.priceChange.from)
    .map((s) => {
      const pc = s.priceChange!
      const diff = pc.to - pc.from
      const perYear = Math.round((s.annualCost / s.lastAmount) * diff)
      return {
        id: `f_price_hike_${s.id}`,
        kind: 'price_hike' as const,
        severity: 'warn' as const,
        title: `${s.merchant} went up ${f(diff)}`,
        detail: `From ${f(pc.from)} to ${f(pc.to)} (+${pc.pct}%) since ${dateLabel(pc.date)}. That's ${c(perYear)} more a year.`,
        amount: diff,
        recurringId: s.id,
        txnIds: s.txnIds,
        ...(s.isSubscription ? { suggestedAction: { tool: 'cancel_subscription' as const, args: { recurringId: s.id }, label: `Cancel ${s.merchant}` } } : {}),
        evidence: { from: pc.from, to: pc.to, pct: pc.pct, since: pc.date, extraPerYear: perYear },
      }
    })
}

// ───────────────────────────── duplicates ─────────────────────────────

function disputedIds(ctx: FinanceContext): Set<string> {
  return new Set(ctx.bank.disputes.map((d) => d.txnId))
}

function minutes(t: Transaction): number | undefined {
  const m = t.time && /^(\d{1,2}):(\d{2})/.exec(t.time)
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined
}

/** Minutes between two timestamped charges (across midnight too); undefined when either has no time. */
function minutesApart(a: Transaction, b: Transaction): number | undefined {
  const ma = minutes(a)
  const mb = minutes(b)
  if (ma === undefined || mb === undefined) return undefined
  return Math.abs(diffDays(a.date, b.date) * 1440 + mb - ma)
}

/** Small purchases, fares and coffee repeat legitimately — never flag them on timing alone. */
function isEverydayRepeat(t: Transaction, small: Minor): boolean {
  return EVERYDAY_CATEGORIES.has(t.category) || -t.amount < small
}

/**
 * A series that bills once per period (subscriptions, rent, utilities, phone…), so a second charge inside one
 * period is suspicious. Habits that merely look periodic (weekly coffee, delivery, groceries) are not billed:
 * buying the same thing twice in a week is normal, and only the 10-minute rule applies to them.
 */
function isBilledSeries(s: RecurringSeries, t: Transaction): boolean {
  return s.isSubscription || BILLED_CATEGORIES.has(s.category) || BILLED_CATEGORIES.has(t.category)
}

/**
 * Same merchant + amount counts as a duplicate when it is
 *  - 'series':  a second charge of one subscription / billed recurring series inside one billing period
 *               (habits that merely look periodic — coffee, fares, delivery — are not billed series),
 *  - 'billed':  a provider-billed category (rent, utilities, phone, subscriptions…) charged twice within 48h,
 *  - 'instant': an online / card / wallet charge repeated within 10 minutes — except fares, coffee & tea and
 *               small purchases, which people genuinely buy twice in a row. Cash can't be double-charged.
 */
function duplicateReason(a: Transaction, b: Transaction, small: Minor, s?: RecurringSeries): 'series' | 'billed' | 'instant' | undefined {
  const gap = diffDays(a.date, b.date)
  if (s && gap < cadenceDays(s.cadence) / 2 && isBilledSeries(s, b)) return 'series'
  if (gap <= DUPLICATE_WINDOW_DAYS && BILLED_CATEGORIES.has(b.category)) return 'billed'
  if (isEverydayRepeat(b, small) || a.channel === 'cash' || b.channel === 'cash') return undefined
  const apart = minutesApart(a, b)
  if (apart !== undefined && apart <= INSTANT_WINDOW_MINUTES) return 'instant'
  return undefined
}

function byDateTime(a: Transaction, b: Transaction): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? '').localeCompare(b.time ?? '')
}

function duplicates(ctx: FinanceContext, series: RecurringSeries[], f: Fmt): BillFinding[] {
  const today = ctx.bank.today
  const small = SMALL_PURCHASE_MAJOR * MINOR_PER_MAJOR[ctx.profile.currency]
  const disputed = disputedIds(ctx)
  const seriesByMerchant = new Map(series.map((s) => [s.merchant, s]))
  const eligible = ctx.bank.transactions
    .filter((t) => isSpending(t) && t.date <= today && diffDays(t.date, today) <= DUPLICATE_LOOKBACK_DAYS)
    .filter((t) => !disputed.has(t.id) && !t.flags?.some((x) => x === 'disputed' || x === 'refund'))

  const out: BillFinding[] = []
  // a duplicate is the next identical charge from the same merchant, so only neighbours in each group are compared
  for (const group of groupBy(eligible, (t) => `${normalizeMerchant(t.merchant)}|${t.amount}`).values()) {
    const sorted = [...group].sort(byDateTime)
    const merchant = normalizeMerchant(sorted[0].merchant)
    const s = seriesByMerchant.get(merchant)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]
      const b = sorted[i]
      const reason = duplicateReason(a, b, small, s)
      if (!reason) continue
      out.push(duplicateFinding(a, b, merchant, reason, s, f))
      i++ // b is accounted for; don't pair it again with the next charge
    }
  }
  return out.sort((x, y) => (x.evidence.secondDate < y.evidence.secondDate ? -1 : x.evidence.secondDate > y.evidence.secondDate ? 1 : 0))
}

function duplicateFinding(a: Transaction, b: Transaction, merchant: string, reason: 'series' | 'billed' | 'instant', s: RecurringSeries | undefined, f: Fmt): BillFinding {
  const gap = diffDays(a.date, b.date)
  const amount = -b.amount
  return {
    id: `f_duplicate_${b.id}`,
    kind: 'duplicate_charge',
    severity: reason === 'instant' ? 'warn' : 'alert',
    title: reason === 'instant' ? `Possible double charge at ${merchant}` : `${merchant} charged you twice`,
    detail: `Two ${f(amount)} charges ${gap === 0 ? `on ${dateLabel(b.date)}` : `on ${dateLabel(a.date)} and ${dateLabel(b.date)}`}${reason === 'series' ? ' in the same billing period' : ''}. If you only meant to pay once, you can dispute the second one.`,
    amount,
    txnIds: [a.id, b.id],
    ...(s ? { recurringId: s.id } : {}),
    suggestedAction: {
      tool: 'dispute_transaction',
      args: { txnId: b.id, reason: `Duplicate charge: ${f(amount)} from ${merchant} on ${b.date}` },
      label: 'Dispute the duplicate',
    },
    evidence: { amount, firstDate: a.date, secondDate: b.date, daysApart: gap, rule: reason },
  }
}

// ───────────────────────────── bills due / overdue / spikes ─────────────────────────────

function isUnpaid(b: Bill): boolean {
  return b.status === 'upcoming' || b.status === 'overdue'
}

function payAction(b: Bill, f: Fmt) {
  return { tool: 'pay_bill' as const, args: { billId: b.id }, label: `Pay ${f(b.amountDue)}` }
}

function dueFindings(ctx: FinanceContext, f: Fmt): BillFinding[] {
  const today = ctx.bank.today
  const out: BillFinding[] = []
  for (const b of ctx.bank.bills) {
    if (!isUnpaid(b)) continue
    const days = diffDays(today, b.dueDate)
    const evidence = { amountDue: b.amountDue, dueDate: b.dueDate, daysLeft: days }
    if (b.status === 'overdue' || days < 0) {
      out.push({
        id: `f_overdue_${b.id}`,
        kind: 'overdue',
        severity: 'alert',
        title: `${b.name} is overdue`,
        detail: `${f(b.amountDue)} was due ${dateLabel(b.dueDate)} (${plural(Math.abs(days), 'day')} ago). Paying now avoids late fees.`,
        amount: b.amountDue,
        billId: b.id,
        suggestedAction: payAction(b, f),
        evidence,
      })
    } else if (days <= DUE_SOON_DAYS) {
      out.push({
        id: `f_due_soon_${b.id}`,
        kind: 'due_soon',
        severity: 'warn',
        title: `${b.name} due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
        detail: `${f(b.amountDue)} due ${dateLabel(b.dueDate)}.`,
        amount: b.amountDue,
        billId: b.id,
        suggestedAction: payAction(b, f),
        evidence,
      })
    }
  }
  return out
}

/** Up to 3 earlier amounts for this payee: earlier bills first, topped up with past payments to the same merchant. */
function billHistory(b: Bill, ctx: FinanceContext): Minor[] {
  const earlier = ctx.bank.bills
    .filter((x) => x.id !== b.id && x.payeeId === b.payeeId && x.period < b.period)
    .sort((x, y) => (x.period < y.period ? 1 : -1))
    .slice(0, 3)
  const amounts = earlier.map((x) => x.amountDue)
  if (amounts.length >= 3) return amounts
  const skip = new Set([b.paidTxnId, ...earlier.map((x) => x.paidTxnId)].filter(Boolean) as string[])
  const name = normalizeMerchant(b.name)
  const before = earlier.length > 0 ? earlier[earlier.length - 1].dueDate : b.dueDate
  const payments = ctx.bank.transactions
    .filter((t) => t.amount < 0 && !isReversed(t) && !skip.has(t.id) && t.date < before)
    .filter((t) => (t.payeeId && t.payeeId === b.payeeId) || normalizeMerchant(t.merchant) === name)
    .sort((x, y) => (x.date < y.date ? 1 : -1))
    .map((t) => -t.amount)
  return [...amounts, ...payments].slice(0, 3)
}

function latestBillPerPayee(bills: Bill[]): Bill[] {
  const latest = new Map<string, Bill>()
  for (const b of bills) {
    const cur = latest.get(b.payeeId)
    if (!cur || b.period > cur.period) latest.set(b.payeeId, b)
  }
  return [...latest.values()]
}

function spikes(ctx: FinanceContext, f: Fmt, c: Fmt): BillFinding[] {
  const out: BillFinding[] = []
  for (const b of latestBillPerPayee(ctx.bank.bills.filter((x) => x.category === 'utilities'))) {
    const history = billHistory(b, ctx)
    if (history.length < 2) continue
    const avg = Math.round(mean(history))
    if (avg <= 0 || b.amountDue < avg * SPIKE_RATIO) continue
    const pct = round1(((b.amountDue - avg) / avg) * 100)
    out.push({
      id: `f_bill_spike_${b.id}`,
      kind: 'bill_spike',
      severity: 'warn',
      title: `${b.name} is ${Math.round(pct)}% higher than usual`,
      detail: `${f(b.amountDue)} this time vs a ${c(avg)} average over your last ${plural(history.length, 'bill')}. Worth a look at usage before it's due ${dateLabel(b.dueDate)}.`,
      amount: b.amountDue - avg,
      billId: b.id,
      ...(isUnpaid(b) ? { suggestedAction: { tool: 'set_bill_reminder' as const, args: { billId: b.id, daysBefore: 3 }, label: 'Remind me 3 days before' } } : {}),
      evidence: { amountDue: b.amountDue, average: avg, pct, periods: history.length, period: b.period },
    })
  }
  return out
}

// ───────────────────────────── subscriptions ─────────────────────────────

function activeSubs(series: RecurringSeries[]): RecurringSeries[] {
  return series.filter((s) => s.isSubscription && s.status === 'active')
}

/** Suggest dropping the service that just got pricier; otherwise the most expensive one. */
function cancelCandidate(group: RecurringSeries[]): RecurringSeries {
  return [...group].sort((a, b) => Number(!!b.priceChange) - Number(!!a.priceChange) || b.lastAmount - a.lastAmount)[0]
}

function overlaps(series: RecurringSeries[], f: Fmt, c: Fmt): BillFinding[] {
  const byNiche = new Map<SubscriptionNiche, RecurringSeries[]>()
  for (const s of activeSubs(series)) {
    const niche = subscriptionNiche(s.merchant)
    if (niche === 'video' || niche === 'music') byNiche.set(niche, [...(byNiche.get(niche) ?? []), s])
  }
  const out: BillFinding[] = []
  for (const [niche, group] of byNiche) {
    if (group.length < 2) continue
    const total = group.reduce((s, x) => s + monthly(x), 0)
    const drop = cancelCandidate(group)
    const names = group.map((s) => s.merchant)
    out.push({
      id: `f_overlap_${niche}`,
      kind: 'subscription_overlap',
      severity: 'warn',
      title: `${group.length} ${NICHE_LABEL[niche]} services`,
      detail: `${listJoin(names)} cost ${c(total)}/month together (${c(total * 12)}/year). Dropping ${drop.merchant} saves ${f(monthly(drop))} a month (${c(monthly(drop) * 12)} a year).`,
      amount: total,
      recurringId: drop.id,
      txnIds: group.flatMap((s) => s.txnIds),
      suggestedAction: { tool: 'cancel_subscription', args: { recurringId: drop.id }, label: `Cancel ${drop.merchant}` },
      // savesPerYear is what the CTA delivers — the basis for any "every year, that's …" picture (not annualTotal)
      evidence: { niche, services: names.join(', '), count: group.length, monthlyTotal: total, annualTotal: total * 12, savesPerMonth: monthly(drop), savesPerYear: monthly(drop) * 12 },
    })
  }
  return out
}

function annualCost(ctx: FinanceContext, series: RecurringSeries[], f: Fmt): BillFinding[] {
  const subs = activeSubs(series)
  if (subs.length === 0) return []
  const annual = subs.reduce((s, x) => s + x.annualCost, 0)
  const eq = dreamEquivalents(annual, ctx.dreams, 1)[0]
  return [{
    id: 'f_annual_cost',
    kind: 'annual_cost',
    severity: 'info',
    title: `Subscriptions: ${f(annual)} a year`,
    detail: `${subs.length === 1 ? 'Your subscription adds' : `Your ${subs.length} subscriptions add`} up to ${f(Math.round(annual / 12))} a month — ${f(annual)} a year${eq ? `. That's ${eq.label}.` : '.'}`,
    amount: annual,
    txnIds: subs.flatMap((s) => s.txnIds),
    suggestedAction: { tool: 'list_recurring', args: { onlySubscriptions: true }, label: 'Review subscriptions' },
    evidence: { count: subs.length, annualTotal: annual, monthlyTotal: Math.round(annual / 12), ...(eq ? { equivalent: eq.label } : {}) },
  }]
}

/**
 * Bill analysis findings: price_hike (recurring series whose latest amount rose >= 5%), duplicate_charge
 * (two charges of one subscription / recurring series in one billing period, a provider-billed charge twice
 * within 48h, or an identical online/card charge within 10 minutes — see duplicateReason), due_soon
 * (unpaid bill due within 5 days), overdue, bill_spike (utility bill >= 25% above its 3-period average),
 * subscription_overlap (2+ active subscriptions in the same niche, e.g. video streaming / music),
 * annual_cost (total yearly subscription cost, with a dream-item equivalent in the detail text).
 * Each finding carries evidence numbers and, where sensible, a suggestedAction (cancel_subscription,
 * dispute_transaction, pay_bill, set_bill_reminder). Sorted by severity (alert > warn > info).
 *
 * Fares, coffee/tea and purchases under ¥20 are never duplicates on timing alone (two metro rides minutes
 * apart, two coffees are real purchases). Bill rawText is never read here (untrusted).
 */
export function analyzeBills(ctx: FinanceContext, recurring: RecurringSeries[]): BillFinding[] {
  // exact amounts for one bill / charge / price; whole yuan from ¥100 for totals and averages
  const f = moneyFmt(ctx.profile.currency)
  const c = copyFmt(ctx.profile.currency)
  const findings = [
    ...duplicates(ctx, recurring, f),
    ...dueFindings(ctx, f),
    ...priceHikes(recurring, f, c),
    ...spikes(ctx, f, c),
    ...overlaps(recurring, f, c),
    ...annualCost(ctx, recurring, c),
  ]
  return findings
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_RANK[a.x.severity] - SEVERITY_RANK[b.x.severity] || a.i - b.i)
    .map(({ x }) => x)
}
