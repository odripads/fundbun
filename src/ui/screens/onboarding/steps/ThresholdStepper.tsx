import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { CURRENCY_SYMBOL, parseAmount } from '../../../../core/money'
import type { Currency } from '../../../../core/types'
import { priceText } from '../../../components/dreams'
import { cx } from '../../../components/ds'
import type { ThresholdRange } from '../logic'
import styles from './ThresholdStepper.module.css'

export interface ThresholdStepperProps {
  id: string
  /** accessible name of the number field */
  label: string
  value: number
  /** pct: a whole percent · money: minor units */
  unit: 'pct' | 'money'
  currency: Currency
  range: ThresholdRange
  onChange: (value: number) => void
  invalid?: boolean
  describedBy?: string
}

export function clampTo(value: number, range: ThresholdRange): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)))
}

/** − [ value ] + : quick nudges by a sensible step, or type an exact number (applied on blur / Enter). */
export function ThresholdStepper({ id, label, value, unit, currency, range, onChange, invalid, describedBy }: ThresholdStepperProps) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (unit === 'pct' ? String(value) : priceText(value, currency))

  function commit() {
    if (text === null) return
    const parsed = unit === 'pct' ? Number.parseInt(text.replace(/[^\d]/g, ''), 10) : parseAmount(text, currency)
    setText(null)
    if (parsed === null || !Number.isFinite(parsed)) return
    onChange(clampTo(parsed, range))
  }

  const nudge = (dir: 1 | -1) => {
    setText(null)
    onChange(clampTo(value + dir * range.step, range))
  }

  return (
    <div className={cx(styles.stepper, invalid && styles.invalid)}>
      <button type="button" className={styles.btn} onClick={() => nudge(-1)} disabled={value <= range.min} aria-label={`Lower: ${label}`}>
        <Minus aria-hidden="true" />
      </button>
      {/* a label, so the whole 64×44 box focuses the field (the digits alone are a ~25px target) */}
      <label className={styles.box} htmlFor={id}>
        {unit === 'money' ? <span className={styles.affix} aria-hidden="true">{CURRENCY_SYMBOL[currency]}</span> : null}
        <input
          id={id}
          className={styles.input}
          inputMode={unit === 'pct' ? 'numeric' : 'decimal'}
          value={shown}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          size={Math.max(2, shown.length)}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
        />
        {unit === 'pct' ? <span className={styles.affix} aria-hidden="true">%</span> : null}
      </label>
      <button type="button" className={styles.btn} onClick={() => nudge(1)} disabled={value >= range.max} aria-label={`Raise: ${label}`}>
        <Plus aria-hidden="true" />
      </button>
    </div>
  )
}
