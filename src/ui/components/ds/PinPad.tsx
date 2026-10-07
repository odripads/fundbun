import { Check, Delete } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { applyPinInput, canSubmitPin, keyToPinCommand, pinLengths, type PinInput } from './pinInput'
import styles from './PinPad.module.css'

export interface PinPadProps {
  /** fixed length (4–6): submits automatically when full */
  length?: number
  /** variable length (e.g. choosing a new PIN): a ✓ key submits once minLength is reached */
  minLength?: number
  maxLength?: number
  onComplete: (pin: string) => void
  /** shown below the dots; a new value (or a new errorKey) shakes the dots and clears the entry */
  error?: string | null
  errorKey?: number
  /** verifying: keys disabled, dots pulse */
  busy?: boolean
  disabled?: boolean
  label?: string
  description?: ReactNode
  autoFocus?: boolean
  /** Escape / the Cancel key */
  onCancel?: () => void
  className?: string
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function PinPad({
  length,
  minLength,
  maxLength,
  onComplete,
  error,
  errorKey,
  busy = false,
  disabled = false,
  label = 'Enter your PIN',
  description,
  autoFocus = true,
  onCancel,
  className,
}: PinPadProps) {
  const lengths = pinLengths(length, minLength, maxLength)
  const [digits, setDigits] = useState('')
  const [shake, setShake] = useState(0)
  // the error stays until the user starts typing again
  const [errorVisible, setErrorVisible] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const labelId = useId()
  const errorId = useId()
  const locked = disabled || busy
  const shownError = errorVisible && error ? error : ''

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  useEffect(() => {
    setErrorVisible(Boolean(error))
    if (!error) return
    setDigits('')
    setShake((n) => n + 1)
  }, [error, errorKey])

  function submit(pin: string) {
    if (!canSubmitPin(pin, lengths)) return
    onComplete(pin)
  }

  function input(cmd: PinInput) {
    if (locked) return
    const next = applyPinInput(digits, cmd, lengths.max)
    setDigits(next)
    setErrorVisible(false)
    if (lengths.auto && next.length === lengths.max && next !== digits) submit(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    // Enter/Space on a focused key button is that button's click, not a submit
    if (target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return
    const cmd = keyToPinCommand(e.key)
    if (!cmd) return
    e.preventDefault()
    if (cmd.type === 'submit') {
      if (!locked) submit(digits)
    } else if (cmd.type === 'cancel') {
      onCancel?.()
    } else {
      input(cmd)
    }
  }

  const slots = Array.from({ length: lengths.max }, (_, i) => i)
  const left = !lengths.auto ? (
    <button type="button" className={cx(styles.key, styles.submit)} onClick={() => submit(digits)} disabled={locked || !canSubmitPin(digits, lengths)} aria-label="Confirm PIN">
      <Check aria-hidden="true" />
    </button>
  ) : onCancel ? (
    <button type="button" className={cx(styles.key, styles.text)} onClick={onCancel} disabled={busy}>Cancel</button>
  ) : (
    <span />
  )

  return (
    <div
      ref={rootRef}
      className={cx(styles.root, locked && styles.locked, className)}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={shownError ? errorId : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <p id={labelId} className={styles.label}>{label}</p>
      {description ? <div className={styles.description}>{description}</div> : null}
      <div key={shake} className={cx(styles.dots, shake > 0 && shownError && styles.shake, busy && styles.busy)} aria-hidden="true">
        {slots.map((i) => (
          <span key={i} className={cx(styles.dot, i < digits.length && styles.filled, i >= lengths.min && styles.optional, shownError && styles.dotError)} />
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? 'Checking PIN' : `${digits.length} of ${lengths.auto ? lengths.max : `${lengths.min} to ${lengths.max}`} digits entered`}
      </p>
      <p id={errorId} className={styles.error} role="alert">{shownError}</p>
      <div className={styles.keypad}>
        {KEYS.map((k) => (
          <button key={k} type="button" className={styles.key} onClick={() => input({ type: 'digit', digit: k })} disabled={locked}>
            {k}
          </button>
        ))}
        {left}
        <button type="button" className={styles.key} onClick={() => input({ type: 'digit', digit: '0' })} disabled={locked}>0</button>
        <button type="button" className={cx(styles.key, styles.icon)} onClick={() => input({ type: 'backspace' })} disabled={locked || digits.length === 0} aria-label="Delete last digit">
          <Delete aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
