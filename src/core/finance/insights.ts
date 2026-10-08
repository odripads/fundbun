import { CATEGORIES } from '../categories'
import { dayOfMonth, monthLabel, shiftMonth, weekday, ym } from '../dates'
import { roundMajor } from '../money'
import type { CategoryId, DreamEquivalent, FinanceContext, Insight, InsightKind, Minor, MonthSummary, Tone, Transaction, YearMonth } from '../types'
import { capCategoryAction, dailyTripwireAction, majorUnits, stashAction } from './actions'
import { type Anomaly, detectAnomalies } from './anomalies'
import { byTone, type Fmt, listJoin, moneyFmt, plural } from './copy'
import { dreamEquivalents, goalEquivalent, goalProgress, primaryGoal } from './dreams'
import { FIXED_CATEGORIES, inMonth, isLateNight, isSpending, monthSpend, upTo } from './ledger'
import { mirrorStatus } from './mirror'
import { detectRecurring } from './recurring'
import { groupBy } from './stats'
import { summarizeMonth } from './summary'

const MAX_INSIGHTS = 8
const CHANGE_PCT = 0.2
const CHANGE_MIN_MAJOR = 200
const SMALL_MAJOR = 40

interface Env {
  ctx: FinanceContext
  s: MonthSummary
  month: YearMonth
  txns: Transaction[]
  spend: Transaction[]
  f: Fmt
  tone: Tone
  minor: (major: number) => Minor
}

interface Scored {
  score: number
  insight: Insight
}

function make(env: Env, kind: InsightKind, key: string, score: number, body: Omit<Insight, 'id' | 'kind'>): Scored {
  const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Omit<Insight, 'id' | 'kind'>
  return { score, insight: { id: `ins_${kind}_${env.month}${key ? `_${key}` : ''}`, kind, ...clean } }
}

function dreamFor(amount: Minor, env: Env): DreamEquivalent | undefined {
  return goalEquivalent(amount, env.ctx.dreams)
}

function thats(dream: DreamEquivalent | undefined): string {
  return dream ? ` That's ${dream.label}.` : ''
}

function daysLeft(s: MonthSummary): number {
  return Math.max(0, s.daysInMonth - s.dayOfMonth)
}

// ───────────────────────────── pace / under ─────────────────────────────

function pace(env: Env): Scored[] {
  const { s, f } = env
  const status = mirrorStatus(s)
  if (status !== 'over' && status !== 'pace_over') return []
  const over = status === 'over' ? s.spent - s.target : s.projected - s.target
  const dream = dreamFor(over, env)
  const evidence = { spent: s.spent, projected: s.projected, target: s.target, dayOfMonth: s.dayOfMonth, daysInMonth: s.daysInMonth, safeToSpendToday: s.safeToSpendToday }
  if (status === 'over') {
    return [make(env, 'pace_warning', 'over', 100, {
      title: byTone(env.tone, { gentle: `${f(over)} past your target`, cheeky: `${f(over)} over — ouch`, numbers: `Over target by ${f(over)}` }),
      body: `You've spent ${f(s.spent)} against a ${f(s.target)} target${s.isCurrent ? `, with ${plural(daysLeft(s), 'day')} to go` : ''}.${thats(dream)}`,
      amount: over,
      severity: 'warn',
      why: `Spending so far (${f(s.spent)}) is above your monthly target (${f(s.target)}).`,
      dream,
      suggestedAction: s.isCurrent ? dailyTripwireAction(env.ctx, s) : undefined,
      evidence,
    })]
  }
  return [make(env, 'pace_warning', 'pace', 100, {
    title: byTone(env.tone, { gentle: `On pace to overshoot by ${f(over)}`, cheeky: `This pace overshoots by ${f(over)}`, numbers: `Projected ${f(over)} over target` }),
    body: `At this pace you'll end near ${f(s.projected)} vs your ${f(s.target)} target. Keeping to ${f(s.safeToSpendToday)} a day closes the gap.${thats(dream)}`,
    amount: over,
    severity: 'warn',
    why: `Projection = spent so far (${f(s.spent)}) + ${plural(daysLeft(s), 'day')} at your blended daily pace (this month mixed with your 3-month average) + bills still due. It is more than 5% above target.`,
    dream,
    suggestedAction: dailyTripwireAction(env.ctx, s),
    evidence,
  })]
}

