import { fmt } from '../money'
import type { Currency, Minor, Tone } from '../types'

/** Copy helpers shared by mirror / tripwires / insights / affordability (internal). */

export type Fmt = (m: Minor) => string

export function moneyFmt(currency: Currency): Fmt {
  return (m) => fmt(m, currency)
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

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "A, B and C" */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
