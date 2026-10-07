import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import styles from './Toggle.module.css'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** visible label (also the accessible name) */
  label?: ReactNode
  /** accessible name when there's no visible label */
  ariaLabel?: string
  description?: ReactNode
  disabled?: boolean
  /** tone of the "on" state: accent for features, over for risky switches (e.g. autopilot) */
  tone?: 'accent' | 'under' | 'over'
  className?: string
}

/** An on/off switch (role="switch"). With a label it renders a full-width, tappable settings row. */
export function Toggle({ checked, onChange, label, ariaLabel, description, disabled, tone = 'under', className }: ToggleProps) {
  const labelId = useId()
  const descId = useId()
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      className={cx(styles.switch, styles[tone])}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} aria-hidden="true" />
    </button>
  )
  if (!label) return <span className={className}>{sw}</span>
  return (
    <div className={cx(styles.row, disabled && styles.disabled, className)} onClick={(e) => {
      if (!disabled && !(e.target as HTMLElement).closest('button')) onChange(!checked)
    }}>
      <div className={styles.text}>
        <span id={labelId} className={styles.label}>{label}</span>
        {description ? <span id={descId} className={styles.description}>{description}</span> : null}
      </div>
      {sw}
    </div>
  )
}
