import { monthLabel, monthsBack, ym } from '../dates'
import type {
  BunMood,
  DreamEquivalent,
  DreamItem,
  FinanceContext,
  GoalProgress,
  Minor,
  MirrorState,
  MirrorStatus,
  MonthSummary,
  Tone,
  YearMonth,
} from '../types'
import { overspendAction, stashAction } from './actions'
import { byTone, delayPhrase, type Fmt, moneyFmt, pctText, plural, withArticle } from './copy'
import { dreamEquivalents, equivalentOf, fallbackMonthlyRate, goalDelayDays, goalProgress, hoursOfWork, primaryGoal } from './dreams'
import { summarizeMonth } from './summary'

/** Early-month projections are mostly noise (research note §5): no pace verdicts before this day. */
const PACE_FROM_DAY = 5
const PACE_OVER = 1.05
const PACE_UNDER = 0.95

export function mirrorStatus(s: MonthSummary): MirrorStatus {
  if (s.spent <= 0) return 'no_data'
  if (s.spent > s.target) return 'over'
  if (!s.isCurrent) return s.spent < s.target ? 'under' : 'on_track'
  if (s.dayOfMonth < PACE_FROM_DAY) return 'on_track'
  if (s.projected > s.target * PACE_OVER) return 'pace_over'
  if (s.projected < s.target * PACE_UNDER) return 'under'
  return 'on_track'
}

function deltaFor(status: MirrorStatus, s: MonthSummary): Minor {
  if (status === 'over') return s.spent - s.target
  if (status === 'pace_over') return s.projected - s.target
  if (status === 'no_data') return 0
  return s.target - s.projected
}

function openItems(dreams: DreamItem[]): DreamItem[] {
  return dreams.filter((d) => !d.achievedAt && d.price > 0)
}

/** Most expensive dream item the amount fully covers; otherwise the primary goal as a fraction. */
export function pickMirrorItem(amount: Minor, dreams: DreamItem[]): { item?: DreamItem; quantity?: number; fraction?: number } {
  const items = openItems(dreams)
  const covered = items.filter((d) => d.price <= amount).sort((a, b) => b.price - a.price)[0]
  if (covered) return { item: covered, quantity: Math.floor(amount / covered.price) }
  const goal = primaryGoal(items)
  if (!goal || amount <= 0) return { item: goal }
  return { item: goal, fraction: Math.round((amount / goal.price) * 10000) / 10000 }
}

function biggestTreatCovered(amount: Minor, dreams: DreamItem[]): DreamItem | undefined {
  return openItems(dreams)
    .filter((d) => d.kind === 'treat' && d.price <= amount)
    .sort((a, b) => b.price - a.price)[0]
}

function moodFor(status: MirrorStatus, tone: Tone): BunMood {
  if (status === 'over') return tone === 'gentle' ? 'worried' : 'burnt'
  if (status === 'pace_over') return 'worried'
  if (status === 'under') return 'happy'
  if (status === 'no_data') return 'sleepy'
  return 'calm'
}

// ───────────────────────────── copy ─────────────────────────────

interface Copy {
  headline: string
  subline: string
}

interface CopyInput {
  tone: Tone
  f: Fmt
  s: MonthSummary
  delta: Minor
  item?: DreamItem
  quantity?: number
  fraction?: number
  goal?: GoalProgress
  delayDays: number
}

function itemPhrase(c: CopyInput): string {
  if (!c.item) return ''
  if (c.quantity && c.quantity >= 2) return `${c.quantity}× ${c.item.name}`
  if (c.quantity) return withArticle(c.item.name)
  return `${pctText(c.fraction ?? 0)} of your ${c.item.name}`
}

function equivalentLabel(c: CopyInput): string {
  return c.item ? equivalentOf(c.delta, c.item).label : ''
}

function daysToGo(s: MonthSummary): number {
  return Math.max(0, s.daysInMonth - s.dayOfMonth)
}

