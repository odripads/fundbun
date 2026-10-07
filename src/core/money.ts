import type { Currency, Minor } from './types'

export const CURRENCY_SYMBOL: Record<Currency, string> = {
  CNY: '¥', USD: '$', EUR: '€', GBP: '£', HKD: 'HK$', SGD: 'S$', JPY: '¥', IDR: 'Rp', MYR: 'RM', AUD: 'A$',
}

/** minor units per major unit */
export const MINOR_PER_MAJOR: Record<Currency, number> = {
  CNY: 100, USD: 100, EUR: 100, GBP: 100, HKD: 100, SGD: 100, JPY: 1, IDR: 100, MYR: 100, AUD: 100,
}

export function toMinor(major: number, currency: Currency = 'CNY'): Minor {
  return Math.round(major * MINOR_PER_MAJOR[currency])
}

export function toMajor(minor: Minor, currency: Currency = 'CNY'): number {
  return minor / MINOR_PER_MAJOR[currency]
}

export interface FmtOptions {
  /** show decimals; default: only when the amount has a fractional part */
  decimals?: boolean
  /** prefix + for positive numbers */
  signed?: boolean
  /** 12.3k style */
  compact?: boolean
  /** omit currency symbol */
  bare?: boolean
}

/** Format minor units for display, e.g. fmt(345000) → "¥3,450". Uses the absolute value unless `signed`. */
export function fmt(minor: Minor, currency: Currency = 'CNY', opts: FmtOptions = {}): string {
  const major = toMajor(Math.abs(minor), currency)
  const sym = opts.bare ? '' : CURRENCY_SYMBOL[currency]
  const sign = minor < 0 ? '−' : opts.signed && minor > 0 ? '+' : ''
  let body: string
  if (opts.compact && major >= 10_000) {
    body = major >= 1_000_000
      ? `${trimZero((major / 1_000_000).toFixed(1))}M`
      : `${trimZero((major / 1_000).toFixed(major >= 100_000 ? 0 : 1))}k`
  } else {
    const showDecimals = opts.decimals ?? (MINOR_PER_MAJOR[currency] > 1 && Math.round(major * 100) % 100 !== 0)
    body = major.toLocaleString('en-US', {
      minimumFractionDigits: showDecimals ? 2 : 0,
      maximumFractionDigits: showDecimals ? 2 : 0,
    })
  }
  return `${sign}${sym}${body}`
}

function trimZero(s: string): string {
  return s.replace(/\.0$/, '')
}

/**
 * Parse a user-typed amount into minor units. Accepts "¥2,000", "2000元", "2k", "1.5w", "1.2万",
 * "$49.99", "RMB 300", "300 yuan", "3 thousand". Returns null when no amount is present.
 */
export function parseAmount(text: string, currency: Currency = 'CNY'): Minor | null {
  const t = text.replace(/，/g, ',').toLowerCase()
  const re = /(?:¥|￥|\$|€|£|rmb|cny|usd|rp|rm)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|w|万|千|thousand|grand|m|million)?\s*(?:元|块|yuan|rmb|cny|kuai|dollars?|bucks?)?/i
  const m = t.match(re)
  if (!m) return null
  const int = m[1].replace(/,/g, '')
  const frac = m[2] ?? ''
  let major = Number(`${int}${frac ? '.' + frac : ''}`)
  if (!Number.isFinite(major)) return null
  const suffix = m[3]
  if (suffix === 'k' || suffix === '千' || suffix === 'thousand' || suffix === 'grand') major *= 1_000
  if (suffix === 'w' || suffix === '万') major *= 10_000
  if (suffix === 'm' || suffix === 'million') major *= 1_000_000
  return toMinor(major, currency)
}

/** Sum helper that keeps integer arithmetic. */
export function sum(values: Minor[]): Minor {
  let s = 0
  for (const v of values) s += v
  return s
}

/** Round a minor amount to the nearest whole major unit (e.g. nearest yuan). */
export function roundMajor(minor: Minor, currency: Currency = 'CNY'): Minor {
  const k = MINOR_PER_MAJOR[currency]
  return Math.round(minor / k) * k
}
