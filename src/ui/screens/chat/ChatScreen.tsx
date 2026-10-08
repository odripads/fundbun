import { ArrowDown, Ellipsis } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { ChatMessage } from '../../../core/types'
import { IconButton, cx } from '../../components/ds'
import { AgentStatusPill, ScreenTopBar } from '../../components/layout'
import { navigate } from '../../router'
import { useApp, useSnapshot } from '../../state'
import { ChatMenu, type ChatOverlay } from './ChatMenu'
import { Composer } from './Composer'
import { EmptyChat } from './EmptyChat'
import { AssistantMessage, TypingIndicator, UserMessage } from './Message'
import { hasConversation, layoutConversation } from './model'
import { useChatScroll } from './useChatScroll'
import styles from './ChatScreen.module.css'

/** The chat only re-renders when messages are added or removed (messages are immutable once written). */
const sameIds = (a: ChatMessage[], b: ChatMessage[]) => a.length === b.length && a.every((m, i) => m.id === b[i].id)
const selectChat = (s: AppSnapshot) => s.state.chat
/** which pending actions each plan embeds — the only plan data the layout needs */
const selectPlanShape = (s: AppSnapshot) => s.state.plans.map((p) => `${p.id}:${p.steps.map((x) => x.pendingId ?? '').join(',')}`).join('|')
const selectBusy = (s: AppSnapshot) => s.derived.busy
const selectEngine = (s: AppSnapshot) => s.derived.engine
const selectCurrency = (s: AppSnapshot) => s.state.profile?.currency ?? 'CNY'

/**
 * Ask Bun — the conversational agent. Messages are AI-labelled; every card is built from structured data;
 * every action goes through the policy engine; "How Bun got this" opens the glass box for each reply.
 */
export function ChatScreen() {
  const app = useApp()
  const messages = useSnapshot(selectChat, sameIds)
  const planShape = useSnapshot(selectPlanShape)
  const busy = useSnapshot(selectBusy)
  const engine = useSnapshot(selectEngine)
  const currency = useSnapshot(selectCurrency)
  const [overlay, setOverlay] = useState<ChatOverlay>(null)
  const [composerH, setComposerH] = useState(96)
  const sending = useRef(false)
  // messages present when the screen opened don't replay their entrance animation
  const initialIds = useRef(new Set(messages.map((m) => m.id)))

  const conversation = hasConversation(messages)
  // planShape is the change signal for the plans read here (plan objects change identity on every commit)
  const layouts = useMemo(() => layoutConversation(messages, app.getSnapshot().state.plans), [messages, planShape, app])
  const ids = useMemo(() => messages.map((m) => m.id), [messages])
  const lastUser = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.id ?? null, [messages])
  const latestAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === 'assistant')?.id ?? null, [messages])
  const { endRef, atBottom, unread, scrollToEnd } = useChatScroll(ids, lastUser, conversation)

  const send = useCallback(async (text: string) => {
    const value = text.trim()
    if (!value || sending.current || app.getSnapshot().derived.busy) return
    sending.current = true
    try {
      await app.sendMessage(value)
    } finally {
      sending.current = false
    }
  }, [app])

  const last = messages[messages.length - 1]
  const announce = last?.role === 'assistant' && !initialIds.current.has(last.id) ? `Bun: ${last.text}` : ''

  return (
    <>
      <ScreenTopBar
        title="Ask Bun"
        subtitle={engine === 'llm' ? 'AI via LLM · redacted context' : 'On-device AI · private'}
        onBack={() => navigate('home')}
        actions={
          <>
            <AgentStatusPill />
            <IconButton label="Chat options" icon={<Ellipsis />} onClick={() => setOverlay('menu')} />
          </>
        }
      />
      <div className={styles.screen}>
        {conversation ? (
          <section aria-labelledby="chat-log-title">
            <h2 id="chat-log-title" className="sr-only">Conversation with Bun</h2>
            <ol className={styles.log}>
              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} message={m} fresh={!initialIds.current.has(m.id)} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    layout={layouts.get(m.id) ?? { cards: [], answer: null, suggestions: [] }}
                    latest={m.id === latestAssistant}
                    fresh={!initialIds.current.has(m.id)}
                    currency={currency}
                    busy={busy}
                    onSend={send}
                  />
                ),
              )}
              {busy ? <TypingIndicator /> : null}
            </ol>
          </section>
        ) : (
          <EmptyChat onSend={send} busy={busy} />
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {busy ? 'Bun is thinking…' : announce}
        </p>
        <div ref={endRef} className={styles.end} style={{ height: composerH }} aria-hidden="true" />
      </div>

      {conversation && !atBottom ? (
        <button
          type="button"
          className={cx(styles.jump, unread && styles.jumpUnread)}
          style={{ bottom: composerH + 8 }}
          onClick={scrollToEnd}
          aria-label={unread ? 'New reply from Bun — jump to it' : 'Jump to the latest message'}
        >
          <ArrowDown aria-hidden="true" />
          {unread ? <span aria-hidden="true">New reply</span> : null}
        </button>
      ) : null}

      <Composer onSend={(t) => void send(t)} busy={busy} engine={engine} onHeight={setComposerH} />
      <ChatMenu open={overlay} onOpen={setOverlay} />
    </>
  )
}