function delayedNote(c: CopyInput): string {
  return c.goal && c.delayDays > 0 ? ` ${c.goal.name} delayed ${plural(c.delayDays, 'day')}.` : ''
}

function monthName(s: MonthSummary): string {
  return monthLabel(s.month).split(' ')[0]
}

function overCopy(c: CopyInput): Copy {
  const { f, s, delta } = c
  const base = `${s.isCurrent ? "You're" : 'You went'} ${f(delta)} over your ${f(s.target)} target`
  const hasDelay = !!c.goal && c.delayDays > 0
  const gentleTail = s.isCurrent ? ` Easing off for the last ${plural(daysToGo(s), 'day')} still helps.` : ' A new month is a fresh start.'
  const extra = `${s.isCurrent ? 'This month' : monthName(s)}'s extra ${f(delta)}`
  return {
    headline: byTone(c.tone, {
      cheeky: !c.item ? `${f(delta)} past your target.` : c.quantity ? `You could've gotten ${itemPhrase(c)}.` : `You could've had ${itemPhrase(c)}.`,
      gentle: c.item ? `${extra} = ${itemPhrase(c)}.` : `${extra} went past your target.`,
      numbers: `${f(delta)} over target.`,
    }),
    subline: byTone(c.tone, {
      cheeky: `${base}${hasDelay ? ` — and your ${c.goal!.name} just moved ${delayPhrase(c.delayDays)} further away.` : '.'}`,
      gentle: `${base}${hasDelay ? `, which nudges your ${c.goal!.name} back ${delayPhrase(c.delayDays)}.` : '.'}${gentleTail}`,
      numbers: `Spent ${f(s.spent)} of ${f(s.target)}.${c.item ? ` Equals ${equivalentLabel(c)}.` : ''}${delayedNote(c)}`,
    }),
  }
}

function paceOverCopy(c: CopyInput): Copy {
  const { f, s, delta } = c
  const left = daysToGo(s)
  const keep = s.safeToSpendToday > 0 ? `Keeping to ${f(s.safeToSpendToday)} a day for the last ${plural(left, 'day')}` : `Easing off for the last ${plural(left, 'day')}`
  const goalTail = c.goal ? ` keeps your ${c.goal.name} on schedule.` : ' gets you back on target.'
  return {
    headline: byTone(c.tone, {
      cheeky: c.item ? `Careful — at this pace you'll trade away ${itemPhrase(c)}.` : `Careful — this pace overshoots by ${f(delta)}.`,
      gentle: c.item ? `Heads up — this pace would cost ${itemPhrase(c)}.` : `Heads up — this pace runs ${f(delta)} over.`,
      numbers: `Projected ${f(delta)} over target.`,
    }),
    subline: byTone(c.tone, {
      cheeky: `You're heading for ${f(s.projected)} against a ${f(s.target)} target — ${f(delta)} over, with ${plural(left, 'day')} to turn it around.`,
      gentle: `You're on track for about ${f(s.projected)}, ${f(delta)} over your ${f(s.target)} target. ${keep}${goalTail}`,
      numbers: `Projected ${f(s.projected)} vs ${f(s.target)} target; ${plural(left, 'day')} left; safe to spend ${f(s.safeToSpendToday)}/day.${delayedNote(c)}`,
    }),
  }
}