function underBudget(env: Env): Scored[] {
  const { s, f } = env
  if (mirrorStatus(s) !== 'under') return []
  const surplus = s.target - s.projected
  const goalItem = primaryGoal(env.ctx.dreams.filter((d) => !d.achievedAt && d.price > 0))
  const progress = goalItem ? goalProgress(goalItem, env.ctx) : undefined
  const dream = dreamFor(surplus, env)
  const closer = progress ? ` Stash it and your ${progress.name} gets ${f(surplus)} closer.` : ''
  return [make(env, 'under_budget', '', 85, {
    title: s.isCurrent ? `On pace to finish ${f(surplus)} under target` : `You finished ${f(surplus)} under target`,
    body: `${s.isCurrent ? 'Projected' : 'Final'} spend ${f(s.projected)} vs your ${f(s.target)} target.${closer}`,
    amount: surplus,
    severity: 'positive',
    why: `${s.isCurrent ? 'Projected month-end' : 'Total'} spending (${f(s.projected)}) is below your ${f(s.target)} target${s.isCurrent ? ' by more than 5%' : ''}.`,
    dream,
    suggestedAction: stashAction(env.ctx, s, surplus),
    evidence: { projected: s.projected, target: s.target, surplus, ...(progress ? { goalPct: progress.pct } : {}) },
  })]
}

// ───────────────────────────── category changes ─────────────────────────────

/** Last month's spend in the category (the baseline a suggested cap tightens from), else `fallback`. */
function lastMonthOr(s: MonthSummary, category: CategoryId, fallback: Minor): Minor {
  const prev = s.byCategory.find((r) => r.category === category)?.prevMonth ?? 0
  return prev > 0 ? prev : fallback
}

function categoryChanges(env: Env): Scored[] {
  const { s, f, ctx, month } = env
  const prevMonth = shiftMonth(month, -1)
  const day = s.isCurrent ? s.dayOfMonth : 31
  const prev = monthSpend(env.txns, prevMonth, (t) => dayOfMonth(t.date) <= day).byCategory
  const cur = monthSpend(env.txns, month).byCategory
  const prevLabel = s.isCurrent ? `this point in ${monthLabel(prevMonth, 'short').split(' ')[0]}` : monthLabel(prevMonth, 'short').split(' ')[0]
  const changes: { category: CategoryId; now: Minor; before: Minor; diff: Minor }[] = []
  for (const category of new Set<CategoryId>([...cur.keys(), ...prev.keys()])) {
    const now = cur.get(category)?.spent ?? 0
    const before = prev.get(category)?.spent ?? 0
    const diff = now - before
    if (Math.abs(diff) >= env.minor(CHANGE_MIN_MAJOR) && (before === 0 || Math.abs(diff) >= before * CHANGE_PCT)) changes.push({ category, now, before, diff })
  }
  const ups = changes.filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 2)
  const downs = changes.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 1)
  const evidence = (c: (typeof changes)[number]) => ({ thisMonth: c.now, comparedWith: c.before, change: c.diff, ...(c.before > 0 ? { pct: Math.round((c.diff / c.before) * 100) } : {}) })
  const pctText = (c: (typeof changes)[number]) => `${Math.round((Math.abs(c.diff) / Math.max(1, c.before)) * 100)}%`
  return [
    ...ups.map((c, i) => {
      const label = CATEGORIES[c.category].label
      const dream = dreamFor(c.diff, env)
      return make(env, 'category_up', c.category, 80 - i * 5, {
        title: c.before === 0
          ? byTone(env.tone, { gentle: `New this month: ${f(c.now)} on ${label.toLowerCase()}`, cheeky: `Hello, ${label.toLowerCase()}: ${f(c.now)} so far`, numbers: `${label} +${f(c.diff)} (new)` })
          : byTone(env.tone, { gentle: `${label} up ${pctText(c)}`, cheeky: `${label} is on a roll (+${pctText(c)})`, numbers: `${label} +${f(c.diff)} (+${pctText(c)})` }),
        body: `${f(c.now)} vs ${f(c.before)} by ${prevLabel}.${dream ? ` The extra ${f(c.diff)} = ${dream.label}.` : ''}`,
        amount: c.diff,
        category: c.category,
        severity: 'warn',
        why: `Flagged because ${label.toLowerCase()} changed by at least 20% and ${f(env.minor(CHANGE_MIN_MAJOR))} compared with ${prevLabel}.`,
        dream,
        suggestedAction: CATEGORIES[c.category].kind === 'want' ? capCategoryAction(ctx, c.category, lastMonthOr(s, c.category, c.before || c.now)) : undefined,
        evidence: evidence(c),
      })
    }),
    ...downs.map((c) => {
      const label = CATEGORIES[c.category].label
      const saved = -c.diff
      const dream = dreamFor(saved, env)
      return make(env, 'category_down', c.category, 40, {
        title: `${label} down ${pctText(c)}`,
        body: `${f(saved)} less than by ${prevLabel}.${dream ? ` That's ${dream.label} you kept.` : ''}`,
        amount: saved,
        category: c.category,
        severity: 'positive',
        why: `Flagged because ${label.toLowerCase()} dropped by at least 20% and ${f(env.minor(CHANGE_MIN_MAJOR))} compared with ${prevLabel}.`,
        dream,
        evidence: evidence(c),
      })
    }),
  ]
}

