import type { ComponentProps, MouseEvent, ReactNode } from 'react'
import { cx } from './cx'
import { Spinner } from './Spinner'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** shows a spinner, keeps the label (no layout jump) and ignores clicks while true */
  loading?: boolean
  iconStart?: ReactNode
  iconEnd?: ReactNode
  fullWidth?: boolean
}

export type ButtonProps = CommonProps & ComponentProps<'button'> & { href?: undefined }
export type LinkButtonProps = CommonProps & ComponentProps<'a'> & { href: string }

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', fullWidth = false, extra?: string): string {
  return cx(styles.button, styles[variant], styles[size], fullWidth && styles.full, extra)
}

function Content({ loading, iconStart, iconEnd, children }: Pick<CommonProps, 'loading' | 'iconStart' | 'iconEnd'> & { children?: ReactNode }) {
  return (
    <>
      {loading ? <Spinner size={18} className={styles.icon} /> : iconStart ? <span className={styles.icon} aria-hidden="true">{iconStart}</span> : null}
      {children != null && children !== false ? <span className={styles.label}>{children}</span> : null}
      {iconEnd && !loading ? <span className={styles.icon} aria-hidden="true">{iconEnd}</span> : null}
    </>
  )
}

/** The one button. Verb-first labels ("Move ¥300 to Birkin"), never Yes/No. Pass `href` for a link. */
export function Button(props: ButtonProps | LinkButtonProps) {
  const { variant = 'primary', size = 'md', loading = false, iconStart, iconEnd, fullWidth = false, className, children, ...rest } = props
  const cls = buttonClass(variant, size, fullWidth, className)
  if (typeof rest.href === 'string') {
    const anchor = rest as ComponentProps<'a'>
    return (
      <a {...anchor} className={cls} aria-busy={loading || undefined}>
        <Content loading={loading} iconStart={iconStart} iconEnd={iconEnd}>{children}</Content>
      </a>
    )
  }
  const { onClick, type = 'button', disabled, ...button } = rest as ComponentProps<'button'>
  const guarded = (e: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }
  return (
    <button
      {...button}
      type={type}
      disabled={disabled}
      className={cls}
      onClick={guarded}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-loading={loading || undefined}
    >
      <Content loading={loading} iconStart={iconStart} iconEnd={iconEnd}>{children}</Content>
    </button>
  )
}
