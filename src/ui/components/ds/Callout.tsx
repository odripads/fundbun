import { Info, OctagonAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import styles from './Callout.module.css'

export type CalloutTone = 'info' | 'warn' | 'block' | 'safe'

export interface CalloutProps {
  tone?: CalloutTone
  title?: ReactNode
  children?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

const ICON: Record<CalloutTone, ReactNode> = {
  info: <Info />,
  warn: <TriangleAlert />,
  block: <OctagonAlert />,
  safe: <ShieldCheck />,
}

/** Inline notice (maps to the chat 'notice' card levels; 'safe' = a security control that worked). */
export function Callout({ tone = 'info', title, children, icon, action, className }: CalloutProps) {
  return (
    <div className={cx(styles.callout, styles[tone], className)} role={tone === 'block' ? 'alert' : undefined}>
      <span className={styles.icon} aria-hidden="true">{icon ?? ICON[tone]}</span>
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children ? <div className={styles.text}>{children}</div> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
    </div>
  )
}
