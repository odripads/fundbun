import { fmt } from '../../../../core/money'
import type { Currency } from '../../../../core/types'

export type ValueFormat = (value: number) => string

/** Charts show money by default; pass `format` for counts or percentages. */
export function moneyFormat(currency: Currency = 'CNY', compact = false): ValueFormat {
  return (v) => fmt(Math.round(v), currency, { compact })
}
