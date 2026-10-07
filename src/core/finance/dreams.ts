import { addDays, monthsBack, shiftMonth, ym } from '../dates'
import type { Account, DreamEquivalent, DreamItem, FinanceContext, GoalProgress, Minor, Profile, Transaction, YearMonth } from '../types'
import { inMonth, isReversed } from './ledger'
import { pctText, withArticle } from './copy'
import { clamp, round1 } from './stats'

const DAYS_PER_MONTH = 30.4
const DEFAULT_WORK_HOURS = 174

function active(dreams: DreamItem[]): DreamItem[] {
  return dreams.filter((d) => !d.achievedAt && d.price > 0)
}

/** The goal shown by default: first non-achieved item of kind 'goal' (fallback: most expensive item). */
export function primaryGoal(dreams: DreamItem[]): DreamItem | undefined {
  const goal = active(dreams).find((d) => d.kind === 'goal')
  if (goal) return goal
  const pool = active(dreams).length > 0 ? active(dreams) : dreams
  return pool.reduce<DreamItem | undefined>((best, d) => (!best || d.price > best.price ? d : best), undefined)
}

export function potFor(item: DreamItem, accounts: Account[]): Account | undefined {
  return (
    accounts.find((a) => a.id === item.potAccountId) ??
    accounts.find((a) => a.type === 'pot' && a.goalId === item.id) ??
    accounts.find((a) => a.id === `pot_${item.id}`)
  )
}

function netPotFlow(txns: Transaction[], potId: string, month: YearMonth): Minor {
  let s = 0
  for (const t of txns) if (t.accountId === potId && !isReversed(t) && inMonth(t, month)) s += t.amount
  return s
}

/**
 * Average net pot inflow over the 3 complete months before today's month, counting only months since the
 * pot started (a goal created last month isn't averaged over months it didn't exist). With no complete
 * month yet, this month's net inflow so far is the best estimate.
 */
function monthlyRate(ctx: FinanceContext, pot: Account | undefined, item: DreamItem): Minor {
  if (!pot) return 0
  const txns = ctx.bank.transactions.filter((t) => t.accountId === pot.id && t.date <= ctx.bank.today)
  const current = ym(ctx.bank.today)
  const firstActivity = txns.reduce((min, t) => (t.date < min ? t.date : min), item.createdAt || ctx.bank.today)
  const months = monthsBack(shiftMonth(current, -1), 3).filter((m) => m >= ym(firstActivity))
  if (months.length === 0) return Math.max(0, netPotFlow(txns, pot.id, current))
  const total = months.reduce((s, m) => s + netPotFlow(txns, pot.id, m), 0)
  return Math.max(0, Math.round(total / months.length))
}

/** Progress from the item's pot balance; monthlyRate = average net pot inflow over the last 3 months. */
export function goalProgress(item: DreamItem, ctx: FinanceContext): GoalProgress {
  const pot = potFor(item, ctx.bank.accounts)
  const saved = Math.max(0, pot?.balance ?? 0)
  const rate = monthlyRate(ctx, pot, item)
  const left = Math.max(0, item.price - saved)
  const progress: GoalProgress = {
    itemId: item.id,
    name: item.name,
    saved,
    price: item.price,
    pct: item.price > 0 ? clamp(round1((saved / item.price) * 100), 0, 100) : 100,
    monthlyRate: rate,
  }
  if (left === 0) return { ...progress, etaMonths: 0, etaDate: ctx.bank.today }
  if (rate <= 0) return progress
  const months = left / rate
  return { ...progress, etaMonths: round1(months), etaDate: addDays(ctx.bank.today, Math.ceil(months * DAYS_PER_MONTH)) }
}

/** Every dream item's progress: open goals first, then treats, achieved items last. */
export function allGoalProgress(ctx: FinanceContext): GoalProgress[] {
  const rank = (d: DreamItem) => (d.achievedAt ? 2 : d.kind === 'goal' ? 0 : 1)
  return [...ctx.dreams]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .map(({ d }) => goalProgress(d, ctx))
}

export function equivalentOf(amount: Minor, item: DreamItem): DreamEquivalent {
  const fraction = Math.round((amount / item.price) * 10_000) / 10_000
  const quantity = Math.floor(amount / item.price)
  const label = quantity >= 2 ? `${quantity}× ${item.name}` : quantity === 1 ? withArticle(item.name) : `${pctText(amount / item.price)} of your ${item.name}`
  return { itemId: item.id, itemName: item.name, image: item.image, fraction, label }
}

/**
 * Express `amount` in dream items, most relatable first: whole items the amount buys (largest affordable
 * first, e.g. "2× New sneakers"), then the fraction of the primary goal ("38% of your Birkin").
 * Remaining slots go to the other items it doesn't fully cover, closest to whole first.
 */
export function dreamEquivalents(amount: Minor, dreams: DreamItem[], max = 3): DreamEquivalent[] {
  if (amount <= 0 || max <= 0) return []
  const items = active(dreams)
  const whole = items.filter((d) => d.price <= amount).sort((a, b) => b.price - a.price)
  const goal = primaryGoal(items)
  const partial = items.filter((d) => d.price > amount).sort((a, b) => a.price - b.price)
  const ordered = [...whole, ...(goal && goal.price > amount ? [goal] : []), ...partial]
  const seen = new Set<string>()
  const out: DreamEquivalent[] = []
  for (const d of ordered) {
    if (seen.has(d.id)) continue
    seen.add(d.id)
    out.push(equivalentOf(amount, d))
    if (out.length >= max) break
  }
  return out
}

/** The amount against the primary goal ("1.3% of your Birkin"), or the biggest whole item once it covers the goal. */
export function goalEquivalent(amount: Minor, dreams: DreamItem[]): DreamEquivalent | undefined {
  if (amount <= 0) return undefined
  const goal = primaryGoal(active(dreams))
  if (goal && goal.price > amount) return equivalentOf(amount, goal)
  return dreamEquivalents(amount, dreams, 1)[0]
}

/** Days by which spending `amount` delays a goal at its current monthly saving rate (0 if no rate). */
export function goalDelayDays(amount: Minor, progress: GoalProgress, fallbackMonthlyRate: Minor): number {
  const rate = progress.monthlyRate > 0 ? progress.monthlyRate : fallbackMonthlyRate
  if (rate <= 0 || amount <= 0) return 0
  return Math.round((amount / rate) * DAYS_PER_MONTH)
}

/** Fallback saving rate when a goal has no history yet: 10% of income. */
export function fallbackMonthlyRate(profile: Profile): Minor {
  return Math.round(profile.monthlyIncome * 0.1)
}

/** amount ÷ (monthlyIncome ÷ workHoursPerMonth), one decimal. */
export function hoursOfWork(amount: Minor, profile: Profile): number {
  const hours = profile.workHoursPerMonth > 0 ? profile.workHoursPerMonth : DEFAULT_WORK_HOURS
  if (profile.monthlyIncome <= 0 || amount <= 0) return 0
  return round1(amount / (profile.monthlyIncome / hours))
}
