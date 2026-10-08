import { fmt, fmtCopy } from '../money'
import type { Currency, Minor, Tone } from '../types'

/** Copy helpers shared by mirror / tripwires / insights / affordability (internal). */

export type Fmt = (m: Minor) => string

/** Exact money (cents shown when present): one bill, one transaction, a price, a line item. */
export function moneyFmt(currency: Currency): Fmt {
  return (m) => fmt(m, currency)
}

/** Money for prose — totals, deltas, targets, projections: whole units from ¥100 (money.fmtCopy). */
export function copyFmt(currency: Currency): Fmt {
  return (m) => fmtCopy(m, currency)
}

/** Pick the string for the user's tone. */
export function byTone(tone: Tone, copy: Record<Tone, string>): string {
  return copy[tone] ?? copy.gentle
}

const HAS_LATIN = /[a-z]/i
const PLURALISH = /^[a-z]+[^su]s$/i

/**
 * "Weekend in Chengdu" → "a Weekend in Chengdu", "AirPods Pro" → "AirPods Pro", "New sneakers" → "New sneakers".
 * Dream names are user-typed, so this is a heuristic: plural-looking words or an existing determiner get no article.
 */
export function withArticle(name: string): string {
  const n = name.trim()
  if (!HAS_LATIN.test(n.charAt(0))) return n
  if (/^(a|an|the|my|your|some|two|three)\s/i.test(n)) return n
  if (n.split(/\s+/).some((w) => PLURALISH.test(w))) return n
  return `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`
}

/** 0.0133 → "1.3%", 0.38 → "38%", 0.0004 → "<0.1%" */
export function pctText(fraction: number): string {
  const p = fraction * 100
  if (p > 0 && p < 0.1) return '<0.1%'
  if (p < 10) return `${Number(p.toFixed(1))}%`
  return `${Math.round(p)}%`
}

/** 9 → "9 days", 37 → "about 5 weeks", 120 → "about 4 months" */
export function delayPhrase(days: number): string {
  if (days <= 1) return 'a day'
  if (days < 14) return `${days} days`
  if (days < 60) return `about ${Math.round(days / 7)} weeks`
  return `about ${Math.round(days / 30.4)} months`
}

/**
 * The one short form of a goal delay for chips and tiles, on the same units as delayPhrase: days under two weeks,
 * then weeks, then months. 9 → "9 days", 18 → "3 wks", 35 → "5 wks", 120 → "4 mo".
 */
export function delayShort(days: number): string {
  const d = Math.max(0, Math.round(days))
  if (d <= 1) return '1 day'
  if (d < 14) return `${d} days`
  if (d < 60) return `${Math.round(d / 7)} wks`
  return `${Math.round(d / 30.4)} mo`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "A, B and C" */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
