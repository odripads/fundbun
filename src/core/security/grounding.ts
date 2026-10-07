import { MINOR_PER_MAJOR } from '../money'
import type { Currency, GroundingReport } from '../types'

export interface NumberToken {
  /** the text as it appears, e.g. "¥3,450", "38%", "3.4k" */
  raw: string
  /** numeric value in display units (major units for money, 38 for "38%") */
  value: number
  /** display precision: the value could stand for anything in [value - unit/2, value + unit) */
  unit: number
  currency: boolean
  percent: boolean
  /** k / w / 万 / 千 / m suffix */
  scaled: boolean
  /** written with thousands separators */
  grouped: boolean
  decimals: number
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'

/** Dates, times and ordinals — their digits are never checked. */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{1,2}(?:-\d{1,2})?(?:t\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?)?\b/gi,
  /\b\d{4}\/\d{1,2}(?:\/\d{1,2})?\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?/gi,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b\\.?(?:,?\\s+\\d{4}\\b)?`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4}\\b)?`, 'gi'),
  new RegExp(`\\b(?:${MONTHS})\\b\\.?\\s+\\d{4}\\b`, 'gi'),
  /\d{4}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?)?/g,
  /\d{1,2}\s*月(?:\s*\d{1,2}\s*[日号])?/g,
  /\d{1,2}\s*[日号]/g,
  /\b\d{1,2}(?:st|nd|rd|th)\b/gi,
]

/**
 * prefix currency · integer (optionally comma-grouped) · fraction · scale suffix · unit.
 * ASCII-only lookarounds so "缴486.20元" is still read, while "iPhone15", "Q4" and "T3" are not.
 */
const NUMBER_RE =
  /(?<![A-Za-z0-9_.])(HK\$|S\$|A\$|RM|Rp|¥|￥|\$|€|£)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?!\d)(?:\.(\d+))?(?![.,]\d)(?:\s?(万|千|亿)|(k|w|m|bn)(?![A-Za-z]))?\s?(%|percent\b|pct\b|元|块|yuan\b|rmb\b|cny\b)?(?![A-Za-z0-9])/gi

const SCALE: Record<string, number> = { k: 1e3, 千: 1e3, w: 1e4, 万: 1e4, 亿: 1e8, m: 1e6, bn: 1e9 }
const CURRENCY_WORDS = new Set(['元', '块', 'yuan', 'rmb', 'cny'])
const PERCENT_WORDS = new Set(['%', 'percent', 'pct'])
const MAX_POOL = 250_000
const MAX_DEPTH = 24

/** Every number written in `text` (dates, times and ordinals removed). */
export function extractNumbers(text: string): NumberToken[] {
  let masked = typeof text === 'string' ? text : String(text ?? '')
  for (const re of DATE_PATTERNS) masked = masked.replace(re, (m) => ' '.repeat(m.length))
  const out: NumberToken[] = []
  for (const m of masked.matchAll(NUMBER_RE)) {
    const [raw, symbol, int, frac = '', cjkScale, latinScale, unitWord] = m
    const scaleKey = (cjkScale ?? latinScale ?? '').toLowerCase()
    const unitKey = (unitWord ?? '').toLowerCase()
    const currency = !!symbol || CURRENCY_WORDS.has(unitKey)
    // "30m" is more likely minutes than millions unless it is clearly money
    if ((scaleKey === 'm' || scaleKey === 'bn') && !currency) continue
    const multiplier = SCALE[scaleKey] ?? 1
    out.push({
      raw: raw.trim(),
      value: Number(`${int.replace(/,/g, '')}${frac ? `.${frac}` : ''}`) * multiplier,
      unit: 10 ** -frac.length * multiplier,
      currency,
      percent: PERCENT_WORDS.has(unitKey),
      scaled: multiplier !== 1,
      grouped: int.includes(','),
      decimals: frac.length,
    })
  }
  return out
}

/**
 * Numeric grounding check (anti-hallucination): every money amount / percentage / count in an assistant
 * reply must trace back to a number present in the tool results of that turn (after normalising minor →
 * major units, thousands separators, k/w suffixes, rounding to 0 or 1 decimals, and percent ↔ fraction).
 * Small integers <= 31 (dates/days), years 2000–2100 and numbers inside dates are ignored.
 * A displayed number matches a source value when the source rounds OR truncates to it at the displayed
 * precision ("3.4k" covers 3,350–3,499.99; "38%" covers 37.5–38.99).
 */
export function checkGrounding(reply: string, sources: unknown[], currency: Currency): GroundingReport {
  const pool = buildPool(sources, MINOR_PER_MAJOR[currency] ?? 100)
  const tokens = extractNumbers(reply).filter(isCheckable)
  const ungrounded: string[] = []
  for (const t of tokens) if (!isGrounded(t, pool) && !ungrounded.includes(t.raw)) ungrounded.push(t.raw)
  return { ok: ungrounded.length === 0, checked: tokens.length, ungrounded }
}

function isCheckable(t: NumberToken): boolean {
  if (t.value === 0) return false
  const plainInteger = !t.scaled && t.decimals === 0
  if (plainInteger && t.value <= 31) return false
  const looksLikeYear = plainInteger && !t.grouped && !t.currency && !t.percent && t.value >= 2000 && t.value <= 2100
  return !looksLikeYear
}

function isGrounded(t: NumberToken, pool: Float64Array): boolean {
  const eps = 1e-9 * Math.max(1, t.value)
  const lo = t.value - t.unit / 2 - eps
  const hi = t.value + t.unit - eps
  const i = lowerBound(pool, lo)
  return i < pool.length && pool[i] <= hi
}

/** All candidate values a source number could be displayed as (raw, minor → major, fraction ↔ percent). */
function buildPool(sources: unknown[], minorPerMajor: number): Float64Array {
  const values: number[] = []
  const push = (n: number) => {
    if (!Number.isFinite(n) || values.length >= MAX_POOL) return
    const a = Math.abs(n)
    values.push(a, a / 100)
    if (minorPerMajor !== 1 && minorPerMajor !== 100) values.push(a / minorPerMajor)
    if (a <= 10) values.push(a * 100)
  }
  const seen = new WeakSet<object>()
  const visit = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) return
    if (typeof v === 'number') push(v)
    else if (typeof v === 'string') for (const t of extractNumbers(v)) push(t.value)
    else if (v && typeof v === 'object') {
      if (seen.has(v)) return
      seen.add(v)
      for (const item of Array.isArray(v) ? v : Object.values(v)) visit(item, depth + 1)
    }
  }
  visit(sources, 0)
  return Float64Array.from(values).sort()
}

function lowerBound(arr: Float64Array, x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}
