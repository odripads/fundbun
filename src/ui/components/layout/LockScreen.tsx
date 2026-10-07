import { LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import type { FundBunApp } from '../../../core/app'
import { errorText } from '../../state/appInstance'
import { BunMascot } from '../brand'
import { Button } from '../ds/Button'
import { Dialog } from '../ds/Dialog'
import { PinPad } from '../ds/PinPad'
import styles from './StatusScreens.module.css'

/** Boot gate when local data is encrypted (vault on): unlock with the PIN, or wipe and start over. */
export function LockScreen({ app }: { app: FundBunApp }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirmReset, setConfirmReset] = useState(false)

  async function unlock(pin: string) {
    setBusy(true)
    try {
      const res = await app.unlock(pin)
      if (!res.ok) {
        setError(res.error ?? 'That PIN didn’t match.')
        setAttempt((n) => n + 1)
      }
    } catch (e) {
      setError(errorText(e))
      setAttempt((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.hero}>
        <BunMascot size={72} mood="sleepy" animated title="Bun is keeping your data locked" />
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.body}>
          <LockKeyhole aria-hidden="true" className={styles.inlineIcon} /> Your FundBun data is encrypted on this device.
        </p>
      </div>
      <PinPad minLength={4} maxLength={6} label="Enter your PIN to unlock" onComplete={unlock} busy={busy} error={error} errorKey={attempt} />
      <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>Forgot PIN? Start over</Button>
      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        alert
        tone="danger"
        title="Delete all data on this device?"
        description="Without the PIN the encrypted data can’t be recovered. This wipes it and starts FundBun fresh."
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Keep my data</Button>
            <Button variant="danger" onClick={() => {
              setConfirmReset(false)
              app.resetAll()
            }}>Delete everything</Button>
          </>
        }
      />
    </div>
  )
}
