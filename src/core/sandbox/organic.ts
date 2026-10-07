import { addDays, dayOfMonth, daysInMonth, endOfMonth, isWeekend, startOfMonth, ym } from '../dates'
import type { ISODate, Minor, PayChannel, YearMonth } from '../types'
import type { Rng } from '../rng'
import type { Draft } from './drafts'
import { pickWeighted, poisson, rngFor, sampleDistinct, samplePrice, timeInWindow } from './random'
import type { DayKind, HabitSpec, MerchantSpec, PersonaScript, SubscriptionSpec } from './script-types'

/** Approximate 2026 public-holiday blocks (sandbox flavour: holidays behave like weekends). */
const HOLIDAY_RANGES: readonly (readonly [ISODate, ISODate])[] = [
  ['2026-01-01', '2026-01-03'],
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-09-25', '2026-09-27'],
  ['2026-10-01', '2026-10-07'],
]

export function isHoliday(date: ISODate): boolean {
  return HOLIDAY_RANGES.some(([from, to]) => date >= from && date <= to)
}

export function dayKind(date: ISODate): DayKind {
  return isWeekend(date) || isHoliday(date) ? 'off' : 'work'
}

export function datesBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

function matchesKind(date: ISODate, on: HabitSpec['on']): boolean {
  return !on || on === 'any' || dayKind(date) === on
}

function intensityFor(habit: HabitSpec, intensity: number): number {
  return 1 + (intensity - 1) * (habit.elasticity ?? 1)
}

/** The days a per-month habit fires in `month` — deterministic per (seed, persona, month, habit). */
export function monthlyHabitDays(script: PersonaScript, seed: number, month: YearMonth, habit: HabitSpec, intensity: number): Set<ISODate> {
  const [min, max] = habit.perMonth ?? [0, 0]
  const rng = rngFor(seed, script.def.id, 'month', month, habit.key)
  const count = Math.round(rng.int(min, max) * intensityFor(habit, intensity))
  const eligible = datesBetween(startOfMonth(month), endOfMonth(month)).filter((d) => matchesKind(d, habit.on))
  return new Set(sampleDistinct(rng, eligible, count))
}

function eventCount(script: PersonaScript, seed: number, date: ISODate, habit: HabitSpec, intensity: number, rng: Rng): number {
  if (habit.perMonth) return monthlyHabitDays(script, seed, ym(date), habit, intensity).has(date) ? 1 : 0
  const rate = (habit.perDay?.[dayKind(date)] ?? 0) * intensityFor(habit, intensity)
  const cap = habit.maxPerDay ?? 1
  // with a cap of one, a Bernoulli draw keeps the expected count equal to the rate
  return cap === 1 ? (rng.chance(Math.min(1, rate)) ? 1 : 0) : Math.min(cap, poisson(rng, rate))
}

function pickChannel(rng: Rng, channel: MerchantSpec['channel']): PayChannel {
  return typeof channel === 'string' ? channel : rng.pick(channel)
}

export function describe(rng: Rng, m: MerchantSpec): string {
  return m.items?.length ? m.description.replace('{item}', rng.pick(m.items)) : m.description.replace(' {item}', '')
}

export function purchaseDraft(rng: Rng, m: MerchantSpec, date: ISODate, hours: readonly [number, number], accountId: string, amount?: Minor): Draft {
  return {
    accountId,
    date,
    time: timeInWindow(rng, hours),
    amount: -(amount ?? samplePrice(rng, m.price)),
    merchant: m.merchant,
    description: describe(rng, m),
    category: m.category,
    channel: pickChannel(rng, m.channel),
    initiatedBy: 'user',
    calibratable: true,
    spec: m,
  }
}

/** Subscription price in force for a month offset; undefined offset (live sandbox days) → latest price. */
export function subscriptionPrice(sub: SubscriptionSpec, monthOffset?: number): Minor {
  let amount = sub.amount
  for (const c of sub.changes ?? []) {
    if (monthOffset === undefined || monthOffset >= c.monthOffset) amount = c.amount
  }
  return amount
}

function isCancelled(merchant: string, cancelled: readonly string[]): boolean {
  const key = merchant.trim().toLowerCase()
  return cancelled.some((c) => c.trim().toLowerCase() === key)
}

function subscriptionDrafts(script: PersonaScript, date: ISODate, opts: OrganicOptions): Draft[] {
  const dom = dayOfMonth(date)
  const dim = daysInMonth(ym(date))
  return script.subscriptions
    .filter((s) => Math.min(s.day, dim) === dom && !isCancelled(s.merchant, opts.cancelled))
    .map((s) => ({
      accountId: opts.accountId,
      date,
      time: s.time,
      amount: -subscriptionPrice(s, opts.monthOffset),
      merchant: s.merchant,
      description: s.description,
      category: s.category,
      channel: s.channel,
      initiatedBy: 'bank' as const,
    }))
}

export interface OrganicOptions {
  accountId: string
  /** merchants whose recurring charges were cancelled */
  cancelled: readonly string[]
  /** month offset relative to the persona's story month (history only) */
  monthOffset?: number
  /** discretionary intensity multiplier (default 1) */
  intensity?: number
}

/**
 * Organic activity for one day: discretionary habits + subscription charges. Each habit draws from its own
 * (seed, persona, date, habit) stream, so days are independent and reproducible in any order.
 */
export function organicDrafts(script: PersonaScript, seed: number, date: ISODate, opts: OrganicOptions): Draft[] {
  const intensity = opts.intensity ?? 1
  const out: Draft[] = []
  for (const habit of script.habits) {
    if (habit.merchants.length === 0) continue
    const rng = rngFor(seed, script.def.id, 'day', date, habit.key)
    const n = eventCount(script, seed, date, habit, intensity, rng)
    for (let i = 0; i < n; i++) {
      const draft = purchaseDraft(rng, pickWeighted(rng, habit.merchants), date, habit.hours, opts.accountId)
      if (habit.protected) draft.protected = true
      out.push(draft)
    }
  }
  return [...out, ...subscriptionDrafts(script, date, opts)]
}
