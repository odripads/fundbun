import { Eraser, Headset, Lock, MessageSquareText, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { BunMascot } from '../../components/brand'
import { Button, Callout, Dialog, List, ListItem, Sheet, Toggle, useToast } from '../../components/ds'
import { useApp, useSnapshot } from '../../state'
import { handoffSummary } from './model'
import styles from './ChatScreen.module.css'

export type ChatOverlay = 'menu' | 'human' | 'clear' | null

export interface ChatMenuProps {
  open: ChatOverlay
  onOpen: (o: ChatOverlay) => void
}

/** Chat options (Sheet), the human handoff (Sheet) and the clear-chat confirmation (Dialog). */
export function ChatMenu({ open, onOpen }: ChatMenuProps) {
  const close = () => onOpen(null)
  return (
    <>
      <Sheet open={open === 'menu'} onClose={close} title="Chat options">
        <List>
          <ListItem
            leading={<Headset />}
            title="Talk to a human"
            subtitle="A person takes over, with a summary"
            onClick={() => onOpen('human')}
          />
          <ListItem
            leading={<Eraser />}
            title="Clear conversation"
            subtitle="Money and audit log stay as they are"
            onClick={() => onOpen('clear')}
          />
        </List>
      </Sheet>
      <HumanHandoff open={open === 'human'} onClose={close} />
      <ClearChat open={open === 'clear'} onClose={close} />
    </>
  )
}

const selectHandoff = (s: AppSnapshot) => s.state.chat
const selectAwaiting = (s: AppSnapshot) => s.derived.awaiting.length
const selectFrozen = (s: AppSnapshot) => s.state.mandate.frozen

function HumanHandoff({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const toast = useToast()
  const chat = useSnapshot(selectHandoff)
  const awaiting = useSnapshot(selectAwaiting)
  const frozen = useSnapshot(selectFrozen)
  const [pause, setPause] = useState(false)
  const summary = handoffSummary(chat, awaiting)

  const request = () => {
    if (pause && !frozen) app.freeze()
    onClose()
    setPause(false)
    toast.show({
      tone: 'neutral',
      icon: <Headset />,
      title: 'Handoff requested (sandbox)',
      message: pause ? 'In the bank’s app an adviser would join with your summary. Bun is paused meanwhile.' : 'In the bank’s app an adviser would join with your summary.',
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Talk to a human"
      description="In the live app this hands your chat to the bank’s support team, so you never have to repeat yourself."
      media={<BunMascot mood="calm" size={52} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Keep chatting</Button>
          <Button iconStart={<Headset />} onClick={request}>Get a human</Button>
        </>
      }
    >
      <div className={styles.sheetStack}>
        <Callout tone="info" title="This is a sandbox">
          No one is on the other end in the demo — the request is shown, not sent.
        </Callout>
        <section className={styles.handoff} aria-label="What the adviser would see">
          <p className={styles.handoffTitle}>
            <MessageSquareText aria-hidden="true" /> What they’d see
          </p>
          {summary.topics.length ? (
            <ul className={styles.handoffList}>
              {summary.topics.map((t, i) => <li key={i}>“{t}”</li>)}
            </ul>
          ) : (
            <p className={styles.handoffEmpty}>No questions yet — they’d start fresh with you.</p>
          )}
          <p className={styles.handoffMeta}>
            {summary.messages} message{summary.messages === 1 ? '' : 's'} · {summary.awaiting ? `${summary.awaiting} action${summary.awaiting === 1 ? '' : 's'} waiting for you` : 'nothing waiting'}
          </p>
          <p className={styles.handoffSafe}>
            <Lock aria-hidden="true" /> Never shared: your PIN, full card or account numbers.
          </p>
        </section>
        {!frozen ? (
          <Toggle
            checked={pause}
            onChange={setPause}
            label="Pause Bun while a human helps"
            description="Bun goes read-only until you resume it in Settings with your PIN."
          />
        ) : (
          <p className={styles.handoffSafe}>
            <ShieldCheck aria-hidden="true" /> Bun is already paused.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function ClearChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const toast = useToast()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      alert
      title="Clear this conversation?"
      description="The messages disappear from this screen. Your accounts, goals, pending approvals and the audit log stay exactly as they are."
      media={<BunMascot mood="sleepy" size={64} />}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button
            variant="danger"
            iconStart={<Eraser />}
            onClick={() => {
              app.clearChat()
              onClose()
              toast.show({ tone: 'neutral', title: 'Conversation cleared', message: 'A fresh start — Bun still remembers your numbers, not your chat.' })
            }}
          >
            Clear conversation
          </Button>
        </>
      }
    />
  )
}
