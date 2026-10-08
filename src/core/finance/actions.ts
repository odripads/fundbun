import { CATEGORIES } from '../categories'
import { MINOR_PER_MAJOR } from '../money'
import type { CategoryId, Currency, FinanceContext, Minor, MonthSummary, SuggestedAction } from '../types'
import { moneyFmt } from './copy'
import { goalProgress, primaryGoal } from './dreams'

/** Suggested-action builders shared by the mirror and insights (internal). Code builds every CTA, never prose. */

export function majorUnits(n: number, currency: Currency): Minor {
  return n * MINOR_PER_MAJOR[currency]
}

export function roundDownTo10(m: Minor, currency: Currency): Minor {
  const ten = majorUnits(10, currency)
  return Math.floor(m / ten) * ten
}

/** The amount a transfer_to_goal action moves (0 for any other action). */
export function stashAmountOf(action: SuggestedAction | undefined): Minor {
  if (!action || action.tool !== 'transfer_to_goal') return 0
  const a = Number(action.args.amount)
  return Number.isSafeInteger(a) && a > 0 ? a : 0
}

/**
 * "Stash ¥X in <goal>": the full surplus of a finished month, half of a projected one (it isn't banked yet),
 * capped at what the goal still needs. Never a purchase.
 */
export function stashAction(ctx: FinanceContext, s: MonthSummary, surplus: Minor): SuggestedAction | undefined {
  const goal = primaryGoal(ctx.dreams.filter((d) => !d.achievedAt && d.price > 0))
  if (!goal || goal.kind !== 'goal' || surplus <= 0) return undefined
  const currency = ctx.profile.currency
  const progress = goalProgress(goal, ctx)
  const raw = s.isCurrent ? surplus / 2 : surplus
  const capped = Math.min(raw, Math.max(0, goal.price - progress.saved))
  const amount = capped >= majorUnits(10, currency) ? roundDownTo10(capped, currency) : Math.floor(capped)
  if (amount < majorUnits(1, currency)) return undefined
  return { tool: 'transfer_to_goal', args: { goalId: goal.id, amount }, label: `Stash ${moneyFmt(currency)(amount)} in ${goal.name}` }
}

/** The category's limit in the active budget plan, if it has one. */
export function categoryLimit(ctx: FinanceContext, category: CategoryId): Minor | undefined {
  return ctx.budget?.categories.find((c) => c.category === category)?.limit
}

/**
 * A tightening budget cap, rounded down to ¥10: 10% under the category's current limit when it has one,
 * otherwise ~15% under `usual` (callers pass last month's spend; min ¥50). A "cap" never loosens a budget,
 * so it is always below the current limit — undefined when there is nothing left to tighten.
 */
export function capCategoryAction(ctx: FinanceContext, category: CategoryId, usual: Minor): SuggestedAction | undefined {
  const currency = ctx.profile.currency
  const current = categoryLimit(ctx, category)
  const limit = current !== undefined
    ? roundDownTo10(current * 0.9, currency)
    : Math.max(majorUnits(50, currency), roundDownTo10(usual * 0.85, currency))
  if (limit <= 0 || (current !== undefined && limit >= current)) return undefined
  return { tool: 'set_category_budget', args: { category, limit }, label: `Cap ${CATEGORIES[category].label} at ${moneyFmt(currency)(limit)}` }
}

const CATEGORY_ALERT_PCT = 80
const PACE_WIRE: SuggestedAction = { tool: 'create_tripwire', args: { kind: 'pace_over', threshold: 100 }, label: 'Warn me before I overshoot' }

/** Where a category's spending is heading by month end at its current daily rate (past months: what was spent). */
function categoryPace(s: MonthSummary, spent: Minor): Minor {
  return s.isCurrent && s.dayOfMonth > 0 ? Math.round((spent / s.dayOfMonth) * s.daysInMonth) : spent
}

/**
 * A cap for a category without a limit that actually bites this month: below where its spending is heading,
 * but above what is already spent (a cap you have already blown is a scolding, not a plan).
 */
