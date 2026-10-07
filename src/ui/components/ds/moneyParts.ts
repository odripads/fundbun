import { CURRENCY_SYMBOL, fmt, type FmtOptions } from '../../../core/money'
import type { Currency, Minor } from '../../../core/types'

export interface MoneyParts {
  sign: '' | '−' | '+'
  symbol: string
  /** integer part with grouping, e.g. "3,450" (or "12" of a compact "12.3k") */
  whole: string
  /** ".20" / ".3" or '' */
  fraction: string
  /** compact suffix: 'k' | 'M' | '' */
  suffix: string
  /** exactly what money.fmt renders */
  text: string
  /** screen-reader text: full precision, spelled-out sign ("minus ¥3,450.20") */
  spoken: string
}

const BODY = /^([\d,]+)(\.\d+)?([kM]?)$/

/** Split a formatted amount so the UI can typeset the symbol and decimals separately. */
export function moneyParts(amount: Minor, currency: Currency = 'CNY', opts: FmtOptions = {}): MoneyParts {
  const text = fmt(amount, currency, opts)
  const sign = text.startsWith('−') ? '−' : text.startsWith('+') ? '+' : ''
  const symbol = opts.bare ? '' : CURRENCY_SYMBOL[currency]
  const body = text.slice(sign.length + symbol.length)
  const m = BODY.exec(body)
  const whole = m ? m[1] : body
  const fraction = m?.[2] ?? ''
  const suffix = m?.[3] ?? ''
  const full = fmt(amount, currency, { ...opts, compact: false, bare: false })
  const fullBody = full.slice(sign.length)
  const spoken = `${sign === '−' ? 'minus ' : sign === '+' ? 'plus ' : ''}${fullBody}`
  return { sign, symbol, whole, fraction, suffix, text, spoken }
}

export type MoneyTone = 'neutral' | 'sign' | 'gain' | 'over' | 'under' | 'muted' | 'accent'

/** Resolve a tone to a concrete colour role. 'sign' colours both directions; 'gain' only money in. */
export function moneyToneFor(amount: Minor, tone: MoneyTone): 'neutral' | 'over' | 'under' | 'muted' | 'accent' {
  if (tone === 'sign') return amount > 0 ? 'under' : amount < 0 ? 'over' : 'neutral'
  if (tone === 'gain') return amount > 0 ? 'under' : 'neutral'
  return tone
}
