import { CATEGORIES, SPENDING_CATEGORIES } from '../categories'
import { monthsBack, shiftMonth, ym } from '../dates'
import { MINOR_PER_MAJOR } from '../money'
import type { BudgetPlan, CategoryBudget, CategoryId, Currency, FinanceContext, ISODateTime, Minor, YearMonth } from '../types'
import { type Fmt, moneyFmt } from './copy'
import { FIXED_CATEGORIES, monthSpend, upTo } from './ledger'
import { median } from './stats'

type Weights = Map<CategoryId, number>

/** Typical shares when there's no history to learn from. */
const DEFAULT_NEEDS: [CategoryId, number][] = [
  ['housing', 45], ['groceries', 20], ['transport', 10], ['utilities', 8], ['health', 7], ['phone_internet', 5], ['education', 5],
]
const DEFAULT_WANTS: [CategoryId, number][] = [
  ['dining', 25], ['shopping', 22], ['delivery', 15], ['entertainment', 12], ['coffee_tea', 8], ['travel', 7], ['subscriptions', 6], ['personal_care', 5],
]

const isNeed = (c: CategoryId) => CATEGORIES[c].kind === 'need'
const isWant = (c: CategoryId) => CATEGORIES[c].kind === 'want'

function sumOf(w: Weights): number {
  let s = 0
  for (const v of w.values()) s += v
  return s
}

function pick(w: Weights, pred: (c: CategoryId) => boolean): Weights {
  return new Map([...w].filter(([c, v]) => pred(c) && v > 0))
}

function scaleTo(w: Weights, total: number): Weights {
  const s = sumOf(w)
  return new Map(s > 0 ? [...w].map(([c, v]) => [c, (v / s) * total]) : [])
}

/** Median monthly spend per category over the up-to-3 complete months before `month` (or before today's month) that the data covers. */
export function historyMedians(ctx: FinanceContext, month: YearMonth): Weights {
  const txns = upTo(ctx.bank.transactions, ctx.bank.today)
  if (txns.length === 0) return new Map()
  const first = ym(txns.reduce((min, t) => (t.date < min ? t.date : min), txns[0].date))
  const current = ym(ctx.bank.today)
  // planning ahead still learns from the last finished months, not from the unfinished current one
  const before = month < current ? month : current
  const months = monthsBack(shiftMonth(before, -1), 3).filter((m) => m >= first)
  if (months.length === 0) return new Map()
  const perMonth = months.map((m) => monthSpend(txns, m).byCategory)
  const out: Weights = new Map()
  for (const c of SPENDING_CATEGORIES) {
    const med = median(perMonth.map((byCat) => byCat.get(c)?.spent ?? 0))
    if (med > 0) out.set(c, med)
  }
  return out
}

function roundLimit(m: number, currency: Currency): Minor {
  const unit = MINOR_PER_MAJOR[currency]
  const step = m / unit >= 500 ? 10 : 1
  return Math.round(m / unit / step) * step * unit
}

/** Round every limit, then push the rounding residue into the biggest want (or biggest category) so the sum is exact. */
function finalize(alloc: Weights, target: Minor, currency: Currency): CategoryBudget[] {
  const rows = [...alloc]
    .map(([category, v]) => ({ category, limit: roundLimit(v, currency) }))
    .filter((r) => r.limit > 0)
  if (rows.length === 0) {
    const biggest = [...alloc].sort((a, b) => b[1] - a[1])[0]
    return biggest ? [{ category: biggest[0], limit: target }] : []
  }
  let residual = target - rows.reduce((s, r) => s + r.limit, 0)
  const order = [...rows].sort((a, b) => Number(isWant(b.category)) - Number(isWant(a.category)) || b.limit - a.limit)
  for (const r of order) {
    if (residual === 0) break
    const next = Math.max(0, r.limit + residual)
    residual -= next - r.limit
    r.limit = next
  }
  return rows.filter((r) => r.limit > 0).sort((a, b) => b.limit - a.limit)
}

interface Allocation {
  alloc: Weights
  method: BudgetPlan['method']
  rationale: string
}

function weightsOr(history: Weights, defaults: [CategoryId, number][]): Weights {
  return history.size > 0 ? history : new Map(defaults)
}

