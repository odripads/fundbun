import { addDays } from '../dates'
import type { CheckIns, ISODate } from '../types'

/**
 * The daily check-in: the habit of opening the app and looking at today's number.
 *
 * Showing up is the behaviour we want every day, so it gets its own small carrot: a stamp on a seven-day card, a
 * running streak, and a golden bun for every seventh day in a row. A streak is also something people do not like
 * to lose, which is the point.
 *
 * The check-in is more than a stamp. Tapping it says "nothing else to log today", so the day counts as logged even
 * with no spending: it can be a good day for Bun's temper (finance/temper), where a day with nothing logged is
 * otherwise skipped. Logging a purchase checks in by itself.
 */

/** Slots on the card; the last one is the golden bun. */
export const CHECKIN_CARD_DAYS = 7
/** How many past check-in days are kept. */
const KEEP_DAYS = 120

export interface CheckInSlot {
  /** 1 to CHECKIN_CARD_DAYS */
  day: number
  state: 'stamped' | 'today' | 'ahead'
  /** the seventh day in a row earns a golden bun */
  golden: boolean
}

export interface CheckInView {
  /** already checked in today */
  done: boolean
  /** days in a row: through today when done, through yesterday while today is still open */
  streak: number
  /** the streak today's check-in would make (streak + 1 while open) */
  next: number
  /** longest streak so far */
  best: number
  /** golden buns earned so far */
  golden: number
  card: CheckInSlot[]
}

export function emptyCheckIns(): CheckIns {
  return { days: [], best: 0, golden: 0 }
}

/** Days in a row ending on `end` (0 when `end` is not a check-in day). */
function runEndingOn(days: ReadonlySet<ISODate>, end: ISODate): number {
  let n = 0
  for (let d = end; days.has(d); d = addDays(d, -1)) n++
  return n
}

/** Days in a row: through today if checked in today, else through yesterday (still alive until the day ends). */
export function checkInStreak(days: readonly ISODate[], today: ISODate): number {
  const set = new Set(days)
  return set.has(today) ? runEndingOn(set, today) : runEndingOn(set, addDays(today, -1))
}

/** What the card shows today. */
export function checkInView(c: CheckIns | undefined, today: ISODate): CheckInView {
  const days = c?.days ?? []
  const done = days.includes(today)
  const streak = checkInStreak(days, today)
  const next = done ? streak : streak + 1
  // where today sits on the card: the card starts over after every seventh day
  const slot = ((next - 1) % CHECKIN_CARD_DAYS) + 1
  const card: CheckInSlot[] = Array.from({ length: CHECKIN_CARD_DAYS }, (_, i) => {
    const day = i + 1
    const state: CheckInSlot['state'] = day < slot || (day === slot && done) ? 'stamped' : day === slot ? 'today' : 'ahead'
    return { day, state, golden: day === CHECKIN_CARD_DAYS }
  })
  return { done, streak, next, best: Math.max(c?.best ?? 0, streak), golden: c?.golden ?? 0, card }
}

/** Record today's check-in (once a day; a second call changes nothing). `earned` says whether it won a golden bun. */
export function recordCheckIn(c: CheckIns | undefined, today: ISODate): { checkIns: CheckIns; added: boolean; streak: number; earned: boolean } {
  const base = c ?? emptyCheckIns()
  if (base.days.includes(today)) return { checkIns: base, added: false, streak: checkInStreak(base.days, today), earned: false }
  const from = addDays(today, -KEEP_DAYS)
  const days = [...base.days.filter((d) => d >= from && d < today), today].sort()
  const streak = checkInStreak(days, today)
  const earned = streak % CHECKIN_CARD_DAYS === 0
  return { checkIns: { days, best: Math.max(base.best, streak), golden: base.golden + (earned ? 1 : 0) }, added: true, streak, earned }
}
