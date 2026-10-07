import { useId, type ReactNode } from 'react'
import { cx } from './cx'
import styles from './Slider.module.css'

export interface SliderStep<T extends string | number> {
  value: T
  label: string
  /** one-line explanation of this stop, shown under the slider when selected */
  hint?: string
}

export interface SliderProps<T extends string | number> {
  steps: SliderStep<T>[]
  value: T
  onChange: (value: T) => void
  label: ReactNode
  /** accessible name when the label is not plain text */
  ariaLabel?: string
  description?: ReactNode
  disabled?: boolean
  /** colour warms from jade to chili as the index rises (autonomy, risk) */
  risk?: boolean
  className?: string
}

/** Position of stop `i` of `n` along the track, 0..100. */
export function stopPercent(i: number, n: number): number {
  return n <= 1 ? 0 : (i / (n - 1)) * 100
}

/** Discrete slider with labelled stops (e.g. the autonomy dial). A native range input underneath = full a11y. */
export function Slider<T extends string | number>({ steps, value, onChange, label, ariaLabel, description, disabled, risk = false, className }: SliderProps<T>) {
  const labelId = useId()
  const hintId = useId()
  const n = steps.length
  const index = Math.max(0, steps.findIndex((s) => s.value === value))
  const current = steps[index]
  const pct = stopPercent(index, n)
  const riskLevel = n <= 1 ? 0 : index / (n - 1)

  return (
    <div
      className={cx(styles.root, risk && styles.risk, disabled && styles.disabled, className)}
      style={{ ['--pct' as string]: `${pct}%`, ['--risk' as string]: riskLevel }}
    >
      <div className={styles.head}>
        <span id={labelId} className={styles.label}>{label}</span>
        {current ? <span className={styles.current}>{current.label}</span> : null}
      </div>
      {description ? <p className={styles.description}>{description}</p> : null}
      <div className={styles.control}>
        <div className={styles.rail} aria-hidden="true">
          <span className={styles.fill} />
          {steps.map((s, i) => (
            <span key={String(s.value)} className={cx(styles.tick, i <= index && styles.tickOn)} style={{ left: `${stopPercent(i, n)}%` }} />
          ))}
        </div>
        <input
          type="range"
          className={styles.input}
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={index}
          disabled={disabled}
          aria-labelledby={typeof label === 'string' ? labelId : undefined}
          aria-label={typeof label === 'string' ? undefined : ariaLabel}
          aria-valuetext={current ? `${current.label}${current.hint ? `: ${current.hint}` : ''}` : undefined}
          aria-describedby={current?.hint ? hintId : undefined}
          onChange={(e) => {
            const next = steps[Number(e.currentTarget.value)]
            if (next && next.value !== value) onChange(next.value)
          }}
        />
      </div>
      <div className={styles.stops} aria-hidden="true">
        {steps.map((s, i) => (
          <button
            key={String(s.value)}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className={cx(styles.stop, i === index && styles.stopOn, i === 0 && styles.first, i === n - 1 && styles.last)}
            style={{ left: `${stopPercent(i, n)}%` }}
            onClick={() => s.value !== value && onChange(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {current?.hint ? <p id={hintId} className={styles.hint}>{current.hint}</p> : null}
    </div>
  )
}
