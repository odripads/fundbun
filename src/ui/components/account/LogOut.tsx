import { Download, LogOut as LogOutIcon } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { navigate } from '../../router'
import { clearDraft } from '../../screens/onboarding/draft'
import { downloadText, exportFileName } from '../../screens/settings/download'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { BunMascot } from '../brand'
import { Button, Dialog, useToast } from '../ds'
import styles from './LogOut.module.css'

/**
 * Log out: leave this profile and go back to the start screen, to try the other demo or set up your own. It is the
 * way back for anyone who tapped the wrong demo or set up something they want to redo.
 *
 * FundBun has no online account: everything lives on this device. So for a demo persona logging out just closes
 * the demo (nothing of the user's is in it), while for someone's own data it deletes that data from the device.
 * The dialog says which, and offers a copy first. Both end on the welcome screen with a fresh setup.
 */

const selectWho = (s: AppSnapshot) => ({
  name: s.state.profile?.name ?? '',
  demo: !!s.state.profile?.personaId,
  onboarded: !!s.state.profile,
})

export interface LogOutDialogProps {
  open: boolean
  onClose: () => void
}

export function LogOutDialog({ open, onClose }: LogOutDialogProps) {
  const app = useApp()
  const toast = useToast()
  const { name, demo } = useSnapshot(selectWho, shallowEqual)

  function logOut() {
    onClose()
    app.resetAll()
    clearDraft()
    navigate('onboarding', { replace: true })
    toast.show({
      tone: 'neutral',
      title: demo ? 'Demo closed' : 'Logged out',
      message: demo ? 'Open a demo or set up your own.' : 'Your data was removed from this device.',
      duration: 3500,
    })
  }

  function saveCopy() {
    const ok = downloadText(exportFileName('data', 'json'), app.exportData())
    toast.show({
      tone: ok ? 'success' : 'warn',
      title: ok ? 'Copy saved' : 'Downloads aren’t available here',
      message: ok ? 'A JSON file with your transactions, goals and settings.' : 'Try another browser.',
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      alert={!demo}
      tone={demo ? 'default' : 'danger'}
      media={<BunMascot mood={demo ? 'calm' : 'worried'} size={72} animated />}
      title={demo ? `Leave ${name ? `${name}’s` : 'the'} demo?` : 'Log out of FundBun?'}
      description={
        demo
          ? 'You go back to the start screen, where you can open the other demo or set up your own. The demo is simulated, so nothing of yours is lost, and you can open it again any time.'
          : 'FundBun has no online account: your data lives only on this device. Logging out deletes it from here, and it can’t be brought back. Save a copy first if you might want it.'
      }
      actions={
        demo ? (
          <>
            <Button iconStart={<LogOutIcon />} onClick={logOut}>Leave the demo</Button>
            <Button variant="ghost" onClick={onClose}>Stay</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" iconStart={<Download />} onClick={saveCopy}>Save a copy first</Button>
            <Button variant="danger" iconStart={<LogOutIcon />} onClick={logOut}>Log out and delete</Button>
            <Button variant="ghost" onClick={onClose}>Stay logged in</Button>
          </>
        )
      }
    />
  )
}

/** Who is using the app, with Log out: the first thing in Settings. */
export function AccountCard() {
  const { name, demo, onboarded } = useSnapshot(selectWho, shallowEqual)
  const [open, setOpen] = useState(false)
  if (!onboarded) return null
  return (
    <section className={styles.card} aria-label="Account">
      <BunMascot mood="calm" size={44} animated={false} />
      <div className={styles.text}>
        <p className={styles.who}>{demo ? `${name}’s demo` : name || 'You'}</p>
        <p className={styles.where}>{demo ? 'Bank demo · simulated data' : 'Your data · on this device only'}</p>
      </div>
      <Button size="sm" variant="secondary" iconStart={<LogOutIcon />} onClick={() => setOpen(true)}>
        {demo ? 'Leave demo' : 'Log out'}
      </Button>
      <LogOutDialog open={open} onClose={() => setOpen(false)} />
    </section>
  )
}
