import type { Currency, Minor } from '../../../core/types'
import { cx } from './cx'
import { moneyParts, moneyToneFor, type MoneyTone } from './moneyParts'
import styles from './Money.module.css'

export type MoneySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero'

export interface MoneyProps {
  /** integer minor units */
  amount: Minor
  currency?: Currency
  /** 12.3k style (the full amount is still announced to screen readers) */
  compact?: boolean
  decimals?: boolean
  /** prefix + on positive amounts */
  signed?: boolean
  tone?: MoneyTone
  size?: MoneySize
  /** Fraunces display face; default on for lg and up */
  display?: boolean
  /** equal-width digits for aligned columns; default on for md and smaller */
  tabular?: boolean
  strike?: boolean
  className?: string
}

const DISPLAY_SIZES: MoneySize[] = ['lg', 'xl', 'hero']

/** A formatted amount (uses money.fmt). Display sizes typeset the symbol and decimals smaller. */
export function Money({ amount, currency = 'CNY', compact, decimals, signed, tone = 'neutral', size = 'md', display, tabular, strike, className }: MoneyProps) {
  const parts = moneyParts(amount, currency, { compact, decimals, signed })
  const big = DISPLAY_SIZES.includes(size)
  const useDisplay = display ?? big
  const useTabular = tabular ?? !big
  const color = moneyToneFor(amount, tone)
  return (
    <span
      className={cx(styles.money, styles[size], styles[color], useDisplay && styles.display, useTabular && styles.tabular, strike && styles.strike, className)}
      data-amount={amount}
    >
      <span className="sr-only">{parts.spoken}</span>
      <span aria-hidden="true" className={styles.inner}>
        {parts.sign ? <span className={styles.sign}>{parts.sign}</span> : null}
        {parts.symbol ? <span className={cx(big && styles.symbol)}>{parts.symbol}</span> : null}
        <span>{parts.whole}</span>
        {parts.fraction ? <span className={cx(big && !compact && styles.fraction)}>{parts.fraction}</span> : null}
        {parts.suffix ? <span className={cx(big && styles.suffix)}>{parts.suffix}</span> : null}
      </span>
    </span>
  )
}