// ───────────────────────────── habits ─────────────────────────────

function dominantCategory(txns: Transaction[]): { category: CategoryId; share: number } {
  const groups = [...groupBy(txns, (t) => t.category)].map(([category, ts]) => ({ category, total: ts.reduce((s, t) => s - t.amount, 0) }))
  const total = groups.reduce((s, g) => s + g.total, 0)
  const top = groups.sort((a, b) => b.total - a.total)[0]
  return { category: top.category, share: total > 0 ? top.total / total : 0 }
}

function total(txns: Transaction[]): Minor {
  return txns.reduce((s, t) => s - t.amount, 0)
}

function topMerchant(env: Env): Scored[] {
  const { f, s } = env
  const dayToDay = env.spend.filter((t) => !FIXED_CATEGORIES.has(t.category) && !t.billId)
  if (dayToDay.length === 0 || s.spent <= 0) return []
  const [merchant, txns] = [...groupBy(dayToDay, (t) => t.merchant)].sort((a, b) => total(b[1]) - total(a[1]))[0]
  const amount = total(txns)
  const share = Math.round((amount / s.spent) * 100)
  const dream = dreamFor(amount, env)
  return [make(env, 'top_merchant', '', 50, {
    title: byTone(env.tone, { gentle: `${merchant} is your top spot`, cheeky: `${merchant} misses you already`, numbers: `Top merchant: ${merchant}` }),
    body: `${f(amount)} across ${plural(txns.length, 'purchase')} — ${share}% of your spending.${thats(dream)}`,
    amount,
    category: dominantCategory(txns).category,
    severity: 'neutral',
    why: `${merchant} has the largest total among day-to-day merchants this month (rent, bills and subscriptions excluded).`,
    dream,
    evidence: { merchant, total: amount, count: txns.length, sharePct: share },
  })]
}

function lateNight(env: Env): Scored[] {
  const { f, s, ctx } = env
  const late = env.spend.filter(isLateNight)
  if (late.length < 3) return []
  const amount = total(late)
  const { category, share } = dominantCategory(late)
  const label = CATEGORIES[category].label
  const dream = dreamFor(amount, env)
  const usual = lastMonthOr(s, category, s.byCategory.find((r) => r.category === category)?.spent ?? 0)
  return [make(env, 'late_night', '', 70, {
    title: byTone(env.tone, { gentle: `Late-night spending: ${f(amount)}`, cheeky: `The midnight snack tax: ${f(amount)}`, numbers: `${late.length} late-night purchases: ${f(amount)}` }),
    body: `${plural(late.length, 'purchase')} between 10pm and 4am${share >= 0.5 ? `, mostly ${label.toLowerCase()}` : ''}.${thats(dream)}`,
    amount,
    category,
    severity: s.spent > 0 && amount >= s.spent * 0.05 ? 'warn' : 'neutral',
    why: `Counted purchases timestamped between 22:00 and 04:00 this month: ${late.length}, totalling ${f(amount)}.`,
    dream,
    suggestedAction: CATEGORIES[category].kind === 'want' && usual > 0 ? capCategoryAction(ctx, category, usual) : undefined,
    evidence: { count: late.length, total: amount, topCategory: category, topCategorySharePct: Math.round(share * 100) },
  })]
}

