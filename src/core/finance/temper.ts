import { addDays, endOfMonth, ym } from '../dates'
import type { BunMood, BunTemper, FinanceContext, ISODate, Minor, MirrorStatus, MonthSummary, Tone, Transaction } from '../types'
import { MINOR_PER_MAJOR } from '../money'
import { copyFmt, pctText, plural } from './copy'
import { FIXED_CATEGORIES, inMonth, isSpending, spendValue, upTo } from './ledger'
import { unpaidBillsDue } from './summary'

/**
 * Bun's temper: the carrot and the stick, as one ladder.
 *
 * The idea is the oldest one in learning psychology (operant conditioning): behaviour follows its consequences,
 * and a consequence teaches best when it is immediate, consistent and in proportion. So Bun's face is a pure
 * function of the ledger:
 *
 *   0 proud    under budget                     → happy    (the carrot)
 *   1 content  on track                         → calm
 *   2 uneasy   heading over budget              → worried  (the raised stick: a warning, nothing is lost yet)
 *   3 cross    over budget                      → angry    (the stick)
 *   4 furious  FURIOUS_OVER past the target     → furious  (bright red)
 *
 * Two things move Bun along the ladder day by day, so the face never becomes wallpaper:
 *  - a blowout (today alone is BLOWOUT_DAYS days' worth while the month is over or heading over) adds a step, now;
 *  - every COOL_DOWN_DAYS good days in a row take a step off, down to "uneasy". Behaving well makes the stick go
 *    away, which is the part that teaches.
 *
 * A good day is a finished, logged day with all its spending within the day limit. Logged means there is spending
 * on the ledger, or the user checked in and said there was nothing to log (finance/checkin). A day with nothing
 * logged is skipped: it neither counts nor breaks the streak, so going quiet never calms Bun down (the reward is
 * for showing up and staying inside the line, not for hiding), and a gap of GAP_DAYS empty days ends the streak. A
 * finished month keeps its verdict: no blowouts, no cooling.
 *
 * The gentle tone softens the face by one step from "cross" up; the numbers stay the same.
 */

/** Past the target by this share of it, Bun is furious rather than cross. */
export const FURIOUS_OVER = 0.2
/** Today's day-to-day spending at this many times the day limit is a blowout. */
export const BLOWOUT_DAYS = 3
/** Finished days in a row within the day limit that take one step off Bun's anger. */
export const COOL_DOWN_DAYS = 2
/** A streak is counted back this far at most. */
export const STREAK_MAX_DAYS = 60
/** This many days in a row with nothing logged end a streak: there is no telling what happened in the gap. */
export const GAP_DAYS = 3

const FACES: readonly BunMood[] = ['happy', 'calm', 'worried', 'angry', 'furious']

function baseHeat(status: MirrorStatus, overBy: number): BunTemper['heat'] {
  return status === 'under' ? 0 : status === 'pace_over' ? 2 : status === 'over' ? (overBy >= FURIOUS_OVER ? 4 : 3) : 1
}

function faceFor(status: MirrorStatus, heat: number, tone: Tone): BunMood {
  return status === 'no_data' ? 'sleepy' : FACES[tone === 'gentle' && heat >= 3 ? heat - 1 : heat]
}

/** Share of the target already overspent (0 when not over). */
export function overShare(spent: Minor, target: Minor): number {
  return target > 0 && spent > target ? (spent - target) / target : 0
}

/**
 * The face for a verdict alone, when there is no day-by-day data to judge (previews, example cards): the ladder
 * without blowouts or cooling. `overBy` is overShare(spent, target).
 */
export function moodOf(status: MirrorStatus, tone: Tone, overBy = 0): BunMood {
  return faceFor(status, baseHeat(status, overBy), tone)
}

/** Purchases, not rent, utilities or other scheduled payments: the spending a day limit is about. */
function isDayToDay(t: Transaction): boolean {
  return isSpending(t) && !t.billId && !FIXED_CATEGORIES.has(t.category)
}

/**
 * What one day of day-to-day spending may be. The user's own daily tripwire when one is on (their line, their
 * words); otherwise an even share of the flexible budget (the target minus this month's fixed costs and bills due),
 * rounded to whole currency units.
 */
export function dayLimitOf(ctx: FinanceContext, s: MonthSummary): Minor {
  const own = ctx.tripwires.find((t) => t.enabled && t.kind === 'daily_over' && t.threshold > 0)
  if (own) return own.threshold
  let fixed = 0
  for (const t of upTo(ctx.bank.transactions, ctx.bank.today)) {
    if (inMonth(t, s.month) && !isDayToDay(t)) fixed += Math.max(0, spendValue(t))
  }
  const due = unpaidBillsDue(ctx.bank.bills, s.month, false).reduce((sum, b) => sum + Math.max(0, b.amountDue), 0)
  // a line to remember: whole yuan, not ¥83.61
  const unit = MINOR_PER_MAJOR[ctx.profile.currency] ?? 100
  return s.daysInMonth > 0 ? Math.max(0, Math.round((s.target - fixed - due) / s.daysInMonth / unit) * unit) : 0
}

