import { ArrowLeftRight, Ban, CreditCard, Eye, ListChecks, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tier } from '../../../core/types'
import { cx } from './cx'
import styles from './Badge.module.css'

export type BadgeVariant = 'neutral' | 'accent' | 'over' | 'under' | 'warn' | 'info' | 'ai' | 'outline' | 'solid'

export interface BadgeProps {
  variant?: BadgeVariant
  size?: 'sm' | 'md'
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}

/** Small status label. Colour is never the only cue: badges always carry text (and usually an icon). */
export function Badge({ variant = 'neutral', size = 'md', icon, children, className, title }: BadgeProps) {
  return (
    <span className={cx(styles.badge, styles[variant], styles[size], className)} title={title}>
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  )
}

export type AgentEngine = 'offline' | 'llm'

export const ENGINE_LABEL: Record<AgentEngine, string> = {
  offline: 'On-device',
  llm: 'LLM',
}

export interface AiBadgeProps {
  /** which engine produced the content (CN AI-content labelling: show it on every agent message) */
  engine?: AgentEngine
  size?: 'sm' | 'md'
  className?: string
}

export function AiBadge({ engine, size = 'sm', className }: AiBadgeProps) {
  const label = engine ? `AI-generated · ${ENGINE_LABEL[engine]}` : 'AI-generated'
  return (
    <span className={cx(styles.badge, styles.ai, styles[size], className)} title={label} aria-label={label} role="img">
      <span className={styles.icon} aria-hidden="true"><Sparkles /></span>
      <span aria-hidden="true">AI{engine ? <span className={styles.engine}>{ENGINE_LABEL[engine]}</span> : null}</span>
    </span>
  )
}

export interface TierInfo {
  short: string
  label: string
  description: string
  icon: ReactNode
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  0: { short: 'T0', label: 'Read', description: 'Reads data and explains it. Always allowed.', icon: <Eye /> },
  1: { short: 'T1', label: 'Organize', description: 'Budgets, tripwires, categories. Reversible, no money moves.', icon: <ListChecks /> },
  2: { short: 'T2', label: 'Move own money', description: 'Between your own accounts and goal pots, within your caps.', icon: <ArrowLeftRight /> },
  3: { short: 'T3', label: 'Pay & cancel', description: 'Verified payees only. Always needs your tap and PIN.', icon: <CreditCard /> },
  4: { short: 'T4', label: 'Prohibited', description: 'New payees, external transfers, credit, own permissions. Never allowed.', icon: <Ban /> },
}

export interface TierBadgeProps {
  tier: Tier
  /** show the tier name next to the code (default true) */
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function TierBadge({ tier, showLabel = true, size = 'md', className }: TierBadgeProps) {
  const info = TIER_INFO[tier]
  return (
    <span
      className={cx(styles.badge, styles.tier, styles[`tier${tier}`], styles[size], className)}
      title={`${info.short} ${info.label}: ${info.description}`}
      data-tier={tier}
    >
      <span className={styles.icon} aria-hidden="true">{info.icon}</span>
      <span className={styles.tierCode}>{info.short}</span>
      {showLabel ? <span>{info.label}</span> : <span className="sr-only">{info.label}</span>}
    </span>
  )
}
