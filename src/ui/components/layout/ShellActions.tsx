import { History, Pause, Settings } from 'lucide-react'
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

/** What the pill says: while the agent runs it is a switch ("Pause"), once frozen a status ("Paused"). */
const STATUS_TEXT: Record<AgentStatus, string> = {
  active: 'Pause',
  paused: 'Paused',
  breaker: 'Breaker',
}

/**
 * The pill's accessible name starts with its visible word (WCAG 2.5.3 — "click Pause" works for voice users) and
 * then says what it means and what a tap does.
 */
export function agentPillName(status: AgentStatus): string {
  if (status === 'active') return 'Pause the agent: it is on — one tap freezes it now (kill switch, no PIN)'
  if (status === 'breaker') return 'Breaker: the circuit breaker stopped the agent. Open the kill switch in Settings to resume'
  return 'Paused: the agent is frozen. Open the kill switch in Settings to resume'
}

/** Settings › kill switch: on Settings already, scroll to it and focus it; elsewhere navigate there. */
function openKillSwitch(): void {
  if (typeof document !== 'undefined' && /^#\/settings(\?|$)/.test(window.location.hash)) {
    const el = document.getElementById('set-kill')
    if (el) {
      el.scrollIntoView?.({ block: 'start' })
      const h = el.querySelector<HTMLElement>('h2')
      if (h) {
        h.tabIndex = -1
        h.focus({ preventScroll: true })
      }
      return
    }
  }
  navigate('settings', { query: { s: 'kill' } })
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
      aria-label={agentPillName(status)}
      title={active ? 'Bun is on — tap to pause it' : 'Bun is frozen — resume in Settings'}
      onClick={() => {
        if (!active) {
          openKillSwitch()
          return
        }
        app.freeze()
        toast.show({
          id: 'agent-paused',
          tone: 'warn',
          title: 'Agent paused',
          message: 'Bun can only read now. Resume any time in Settings with your PIN.',
          actions: [{ label: 'Resume…', onClick: openKillSwitch }],
        })
      }}
    >
      <span className={styles.dot} aria-hidden="true" />
      {active ? <Pause className={styles.pauseIcon} aria-hidden="true" /> : null}
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