/**
 * Day-to-day spending per logged day. A day with only fixed costs is on the map at 0, and so is a day the user
 * checked in on without spending: "nothing to log today" is a logged day.
 */
function dayTotals(txns: Transaction[], checkedDays: readonly ISODate[] = []): Map<ISODate, Minor> {
  const totals = new Map<ISODate, Minor>()
  for (const d of checkedDays) totals.set(d, 0)
  for (const t of txns) {
    if (isSpending(t)) totals.set(t.date, (totals.get(t.date) ?? 0) + (isDayToDay(t) ? -t.amount : 0))
  }
  return totals
}

/** Logged days in a row within the limit, walking back from `from`; empty days are skipped, a long gap ends it. */
function goodDayStreak(totals: Map<ISODate, Minor>, from: ISODate, dayLimit: Minor): number {
  let good = 0
  let gap = 0
  let d = from
  for (let i = 0; i < STREAK_MAX_DAYS && gap < GAP_DAYS; i++, d = addDays(d, -1)) {
    const spent = totals.get(d)
    if (spent === undefined) {
      gap++
      continue
    }
    if (spent > dayLimit) break
    gap = 0
    good++
  }
  return good
}

/**
 * Bun's temper for the month in `s`. `status` is the mirror's verdict for the same month (finance/mirror), so the
 * face and the headline can never disagree.
 */
export function bunTemper(ctx: FinanceContext, s: MonthSummary, status: MirrorStatus, tone: Tone = ctx.profile.tone): BunTemper {
  const f = copyFmt(ctx.profile.currency)
  const today = ctx.bank.today
  const dayLimit = dayLimitOf(ctx, s)
  const totals = dayTotals(upTo(ctx.bank.transactions, today), (ctx.checkedDays ?? []).filter((d) => d <= today))
  const future = s.month > ym(today)
  const spentToday = s.isCurrent ? (totals.get(today) ?? 0) : 0

  // the streak: back from yesterday (today is not finished; going over today breaks it), or from a finished month's last day
  const goodDays = future || spentToday > dayLimit ? 0 : goodDayStreak(totals, s.isCurrent ? addDays(today, -1) : endOfMonth(s.month), dayLimit)

  const overBy = status === 'over' ? overShare(s.spent, s.target) : 0
  const base = baseHeat(status, overBy)
  const blowout = base >= 2 && dayLimit > 0 && spentToday >= dayLimit * BLOWOUT_DAYS
  const heated = blowout ? Math.min(4, base + 1) : base
  const cooled = blowout || !s.isCurrent ? 0 : Math.min(Math.max(0, heated - 2), Math.floor(goodDays / COOL_DOWN_DAYS))
  const heat = (heated - cooled) as BunTemper['heat']
  const face = faceFor(status, heat, tone)

  const limit = f(dayLimit)
  const streak = `${plural(goodDays, 'day')} in a row within your ${limit} day limit`
  const reasons: string[] = []
  if (status === 'no_data') reasons.push('There is no spending to judge yet.')
  else if (status === 'over') reasons.push(`You are ${f(s.spent - s.target)} over your ${f(s.target)} target${overBy >= FURIOUS_OVER ? `, ${pctText(overBy)} past it` : ''}.`)
  else if (status === 'pace_over') reasons.push(`At this pace the month ends ${f(s.projected - s.target)} over your ${f(s.target)} target.`)
  else if (goodDays >= COOL_DOWN_DAYS) reasons.push(`${streak}${status === 'under' ? ', and you are spending less than your target' : ''}.`)
  else reasons.push(status === 'under' ? 'You are spending less than your target.' : 'You are on track.')
  if (blowout) reasons.push(`Today alone is ${f(spentToday)}, ${Math.floor(spentToday / dayLimit)} times your ${limit} day limit.`)
  if (cooled > 0) reasons.push(`${streak} calmed Bun down.`)

  let wayBack: string | undefined
  if (!s.isCurrent) {
    if (status === 'over') wayBack = 'That month is closed. A new month starts clean.'
  } else if (heat >= 3) {
    const need = blowout ? COOL_DOWN_DAYS : COOL_DOWN_DAYS - (goodDays % COOL_DOWN_DAYS)
    wayBack = `Log ${plural(need, 'day')} within ${limit} and Bun cools down a step.`
  } else if (status === 'pace_over') {
    wayBack = s.safeToSpendToday > 0 ? `Keep to ${f(s.safeToSpendToday)} a day and the month still lands on target.` : 'Ease off for the rest of the month and the overshoot shrinks.'
  } else if (status === 'over') {
    wayBack = `Keep it within ${limit} a day. Every day you do counts in your favour.`
  }

  return { mood: face, heat, overBy, dayLimit, spentToday, goodDays, blowout, cooling: cooled > 0, reason: reasons.join(' '), ...(wayBack ? { wayBack } : {}) }
}
