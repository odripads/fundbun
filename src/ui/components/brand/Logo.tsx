import type { CSSProperties } from 'react'
import { cx } from '../ds/cx'
import { useShellAppearance } from '../plugins/shellAppearance'
import { BunMascot } from './BunMascot'
import styles from './Logo.module.css'

export interface LogoProps {
  size?: number
  withWordmark?: boolean
  className?: string
  /** idle blink/breathe on the mark (still under reduced motion) */
  animated?: boolean
  /**
   * The name on the wordmark. Left out, it is the name the user chose in Creator Mode (or FundBun). Pass null to
   * force the FundBun wordmark, as the chat card does when it previews a reset.
   */
  appName?: string | null
}

export const BRAND_NAME = 'FundBun'

/**
 * The mark, optionally with the Fraunces wordmark ("Fund" in ink, "Bun" in yuan gold). Announced once as "FundBun".
 * With a custom app name (a Creator Mode shell appearance plugin) the wordmark shows that name, and a small
 * "FundBun" line stays under it so the product behind the name is always in view.
 */
export function Logo({ size = 32, withWordmark = false, className, animated = true, appName }: LogoProps) {
  const px = Number.isFinite(size) && size > 0 ? size : 32
  const stored = useShellAppearance().appName
  const custom = appName === undefined ? stored : appName
  return (
    <span
      className={cx(styles.logo, className)}
      style={{ '--logo-size': `${px}px` } as CSSProperties}
      role="img"
      aria-label={custom ? `${custom} (${BRAND_NAME})` : BRAND_NAME}
      data-app-name={custom ?? undefined}
    >
      <BunMascot size={px} animated={animated} className={styles.mark} />
      {withWordmark ? (
        custom ? (
          <span className={styles.custom} aria-hidden="true">
            <span className={styles.word}>{custom}</span>
            <span className={styles.kernel}>{BRAND_NAME}</span>
          </span>
        ) : (
          <span className={styles.word} aria-hidden="true">
            Fund<span className={styles.bun}>Bun</span>
          </span>
        )
      ) : null}
    </span>
  )
}
