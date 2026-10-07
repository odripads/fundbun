import { Check } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import styles from './Checkbox.module.css'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
  required?: boolean
  className?: string
}

/** Native checkbox with a large tappable row — consent rows are never pre-ticked by the caller. */
export function Checkbox({ checked, onChange, label, description, disabled, required, className }: CheckboxProps) {
  const id = useId()
  const descId = useId()
  return (
    <label htmlFor={id} className={cx(styles.row, disabled && styles.disabled, className)}>
      <span className={styles.box}>
        <input
          id={id}
          type="checkbox"
          className={styles.input}
          checked={checked}
          disabled={disabled}
          required={required}
          aria-describedby={description ? descId : undefined}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
        <span className={styles.mark} aria-hidden="true"><Check /></span>
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description ? <span id={descId} className={styles.description}>{description}</span> : null}
      </span>
    </label>
  )
}
