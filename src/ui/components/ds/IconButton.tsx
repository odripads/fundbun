import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import styles from './IconButton.module.css'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** accessible name — required because the button has no visible text */
  label: string
  icon: ReactNode
  variant?: 'ghost' | 'secondary' | 'primary' | 'glass'
  size?: 'sm' | 'md' | 'lg'
  /** true → a dot; a number → a count (hidden when 0) */
  badge?: boolean | number
}

export function badgeText(badge: boolean | number | undefined): string | null {
  if (badge === true) return ''
  if (typeof badge === 'number' && badge > 0) return badge > 9 ? '9+' : String(badge)
  return null
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', badge, className, type = 'button', ...rest }: IconButtonProps) {
  const text = badgeText(badge)
  const name = text === null ? label : `${label} (${text === '' ? 'new' : text})`
  return (
    <button {...rest} type={type} aria-label={name} title={label} className={cx(styles.button, styles[variant], styles[size], className)}>
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      {text !== null ? <span className={cx(styles.badge, text === '' && styles.dot)} aria-hidden="true">{text}</span> : null}
    </button>
  )
}
