import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../../core/app-api'
import { CATEGORIES } from '../../../../core/categories'
import type { CategoryId, ChatCard, Currency } from '../../../../core/types'
import { useApp, useSnapshot } from '../../../state'
import { evidenceChips } from '../logic'
import styles from './cards.module.css'

export interface ChatCardContext {
  /** send a chat message (clarify options, "stop") — defaults to app.sendMessage */
  onSend?: (text: string) => void
  /** clarify: the user's later answer — the card becomes read-only and marks it */
  answer?: string | null
  /** the containing message's text (a clarify question that repeats it is not shown twice) */
  messageText?: string
  /** action cards already shown earlier in the conversation render as one-line receipts */
  actionMode?: 'card' | 'receipt'
}

export interface CardProps<T extends ChatCard['type']> {
  card: Extract<ChatCard, { type: T }>
  context: ChatCardContext
}

const selectCurrency = (s: AppSnapshot): Currency => s.state.profile?.currency ?? 'CNY'

export function useCurrency(): Currency {
  return useSnapshot(selectCurrency)
}

/** Sends through the context (the chat screen) or straight to the controller. */
export function useSend(context: ChatCardContext): (text: string) => void {
  const app = useApp()
  return context.onSend ?? ((text: string) => void app.sendMessage(text))
}

export function categoryMeta(id: CategoryId) {
  return CATEGORIES[id] ?? CATEGORIES.other
}

/** Emoji avatar for a category (identity is also carried by the text label next to it). */
export function CategoryAvatar({ category }: { category: CategoryId }) {
  const meta = categoryMeta(category)
  return (
    <span className={styles.avatar} aria-hidden="true">
      {meta.emoji}
    </span>
  )
}

/** Shows the first `initial` items with a "Show all N" toggle. */
export function useMore<T>(items: T[], initial: number): { shown: T[]; toggle: ReactNode } {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, initial)
  const hidden = items.length - initial
  const toggle = hidden > 0 ? (
    <button type="button" className={styles.more} aria-expanded={all} onClick={() => setAll((a) => !a)}>
      {all ? 'Show less' : `Show ${hidden} more`}
      <ChevronDown aria-hidden="true" className={all ? styles.flip : undefined} />
    </button>
  ) : null
  return { shown, toggle }
}

export function EvidenceChips({ evidence, currency }: { evidence?: Record<string, number | string>; currency: Currency }) {
  const chips = evidenceChips(evidence, currency)
  if (!chips.length) return null
  return (
    <dl className={styles.evidence}>
      {chips.map((c) => (
        <div key={c.key} className={styles.evidenceChip}>
          <dt>{c.label}</dt>
          <dd>{c.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Small uppercase label above a card's headline. */
export function Eyebrow({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className={styles.eyebrow}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </p>
  )
}