function capBelowPace(ctx: FinanceContext, s: MonthSummary, category: CategoryId, spent: Minor, prevMonth: Minor): SuggestedAction | undefined {
  if (!s.isCurrent) return capCategoryAction(ctx, category, spent)
  const currency = ctx.profile.currency
  const pace = categoryPace(s, spent)
  const usual = Math.max(prevMonth, spent)
  const fromHistory = capCategoryAction(ctx, category, usual)
  const limit = fromHistory ? Number(fromHistory.args.limit) : 0
  if (fromHistory && limit > spent && limit < pace) return fromHistory
  const between = roundDownTo10(spent + (pace - spent) / 2, currency)
  if (between <= spent || between >= pace) return undefined
  return { tool: 'set_category_budget', args: { category, limit: between }, label: `Cap ${CATEGORIES[category].label} at ${moneyFmt(currency)(between)}` }
}

/** "Alert me on days over ¥X" with X below the current daily average, unless such a line already exists. */
function dailyLineAction(ctx: FinanceContext, s: MonthSummary): SuggestedAction | undefined {
  if (!s.isCurrent || s.dailyAvg <= 0) return undefined
  const currency = ctx.profile.currency
  const even = dailyTripwireAction(ctx, s)
  const threshold = Math.min(Number(even.args.threshold), roundDownTo10(s.dailyAvg * 0.85, currency))
  if (threshold < majorUnits(10, currency) || threshold >= s.dailyAvg) return undefined
  if (ctx.tripwires.some((t) => t.enabled && t.kind === 'daily_over' && t.threshold <= threshold)) return undefined
  return { tool: 'create_tripwire', args: { kind: 'daily_over', threshold }, label: `Alert me on days over ${moneyFmt(currency)(threshold)}` }
}

function hasPaceWire(ctx: FinanceContext): boolean {
  return ctx.tripwires.some((t) => t.enabled && t.kind === 'pace_over' && t.threshold <= 100)
}

/**
 * Over/pace-over secondary CTA — always a rule that still changes something this month:
 *  · the biggest 'want' category below 80% of its limit (and no alert yet) → "Alert me at 80% of <category>";
 *  · that category without a limit → a cap below where its spending is heading (but above what's spent);
 *  · otherwise (the category is already past 80%): while only the pace runs over, a pace tripwire; once over,
 *    a daily spending line below the current daily average ("Alert me on days over ¥300").
 * Never an 80% alert for a category that has already crossed 80% — that alert would be stale on arrival.
 */
export function overspendAction(ctx: FinanceContext, s: MonthSummary): SuggestedAction {
  const row = s.byCategory.filter((r) => CATEGORIES[r.category].kind === 'want' && r.spent > 0).sort((a, b) => b.spent - a.spent)[0]
  if (row) {
    const label = CATEGORIES[row.category].label
    const hasTripwire = ctx.tripwires.some((t) => t.enabled && t.kind === 'category_pct' && t.category === row.category)
    if (row.limit !== undefined && row.limit > 0) {
      if (!hasTripwire && row.spent < (row.limit * CATEGORY_ALERT_PCT) / 100) {
        return { tool: 'create_tripwire', args: { kind: 'category_pct', threshold: CATEGORY_ALERT_PCT, category: row.category }, label: `Alert me at ${CATEGORY_ALERT_PCT}% of ${label}` }
      }
    } else {
      const cap = capBelowPace(ctx, s, row.category, row.spent, row.prevMonth ?? 0)
      if (cap) return cap
    }
  }
  const overAlready = s.spent > s.target
  if (!overAlready && !hasPaceWire(ctx)) return PACE_WIRE
  return dailyLineAction(ctx, s) ?? PACE_WIRE
}

/** "Alert me on days over ¥X", where X is an even share of the monthly target. */
export function dailyTripwireAction(ctx: FinanceContext, s: MonthSummary): SuggestedAction {
  const currency = ctx.profile.currency
  const threshold = Math.max(majorUnits(50, currency), roundDownTo10(s.target / s.daysInMonth, currency))
  return { tool: 'create_tripwire', args: { kind: 'daily_over', threshold }, label: `Alert me on days over ${moneyFmt(currency)(threshold)}` }
}
