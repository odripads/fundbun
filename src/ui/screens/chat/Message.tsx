import { CornerDownRight, FileText, ShieldCheck } from 'lucide-react'
import { memo, type CSSProperties } from 'react'
import type { ChatMessage, Currency } from '../../../core/types'
import type { AppSnapshot } from '../../../core/app-api'
import { ChatCardView } from '../../components/agent'
import { LiveReplyView, Markdown } from '../../components/ai'
import { useSnapshot } from '../../state'
import { clockTime } from '../../components/agent/logic'
import { BunMascot } from '../../components/brand'
import { AiBadge, Chip, cx } from '../../components/ds'
import { messageMood, showGroundingFlag, type MessageLayout } from './model'
import { TraceView } from './TraceView'
import styles from './Message.module.css'

export interface AssistantMessageProps {
  message: ChatMessage
  layout: MessageLayout
  /** the newest reply: animated avatar, suggestion chips */
  latest: boolean
  /** arrived while the screen was open (entrance animation) */
  fresh: boolean
  currency: Currency
  busy: boolean
  onSend: (text: string) => void
}

/** One reply from Bun: AI-labelled header, text, structured cards, quick replies and the glass-box trace. */
export const AssistantMessage = memo(function AssistantMessage({ message: m, layout, latest, fresh, currency, busy, onSend }: AssistantMessageProps) {
  const mood = messageMood(m)
  return (
    <li id={`msg-${m.id}`} className={cx(styles.msg, styles.bot, fresh && styles.fresh)}>
      <div className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">
          <BunMascot mood={mood} size={30} animated={latest} />
        </span>
        <span className={styles.name}>Bun</span>
        <AiBadge engine={m.engine ?? 'offline'} />
        {m.via ? <span className={styles.via}>{m.via}</span> : null}
        <time className={styles.time} dateTime={m.ts}>{clockTime(m.ts)}</time>
      </div>
      {m.text ? m.rich ? <div className={cx(styles.bubble, styles.rich)}><Markdown text={m.text} /></div> : <p className={styles.bubble}>{m.text}</p> : null}
      {showGroundingFlag(m) ? (
        <p className={styles.grounding}>
          <ShieldCheck aria-hidden="true" />
          A number couldn’t be verified and was removed.
        </p>
      ) : null}
      {layout.cards.length ? (
        <div className={styles.cards}>
          {layout.cards.map((c, i) => (
            <div key={c.key} className={styles.card} style={{ '--i': i } as CSSProperties}>
              <ChatCardView card={c.card} context={{ onSend, answer: layout.answer, messageText: m.text, actionMode: c.actionMode }} />
            </div>
          ))}
        </div>
      ) : null}
      {layout.suggestions.length ? (
        <div className={styles.chips} role="group" aria-label="Suggested replies">
          {layout.suggestions.map((s) => (
            <Chip key={s} icon={<CornerDownRight />} onClick={() => onSend(s)} disabled={busy}>
              {s}
            </Chip>
          ))}
        </div>
      ) : null}
      {m.trace?.length ? <TraceView trace={m.trace} grounding={m.grounding} engine={m.engine} currency={currency} /> : null}
    </li>
  )
}, (a, b) => a.message.id === b.message.id && a.layout === b.layout && a.latest === b.latest && a.fresh === b.fresh && a.busy === b.busy && a.currency === b.currency && a.onSend === b.onSend)

export const UserMessage = memo(function UserMessage({ message: m, fresh }: { message: ChatMessage; fresh: boolean }) {
  return (
    <li id={`msg-${m.id}`} className={cx(styles.msg, styles.user, fresh && styles.fresh)}>
      {m.attachments?.length ? (
        <ul className={styles.userFiles} aria-label="Attached files">
          {m.attachments.map((f, i) => (
            <li key={`${i}-${f.name}`} className={styles.userFile} title={f.truncated ? `${f.name} (only the start was sent)` : f.name}>
              <FileText aria-hidden="true" />
              <span>{f.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.userBubble}>
        <span className="sr-only">You said: </span>
        {m.text}
      </p>
      <time className={styles.userTime} dateTime={m.ts}>{clockTime(m.ts)}</time>
    </li>
  )
}, (a, b) => a.message.id === b.message.id && a.fresh === b.fresh)

const selectLive = (s: AppSnapshot) => s.derived.live

/**
 * Bun is working on a reply. With the user's own AI the answer shows as it is written, with the steps taken
 * and a Stop button; otherwise three dots (the built-in engine answers at once, a hosted model in a few seconds).
 */
export function TypingIndicator() {
  const live = useSnapshot(selectLive)
  if (live) {
    return (
      <li className={cx(styles.msg, styles.bot, styles.fresh)}>
        <div className={styles.head}>
          <span className={styles.avatar} aria-hidden="true">
            <BunMascot mood="calm" size={30} animated />
          </span>
          <span className={styles.name}>Bun</span>
          <span className={styles.via}>{live.via}</span>
        </div>
        <div className={cx(styles.bubble, styles.rich)}>
          <LiveReplyView live={live} />
        </div>
      </li>
    )
  }
  return (
    <li className={cx(styles.msg, styles.bot, styles.fresh)} aria-hidden="true">
      <div className={styles.head}>
        <span className={styles.avatar}>
          <BunMascot mood="calm" size={30} animated />
        </span>
        <span className={styles.name}>Bun</span>
      </div>
      <div className={styles.typing}>
        <span />
        <span />
        <span />
      </div>
    </li>
  )
}
