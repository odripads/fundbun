/**
 * Pure view logic for the Home screen (the Dream Mirror). No React, no DOM — unit-tested in model.test.ts.
 * Every amount is integer minor units; formatting goes through money.fmt.
 */
import { toolTier } from '../../../core/agent/specs'
import { CATEGORIES } from '../../../core/categories'
import { addDays, diffDays, monthLabel, parseDate } from '../../../core/dates'
import { categorize } from '../../../core/finance/categorize'
import { delayPhrase, delayShort, durationText, pctText, plural } from '../../../core/finance/copy'
import { fmt, fmtCopy } from '../../../core/money'
import type {
  AffordabilityResult,
  Bill,
  BunMood,
  CategoryId,
  Currency,
  DreamEquivalent,
  DreamItem,
  GoalProgress,
  Insight,
  ISODate,
  Minor,
  MirrorState,
  MirrorStatus,
  MonthSummary,
  SuggestedAction,
  Tone,
  TripwireEvent,
  YearMonth,
  SpendingCandidate,
} from '../../../core/types'

export type StatusTone = 'over' | 'warn' | 'under' | 'accent' | 'neutral'

export interface StatusMeta {
  label: string
  tone: StatusTone
}

/** Text + tone per mirror status — the badge always carries words so colour is never the only cue. */
export const STATUS_META: Record<MirrorStatus, StatusMeta> = {
  over: { label: 'Over budget', tone: 'over' },
  pace_over: { label: 'Pace runs over', tone: 'warn' },
  on_track: { label: 'On track', tone: 'accent' },
  // the good state is named as good: "under" reads like falling short
  under: { label: 'On target', tone: 'under' },
  no_data: { label: 'No spending yet', tone: 'neutral' },
}

/** Whole-unit money for glanceable UI ("¥2,580", not "¥2,580.24"). */
export function fmtWhole(m: Minor, currency: Currency): string {
  return fmt(m, currency, { decimals: false })
}

/** '2026-10' → 'October' */
export function monthName(month: YearMonth, style: 'long' | 'short' = 'long'): string {
  return monthLabel(month, style).split(' ')[0]
}

export function mirrorEyebrow(m: Pick<MirrorState, 'month'>): string {
  return `Dream Mirror · ${monthName(m.month)}`
}

/**
 * Split a headline around a dream name so the view can set the name apart:
 * ("You could've gotten a ", "Weekend in Chengdu", "."). Null when the name isn't in the headline.
 */
export function splitHeadline(headline: string, itemName?: string): [string, string, string] | null {
  if (!itemName) return null
  const i = headline.indexOf(itemName)
  if (i < 0) return null
  return [headline.slice(0, i), itemName, headline.slice(i + itemName.length)]
}

/**
 * An angry Bun shouts: every sentence ends in "!!!". Only sentence ends change (a full stop or question mark
 * before a space or the end), so amounts like ¥2,580.24 are left alone.
 */
export function shout(text: string): string {
  return text.replace(/[.?!]+(?=\s|$)/g, '!!!')
}

/** Is Bun angry enough to break the mirror and raise its voice? */
export function isAngry(mood: BunMood): boolean {
  return mood === 'angry' || mood === 'furious'
}

/** 35 → '5 wks', 9 → '9 days', 120 → '4 mo' — for tight tiles. */
export function shortDelay(days: number): string {
  return delayShort(days)
}

/** 24.3 → '24 h', 4.5 → '4.5 h' */
export function hoursText(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 h'
  return hours >= 10 ? `${Math.round(hours)} h` : `${Number(hours.toFixed(1))} h`
}

// ───────────────────────────── hero ─────────────────────────────

/** What the mirror frame shows: the item the month buys, or the goal the surplus moves closer. */
export interface HeroDream {
  item?: DreamItem
  /** 'goal' → the frame shows goal progress (a ring) instead of a "could've" item */
  role: 'item' | 'goal' | 'none'
}

/**
 * Under budget with a goal, the headline is about the goal ("¥668 closer to your MacBook Air"), so the frame
 * shows the goal even when the core's mirror item is the treat the surplus could cover. Otherwise: the mirror item.
 */
export function heroDream(m: MirrorState, dreams: DreamItem[]): HeroDream {
  const goalItem = m.goal ? dreams.find((d) => d.id === m.goal!.itemId) : undefined
  if (m.status === 'under' && goalItem) {
    const itemInHeadline = m.item ? m.headline.includes(m.item.name) : false
    if (!itemInHeadline || m.item?.id === goalItem.id) return { item: goalItem, role: 'goal' }
  }
  if (m.item) return { item: m.item, role: m.status === 'on_track' && m.item.id === goalItem?.id ? 'goal' : 'item' }
  return { role: 'none' }
}

