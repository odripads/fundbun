import { cx } from './cx'
import styles from './Spinner.module.css'

export interface SpinnerProps {
  size?: number
  className?: string
  /** announced label; decorative when omitted */
  label?: string
}

/** Three steaming dots — reads as "working" and degrades to static dots under reduced motion. */
export function Spinner({ size = 18, className, label }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, className)}
      style={{ ['--spinner-size' as string]: `${size}px` }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  )
}