function smallFrequent(env: Env): Scored[] {
  const { f, s } = env
  // the latte factor is about impulse buys, not the ¥15 subscription that renews itself
  const small = env.spend.filter((t) => -t.amount < env.minor(SMALL_MAJOR) && CATEGORIES[t.category].kind === 'want' && !FIXED_CATEGORIES.has(t.category))
  const amount = total(small)
  if (small.length < 8 || amount < env.minor(200)) return []
  const days = Math.max(1, s.dayOfMonth)
  const yearly = roundMajor(s.isCurrent ? (amount / days) * 365 : amount * 12, env.ctx.profile.currency)
  const { category } = dominantCategory(small)
  const dream = dreamEquivalents(yearly, env.ctx.dreams, 1)[0]
  return [make(env, 'small_frequent', '', 65, {
    title: byTone(env.tone, { gentle: `Small buys add up: ${f(amount)}`, cheeky: `The latte factor strikes: ${f(amount)}`, numbers: `${small.length} purchases under ${f(env.minor(SMALL_MAJOR))}: ${f(amount)}` }),
    body: `${plural(small.length, 'purchase')} under ${f(env.minor(SMALL_MAJOR))}, mostly ${CATEGORIES[category].label.toLowerCase()}. At this rate that's ${f(yearly)} a year${dream ? ` — ${dream.label}` : ''}.`,
    amount,
    category,
    severity: 'neutral',
    why: `Counted discretionary purchases under ${f(env.minor(SMALL_MAJOR))} this month (${small.length}, ${f(amount)}); the yearly figure is ${s.isCurrent ? 'the daily rate × 365' : 'this month × 12'}.`,
    dream,
    evidence: { count: small.length, total: amount, yearly, topCategory: category },
  })]
}

function weekendSpike(env: Env): Scored[] {
  const { f, s } = env
  const dayToDay = env.spend.filter((t) => !FIXED_CATEGORIES.has(t.category) && !t.billId)
  let weekendDays = 0
  let weekdays = 0
  for (let d = 1; d <= Math.max(0, s.dayOfMonth); d++) {
    const w = weekday(`${env.month}-${String(d).padStart(2, '0')}`)
    if (w === 0 || w === 6) weekendDays++
    else weekdays++
  }
  if (weekendDays < 2 || weekdays < 3) return []
  const isWeekendTxn = (t: Transaction) => [0, 6].includes(weekday(t.date))
  const weekendSpend = total(dayToDay.filter(isWeekendTxn))
  const weekdaySpend = total(dayToDay.filter((t) => !isWeekendTxn(t)))
  const perWeekend = weekendSpend / weekendDays
  const perWeekday = weekdaySpend / weekdays
  if (weekendSpend < env.minor(200) || perWeekday <= 0 || perWeekend < perWeekday * 1.5) return []
  const ratio = Math.round((perWeekend / perWeekday) * 10) / 10
  const currency = env.ctx.profile.currency
  const extra = roundMajor((perWeekend - perWeekday) * weekendDays, currency)
  const dream = dreamFor(extra, env)
  return [make(env, 'weekend_spike', '', 55, {
    title: byTone(env.tone, { gentle: `Weekends cost ${ratio}× more`, cheeky: `Weekend you is living large (${ratio}×)`, numbers: `Weekend daily spend ${ratio}× weekdays` }),
    body: `About ${f(roundMajor(perWeekend, currency))} a day on weekends vs ${f(roundMajor(perWeekday, currency))} on weekdays.${dream ? ` The weekend extra (${f(extra)}) = ${dream.label}.` : ''}`,
    amount: extra,
    severity: 'neutral',
    why: `Average day-to-day spending per weekend day vs per weekday this month (rent, bills and subscriptions excluded); shown when weekends run at least 1.5× weekdays.`,
    dream,
    evidence: { weekendDays, weekdays, perWeekendDay: Math.round(perWeekend), perWeekday: Math.round(perWeekday), ratio },
  })]
}

function subscriptionLoad(env: Env): Scored[] {
  const { f, ctx, s } = env
  if (!s.isCurrent) return []
  const subs = detectRecurring(env.txns, ctx.bank.today, ctx.bank.cancelledMerchants).filter((x) => x.isSubscription && x.status === 'active')
  const annual = subs.reduce((t, x) => t + x.annualCost, 0)
  const monthly = Math.round(annual / 12)
  if (subs.length < 3 && monthly < ctx.profile.monthlyIncome * 0.05) return []
  if (subs.length === 0) return []
  const dream = dreamEquivalents(annual, ctx.dreams, 1)[0]
  const names = subs.slice(0, 3).map((x) => x.merchant)
  return [make(env, 'subscription_load', '', 60, {
    title: `${plural(subs.length, 'subscription')} = ${f(annual)}/year`,
    body: `${f(monthly)} a month on ${listJoin(names)}${subs.length > 3 ? ' and more' : ''}.${dream ? ` A year of them = ${dream.label}.` : ''}`,
    amount: annual,
    category: 'subscriptions',
    severity: 'neutral',
    why: `Detected ${plural(subs.length, 'active recurring subscription')}; yearly cost = latest price × charges per year.`,
    dream,
    suggestedAction: { tool: 'list_recurring', args: { onlySubscriptions: true }, label: 'Review subscriptions' },
    evidence: { count: subs.length, monthly, annual },
  })]
}

