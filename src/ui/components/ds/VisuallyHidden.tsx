import type { ComponentProps } from 'react'
import { cx } from './cx'

/** Content for screen readers only. */
export function VisuallyHidden({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={cx('sr-only', className)} {...rest} />
}
