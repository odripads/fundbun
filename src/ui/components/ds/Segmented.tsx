import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { rovingIndex } from './roving'
import styles from './Segmented.module.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** accessible group name */
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/** A single-choice switcher (radio group semantics, arrow keys move and select). */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', className }: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const index = Math.max(0, options.findIndex((o) => o.value === value))

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = rovingIndex(index, e.key, options.length, (i) => Boolean(options[i].disabled))
    if (next === null) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.root, styles[size], className)}
      style={{ ['--seg-n' as string]: options.length, ['--seg-i' as string]: index }}
      onKeyDown={onKeyDown}
    >
      <span className={styles.thumb} aria-hidden="true" />
      {options.map((o, i) => {
        const checked = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            className={cx(styles.option, checked && styles.checked)}
            onClick={() => onChange(o.value)}
          >
            {o.icon ? <span className={styles.icon} aria-hidden="true">{o.icon}</span> : null}
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