function underCopy(c: CopyInput, dreams: DreamItem[]): Copy {
  const { f, s, delta, goal } = c
  const treat = biggestTreatCovered(delta, dreams)
  const otherGoal = c.item && c.quantity && c.item.kind === 'goal' && c.item.id !== goal?.itemId ? c.item : undefined
  const choice = treat ? `it covers ${withArticle(treat.name)}, guilt-free` : otherGoal ? `it fully funds ${withArticle(otherGoal.name)}` : ''
  const pace = s.isCurrent ? `You're on pace to finish ${f(delta)} under your ${f(s.target)} target.` : `You finished ${f(delta)} under your ${f(s.target)} target.`
  if (!goal) {
    const headline = treat ? `You're ${f(delta)} under target — that's ${withArticle(treat.name)}, guilt-free!` : `You're ${f(delta)} under target.`
    return { headline: c.tone === 'numbers' ? `${f(delta)} under target.` : headline, subline: `${pace} Spend it or save it — your call.` }
  }
  const now = `${Math.floor(goal.pct)}%`
  const after = `${Math.floor(Math.min(100, ((goal.saved + delta) / goal.price) * 100))}%`
  return {
    headline: byTone(c.tone, {
      gentle: `${f(delta)} closer to your ${goal.name} (${now} there).`,
      cheeky: `${f(delta)} under target — your ${goal.name} is blushing.`,
      numbers: `${f(delta)} under target.`,
    }),
    subline: byTone(c.tone, {
      gentle: `${pace} Stash it and your ${goal.name} is ${after} there${choice ? ` — or, if you'd like, ${choice}` : ''}. Your call.`,
      cheeky: `${pace} Stash it and you're ${after} of the way there${choice ? `, or ${choice}` : ''} — your call, legend.`,
      numbers: `${s.isCurrent ? `Projected ${f(s.projected)}` : `Spent ${f(s.spent)}`} vs ${f(s.target)} target. ${goal.name}: ${now} saved, ${after} if stashed.${treat ? ` Alternative: ${treat.name} (${f(treat.price)}).` : ''}`,
    }),
  }
}

function onTrackCopy(c: CopyInput): Copy {
  const { f, s } = c
  const left = daysToGo(s)
  const current = `${f(s.spent)} spent of your ${f(s.target)} target, ${plural(left, 'day')} to go. Safe to spend today: ${f(s.safeToSpendToday)}.`
  const past = `You landed at ${f(s.spent)} — right on your ${f(s.target)} target.`
  return {
    headline: byTone(c.tone, { gentle: 'Right on track.', cheeky: 'Steady as a steamed bun.', numbers: `On track: ${f(s.spent)} of ${f(s.target)}.` }),
    subline: byTone(c.tone, {
      gentle: s.isCurrent ? current : past,
      cheeky: s.isCurrent ? current : past,
      numbers: s.isCurrent ? `Projected ${f(s.projected)}; ${plural(left, 'day')} left; safe to spend ${f(s.safeToSpendToday)}/day.` : `Final: ${f(s.spent)} vs ${f(s.target)} target.`,
    }),
  }
}

function noDataCopy(c: CopyInput): Copy {
  const label = monthLabel(c.s.month)
  return {
    headline: byTone(c.tone, { gentle: 'Nothing to mirror yet.', cheeky: 'Bun is napping — no spending yet.', numbers: `No spending recorded for ${label}.` }),
    subline: `Once spending shows up for ${label}, your dreams will show up here.`,
  }
}

// ───────────────────────────── mirror ─────────────────────────────

/**
 * The Dream Mirror — FundBun's signature landing hero.
 * status:
 *   'over'      spent > target                                   → "You could've gotten a {item}."
 *   'pace_over' current month, spent <= target but projected > target × 1.05
 *                                                                → "Careful — at this pace you'll trade away {item}."
 *   'under'     past month under target, or current month projected < target × 0.95
 *                                                                → "You're ¥X under — that's {treat}, guilt-free!" or
 *                                                                  "¥X closer to your {goal} (62% there)."
 *   'on_track'  otherwise; 'no_data' when no spending.
 * Item choice: the most expensive dream item fully covered by |delta| (quantity >= 1); if none, the primary
 * goal with `fraction`. Fill goalDelayDays, hoursOfWork, goal progress, mood and a CTA:
 *   over/pace_over → create_tripwire or set_category_budget on the biggest 'want' category;
 *   under → transfer_to_goal of (part of) the surplus.
 * Copy varies by profile.tone (cheeky | gentle | numbers); numbers in copy are formatted with money.fmt.
 *
 * Pace verdicts wait until day 5 (early projections are noise). Under-target copy leads with goal progress
 * and offers the treat as the user's own choice; the CTA is always "stash", never a purchase.
 */
