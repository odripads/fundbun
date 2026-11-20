import { Download, FileUp, KeyRound } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { navigate } from '../../router'
import { downloadText, exportFileName } from '../../screens/settings/download'
import { useApp } from '../../state'
import { Button, Sheet, TextField, useToast } from '../ds'
import styles from './MoveDevice.module.css'

/** Matches core BACKUP_MIN_PASSWORD. */
const MIN = 8

/**
 * Move to another device. FundBun keeps everything on the device and has no server or account yet, so data moves as
 * a file: an encrypted copy, opened with a password the user picks. On the other device: "Restore from a copy".
 */
export function MoveDeviceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.length < MIN) return setError(`Use at least ${MIN} characters`)
    if (pw !== again) return setError('The two passwords don’t match')
    setBusy(true)
    const r = await app.exportBackup(pw, pin)
    setPin('')
    setBusy(false)
    if (!r.ok) return setError(r.error)
    const ok = downloadText(exportFileName('copy', 'fundbun'), r.text, 'application/octet-stream')
    toast.show({
      tone: ok ? 'success' : 'warn',
      title: ok ? 'Encrypted copy saved' : 'Downloads aren’t available here',
      message: ok ? 'Send it to your other device (AirDrop, WeChat, a cable), then tap “Restore from a copy” there.' : 'Try another browser.',
    })
    setPw('')
    setAgain('')
    setError(null)
    if (ok) onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Move to another device" description="Your data lives only on this device. To use it on another one, save an encrypted copy and open it there.">
      <form className={styles.form} onSubmit={(e) => void save(e)} noValidate>
        <ol className={styles.steps}>
          <li>Pick a password and save the copy.</li>
          <li>Send the file to your other device.</li>
          <li>There, open FundBun and tap <strong>Restore from a copy</strong>.</li>
        </ol>
        <TextField label="Password for this copy" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} hint={`At least ${MIN} characters. Without it the copy can’t be opened, by anyone.`} />
        <TextField label="Type it again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.currentTarget.value)} />
        <TextField label="Your PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} error={error ?? undefined} hint="A copy holds everything, so it needs your PIN. The copy itself carries no PIN." onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))} />
        <Button type="submit" size="lg" fullWidth iconStart={<Download />} loading={busy}>Save encrypted copy</Button>
      </form>
    </Sheet>
  )
}

/** Restore from a copy: pick the file, type its password; it replaces what is on this device. */
export function RestoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [pw, setPw] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function restore(e: FormEvent) {
    e.preventDefault()
    if (!file) return setError('Choose the copy first')
    setBusy(true)
    const r = await app.restoreBackup(file.text, pw, pin)
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'That didn’t work.')
    toast.show({ tone: 'success', title: 'Welcome back', message: 'Everything from your other device is here. Bun’s permissions start careful again: raise them in Settings with your new PIN.' })
    setFile(null)
    setPw('')
    onClose()
    navigate('home', { replace: true })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Restore from a copy" description="Open the encrypted copy you saved on your other device. It replaces what is on this one.">
      <form className={styles.form} onSubmit={(e) => void restore(e)} noValidate>
        <input
          ref={input}
          type="file"
          accept=".fundbun,application/octet-stream,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (f) {
              setFile({ name: f.name, text: await f.text() })
              setError(null)
            }
          }}
        />
        <Button type="button" variant="secondary" iconStart={<FileUp />} onClick={() => input.current?.click()}>
          {file ? file.name : 'Choose the copy'}
        </Button>
        <TextField label="Its password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.currentTarget.value)} />
        <TextField label="A new PIN for this device" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} error={error ?? undefined} hint="4–6 digits. It guards payments and Bun’s limits here." onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))} />
        <Button type="submit" size="lg" fullWidth iconStart={<KeyRound />} loading={busy}>Restore</Button>
      </form>
    </Sheet>
  )
}