/** This month's anomalies, one per merchant (three identical odd charges are one story). */
function anomaliesInMonth(txns: Transaction[], env: Env): { anomaly: Anomaly; txn: Transaction }[] {
  const byId = new Map(txns.map((t) => [t.id, t]))
  const seen = new Set<string>()
  return detectAnomalies(txns, env.ctx.bank.today)
    .map((anomaly) => ({ anomaly, txn: byId.get(anomaly.txnId)! }))
    .filter((x) => x.txn && inMonth(x.txn, env.month) && !seen.has(x.txn.merchant) && !!seen.add(x.txn.merchant))
}

function anomalyInsights(env: Env): Scored[] {
  const { f } = env
  return anomaliesInMonth(env.txns, env)
    .slice(0, 2)
    .map(({ anomaly: a, txn }, i) => {
      const dream = dreamFor(a.amount, env)
      return make(env, 'anomaly', a.txnId, 90 - i * 5, {
        title: `Unusual: ${f(a.amount)} at ${txn.merchant}`,
        body: `${a.reason}${thats(dream)}`,
        amount: a.amount,
        category: a.category,
        severity: 'warn',
        why: `Robust z-score ${a.score} (> 3.5) against your ${CATEGORIES[a.category].label.toLowerCase()} purchases over the last 120 days (typical ${f(a.typical)}).`,
        dream,
        evidence: { txnId: a.txnId, amount: a.amount, typical: a.typical, score: a.score, date: txn.date },
      })
    })
}

function savingsRate(env: Env): Scored[] {
  const { f, s, ctx } = env
  if (s.income <= 0) return []
  const pct = Math.round((s.savedToGoals / s.income) * 100)
  const goalItem = primaryGoal(ctx.dreams.filter((d) => !d.achievedAt && d.price > 0))
  const progress = goalItem ? goalProgress(goalItem, ctx) : undefined
  const dream = s.savedToGoals > 0 ? dreamFor(s.savedToGoals, env) : undefined
  const body = s.savedToGoals > 0
    ? `${f(s.savedToGoals)} went into your goal pots${progress ? ` — your ${progress.name} is ${Math.floor(progress.pct)}% there` : ''}.`
    : `Nothing has gone into your goal pots yet this month.`
  return [make(env, 'savings_rate', '', 45, {
    title: byTone(env.tone, { gentle: `You saved ${pct}% of your income`, cheeky: `${pct}% of your pay went to dreams`, numbers: `Savings rate: ${pct}%` }),
    body,
    amount: s.savedToGoals,
    severity: pct >= 10 ? 'positive' : 'neutral',
    why: `Savings rate = money moved into goal pots (${f(s.savedToGoals)}) ÷ income received (${f(s.income)}) in ${monthLabel(s.month)}.`,
    dream,
    evidence: { saved: s.savedToGoals, income: s.income, ratePct: pct },
  })]
}

/**
 * Spending insights for a month: category_up / category_down (vs previous month, >= 20% and >= ¥200),
 * top_merchant, late_night (22:00–04:00 spend, esp. delivery), small_frequent ("latte factor": many
 * purchases < ¥40 adding up), weekend_spike, pace_warning, under_budget, subscription_load, anomaly
 * (from detectAnomalies), savings_rate. Each has a plain-language `why`, evidence numbers, a dream
 * equivalent and, where useful, a suggestedAction. Max 8, most useful first.
 *
 * For the current month, category changes compare like with like: month-to-date vs the same days of the
 * previous month.
 */
export function generateInsights(ctx: FinanceContext, month?: YearMonth): Insight[] {
  const m = month ?? ym(ctx.bank.today)
  const txns = upTo(ctx.bank.transactions, ctx.bank.today)
  const env: Env = {
    ctx,
    s: summarizeMonth(ctx, m),
    month: m,
    txns,
    spend: txns.filter((t) => isSpending(t) && inMonth(t, m)),
    f: moneyFmt(ctx.profile.currency),
    tone: ctx.profile.tone,
    minor: (major) => majorUnits(major, ctx.profile.currency),
  }
  const all = [
    ...pace(env),
    ...anomalyInsights(env),
    ...underBudget(env),
    ...categoryChanges(env),
    ...lateNight(env),
    ...smallFrequent(env),
    ...subscriptionLoad(env),
    ...weekendSpike(env),
    ...topMerchant(env),
    ...savingsRate(env),
  ]
  return all
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INSIGHTS)
    .map((x) => x.insight)
}
