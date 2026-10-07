import { History, Settings } from 'lucide-react'
import { navigate } from '../../router'
import { useApp, useSnapshot } from '../../state/useApp'
import { cx } from '../ds/cx'
import { IconButton } from '../ds/IconButton'
import { useToast } from '../ds/Toast'
import styles from './ShellActions.module.css'

export type AgentStatus = 'active' | 'paused' | 'breaker'

export function agentStatus(frozen: boolean, breakerTrippedAt?: string): AgentStatus {
  if (!frozen) return 'active'
  return breakerTrippedAt ? 'breaker' : 'paused'
}

const STATUS_TEXT: Record<AgentStatus, string> = {
  active: 'Agent on',
  paused: 'Paused',
  breaker: 'Breaker',
}

/**
 * One-tap kill switch reachable from every screen: pausing is instant and needs no PIN;
 * resuming happens in Settings, where it does.
 */
export function AgentStatusPill() {
  const app = useApp()
  const toast = useToast()
  const status = useSnapshot((s) => agentStatus(s.state.mandate.frozen, s.state.mandate.breakerTrippedAt))
  const active = status === 'active'
  return (
    <button
      type="button"
      className={cx(styles.pill, styles[status])}
      aria-label={active ? 'Agent is on. Pause the agent now (kill switch)' : `Agent is ${status === 'breaker' ? 'stopped by the circuit breaker' : 'paused'}. Open settings to resume`}
      onClick={() => {
        if (!active) {
          navigate('settings')
          return
        }
        app.freeze()
        toast.show({
          id: 'agent-paused',
          tone: 'warn',
          title: 'Agent paused',
          message: 'Bun can only read now. Resume any time in Settings with your PIN.',
          actions: [{ label: 'Open Settings', onClick: () => navigate('settings') }],
        })
      }}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span aria-hidden="true">{STATUS_TEXT[status]}</span>
    </button>
  )
}

export interface ShellActionsProps {
  /** hide the activity/settings shortcuts (e.g. on those screens themselves) */
  compact?: boolean
}

/** The TopBar's right side: kill switch + Activity + Settings. */
export function ShellActions({ compact = false }: ShellActionsProps) {
  const unseen = useSnapshot((s) => s.derived.unseenEvents.length)
  return (
    <>
      <AgentStatusPill />
      {!compact ? (
        <>
          <IconButton label="Activity and audit log" icon={<History />} onClick={() => navigate('activity')} badge={unseen} />
          <IconButton label="Settings" icon={<Settings />} onClick={() => navigate('settings')} />
        </>
      ) : null}
    </>
  )
}
