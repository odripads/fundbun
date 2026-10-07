import { cx } from '../ds/cx'
import styles from './SteamBackdrop.module.css'

/**
 * The brand's ambient layer: faint steam wisps rising off a warm glow, over a whisper of paper grain.
 * Purely decorative; under reduced motion the wisps settle to nothing and only the static glow remains.
 * Variants: 'screen' inside the app column · 'canvas' the desktop stage behind the device · 'page' a full-width page.
 */
export function SteamBackdrop({ variant = 'screen' }: { variant?: 'screen' | 'canvas' | 'page' }) {
  return (
    <div className={cx(styles.steam, styles[variant])} aria-hidden="true">
      <span className={styles.glow} />
      <span className={cx(styles.wisp, styles.w1)} />
      <span className={cx(styles.wisp, styles.w2)} />
      <span className={cx(styles.wisp, styles.w3)} />
      <span className={cx(styles.wisp, styles.w4)} />
      <span className={styles.grain} />
    </div>
  )
}
