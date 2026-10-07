import type { CSSProperties } from 'react'
import { cx } from '../ds/cx'
import { BunMascot } from './BunMascot'
import styles from './Logo.module.css'

export interface LogoProps {
  size?: number
  withWordmark?: boolean
  className?: string
  /** idle blink/breathe on the mark (still under reduced motion) */
  animated?: boolean
}

export const BRAND_NAME = 'FundBun'

/** The mark, optionally with the Fraunces wordmark ("Fund" in ink, "Bun" in yuan gold). Announced once as "FundBun". */
export function Logo({ size = 32, withWordmark = false, className, animated = true }: LogoProps) {
  const px = Number.isFinite(size) && size > 0 ? size : 32
  return (
    <span className={cx(styles.logo, className)} style={{ '--logo-size': `${px}px` } as CSSProperties} role="img" aria-label={BRAND_NAME}>
      <BunMascot size={px} animated={animated} className={styles.mark} />
      {withWordmark ? (
        <span className={styles.word} aria-hidden="true">
          Fund<span className={styles.bun}>Bun</span>
        </span>
      ) : null}
    </span>
  )
}
