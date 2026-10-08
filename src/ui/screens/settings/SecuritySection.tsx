/**
 * Security: change the step-up PIN (current → new → confirm) and the at-rest vault (AES-GCM, key from the PIN).
 */
import { KeyRound, LockKeyhole, ShieldCheck, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { Card, List, ListItem, PinPad, SectionHeader, Sheet, Toggle, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { newPinProblem, pinLockText } from './logic'
import { PinSheet } from './PinSheet'
import styles from './Settings.module.css'

function selectSecurity(s: AppSnapshot) {
  return {
    vault: s.state.settings.vault,
    failed: s.state.mandate.failedPinAttempts,
    lockedUntil: s.state.mandate.pinLockedUntil,
  }
}

export function SecuritySection() {
  const app = useApp()
  const toast = useToast()
  const sec = useSnapshot(selectSecurity, shallowEqual)
  const [changing, setChanging] = useState(false)
  const [vaultTarget, setVaultTarget] = useState<boolean | null>(null)
  const lock = pinLockText(sec.lockedUntil, Date.now())

  return (
    <section id="set-security" aria-labelledby="set-security-h" className={styles.section}>
      <SectionHeader id="set-security-h" eyebrow="Your keys" title="Security" />
      <List card>
          <ListItem
            leading={<KeyRound />}
            title="Change PIN"
            subtitle={lock ?? (sec.failed ? `${sec.failed} wrong ${sec.failed === 1 ? 'try' : 'tries'} since the last correct one` : 'Needed to pay, unfreeze and loosen limits')}
            onClick={() => setChanging(true)}
          />
      </List>
      <Card>
        <div className={styles.vault}>
          <Toggle
            label="Encrypt data on this device"
            description={sec.vault ? 'On. FundBun asks for your PIN when it opens.' : 'Off. Data is stored on this device without encryption.'}
            checked={sec.vault}
            onChange={(on) => setVaultTarget(on)}
          />
          <p className={styles.vaultNote} data-on={sec.vault || undefined}>
            {sec.vault ? <ShieldCheck aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
            <span>
              {sec.vault ? 'Your data on this device is encrypted' : 'Turn it on and your data on this device is encrypted'} with <strong>AES-GCM</strong>, with a key derived from your PIN (PBKDF2). Without the PIN the stored copy is unreadable, and nothing leaves the device.
            </span>
          </p>
        </div>
      </Card>

      <ChangePinSheet open={changing} onClose={() => setChanging(false)} onDone={() => toast.show({ tone: 'success', title: 'PIN changed', message: 'Use the new PIN from now on. The change is in your audit log.' })} />

      <PinSheet
        open={vaultTarget !== null}
        title={vaultTarget ? 'Encrypt your data?' : 'Turn off encryption?'}
        description={vaultTarget ? 'FundBun will ask for your PIN each time it opens.' : 'Your data stays on this device, but unencrypted.'}
        onClose={() => setVaultTarget(null)}
        onSubmit={(pin) => (vaultTarget ? app.enableVault(pin) : app.disableVault(pin))}
        onSuccess={() =>
          toast.show({
            tone: vaultTarget ? 'success' : 'warn',
            title: vaultTarget ? 'Vault on' : 'Vault off',
            message: vaultTarget ? 'Encrypted with your PIN (AES-GCM).' : 'Stored without encryption on this device.',
          })
        }
      >
        <p className={styles.pinLead}>
          <LockKeyhole aria-hidden="true" />
          {vaultTarget ? 'Your PIN becomes the key to your data.' : 'Confirm it’s you before removing the lock.'}
        </p>
      </PinSheet>
    </section>
  )
}

type Step = 'current' | 'next' | 'confirm'

const STEP_COPY: Record<Step, { label: string; description: string }> = {
  current: { label: 'Enter your current PIN', description: 'Step 1 of 3' },
  next: { label: 'Choose a new PIN', description: 'Step 2 of 3 · 4 to 6 digits, no 1111 or 1234' },
  confirm: { label: 'Type the new PIN again', description: 'Step 3 of 3' },
}

function ChangePinSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const app = useApp()
  const [step, setStep] = useState<Step>('current')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setStep('current')
      setCurrent('')
      setNext('')
      setError(null)
    }
  }

  const fail = (msg: string, back?: Step) => {
    if (back) setStep(back)
    setError(msg)
    setErrorKey((k) => k + 1)
  }

  function complete(pin: string) {
    setError(null)
    if (step === 'current') {
      setCurrent(pin)
      setStep('next')
      return
    }
    if (step === 'next') {
      const problem = newPinProblem(pin)
      if (problem) return fail(problem)
      if (pin === current) return fail('Pick a PIN that’s different from the current one')
      setNext(pin)
      setStep('confirm')
      return
    }
    if (pin !== next) return fail('Those didn’t match. Choose the new PIN again.', 'next')
    const r = app.changePin(current, next)
    if (r.ok) {
      onClose()
      onDone()
      return
    }
    // a wrong current PIN only surfaces now (the controller checks it with the change)
    fail(r.error ?? 'That didn’t work', /pin/i.test(r.error ?? '') && !/new/i.test(r.error ?? '') ? 'current' : 'next')
  }

  const copy = STEP_COPY[step]
  return (
    <Sheet open={open} onClose={onClose} title="Change PIN" description={copy.description}>
      <div className={styles.pinBody}>
        <ol className={styles.pinSteps} aria-hidden="true">
          {(['current', 'next', 'confirm'] as const).map((s) => (
            <li key={s} data-on={s === step || undefined} data-done={(['current', 'next', 'confirm'].indexOf(s) < ['current', 'next', 'confirm'].indexOf(step)) || undefined} />
          ))}
        </ol>
        <PinPad key={step} minLength={4} maxLength={6} label={copy.label} onComplete={complete} error={error} errorKey={errorKey} onCancel={onClose} />
      </div>
    </Sheet>
  )
}