/** Saved % of a goal after a stash of `extra` (capped at 100). */
export function pctAfter(goal: GoalProgress, extra: Minor): number {
  if (goal.price <= 0) return 0
  return Math.min(100, ((goal.saved + Math.max(0, extra)) / goal.price) * 100)
}

/** The stash amount a transfer_to_goal CTA carries (0 when the CTA is something else). */
export function stashAmount(action?: SuggestedAction): Minor {
  if (!action || action.tool !== 'transfer_to_goal') return 0
  const a = Number(action.args.amount)
  return Number.isFinite(a) && a > 0 ? a : 0
}

export interface HeroStat {
  id: string
  /** short display value, set in Fraunces: '1×', '24 h', '+5 wks' */
  value: string
  label: string
  /** full sentence for screen readers */
  description: string
  tone: StatusTone
}

/**
 * A dream name short enough for a tile or the mirror's name plate (the full name stays in headlines and in the
 * screen-reader text): cut at a word boundary, "Noise-cancelling headphones for long flights" → "Noise-cancelling…".
 */
export function shortName(name: string, max = 24): string {
  const n = name.trim()
  if (n.length <= max) return n
  const cut = n.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space >= 8 ? cut.slice(0, space) : cut).replace(/[\s,;:·–—-]+$/, '')}…`
}

/** The three evidence tiles under the mirror headline. */
export function mirrorStats(m: MirrorState, currency: Currency): HeroStat[] {
  const stats: HeroStat[] = []
  const losing = m.status === 'over' || m.status === 'pace_over'
  const tone: StatusTone = m.status === 'over' ? 'over' : 'warn'
  if (losing) {
    if (m.item && m.quantity && m.quantity >= 2) {
      stats.push({ id: 'item', value: `${m.quantity}×`, label: shortName(m.item.name), description: `The difference buys ${m.quantity} × ${m.item.name}.`, tone })
    } else if (m.item && m.fraction !== undefined) {
      stats.push({ id: 'item', value: pctText(m.fraction), label: `of ${shortName(m.item.name)}`, description: `The difference is ${pctText(m.fraction)} of your ${m.item.name}.`, tone })
    } else {
      // one whole item is already the headline — the tile carries the amount instead
      stats.push({ id: 'delta', value: fmtWhole(m.delta, currency), label: m.status === 'over' ? 'over budget' : 'projected over', description: `${fmtWhole(m.delta, currency)} over budget.`, tone })
    }
    if (m.hoursOfWork) {
      stats.push({ id: 'hours', value: hoursText(m.hoursOfWork), label: 'of your work', description: `About ${m.hoursOfWork} hours of your work.`, tone: 'neutral' })
    }
    if (m.goal && m.goalDelayDays && m.goalDelayDays > 0) {
      stats.push({ id: 'delay', value: `+${shortDelay(m.goalDelayDays)}`, label: `${shortName(m.goal.name)} delay`, description: `${m.goal.name} pushed back ${delayPhrase(m.goalDelayDays)}.`, tone })
    }
  } else if (m.status === 'under') {
    stats.push({ id: 'delta', value: fmtWhole(m.delta, currency), label: 'left over', description: `On pace to have ${fmtWhole(m.delta, currency)} left over.`, tone: 'under' })
    if (m.hoursOfWork) {
      stats.push({ id: 'hours', value: hoursText(m.hoursOfWork), label: 'of work kept', description: `About ${m.hoursOfWork} hours of your work kept.`, tone: 'neutral' })
    }
    if (m.goal) {
      const extra = stashAmount(m.cta)
      const now = Math.floor(m.goal.pct)
      const after = Math.floor(pctAfter(m.goal, extra))
      stats.push(extra > 0 && after > now
        ? { id: 'goal', value: `${now}→${after}%`, label: `${shortName(m.goal.name)} if stashed`, description: `${m.goal.name} goes from ${now}% to ${after}% saved if you stash ${fmtWhole(extra, currency)}.`, tone: 'under' }
        : { id: 'goal', value: `${now}%`, label: `${shortName(m.goal.name)} saved`, description: `${m.goal.name} is ${now}% saved.`, tone: 'under' })
    }
  } else if (m.status === 'on_track' && m.goal) {
    stats.push({ id: 'goal', value: `${Math.floor(m.goal.pct)}%`, label: `${shortName(m.goal.name)} saved`, description: `${m.goal.name} is ${Math.floor(m.goal.pct)}% saved.`, tone: 'accent' })
  }
  return stats
}

/** The guilt-free treat (under budget only): the mirror's own `treat`, else its item when it is a treat. */
export function treatOf(m: MirrorState): DreamEquivalent | undefined {
  if (m.treat) return m.treat
  if (m.status !== 'under' || !m.item || m.item.kind !== 'treat' || !m.quantity) return undefined
  return { itemId: m.item.id, itemName: m.item.name, image: m.item.image, fraction: m.delta / m.item.price, label: m.item.name }
}

/** One button in the hero's action stack. */
export type HeroAction =
  /** start a conversation with Bun: navigate to chat and send `prompt` as the user's message */
  | { kind: 'prompt'; label: string; prompt: string }
  /** a one-tap rule or stash, proposed through the policy engine (useProposeAction) */
  | { kind: 'action'; action: SuggestedAction }
  /** weigh up a treat in the local "Should I buy it?" check (never a purchase) */
  | { kind: 'check'; label: string; amount: Minor; itemId: string }

export interface HeroActions {
  primary?: HeroAction
  secondary?: HeroAction
}

/**
 * The hero's buttons. Over / pace over: "Make a plan with Bun" leads (mirror.ctaPrompt — the get-back-on-track
 * plan in chat) and the one-tap rule (mirror.cta) follows. Under: "Stash ¥X" leads; the treat (an earmark into
 * its own pot when it has one, otherwise a look in "Should I buy it?") is the quieter second choice.
 */
export function heroActions(m: MirrorState, dreams: DreamItem[]): HeroActions {
  const losing = m.status === 'over' || m.status === 'pace_over'
  if (losing) {
    if (m.ctaPrompt) return { primary: { kind: 'prompt', ...m.ctaPrompt }, ...(m.cta ? { secondary: { kind: 'action', action: m.cta } } : {}) }
    return m.cta ? { primary: { kind: 'action', action: m.cta } } : {}
  }
  const primary: HeroAction | undefined = m.cta ? { kind: 'action', action: m.cta } : undefined
  if (m.secondaryCta) return { primary, secondary: { kind: 'action', action: m.secondaryCta } }
  const treat = treatOf(m)
  const hero = heroDream(m, dreams)
  const item = treat && treat.itemId !== hero.item?.id ? dreams.find((d) => d.id === treat.itemId) : undefined
  return { primary, ...(item ? { secondary: { kind: 'check', label: `Or weigh up the ${item.name}`, amount: item.price, itemId: item.id } } : {}) }
}

export type CtaIcon = 'bell' | 'gauge' | 'piggy' | 'spark'

export function ctaIcon(action: SuggestedAction): CtaIcon {
  if (action.tool === 'create_tripwire') return 'bell'
  if (action.tool === 'set_category_budget' || action.tool === 'create_budget_plan') return 'gauge'
  if (action.tool === 'transfer_to_goal') return 'piggy'
  return 'spark'
}

/** One reassuring line under a CTA: what the permission tier means for this tap. */
export function ctaHint(action: SuggestedAction, bank = true): string {
  const tier = toolTier(action.tool)
  if (tier <= 1) return 'A rule, not a payment — switch it off anytime.'
  // no bank connected: a pot is an envelope Bun keeps count of
  if (tier === 2) return bank ? 'Moves your own money. You confirm first.' : 'An envelope: Bun keeps count, you move the money.'
  return 'Bun asks for your tap and PIN first.'
}

// ───────────────────────────── month progress ─────────────────────────────

export interface MonthTrack {
  /** the bar's full scale (a little beyond the biggest value) */
  scale: Minor
  spentPct: number
  /** spent within the target (solid part) */
  withinPct: number
  targetPct: number
  pacePct: number
  projectedPct: number
  /** where an even spend would be by today */
  paceAmount: Minor
  daysLeft: number
  tone: StatusTone
  aheadOfPace: boolean
}

const pctOf = (v: number, scale: number) => (scale > 0 ? Math.max(0, Math.min(100, (v / scale) * 100)) : 0)

export function monthTrack(s: MonthSummary): MonthTrack {
  const paceAmount = Math.round((s.target * s.dayOfMonth) / Math.max(1, s.daysInMonth))
  const scale = Math.max(s.target, s.projected, s.spent, 1) * 1.04
  const tone: StatusTone = s.spent > s.target ? 'over' : s.projected > s.target ? 'warn' : 'under'
  return {
    scale,
    spentPct: pctOf(s.spent, scale),
    withinPct: pctOf(Math.min(s.spent, s.target), scale),
    targetPct: pctOf(s.target, scale),
    pacePct: pctOf(paceAmount, scale),
    projectedPct: pctOf(Math.max(s.projected, s.spent), scale),
    paceAmount,
    daysLeft: Math.max(0, s.daysInMonth - s.dayOfMonth),
    tone,
    aheadOfPace: s.spent > paceAmount,
  }
}

/** A plain sentence describing the month bar (it is drawn as role="img"). */
export function monthTrackSummary(s: MonthSummary, currency: Currency): string {
  const f = (m: Minor) => fmtWhole(m, currency)
  const t = monthTrack(s)
  return `Spent ${f(s.spent)} of a ${f(s.target)} target by day ${s.dayOfMonth} of ${s.daysInMonth}. ` +
    `An even pace would be ${f(t.paceAmount)} by today. Projected month end: ${f(s.projected)}.`
}

/** "¥1,312 above an even pace" / "¥420 below an even pace" */
export function paceLine(s: MonthSummary, currency: Currency): string {
  const t = monthTrack(s)
  const gap = Math.abs(s.spent - t.paceAmount)
  if (gap < s.target * 0.01) return 'Right on an even pace'
  return t.aheadOfPace ? `${fmtWhole(gap, currency)} above an even pace` : `${fmtWhole(gap, currency)} below an even pace`
}

/** Tone-aware line under "Safe to spend today". Never nudges toward spending. */
export function safeToSpendNote(s: MonthSummary, tone: Tone, currency: Currency): string {
  const f = (m: Minor) => fmtWhole(m, currency)
  const daysLeft = Math.max(0, s.daysInMonth - s.dayOfMonth)
  if (s.remaining <= 0) {
    if (tone === 'cheeky') return 'The wallet is on a diet until the 1st.'
    if (tone === 'numbers') return `${f(-s.remaining)} over budget, ${daysLeft} days left.`
    return 'Past this month’s target — every yuan you keep now still counts.'
  }
  if (tone === 'cheeky') return 'Stay within it and the month lands on target.'
  if (tone === 'numbers') return `${f(s.remaining)} left over ${daysLeft} days.`
  return `Staying within it keeps the month on target for the ${daysLeft} days left.`
}

// ───────────────────────────── tripwire events ─────────────────────────────

/** "just now", "5 min ago", "3 h ago", "2 d ago", else "Oct 7". */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const sec = Math.max(0, Math.round((now - t) / 1000))
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Newest first. Events fired together (same timestamp) lead with the specific purchase that tripped them,
 * then later-in-list = newer.
 */
export function newestFirst(events: TripwireEvent[]): TripwireEvent[] {
  return events
    .map((e, i) => ({ e, i, t: Date.parse(e.firedAt) || 0 }))
    .sort((a, b) => b.t - a.t || Number(Boolean(b.e.txnId)) - Number(Boolean(a.e.txnId)) || b.i - a.i)
    .map(({ e }) => e)
}

/** The event a toast should lead with: a specific purchase beats a month-level threshold. */
export function leadEvent(events: TripwireEvent[]): TripwireEvent | undefined {
  return events.find((e) => e.txnId) ?? events[events.length - 1]
}

/** Events not in `known`, in their original order. */
export function freshEvents(known: ReadonlySet<string>, events: TripwireEvent[]): TripwireEvent[] {
  return events.filter((e) => !known.has(e.id))
}

/** Equality for useSnapshot: same event ids in the same order. */
export function sameIds(a: { id: string }[], b: { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id)
}

// ───────────────────────────── bills ─────────────────────────────

export function dueLabel(today: ISODate, due: ISODate): string {
  const n = diffDays(today, due)
  if (n < 0) return n === -1 ? 'Overdue 1 day' : `Overdue ${-n} days`
  if (n === 0) return 'Due today'
  if (n === 1) return 'Due tomorrow'
  return `Due in ${n} days`
}

export function dueTone(today: ISODate, due: ISODate): StatusTone {
  const n = diffDays(today, due)
  if (n < 0) return 'over'
  if (n <= 3) return 'warn'
  return 'neutral'
}

/** 'Oct 25' */
export function shortDate(d: ISODate): string {
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** The next `n` bills the user can still act on (scheduled ones stay visible but aren't payable). */
export function nextBills(bills: Bill[], n = 3): Bill[] {
  return bills.filter((b) => b.status !== 'paid').slice(0, n)
}

export function payAction(bill: Bill, currency: Currency): SuggestedAction {
  return { tool: 'pay_bill', args: { billId: bill.id }, label: `Pay ${bill.name} ${fmt(bill.amountDue, currency)}` }
}

export type BillIcon = 'home' | 'zap' | 'phone' | 'repeat' | 'shield' | 'book' | 'receipt'

export function billIcon(category: CategoryId, name = ''): BillIcon {
  if (category === 'housing') return 'home'
  if (category === 'utilities') return /water/i.test(name) ? 'receipt' : 'zap'
  if (category === 'phone_internet') return 'phone'
  if (category === 'subscriptions') return 'repeat'
  if (category === 'insurance') return 'shield'
  if (category === 'education') return 'book'
  return 'receipt'
}

// ───────────────────────────── insights ─────────────────────────────

/** Month-level verdicts the mirror already tells — skipped in the Home peek so it never repeats the hero. */
const MIRROR_KINDS = new Set<Insight['kind']>(['pace_warning', 'under_budget'])

export function peekInsights(insights: Insight[], n = 2): Insight[] {
  const fresh = insights.filter((i) => !MIRROR_KINDS.has(i.kind))
  return (fresh.length > 0 ? fresh : insights).slice(0, n)
}

// ───────────────────────────── could've collection ─────────────────────────────

export interface HistoryPoint {
  month: YearMonth
  status: MirrorStatus
  delta: Minor
  item?: DreamEquivalent
}

export interface HistoryBar extends HistoryPoint {
  short: string
  direction: 'over' | 'under' | 'even'
  /** 0..1 of the biggest |delta| */
  height: number
  current: boolean
  caption: string
  /** visible amount, e.g. '+¥384' / '−¥55' */
  amountText: string
}

function directionOf(p: HistoryPoint): HistoryBar['direction'] {
  if ((p.status === 'over' || p.status === 'pace_over') && p.delta > 0) return 'over'
  if (p.status === 'under' && p.delta > 0) return 'under'
  return 'even'
}

export function historyBars(points: HistoryPoint[], currentMonth: YearMonth, currency: Currency): HistoryBar[] {
  const max = Math.max(1, ...points.map((p) => (directionOf(p) === 'even' ? 0 : Math.abs(p.delta))))
  return points.map((p) => {
    const direction = directionOf(p)
    const current = p.month === currentMonth
    const name = monthName(p.month)
    const amount = fmtWhole(Math.abs(p.delta), currency)
    const so = current ? (p.status === 'over' ? ' so far' : ' on pace') : ''
    let caption: string
    if (direction === 'over') caption = `${name}: ${amount} over${so}${p.item ? ` — ${p.item.label} you could’ve had` : ''}.`
    else if (direction === 'under') caption = `${name}: ${amount} under${so}${p.item ? ` — ${p.item.label} you didn’t spend` : ''}.`
    else if (p.status === 'no_data') caption = `${name}: no spending recorded.`
    else caption = `${name}: right on target.`
    return {
      ...p,
      short: monthName(p.month, 'short'),
      direction,
      height: direction === 'even' ? 0 : Math.abs(p.delta) / max,
      current,
      caption,
      amountText: direction === 'over' ? `+${amount}` : direction === 'under' ? `−${amount}` : '±0',
    }
  })
}

export interface DivergingScale {
  /** px reserved above / below the axis */
  up: number
  down: number
  /** px per minor unit — the same scale both ways so bars stay comparable */
  perUnit: number
}

/**
 * Split a fixed chart height between over (up) and under (down) by their biggest values, keeping one shared
 * scale; each side keeps at least `min` px so the axis never sits on an edge.
 */
export function divergingScale(bars: Pick<HistoryBar, 'direction' | 'delta'>[], total = 88, min = 14): DivergingScale {
  const maxOf = (dir: HistoryBar['direction']) => Math.max(0, ...bars.filter((b) => b.direction === dir).map((b) => Math.abs(b.delta)))
  const over = maxOf('over')
  const under = maxOf('under')
  if (over + under === 0) return { up: total / 2, down: total / 2, perUnit: 0 }
  const perUnit = total / (over + under)
  if (over * perUnit < min) return { up: min, down: total - min, perUnit: (total - min) / under }
  if (under * perUnit < min) return { up: total - min, down: min, perUnit: (total - min) / over }
  return { up: over * perUnit, down: under * perUnit, perUnit }
}

/** Bar height in px for a month (a visible 4px stub for any non-zero month). */
export function barPx(delta: Minor, scale: DivergingScale): number {
  if (delta === 0 || scale.perUnit === 0) return 0
  return Math.max(4, Math.abs(delta) * scale.perUnit)
}

export interface CouldveTotals {
  totalOver: Minor
  totalUnder: Minor
  equivalents: DreamEquivalent[]
}

/** One line that sums up six months — leads with the kept money when it outweighs the overspend. */
export function couldveHeadline(c: CouldveTotals, months: number, currency: Currency): string {
  const f = (m: Minor) => fmtWhole(m, currency)
  // the totals cover finished months only (the month in progress has its own line below the chart), so say so
  const span = `${months} finished month${months === 1 ? '' : 's'}`
  if (c.totalOver <= 0 && c.totalUnder <= 0) return `Nothing to tally from the last ${months} months yet.`
  if (c.totalOver <= 0) return `${f(c.totalUnder)} left over in ${span}.`
  const eq = c.equivalents[0]
  return `${f(c.totalOver)} over budget in ${span}${eq ? ` — ${eq.label}` : ''}.`
}

// ───────────────────────────── "Should I buy it?" ─────────────────────────────

export interface VerdictMeta {
  title: string
  badge: string
  tone: StatusTone
  mood: BunMood
}

export function verdictMeta(verdict: AffordabilityResult['verdict'], tone: Tone): VerdictMeta {
  if (verdict === 'go') {
    return { badge: 'Fits', tone: 'under', mood: 'happy', title: tone === 'cheeky' ? 'Bun can live with that' : tone === 'numbers' ? 'Fits the budget' : 'It fits your month' }
  }
  if (verdict === 'think') {
    return { badge: 'Think it over', tone: 'warn', mood: 'worried', title: tone === 'cheeky' ? 'Hmm — think twice' : tone === 'numbers' ? 'Thin margin' : 'Maybe sleep on it' }
  }
  return { badge: 'Skip for now', tone: 'over', mood: tone === 'gentle' ? 'worried' : 'angry', title: tone === 'cheeky' ? 'Your dreams say no' : tone === 'numbers' ? 'Over budget' : 'Better to skip it for now' }
}

/** The question "Ask Bun" sends to chat. */
export function affordabilityQuestion(amount: Minor, label: string, currency: Currency): string {
  const what = label && label !== 'this' ? ` ${label}` : ' it'
  return `Should I buy${what} for ${fmt(amount, currency)}?`
}

// ───────────────────────────── "Why am I seeing this?" ─────────────────────────────

export function statusRule(status: MirrorStatus): string {
  switch (status) {
    case 'over': return 'You’ve already spent more than your monthly target, so the mirror shows what the extra could have bought.'
    case 'pace_over': return 'You’re still within your target today, but your pace projects more than 5% over by month end.'
    case 'under': return 'Your pace projects spending more than 5% less than your target, so the mirror shows what the money left over can do.'
    case 'on_track': return 'Your projected month end is within 5% of your target.'
    default: return 'There’s no spending recorded this month yet.'
  }
}

/** Why this particular dream item was picked. */
export function itemReason(m: MirrorState, currency: Currency): string | null {
  if (!m.item) return null
  const f = (x: Minor) => fmtWhole(x, currency)
  // under budget with a goal the mirror is goal-led: the surplus is shown moving the goal, not as what it buys
  if (m.status === 'under' && m.goal && m.item.id === m.goal.itemId) {
    const stash = stashAmount(m.cta)
    return `With money left over, Bun leads with your main goal, ${m.item.name} (${f(m.item.price)})${stash > 0 ? `: stashing ${f(stash)} of the ${f(m.delta)} takes it to ${Math.floor(pctAfter(m.goal, stash))}%` : ''}.${m.treat ? ` The rest covers ${m.treat.label}, if you’d like it.` : ''}`
  }
  if (m.quantity) {
    return `${m.item.name} (${f(m.item.price)}) is the biggest dream on your list that ${f(m.delta)} fully covers${m.quantity >= 2 ? ` — ${m.quantity} times over` : ''}.`
  }
  if (m.fraction !== undefined) {
    return `None of your dreams fits inside ${f(m.delta)}, so Bun shows it as a share of your main goal, ${m.item.name} (${f(m.item.price)}).`
  }
  return `${m.item.name} is your main goal.`
}

export function delayReason(m: MirrorState, currency: Currency): string | null {
  if (!m.goal || !m.goalDelayDays) return null
  const rate = m.goal.monthlyRate
  const how = rate > 0
    ? `You save about ${fmtWhole(rate, currency)} a month toward ${m.goal.name} (3-month average)`
    : `With no saving history yet, Bun assumes 10% of your income goes to ${m.goal.name}`
  return `${how}, so ${fmtWhole(m.delta, currency)} is roughly ${durationText(m.goalDelayDays)} of saving.`
}

export function hoursReason(m: MirrorState, monthlyIncome: Minor, workHours: number, currency: Currency): string | null {
  if (!m.hoursOfWork) return null
  return `At ${fmtWhole(monthlyIncome, currency)} a month over ${workHours} work hours, ${fmtWhole(Math.abs(m.delta), currency)} is about ${m.hoursOfWork} hours of work.`
}

export const TONE_LABEL: Record<Tone, string> = {
  cheeky: 'Cheeky',
  gentle: 'Gentle',
  numbers: 'Just the numbers',
}

// ───────────────────────────── quick add ─────────────────────────────

export interface ManualSpend {
  amount: Minor
  /** what it was, or where: "coffee", "Hema" — may be empty */
  what: string
  /** the user's pick; '' lets the on-device categoriser guess from `what` */
  category: CategoryId | ''
  today: ISODate
  /** the day it was spent (yesterday's coffee logged today); omitted → today */
  date?: ISODate
  currency: Currency
  /** the user's own merchant → category rules */
  rules?: Record<string, CategoryId>
  /** makes the id unique: two identical coffees are two purchases */
  seq: string
}

/** A typed-in purchase as a spending candidate: on the day the user picked (never after today), in the category the user picked or Bun guessed. */
export function manualCandidate(m: ManualSpend): SpendingCandidate {
  const what = m.what.trim().slice(0, 60)
  const category = m.category || (what ? categorize(what, what, -1, m.rules ?? {}).category : 'other')
  return {
    id: `manual_${m.seq}`,
    merchant: what || CATEGORIES[category].label,
    amount: Math.abs(m.amount),
    currency: m.currency,
    date: m.date && m.date <= m.today ? m.date : m.today,
    category,
    description: what,
    source: 'manual',
  }
}

// ───────────────────────────── the carrot and the stick ─────────────────────────────

/** How Bun's face is named in a sentence. */
export const MOOD_WORDS: Record<BunMood, string> = {
  happy: 'Bun is proud',
  calm: 'Bun is content',
  worried: 'Bun is worried',
  angry: 'Bun is cross',
  furious: 'Bun is furious',
  burnt: 'Bun got toasted',
  sleepy: 'Bun is napping',
}

export interface TemperLine {
  kind: 'carrot' | 'stick' | 'cooling'
  label: string
  text: string
}

/**
 * The one line under the hero that says how Bun feels and what changes it: the way back when Bun is cross, the
 * streak when things go well. Nothing when there is nothing to add to the headline.
 */
export function temperLine(m: Pick<MirrorState, 'mood' | 'temper' | 'status'>): TemperLine | null {
  const t = m.temper
  if (!t) return null
  const streak = `${plural(t.goodDays, 'good day')} in a row.`
  if (t.cooling) return { kind: 'cooling', label: 'Bun is cooling down', text: `${streak} ${t.wayBack ?? ''}`.trim() }
  if (m.status === 'over' && t.wayBack) return { kind: 'stick', label: MOOD_WORDS[m.mood], text: t.wayBack }
  if (t.heat <= 1 && t.goodDays >= 2) return { kind: 'carrot', label: MOOD_WORDS[m.mood], text: `${streak} Each one stayed within your day limit.` }
  return null
}

export interface SpendReaction {
  /** carrot: it fits and the month is fine · nudge: more than today's share, nothing lost yet · stick: over budget, or a wire tripped */
  kind: 'carrot' | 'nudge' | 'stick'
  /** Bun's face before the purchase, so the screen can show it change */
  from: BunMood
  mood: BunMood
  title: string
  /** what it cost, or what it kept: one to three short lines, the dream first */
  lines: string[]
  /** the dream this purchase is measured in */
  dream?: DreamEquivalent
  /** what calms Bun down again */
  wayBack?: string
  /** said with a stick or a nudge: the stick is for the spending, never for telling Bun about it */
  thanks?: string
  /** offer "Make a plan with Bun" */
  plan: boolean
}

export interface SpendReactionInput {
  amount: Minor
  currency: Currency
  tone: Tone
  /** "Should I buy it?" for this amount, worked out just before it was added */
  check: Pick<AffordabilityResult, 'safeToSpendToday' | 'equivalents' | 'goalName' | 'goalDelayDays' | 'delayText' | 'hoursOfWork'>
  before: Pick<MirrorState, 'mood'>
  after: Pick<MirrorState, 'mood' | 'status' | 'delta' | 'temper' | 'goal'>
  /** safe to spend today once the purchase is in */
  safeAfter: Minor
  /** how many tripwire alerts this purchase set off */
  tripped: number
}

const REACTION_TITLES: Record<'furious' | 'stick' | 'nudge' | 'carrot', Record<Tone, string>> = {
  furious: { cheeky: 'Bun is fuming.', gentle: 'That was a big one.', numbers: 'Way past the line.' },
  stick: { cheeky: 'That one stung.', gentle: 'That one costs a little.', numbers: 'Over the line.' },
  nudge: { cheeky: 'Hmm. More than today’s share.', gentle: 'A bit more than today’s share.', numbers: 'Above today’s safe amount.' },
  carrot: { cheeky: 'Nice. That fits.', gentle: 'Logged. You’re on track.', numbers: 'Within today’s safe amount.' },
}

/**
 * Bun's reaction the moment a purchase is logged: the consequence, right away, in the user's own dream. Over
 * target or a tripped wire gets the stick (what it cost, and the way back); more than today's share gets a nudge;
 * a purchase that fits gets the carrot (what is still safe, and the streak it keeps).
 */
export function spendReaction(i: SpendReactionInput): SpendReaction {
  const f = (m: Minor) => fmt(m, i.currency)
  // the purchase is exact; what is left to spend reads as whole yuan from ¥100
  const fc = (m: Minor) => fmtCopy(m, i.currency)
  const t = i.after.temper
  const heat = t?.heat ?? (i.after.status === 'over' ? 3 : i.after.status === 'pace_over' ? 2 : 1)
  const kind: SpendReaction['kind'] = heat >= 3 || i.tripped > 0 ? 'stick' : heat === 2 || i.amount > i.check.safeToSpendToday ? 'nudge' : 'carrot'
  // a tripped wire is a line the user drew themselves: Bun is at least cross about it (worried in the gentle tone)
  const mood: BunMood =
    kind === 'stick' ? (heat >= 3 ? i.after.mood : i.tone === 'gentle' ? 'worried' : 'angry')
    : kind === 'nudge' ? 'worried'
    : i.after.mood === 'happy' ? 'happy' : 'calm'
  const dream = i.check.equivalents[0]
  const goal = i.check.goalName
  const lines: string[] = []
  if (kind === 'carrot') {
    lines.push(i.safeAfter > 0 ? `${fc(i.safeAfter)} is still safe to spend today.` : 'That uses up today’s safe amount.')
    if (i.after.goal) lines.push(`Your ${i.after.goal.name} stays on schedule.`)
    if (t && t.goodDays >= 2) lines.push(`${plural(t.goodDays, 'good day')} in a row. Keep it going.`)
  } else {
    if (dream) lines.push(`${f(i.amount)} = ${dream.label}.`)
    // only the part past the target sets the goal back; the rest was budgeted spending
    const past = i.after.status === 'over' ? Math.min(i.amount, Math.max(0, i.after.delta)) : 0
    const lost = i.check.goalDelayDays && i.amount > 0 ? Math.round((i.check.goalDelayDays * past) / i.amount) : 0
    if (goal && lost >= 1) lines.push(`Your ${goal} just moved ${delayPhrase(lost)} further away.`)
    else if (kind === 'nudge') lines.push(`Today’s safe amount was ${fc(i.check.safeToSpendToday)}.`)
    else if (goal && i.check.delayText) lines.push(`That is ${i.check.delayText} of saving for your ${goal}.`)
    if (i.tripped > 0) lines.push(i.tripped === 1 ? 'It tripped a wire you set.' : `It tripped ${i.tripped} wires you set.`)
    else if (kind === 'stick' && i.check.hoursOfWork > 0) lines.push(`About ${i.check.hoursOfWork} hours of work.`)
  }
  const titleKey = kind === 'stick' && mood === 'furious' ? 'furious' : kind
  return {
    kind,
    from: i.before.mood,
    mood,
    title: REACTION_TITLES[titleKey][i.tone] ?? REACTION_TITLES[titleKey].gentle,
    lines,
    ...(kind !== 'carrot' && dream ? { dream } : {}),
    ...(kind !== 'carrot' && t?.wayBack ? { wayBack: t.wayBack } : {}),
    ...(kind !== 'carrot' ? { thanks: 'Thanks for logging it. Honest numbers are how you get back.' } : {}),
    plan: kind === 'stick' || i.after.status === 'pace_over',
  }
}

// ───────────────────────────── when it was spent ─────────────────────────────

export type SpendDay = 'today' | 'yesterday' | 'earlier'

/** How far back a purchase can be logged by hand. */
export const BACKDATE_MAX_DAYS = 365

/** The date for the day chosen in Add spending, or an error for an earlier date that is out of range. */
export function spendDate(day: SpendDay, picked: string, today: ISODate): { date: ISODate } | { error: string } {
  if (day === 'today') return { date: today }
  if (day === 'yesterday') return { date: addDays(today, -1) }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(picked)) return { error: 'Pick the day you spent it' }
  if (picked > today) return { error: 'That day hasn’t happened yet' }
  if (picked < addDays(today, -BACKDATE_MAX_DAYS)) return { error: 'Pick a day within the last year' }
  return { date: picked }
}

/** "today", "yesterday", "Mon 19 Oct": how the note under the form names the day. */
export function spendDayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return 'today'
  if (date === addDays(today, -1)) return 'yesterday'
  const d = parseDate(date)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

