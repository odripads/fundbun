import type { ComponentProps, ElementType, ReactNode } from 'react'
import { cx } from './cx'
import styles from './Card.module.css'

export type CardVariant = 'default' | 'raised' | 'sunken' | 'outline' | 'glass' | 'accent' | 'over' | 'under'

export interface CardProps extends Omit<ComponentProps<'div'>, 'title'> {
  variant?: CardVariant
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** element to render; use 'section'/'article' for landmarks, 'li' inside lists */
  as?: ElementType
  /** hover/press affordance for cards that contain a single primary link/button */
  interactive?: boolean
}

export function Card({ variant = 'default', padding = 'md', as: Tag = 'div', interactive = false, className, ...rest }: CardProps) {
  return <Tag {...rest} className={cx(styles.card, styles[variant], styles[`pad-${padding}`], interactive && styles.interactive, className)} />
}

export interface CardHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** e.g. an <AiBadge/> or a "See all" link */
  action?: ReactNode
  icon?: ReactNode
  /** heading level for document outline (default 3) */
  level?: 2 | 3 | 4
  className?: string
}

export function CardHeader({ title, subtitle, action, icon, level = 3, className }: CardHeaderProps) {
  const H = `h${level}` as 'h2' | 'h3' | 'h4'
  return (
    <div className={cx(styles.header, className)}>
      {icon ? <span className={styles.headerIcon} aria-hidden="true">{icon}</span> : null}
      <div className={styles.headerText}>
        <H className={styles.title}>{title}</H>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
