import { uid } from '../ids'
import type { ChatCard, DialogueState, ISODateTime, TraceKind, TraceStep } from '../types'
import type { AgentHost } from './host'

/**
 * One agent turn: the glass-box trace, the cards for the reply, the taint flag and every tool-derived value
 * (the grounding sources). Engines and the policy gate write into it; the runtime turns it into a ChatMessage.
 */
export type TurnSource = 'chat' | 'xray' | 'ui' | 'approval'

export interface DialoguePatch {
  /** null clears a stored clarification */
  pendingClarification?: DialogueState['pendingClarification'] | null
  lastProposalId?: string
  lastIntent?: string
}

export interface Turn {
  id: string
  ts: ISODateTime
  source: TurnSource
  engine: 'offline' | 'llm'
  tainted: boolean
  taintReasons: string[]
  trace: TraceStep[]
  cards: ChatCard[]
  /** tool data, previews and decision reasons of this turn — what a reply may quote */
  sources: unknown[]
  /** pending ids (status pending/executed/denied…) created in this turn */
  proposals: string[]
  dialogue: DialoguePatch
  /** dedupe for injection notices */
  noticeKeys: Set<string>
  now(): ISODateTime
}

export function startTurn(host: AgentHost, source: TurnSource): Turn {
  const turn: Turn = {
    id: uid('turn'),
    ts: host.now(),
    source,
    engine: 'offline',
    tainted: false,
    taintReasons: [],
    trace: [],
    cards: [],
    sources: [],
    proposals: [],
    dialogue: {},
    noticeKeys: new Set(),
    now: () => host.now(),
  }
  if (source === 'xray') taint(turn, 'The user pasted outside text (bill X-ray)')
  return turn
}

export function trace(turn: Turn, kind: TraceKind, label: string, detail?: unknown): void {
  const step: TraceStep = { kind, label, ts: turn.now() }
  if (detail !== undefined) step.detail = detail
  turn.trace.push(step)
}

export function taint(turn: Turn, reason: string): void {
  if (!turn.tainted) trace(turn, 'injection', 'Turn tainted: untrusted content in context', { reason })
  turn.tainted = true
  if (!turn.taintReasons.includes(reason)) turn.taintReasons.push(reason)
}

export function addCard(turn: Turn, card: ChatCard): void {
  if (card.type === 'action' && turn.cards.some((c) => c.type === 'action' && c.pendingId === card.pendingId)) return
  if (card.type === 'plan' && turn.cards.some((c) => c.type === 'plan' && c.planId === card.planId)) return
  turn.cards.push(card)
}

export function addNotice(turn: Turn, level: 'info' | 'warn' | 'block', title: string, text: string, key = `${level}:${title}`): void {
  if (turn.noticeKeys.has(key)) return
  turn.noticeKeys.add(key)
  turn.cards.push({ type: 'notice', level, title, text })
}

export function addSource(turn: Turn, value: unknown): void {
  if (value !== undefined) turn.sources.push(value)
}
