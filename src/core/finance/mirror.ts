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
  SuggestedAction,
  Tone,
  YearMonth,
} from '../types'
import { majorUnits, overspendAction, roundDownTo10, stashAction, stashAmountOf } from './actions'
import { byTone, copyFmt, delayPhrase, type Fmt, pctText, plural, withArticle } from './copy'
import { dreamEquivalents, equivalentOf, fallbackMonthlyRate, goalDelayDays, goalProgress, hoursOfWork, potFor, primaryGoal } from './dreams'
import { isSpending } from './ledger'
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

/**
 * How an under-target surplus is split: what the stash CTA moves into the goal, what is left, and the biggest
 * treat that the rest fully covers (a treat is only ever offered out of money the stash doesn't use).
 */
export interface SurplusSplit {
  surplus: Minor
  stash: Minor
  rest: Minor
  treat?: DreamItem
}

export function splitSurplus(surplus: Minor, stash: Minor, dreams: DreamItem[]): SurplusSplit {
  const moved = Math.max(0, Math.min(stash, surplus))
  const rest = Math.max(0, surplus - moved)
  const treat = rest > 0 ? biggestTreatCovered(rest, dreams) : undefined
  return { surplus, stash: moved, rest, ...(treat ? { treat } : {}) }
}

function goalPctAfter(goal: GoalProgress, extra: Minor): string {
  return goal.price > 0 ? `${Math.floor(Math.min(100, ((goal.saved + extra) / goal.price) * 100))}%` : '100%'
}

