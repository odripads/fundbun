import type { ISODate, YearMonth } from './types'

/** All date math is done on calendar dates (UTC-noon based) to avoid DST/timezone drift. */

export function parseDate(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, 12))
}

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10)
}

export function ym(d: ISODate): YearMonth {
  return d.slice(0, 7)
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parseDate(d)
  x.setUTCDate(x.getUTCDate() + n)
  return toISODate(x)
}

export function addMonths(d: ISODate, n: number): ISODate {
  const x = parseDate(d)
  const day = x.getUTCDate()
  x.setUTCDate(1)
  x.setUTCMonth(x.getUTCMonth() + n)
  const dim = daysInMonth(toISODate(x).slice(0, 7))
  x.setUTCDate(Math.min(day, dim))
  return toISODate(x)
}

/** b - a in whole days */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)
}

export function daysInMonth(m: YearMonth): number {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

export function dayOfMonth(d: ISODate): number {
  return Number(d.slice(8, 10))
}

export function startOfMonth(m: YearMonth): ISODate {
  return `${m}-01`
}

export function endOfMonth(m: YearMonth): ISODate {
  return `${m}-${String(daysInMonth(m)).padStart(2, '0')}`
}

export function shiftMonth(m: YearMonth, n: number): YearMonth {
  return addMonths(`${m}-01`, n).slice(0, 7)
}

/** The `n` months ending at (and including) `m`, oldest first. */
export function monthsBack(m: YearMonth, n: number): YearMonth[] {
  const out: YearMonth[] = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(m, -i))
  return out
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(d: ISODate): number {
  return parseDate(d).getUTCDay()
}

export function isWeekend(d: ISODate): boolean {
  const w = weekday(d)
  return w === 0 || w === 6
}

export function monthLabel(m: YearMonth, style: 'long' | 'short' = 'long'): string {
  return parseDate(`${m}-01`).toLocaleDateString('en-US', { month: style, year: 'numeric', timeZone: 'UTC' })
}

export function dateLabel(d: ISODate): string {
  return parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function nowISO(): string {
  return new Date().toISOString()
}

export function compareDate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}
