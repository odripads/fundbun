import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import styles from './Chip.module.css'

export interface ChipProps extends Omit<ComponentProps<'button'>, 'onClick'> {
  icon?: ReactNode
  /** toggle chips (filters): sets aria-pressed */
  selected?: boolean
  /** clickable chip (quick replies, filters); without it the chip is static text */
  onClick?: () => void
  /** shows a remove button */
  onRemove?: () => void
  removeLabel?: string
  tone?: 'default' | 'accent' | 'over' | 'under' | 'ai'
  size?: 'sm' | 'md'
}

/** Quick replies, filters and "why?" evidence chips ("Dining ¥1,240 vs ¥900"). */
export function Chip({ icon, selected, onClick, onRemove, removeLabel, tone = 'default', size = 'md', className, children, disabled, ...rest }: ChipProps) {
  const cls = cx(styles.chip, styles[tone], styles[size], selected && styles.selected, onClick && !onRemove && styles.interactive, className)
  const body = (
    <>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.text}>{children}</span>
    </>
  )
  if (onRemove) {
    return (
      <span className={cls}>
        {body}
        <button type="button" className={styles.remove} onClick={onRemove} disabled={disabled} aria-label={removeLabel ?? `Remove ${typeof children === 'string' ? children : 'item'}`}>
          <X aria-hidden="true" />
        </button>
      </span>
    )
  }
  if (!onClick) return <span className={cls}>{body}</span>
  return (
    <button {...rest} type="button" className={cls} onClick={onClick} disabled={disabled} aria-pressed={selected === undefined ? undefined : selected}>
      {body}
    </button>
  )
}
