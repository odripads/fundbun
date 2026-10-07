import { useId, type ComponentProps, type ReactNode } from 'react'
import { cx } from './cx'
import styles from './TextField.module.css'

interface FieldChrome {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** inside the field, before the value (e.g. the currency symbol) */
  prefix?: ReactNode
  suffix?: ReactNode
  /** hide the label visually but keep it for screen readers */
  hideLabel?: boolean
  className?: string
}

export type TextFieldProps = FieldChrome & Omit<ComponentProps<'input'>, 'prefix'> & { multiline?: false }
export type TextAreaProps = FieldChrome & ComponentProps<'textarea'> & { multiline: true }

/** Labelled input (or textarea with `multiline`) with hint, error and prefix/suffix slots. */
export function TextField(props: TextFieldProps | TextAreaProps) {
  const { label, hint, error, prefix, suffix, hideLabel, className, id: idProp, multiline, ...rest } = props
  const auto = useId()
  const id = idProp ?? auto
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, className: styles.input }
  return (
    <div className={cx(styles.field, Boolean(error) && styles.invalid, className)}>
      <label htmlFor={id} className={cx(styles.label, hideLabel && 'sr-only')}>{label}</label>
      <div className={cx(styles.box, multiline && styles.multiline)}>
        {prefix ? <span className={styles.affix} aria-hidden="true">{prefix}</span> : null}
        {multiline ? (
          <textarea {...(rest as ComponentProps<'textarea'>)} {...common} />
        ) : (
          <input {...(rest as ComponentProps<'input'>)} {...common} />
        )}
        {suffix ? <span className={styles.affix}>{suffix}</span> : null}
      </div>
      {error ? <p id={errorId} className={styles.error}>{error}</p> : hint ? <p id={hintId} className={styles.hint}>{hint}</p> : null}
    </div>
  )
}