function fiftyThirtyTwenty(ctx: FinanceContext, history: Weights, f: Fmt, note = ''): Allocation {
  const { targetSpend: target, monthlyIncome: income } = ctx.profile
  const needsHistory = sumOf(pick(history, isNeed))
  const needs = Math.min(target, Math.max(Math.round((target * 5) / 8), needsHistory))
  const wants = target - needs
  const alloc = new Map([
    ...scaleTo(weightsOr(pick(history, isNeed), DEFAULT_NEEDS), needs),
    ...scaleTo(weightsOr(pick(history, isWant), DEFAULT_WANTS), wants),
  ])
  const savings = income - target
  const saveLine = savings > 0 ? `${f(savings)} (${Math.round((savings / income) * 100)}%) of your ${f(income)} income stays free for your dreams` : `your target uses all of your ${f(income)} income`
  return {
    alloc,
    method: 'fifty_thirty_twenty',
    rationale: `${note}50/30/20: ${saveLine}; your ${f(target)} target splits into ${f(needs)} for needs and ${f(wants)} for wants.`,
  }
}

function fromHistory(ctx: FinanceContext, history: Weights, f: Fmt): Allocation {
  const target = ctx.profile.targetSpend
  const total = sumOf(history)
  if (total <= target) {
    // rent and bills don't grow because there's slack; the slack goes to the flexible categories
    const fixed = pick(history, (c) => FIXED_CATEGORIES.has(c))
    const flexible = pick(history, (c) => !FIXED_CATEGORIES.has(c))
    const alloc = sumOf(flexible) > 0 ? new Map([...fixed, ...scaleTo(flexible, target - sumOf(fixed))]) : scaleTo(history, target)
    return { alloc, method: 'history', rationale: `Your usual ${f(Math.round(total))} a month: bills stay as they are and the rest of your ${f(target)} target is shared across everyday categories in the same proportions.` }
  }
  const needs = pick(history, isNeed)
  const needsTotal = sumOf(needs)
  if (needsTotal >= target) {
    return {
      alloc: scaleTo(needs, target),
      method: 'history',
      rationale: `Your essentials alone usually run ${f(Math.round(needsTotal))}, above your ${f(target)} target, so this plan covers needs only — worth revisiting the target.`,
    }
  }
  const wants = pick(history, isWant)
  const trimPct = Math.round((1 - (target - needsTotal) / sumOf(wants)) * 100)
  return {
    alloc: new Map([...needs, ...scaleTo(wants, target - needsTotal)]),
    method: 'history',
    rationale: `Based on your last few months (${f(Math.round(total))}): needs kept at ${f(Math.round(needsTotal))}, wants trimmed ${trimPct}% to fit your ${f(target)} target.`,
  }
}

function custom(ctx: FinanceContext, history: Weights, f: Fmt): Allocation {
  const existing: Weights = new Map((ctx.budget?.categories ?? []).map((c) => [c.category, c.limit]))
  if (sumOf(existing) <= 0) return history.size > 0 ? fromHistory(ctx, history, f) : fiftyThirtyTwenty(ctx, history, f)
  return { alloc: scaleTo(existing, ctx.profile.targetSpend), method: 'custom', rationale: `Your own plan, rescaled to your ${f(ctx.profile.targetSpend)} target.` }
}

/**
 * Propose a monthly budget plan whose category limits sum to profile.targetSpend.
 * 'history': allocate target proportionally to the last 3 months' category medians, trimming 'want'
 *   categories first when history exceeds target (needs are protected).
 * 'fifty_thirty_twenty': needs ≈ 50% of income, wants ≈ 30%, savings 20%, capped to targetSpend.
 * Round limits to whole yuan (multiples of 10 major units when >= 500). Include a one-line rationale.
 *
 * 50/30/20 splits the target 5:3 between needs and wants (needs are never squeezed below their usual level).
 * 'history' without any history falls back to 50/30/20; 'custom' rescales the current plan. The returned
 * `method` is the one actually used. createdAt defaults to the sandbox day (pass opts.now from the controller).
 */
export function proposeBudget(
  ctx: FinanceContext,
  method: BudgetPlan['method'],
  month: YearMonth,
  opts: { now?: ISODateTime; createdBy?: BudgetPlan['createdBy'] } = {},
): BudgetPlan {
  const f = moneyFmt(ctx.profile.currency)
  const target = Math.max(0, ctx.profile.targetSpend)
  const history = historyMedians(ctx, month)
  const plan =
    method === 'custom' ? custom(ctx, history, f)
    : method === 'history' && history.size > 0 ? fromHistory(ctx, history, f)
    : fiftyThirtyTwenty(ctx, history, f, method === 'history' ? 'Not enough history yet, so using ' : '')
  const categories = target > 0 ? finalize(plan.alloc, target, ctx.profile.currency) : []
  return {
    month,
    total: categories.reduce((s, c) => s + c.limit, 0),
    categories,
    method: plan.method,
    createdBy: opts.createdBy ?? 'agent',
    createdAt: opts.now ?? `${ctx.bank.today}T00:00:00.000Z`,
    rationale: plan.rationale,
  }
}
