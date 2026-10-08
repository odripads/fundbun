import { CircleCheck, LockKeyhole } from 'lucide-react'
import { useEffect } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { sandboxToday, useSnapshot } from '../../state'
import { BunMascot } from '../brand'
import { Button, PinPad, Sheet } from '../ds'
import { useToast } from '../ds/Toast'
import { ActionCard } from './ActionCard'
import { closeApproval, useApprovalTarget } from './approvalStore'
import { useApprovalFlow, useNow } from './hooks'
import { actionTitle, needsPin, pinLockedFor } from './logic'
import styles from './ApprovalHost.module.css'

const selectLock = (s: AppSnapshot) => s.state.mandate.pinLockedUntil
const selectToday = (s: AppSnapshot) => sandboxToday(s)

/** The single approval sheet (tap to approve; PIN for step_up). Mounted once inside the app frame. */
export function ApprovalHost() {
  const id = useApprovalTarget()
  const toast = useToast()
  const p = useSnapshot((s) => (id ? s.state.pending.find((x) => x.id === id) : undefined))
  const lockedUntil = useSnapshot(selectLock)
  const today = useSnapshot(selectToday)
  const flow = useApprovalFlow(id, () => closeApproval())
  const open = Boolean(id && p && p.status === 'pending')
  const pin = p ? needsPin(p) : false
  const now = useNow(open && pin && Boolean(lockedUntil), 1000)
  const lockedSecs = pinLockedFor(lockedUntil, now)

  // the action settled elsewhere (approved inline, expired, stopped by a plan) → forget it
  useEffect(() => {
    if (id && !flow.busy && (!p || p.status !== 'pending')) closeApproval()
  }, [id, p, flow.busy])

  const notNow = () => {
    flow.reject()
    closeApproval()
    toast.show({ id: 'approval-declined', tone: 'neutral', title: 'Okay — nothing ran', message: 'Ask Bun again any time.' })
  }

  const lockText = lockedSecs > 0 ? `PIN entry is locked for ${Math.ceil(lockedSecs / 60)} more minute${lockedSecs > 60 ? 's' : ''} after too many wrong tries.` : null

  return (
    <Sheet
      open={open}
      onClose={closeApproval}
      dismissible={!flow.busy}
      title={p ? actionTitle(p, today) : 'Review'}
      description={pin ? 'Check the details, then enter your PIN. It seals this exact action.' : 'Check the details. Nothing happens until you approve.'}
      media={<BunMascot mood="calm" size={52} />}
      footer={
        p ? (
          pin ? (
            <Button variant="ghost" onClick={notNow} disabled={flow.busy}>Not now</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={notNow} disabled={flow.busy}>Not now</Button>
              <Button iconStart={<CircleCheck />} loading={flow.busy} onClick={() => void flow.approve()}>Approve</Button>
            </>
          )
        ) : null
      }
    >
      {p ? (
        <div className={styles.body}>
          <ActionCard pendingId={p.id} variant="sheet" part={pin ? 'summary' : 'all'} />
          {pin ? (
            <div className={styles.pin}>
              {lockText ? (
                <p className={styles.locked} role="alert">
                  <LockKeyhole aria-hidden="true" />
                  {lockText}
                </p>
              ) : null}
              <PinPad
                minLength={4}
                maxLength={6}
                label="Enter your PIN to approve"
                description="Checked on this device only"
                onComplete={(value) => void flow.approve(value)}
                error={flow.error}
                errorKey={flow.errorKey}
                busy={flow.busy}
                disabled={lockedSecs > 0}
                onCancel={closeApproval}
              />
            </div>
          ) : null}
          {pin ? <ActionCard pendingId={p.id} variant="sheet" part="assurance" /> : null}
          {!pin && flow.error ? (
            <p className={styles.error} role="alert">{flow.error}</p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}