function underCopy(c: CopyInput, split: SurplusSplit): Copy {
  const { f, s, delta, goal } = c
  const { treat, stash, rest } = split
  const pace = s.isCurrent ? `You're on pace to finish ${f(delta)} under your ${f(s.target)} target.` : `You finished ${f(delta)} under your ${f(s.target)} target.`
  if (!goal) {
    const headline = treat ? `You're ${f(delta)} under target — that's ${withArticle(treat.name)}, guilt-free!` : `You're ${f(delta)} under target.`
    return { headline: c.tone === 'numbers' ? `${f(delta)} under target.` : headline, subline: `${pace} Spend it or save it — your call.` }
  }
  const now = `${Math.floor(goal.pct)}%`
  // "(0% there)" reads like a scolding — an empty pot gets a fresh-start line instead
  const started = goal.saved > 0
  const headline = byTone(c.tone, {
    gentle: started ? `${f(delta)} closer to your ${goal.name} (${now} there).` : `${f(delta)} under target — a first stash for your ${goal.name}?`,
    cheeky: `${f(delta)} under target — your ${goal.name} is blushing.`,
    numbers: `${f(delta)} under target.`,
  })
  const proj = s.isCurrent ? `Projected ${f(s.projected)}` : `Spent ${f(s.spent)}`
  const saved = started ? `${now} saved` : 'nothing saved yet'
  if (stash <= 0) {
    // nothing to stash (the goal is funded, or the surplus is tiny): the surplus is the user's to keep
    const choice = treat ? `It covers ${withArticle(treat.name)}, guilt-free — or keep it as breathing room.` : 'Keep it as breathing room.'
    return {
      headline,
      subline: byTone(c.tone, {
        gentle: `${pace} ${choice} Your call.`,
        cheeky: `${pace} ${choice} Your call, legend.`,
        numbers: `${proj} vs ${f(s.target)} target. ${goal.name}: ${saved}.${treat ? ` Covers ${treat.name} (${f(treat.price)}).` : ''}`,
      }),
    }
  }
  const after = goalPctAfter(goal, stash)
  const otherTreat = treat ? `the other ${f(rest)} covers ${withArticle(treat.name)}, guilt-free` : ''
  return {
    headline,
    subline: byTone(c.tone, {
      gentle: `${pace} Stash ${f(stash)} and your ${goal.name} is ${after} there — ${treat ? `${otherTreat}.` : 'or keep it as breathing room.'} Your call.`,
      cheeky: `${pace} Stash ${f(stash)} and you're ${after} of the way there${treat ? ` — ${otherTreat}` : ', or keep it as breathing room'} — your call, legend.`,
      numbers: `${proj} vs ${f(s.target)} target. ${goal.name}: ${saved}, ${after} with ${f(stash)} stashed.${treat ? ` The other ${f(rest)} covers ${treat.name} (${f(treat.price)}).` : ''}`,
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

/** First month with FundBun: too little history for a verdict, so welcome instead of mirroring. */
function welcomeCopy(c: CopyInput, name: string): Copy {
  const { f, s, goal } = c
  const left = daysToGo(s)
  const hi = name ? `Welcome, ${name}!` : 'Welcome!'
  const grow = goal ? ` and your ${goal.name} will start to show up here` : ''
  return {
    headline: byTone(c.tone, {
      gentle: `${hi} Your first month with Bun has begun.`,
      cheeky: `${hi} Bun is still getting to know your wallet.`,
      numbers: `First month: ${f(s.spent)} of ${f(s.target)} so far.`,
    }),
    subline: byTone(c.tone, {
      gentle: `${f(s.spent)} spent of your ${f(s.target)} target, ${plural(left, 'day')} to go. Give it a few more days of spending${grow} — no verdicts yet.`,
      cheeky: `${f(s.spent)} of ${f(s.target)} so far, ${plural(left, 'day')} to go. A few more days of data${grow}.`,
      numbers: `${plural(left, 'day')} left; safe to spend ${f(s.safeToSpendToday)}/day. Verdicts start once there is a little more history.`,
    }),
  }
}

function noDataCopy(c: CopyInput, welcome?: string): Copy {
  const label = monthLabel(c.s.month)
  if (welcome !== undefined) {
    const hi = welcome ? `Welcome, ${welcome}!` : 'Welcome!'
    return {
      headline: byTone(c.tone, { gentle: `${hi} Your mirror is ready.`, cheeky: `${hi} Bun is ready when you are.`, numbers: `No spending recorded for ${label} yet.` }),
      subline: `Your ${f0(c)} target is set. As spending shows up, Bun will mirror your month in dream items${c.goal ? ` — starting with your ${c.goal.name}` : ''}.`,
    }
  }
  return {
    headline: byTone(c.tone, { gentle: 'Nothing to mirror yet.', cheeky: 'Bun is napping — no spending yet.', numbers: `No spending recorded for ${label}.` }),
    subline: `Once spending shows up for ${label}, your dreams will show up here.`,
  }
}

function f0(c: CopyInput): string {
  return c.f(c.s.target)
}

// ───────────────────────────── mirror ─────────────────────────────

/** No spending before this month: the projection has no baseline yet, so under/on-track verdicts are noise. */
export function isFirstMonth(ctx: FinanceContext, s: MonthSummary): boolean {
  const start = `${s.month}-01`
  return s.isCurrent && !ctx.bank.transactions.some((t) => t.date < start && isSpending(t))
}

/** "Earmark ¥X for <treat>": only when the treat already has its own pot to move money into (never a purchase). */
function earmarkAction(ctx: FinanceContext, treat: DreamItem, available: Minor): SuggestedAction | undefined {
  const pot = potFor(treat, ctx.bank.accounts)
  if (!pot) return undefined
  const currency = ctx.profile.currency
  const raw = Math.min(available, Math.max(0, treat.price - Math.max(0, pot.balance)))
  const amount = raw >= majorUnits(10, currency) ? roundDownTo10(raw, currency) : Math.floor(raw)
  if (amount < majorUnits(1, currency)) return undefined
  return { tool: 'transfer_to_goal', args: { goalId: treat.id, amount }, label: `Earmark ${copyFmt(currency)(amount)} for ${treat.name}` }
}

/** Over or heading over: the hero's main button starts a plan with Bun (the "get back on track" task plan). */
export const MIRROR_PLAN_PROMPT = { label: 'Make a plan with Bun', prompt: 'Help me get back on track this month' } as const

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
 * goal with `fraction`. Under target with a goal the headline is goal-led, so `item` is the goal (with
 * `fraction` = surplus ÷ goal price). Fill goalDelayDays, hoursOfWork, goal progress, mood and the CTAs:
 *   over/pace_over → `ctaPrompt` "Make a plan with Bun" (primary: starts the get-back-on-track plan in chat)
 *                    and `cta`, a rule that still bites this month (finance/actions.overspendAction);
 *   under → `cta` transfer_to_goal of (part of) the surplus.
 * Copy varies by profile.tone (cheeky | gentle | numbers); amounts in copy use money.fmtCopy (whole yuan from ¥100).
 *
 * Pace verdicts wait until day 5 (early projections are noise). Under-target copy leads with goal progress
 * and describes exactly what the stash CTA moves ("Stash ¥330 and your MacBook Air is 50% there — …"); the
 * rest is offered as `treat` only when it fully covers one ("the other ¥338 covers a Concert ticket"),
 * otherwise as breathing room. The CTA is always "stash", never a purchase. `secondaryCta`
 * ("Earmark ¥338 for <treat>", a transfer_to_goal) is offered only when that treat already has its own pot.
 * A first month with no earlier spending gets a welcome (status 'on_track' instead of a projection-only
 * 'under', or a welcoming 'no_data'), and an untouched goal is never described as "0% there".
 */
export function computeMirror(ctx: FinanceContext, month?: YearMonth): MirrorState {
  const s = summarizeMonth(ctx, month)
  const tone = ctx.profile.tone
  const f = copyFmt(ctx.profile.currency)
  const raw = mirrorStatus(s)
  const firstMonth = isFirstMonth(ctx, s)
  // a brand-new user's "under" (or a first few days) is a projection with no history behind it — welcome instead
  const welcome = firstMonth && (raw === 'under' || (raw === 'on_track' && s.dayOfMonth < PACE_FROM_DAY))
  const status: MirrorStatus = welcome ? 'on_track' : raw
  const delta = deltaFor(status, s)
  const main = primaryGoal(openItems(ctx.dreams))
  // a treat-only wishlist has nothing to "get closer to" or delay
  const goalItem = main?.kind === 'goal' ? main : undefined
  const goal = goalItem ? goalProgress(goalItem, ctx) : undefined
  const losing = status === 'over' || status === 'pace_over'
  const under = status === 'under'
  // under target with a goal, the headline (and so the hero) is about the goal, not the covered item
  const goalLed = under && goalItem !== undefined && delta > 0
  const pick = goalLed
    ? { item: goalItem, fraction: Math.round((delta / goalItem.price) * 10_000) / 10_000 }
    : losing || under ? pickMirrorItem(delta, ctx.dreams) : { item: main }
  const delayDays = losing && goal ? goalDelayDays(delta, goal, fallbackMonthlyRate(ctx.profile)) : 0
  const cta = losing ? overspendAction(ctx, s) : under ? stashAction(ctx, s, delta) : undefined
  const split = under && delta > 0 ? splitSurplus(delta, stashAmountOf(cta), ctx.dreams) : undefined

  const input: CopyInput = { tone, f, s, delta, ...pick, goal, delayDays }
  const name = ctx.profile.name?.trim() ?? ''
  const copy =
    status === 'over' ? overCopy(input)
    : status === 'pace_over' ? paceOverCopy(input)
    : status === 'under' ? underCopy(input, split ?? splitSurplus(0, 0, []))
    : welcome ? welcomeCopy(input, name)
    : status === 'on_track' ? onTrackCopy(input)
    : noDataCopy(input, firstMonth ? name : undefined)
  const treat = split?.treat ? equivalentOf(split.rest, split.treat) : undefined
  const secondaryCta = split?.treat ? earmarkAction(ctx, split.treat, split.rest) : undefined

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
    ...('quantity' in pick && pick.quantity ? { quantity: pick.quantity } : {}),
    ...(pick.fraction !== undefined ? { fraction: pick.fraction } : {}),
    ...(goal ? { goal } : {}),
    ...(losing && goal ? { goalDelayDays: delayDays } : {}),
    ...(status !== 'on_track' && status !== 'no_data' ? { hoursOfWork: hoursOfWork(Math.abs(delta), ctx.profile) } : {}),
    tone,
    mood: moodFor(status, tone),
    ...(cta ? { cta } : {}),
    ...(losing ? { ctaPrompt: { ...MIRROR_PLAN_PROMPT } } : {}),
    ...(treat ? { treat } : {}),
    ...(secondaryCta ? { secondaryCta } : {}),
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
    // what the month's difference adds up to — for an under month that is the item it covers, not the goal it's led by
    const item = m.status === 'under' ? pickMirrorItem(m.delta, ctx.dreams).item : m.item
    const showItem = item && m.delta > 0 && (m.status === 'over' || m.status === 'pace_over' || m.status === 'under')
    return { month, status: m.status, delta: m.delta, ...(showItem ? { item: equivalentOf(m.delta, item) } : {}) }
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
