import { ChevronRight } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cx } from './cx'
import styles from './ListItem.module.css'

export interface ListProps extends ComponentProps<'ul'> {
  /** inset dividers between rows (default true) */
  dividers?: boolean
  /** wrap the list in a card surface */
  card?: boolean
}

export function List({ dividers = true, card = false, className, ...rest }: ListProps) {
  return <ul role="list" {...rest} className={cx(styles.list, dividers && styles.dividers, card && styles.card, className)} />
}

export interface ListItemProps {
  /** icon, emoji avatar, merchant logo or <DreamImage/> */
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** e.g. <Money/>; aligned right */
  trailing?: ReactNode
  /** small text under the trailing element (date, status) */
  meta?: ReactNode
  onClick?: () => void
  href?: string
  /** show a chevron (default: when interactive) */
  chevron?: boolean
  disabled?: boolean
  /** accessible name override for interactive rows */
  ariaLabel?: string
  className?: string
}

/** One row of a List (renders <li>). Interactive rows are a single button/link covering the whole row. */
export function ListItem({ leading, title, subtitle, trailing, meta, onClick, href, chevron, disabled, ariaLabel, className }: ListItemProps) {
  const interactive = Boolean(onClick || href)
  const showChevron = chevron ?? interactive
  const body = (
    <>
      {leading ? <span className={styles.leading} aria-hidden={typeof leading === 'string' ? true : undefined}>{leading}</span> : null}
      <span className={styles.main}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {trailing || meta ? (
        <span className={styles.trailing}>
          {trailing}
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
      ) : null}
      {showChevron ? <ChevronRight className={styles.chevron} aria-hidden="true" /> : null}
    </>
  )
  const cls = cx(styles.row, interactive && styles.interactive)
  return (
    <li className={cx(styles.item, className)}>
      {href ? (
        <a className={cls} href={href} aria-label={ariaLabel} aria-disabled={disabled || undefined}>{body}</a>
      ) : onClick ? (
        <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}
