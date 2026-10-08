/**
 * Step-up PIN sheet for every loosening change (raise autonomy / caps, re-enable a money tool, unfreeze,
 * vault on/off). The controller verifies the PIN; this only collects it and shows the outcome.
 */
import { KeyRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Result } from '../../../core/app-api'
import { PinPad, Sheet } from '../../components/ds'
import { errorText } from '../../state'
import styles from './Settings.module.css'

export interface PinSheetProps {
  open: boolean
  title: string
  description?: ReactNode
  /** what the PIN unlocks, shown above the keypad */
  children?: ReactNode
  /** label above the dots */
  label?: string
  onSubmit: (pin: string) => Result | Promise<Result>
  onSuccess?: () => void
  onClose: () => void
}

export function PinSheet({ open, title, description, children, label = 'Enter your PIN', onSubmit, onSuccess, onClose }: PinSheetProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function complete(pin: string) {
    setBusy(true)
    let r: Result
    try {
      r = await onSubmit(pin)
    } catch (e) {
      r = { ok: false, error: errorText(e) }
    }
    setBusy(false)
    if (r.ok) {
      onSuccess?.()
      onClose()
      return
    }
    setError(r.error ?? 'That PIN didn’t match')
    setErrorKey((k) => k + 1)
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} dismissible={!busy}>
      <div className={styles.pinBody}>
        {children}
        <PinPad minLength={4} maxLength={6} label={label} onComplete={complete} error={error} errorKey={errorKey} busy={busy} onCancel={onClose} />
        <p className={styles.pinFoot}>
          <KeyRound aria-hidden="true" />
          {/* no demo-PIN hint here: anyone at the screen could unfreeze or escalate — it lives in the sandbox controls */}
          Your PIN is checked on this device and never stored in plain text.
        </p>
      </div>
    </Sheet>
  )
}
