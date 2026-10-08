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

/** From this many major units (¥100) up, amounts in prose drop their cents. */
export const COPY_WHOLE_FROM_MAJOR = 100

/**
 * Money for human copy (mirror lines, tripwire and insight text, chat replies): whole units once the absolute
 * amount reaches ¥100 ("¥2,580 over", "¥12,080 spent"), cents kept below that ("¥28.50"). Rounds to the
 * nearest unit, so the grounding check (which allows display rounding) still traces it to the exact source.
 * Use plain `fmt` for exact figures: one bill or transaction (¥486.20), line items, and tables or cards
 * where precision matters.
 */
export function fmtCopy(minor: Minor, currency: Currency = 'CNY', opts: Omit<FmtOptions, 'decimals'> = {}): string {
  if (Math.abs(toMajor(minor, currency)) < COPY_WHOLE_FROM_MAJOR) return fmt(minor, currency, opts)
  return fmt(roundMajor(minor, currency), currency, { ...opts, decimals: false })
}

/**
 * Magnitude suffixes. Single letters only count written directly after the digits ("2k", "1.5w", "5m", "5mn"),
 * words may follow a space ("3 thousand", "2 grand", "5 million"); either way the suffix must end at a
 * non-letter, so "save 500 more", "1 week", "500 with bun" and "2kg" keep their plain number.
 */
const AMOUNT_RE = new RegExp(
  '(?:¥|￥|\\$|€|£|rmb|cny|usd|rp|rm)?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d+))?' +
    '(?:(k|w|mn|m)(?![a-z])|\\s*(万|千)|\\s*(k|thousand|grand|million)(?![a-z]))?' +
    '\\s*(?:元|块|yuan|rmb|cny|kuai|dollars?|bucks?)?',
  'i',
)

const MULTIPLIER: Record<string, number> = {
  k: 1_000, 千: 1_000, thousand: 1_000, grand: 1_000,
  w: 10_000, 万: 10_000,
  m: 1_000_000, mn: 1_000_000, million: 1_000_000,
}

/**
 * Parse a user-typed amount into minor units. Accepts "¥2,000", "2000元", "2k", "1.5w", "1.2万",
 * "$49.99", "RMB 300", "300 yuan", "3 thousand", "5m". Returns null when no amount is present.
 */
export function parseAmount(text: string, currency: Currency = 'CNY'): Minor | null {
  const t = text.replace(/，/g, ',').toLowerCase()
  const m = t.match(AMOUNT_RE)
  if (!m) return null
  const int = m[1].replace(/,/g, '')
  const frac = m[2] ?? ''
  let major = Number(`${int}${frac ? '.' + frac : ''}`)
  if (!Number.isFinite(major)) return null
  const suffix = m[3] ?? m[4] ?? m[5]
  if (suffix) major *= MULTIPLIER[suffix]
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