export function computeMirror(ctx: FinanceContext, month?: YearMonth): MirrorState {
  const s = summarizeMonth(ctx, month)
  const tone = ctx.profile.tone
  const f = moneyFmt(ctx.profile.currency)
  const status = mirrorStatus(s)
  const delta = deltaFor(status, s)
  const main = primaryGoal(openItems(ctx.dreams))
  // a treat-only wishlist has nothing to "get closer to" or delay
  const goalItem = main?.kind === 'goal' ? main : undefined
  const goal = goalItem ? goalProgress(goalItem, ctx) : undefined
  const pick = status === 'over' || status === 'pace_over' || status === 'under' ? pickMirrorItem(delta, ctx.dreams) : { item: main }
  const losing = status === 'over' || status === 'pace_over'
  const delayDays = losing && goal ? goalDelayDays(delta, goal, fallbackMonthlyRate(ctx.profile)) : 0

  const input: CopyInput = { tone, f, s, delta, ...pick, goal, delayDays }
  const copy =
    status === 'over' ? overCopy(input)
    : status === 'pace_over' ? paceOverCopy(input)
    : status === 'under' ? underCopy(input, ctx.dreams)
    : status === 'on_track' ? onTrackCopy(input)
    : noDataCopy(input)
  const cta = losing ? overspendAction(ctx, s) : status === 'under' ? stashAction(ctx, s, delta) : undefined

  return {
    status,
    month: s.month,
    spent: s.spent,
    target: s.target,
    projected: s.projected,
    delta,
    headline: copy.headline,
    subline: copy.subline,
    ...(pick.item ? { item: pick.item } : {}),
    ...(pick.quantity ? { quantity: pick.quantity } : {}),
    ...(pick.fraction !== undefined ? { fraction: pick.fraction } : {}),
    ...(goal ? { goal } : {}),
    ...(losing && goal ? { goalDelayDays: delayDays } : {}),
    ...(status !== 'on_track' && status !== 'no_data' ? { hoursOfWork: hoursOfWork(Math.abs(delta), ctx.profile) } : {}),
    tone,
    mood: moodFor(status, tone),
    ...(cta ? { cta } : {}),
  }
}

export interface MirrorHistoryPoint {
  month: YearMonth
  status: MirrorStatus
  delta: Minor
  item?: DreamEquivalent
}

/** The mirror for each of the last `months` months (oldest first, including the current one). */
export function mirrorHistory(ctx: FinanceContext, months: number): MirrorHistoryPoint[] {
  return monthsBack(ym(ctx.bank.today), Math.max(0, Math.floor(months))).map((month) => {
    const m = computeMirror(ctx, month)
    const showItem = m.item && m.delta > 0 && (m.status === 'over' || m.status === 'pace_over' || m.status === 'under')
    return { month, status: m.status, delta: m.delta, ...(showItem ? { item: equivalentOf(m.delta, m.item!) } : {}) }
  })
}

/**
 * "Could've collection": what the overspend of the last `months` months adds up to in dream items.
 * Only realised amounts count — finished months, plus the current month once it is actually over target
 * (a projected surplus or overshoot hasn't happened yet).
 */
export function couldveCollection(ctx: FinanceContext, months: number): { totalOver: Minor; totalUnder: Minor; equivalents: DreamEquivalent[] } {
  const current = ym(ctx.bank.today)
  let totalOver = 0
  let totalUnder = 0
  for (const p of mirrorHistory(ctx, months)) {
    if (p.status === 'over') totalOver += p.delta
    if (p.status === 'under' && p.month !== current) totalUnder += p.delta
  }
  return { totalOver, totalUnder, equivalents: dreamEquivalents(totalOver, ctx.dreams, 3) }
}
