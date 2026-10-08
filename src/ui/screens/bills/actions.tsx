/**
 * Action buttons for the Bills screen. Every money/organise action goes through useProposeAction, so the
 * policy engine (tier, mandate caps, taint, verified payee) decides — the UI never executes anything itself.
 */
import { LockKeyhole } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { toolTier } from '../../../core/agent/specs'
import type { PendingAction, SuggestedAction } from '../../../core/types'
import { openApproval, useProposeAction } from '../../components/agent'
import { Button, cx, type ButtonSize, type ButtonVariant } from '../../components/ds'
import { findPending } from './billsView'
import styles from './actions.module.css'

/** propose() plus a per-button loading key, so only the tapped button spins (the others stay usable). */
export function useActionRunner() {
  const propose = useProposeAction()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async (key: string, action: SuggestedAction): Promise<PendingAction | undefined> => {
      setBusy(key)
      try {
        return await propose(action)
      } finally {
        setBusy(null)
      }
    },
    [propose],
  )
  return { run, busy }
}

export type ActionRunner = ReturnType<typeof useActionRunner>

export interface ProposeButtonProps {
  action: SuggestedAction
  awaiting: PendingAction[]
  run: (key: string, action: SuggestedAction) => Promise<unknown>
  busy: string | null
  /** stable key for the loading state (defaults to tool + args) */
  busyKey?: string
  label?: ReactNode
  /** accessible name when the visible label is short ("Cancel" → "Cancel iQIYI") */
  ariaLabel?: string
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  fullWidth?: boolean
  disabled?: boolean
  /** show only the icon (the accessible name comes from ariaLabel, or the action label) */
  iconOnly?: boolean
  className?: string
}

export function actionKey(action: SuggestedAction): string {
  return `${action.tool}:${JSON.stringify(action.args)}`
}

/**
 * A button for one SuggestedAction. When the same action is already waiting for approval (the user closed
 * the sheet), it turns into "Review" and reopens that exact pending action instead of proposing a duplicate.
 */
export function ProposeButton({ action, awaiting, run, busy, busyKey, label, ariaLabel, variant = 'primary', size = 'sm', icon, fullWidth, disabled, iconOnly = false, className }: ProposeButtonProps) {
  const pending = findPending(awaiting, action)
  const key = busyKey ?? actionKey(action)
  const cls = cx(iconOnly && styles.iconOnly, className)
  if (pending) {
    const name = `Review and approve: ${pending.preview.title}`
    return (
      <Button
        variant="soft"
        size={size}
        fullWidth={fullWidth}
        className={cls}
        iconStart={<LockKeyhole />}
        onClick={() => openApproval(pending.id)}
        aria-label={name}
        title={iconOnly ? name : undefined}
      >
        {iconOnly ? null : 'Review & approve'}
      </Button>
    )
  }
  const name = ariaLabel ?? (iconOnly ? action.label : undefined)
  return (
    <Button
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      className={cls}
      iconStart={icon}
      loading={busy === key}
      disabled={disabled}
      aria-label={name}
      title={iconOnly ? name : undefined}
      onClick={() => void run(key, action)}
    >
      {iconOnly ? null : label ?? action.label}
    </Button>
  )
}

/** "Needs your PIN" next to T3 actions — the safety rule, said before the tap. */
export function PinHint({ tool, children }: { tool: string; children?: ReactNode }) {
  if (toolTier(tool) !== 3) return null
  return (
    <span className={styles.pinHint}>
      <LockKeyhole aria-hidden="true" />
      <span>{children ?? 'Needs your PIN'}</span>
    </span>
  )
}
