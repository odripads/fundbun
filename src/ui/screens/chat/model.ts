/**
 * Pure view logic for the chat screen: starter prompts, how each card sits in the conversation, avatar moods,
 * the glass-box trace digest and the human-handoff summary. No React, no DOM — unit-tested.
 */
import { CURRENCY_SYMBOL, fmt } from '../../../core/money'
import { humanizeKey } from '../../components/agent/logic'
import type {
  BunMood,
  ChatCard,
  ChatMessage,
  Currency,
  Decision,
  DreamItem,
  GroundingReport,
  MirrorStatus,
  TaskPlan,
  Tier,
  Tone,
  TraceStep,
} from '../../../core/types'

// ───────────────────────────── conversation shape ─────────────────────────────

export function hasConversation(messages: Pick<ChatMessage, 'role'>[]): boolean {
  return messages.some((m) => m.role === 'user')
}

/** The assistant's opening line shown in the empty state (the onboarding welcome), if there is one. */
export function welcomeText(messages: Pick<ChatMessage, 'role' | 'text'>[]): string | null {
  if (hasConversation(messages)) return null
  const first = messages.find((m) => m.role === 'assistant')
  return first?.text ?? null
}

export interface StarterPrompt {
  id: 'overview' | 'breakdown' | 'bills' | 'afford' | 'plan' | 'save'
  text: string
}

/** The shortest recognisable name of a goal: "Weekend in Chengdu" → "Chengdu", "MacBook Air" stays. */
export function shortGoalName(name: string): string {
  const m = /\b(?:in|to)\s+(.+)$/i.exec(name.trim())
  return (m ? m[1] : name).trim()
}

/** The goal a "move money" starter should name: the cheapest unfinished goal (the most reachable one). */
export function starterGoal(dreams: Pick<DreamItem, 'name' | 'price' | 'kind' | 'achievedAt'>[]): Pick<DreamItem, 'name'> | undefined {
  return [...dreams].filter((d) => d.kind === 'goal' && !d.achievedAt).sort((a, b) => a.price - b.price)[0]
}

/**
 * Six starter prompts covering the judged tasks: overview, breakdown, bills, affordability, a multi-step plan
 * and a policy-gated transfer. The plan prompt matches the month (under target → put the surplus to work).
 */
export function starterPrompts(opts: { currency: Currency; dreams: Pick<DreamItem, 'name' | 'price' | 'kind' | 'achievedAt'>[]; status?: MirrorStatus | null }): StarterPrompt[] {
  const sym = CURRENCY_SYMBOL[opts.currency] ?? '¥'
  const goal = starterGoal(opts.dreams)
  const prompts: StarterPrompt[] = [
    { id: 'overview', text: 'How am I doing this month?' },
    { id: 'breakdown', text: 'Where did my money go?' },
    { id: 'bills', text: 'Check my bills' },
    { id: 'afford', text: `Can I afford ${sym}1,299 sneakers?` },
    { id: 'plan', text: opts.status === 'under' ? 'Make a plan for my surplus' : 'Help me get back on track' },
  ]
  prompts.push({ id: 'save', text: goal ? `Move ${sym}300 to my ${shortGoalName(goal.name)} fund` : `Move ${sym}300 to my goal` })
  return prompts
}

export function firstName(name: string | undefined | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

/** Empty-state heading + line, in the user's chosen tone (cheeky is opt-in). */
export function greeting(tone: Tone, name: string): { title: string; body: string } {
  const who = name ? `, ${name}` : ''
  switch (tone) {
    case 'cheeky':
      return { title: `Spill the tea${who}`, body: 'Ask me where the money went, what’s due, or whether those sneakers are a good idea. I’ll be honest — and kind.' }
    case 'numbers':
      return { title: `Ask me anything${who}`, body: 'Spending, bills, goals, affordability. Short answers, real numbers from your own data.' }
    default:
      return { title: `Hi${who} — I’m Bun`, body: 'Ask me about your spending, bills or dreams. I explain, plan and — only with your OK — move money between your own pots.' }
  }
}

// ───────────────────────────── cards in context ─────────────────────────────

export interface CardPlacement {
  card: ChatCard
  key: string
  /** action cards: the first appearance is the full card; later references are receipts */
  actionMode?: 'card' | 'receipt'
}

export interface MessageLayout {
  cards: CardPlacement[]
  /** clarify: what the user answered next (null = not answered yet) */
  answer: string | null
  /** suggestion chips worth showing (latest assistant message only) */
  suggestions: string[]
}

/**
 * Lay out every message's cards against the whole conversation:
 *  - an action card embedded in a plan of the same message is not repeated;
 *  - an action already shown earlier becomes a one-line receipt (live status + Undo);
 *  - clarify cards learn the user's next answer; only the latest assistant message keeps suggestion chips.
 */
export function layoutConversation(messages: ChatMessage[], plans: Pick<TaskPlan, 'id' | 'steps'>[]): Map<string, MessageLayout> {
  const out = new Map<string, MessageLayout>()
  const seen = new Set<string>()
  const lastAssistant = findLastIndex(messages, (m) => m.role === 'assistant')
  messages.forEach((m, i) => {
    if (m.role !== 'assistant') return
    const cards = m.cards ?? []
    const embedded = new Set<string>()
    for (const c of cards) {
      if (c.type !== 'plan') continue
      for (const s of plans.find((p) => p.id === c.planId)?.steps ?? []) if (s.pendingId) embedded.add(s.pendingId)
    }
    const placed: CardPlacement[] = []
    cards.forEach((card, j) => {
      const key = `${m.id}:${j}`
      if (card.type === 'action') {
        if (embedded.has(card.pendingId)) return
        placed.push({ card, key, actionMode: seen.has(card.pendingId) ? 'receipt' : 'card' })
        seen.add(card.pendingId)
        return
      }
      placed.push({ card, key })
    })
    for (const id of embedded) seen.add(id)
    const next = messages.slice(i + 1).find((x) => x.role === 'user')
    const latest = i === lastAssistant && !next
    const options = new Set(cards.flatMap((c) => (c.type === 'clarify' ? c.options.map((o) => o.value.toLowerCase()) : [])))
    // a plan card carries its own "Stop plan" button
    if (cards.some((c) => c.type === 'plan')) options.add('stop')
    out.set(m.id, {
      cards: placed,
      answer: next ? next.text : null,
      suggestions: latest ? (m.suggestions ?? []).filter((s) => !options.has(s.toLowerCase())).slice(0, 4) : [],
    })
  })
  return out
}

function findLastIndex<T>(items: T[], pred: (t: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i])) return i
  return -1
}

/** Bun's face for a reply — reacts to what the reply says (blocked → worried, saved/under → happy). */
export function messageMood(m: Pick<ChatMessage, 'cards' | 'grounding'>): BunMood {
  const cards = m.cards ?? []
  if (cards.some((c) => c.type === 'notice' && c.level === 'block')) return 'worried'
  if (cards.some((c) => c.type === 'xray' && c.result.injection.suspicious)) return 'worried'
  const mirror = cards.find((c): c is Extract<ChatCard, { type: 'mirror' }> => c.type === 'mirror')
  if (mirror) return mirror.mirror.mood
  const afford = cards.find((c): c is Extract<ChatCard, { type: 'affordability' }> => c.type === 'affordability')
  if (afford) return afford.result.verdict === 'go' ? 'happy' : afford.result.verdict === 'skip' ? 'worried' : 'calm'
  if (cards.some((c) => c.type === 'goals')) return 'happy'
  return 'calm'
}

export function grounded(g: GroundingReport | undefined): boolean {
  return g?.ok !== false
}

/** The "a number was removed" flag — unless the reply already carries the runtime's own notice saying so. */
export function showGroundingFlag(m: Pick<ChatMessage, 'grounding' | 'cards'>): boolean {
  if (grounded(m.grounding)) return false
  return !(m.cards ?? []).some((c) => c.type === 'notice' && /unverified number/i.test(c.title))
}

// ───────────────────────────── trace digest ("How Bun got this") ─────────────────────────────

type Detail = Record<string, unknown>

function asDetail(v: unknown): Detail {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Detail) : {}
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** "save_to_goal" → "Save to goal". */
export function humanize(id: string): string {
  const s = id.replace(/[_-]+/g, ' ').trim().replace(/\bai\b/gi, 'AI').replace(/\bxray\b/gi, 'X-ray').replace(/\bllm\b/gi, 'LLM')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type TraceRow =
  | { kind: 'intent'; label: string; intent?: string; confidence?: number; rule?: string; slots: { key: string; value: string }[]; alternatives: { intent: string; confidence: number }[] }
  | { kind: 'tool_call'; label: string; tool: string; proposedBy?: string; args: { key: string; value: string }[] }
  | { kind: 'tool_result'; label: string; ok: boolean; untrusted: boolean }
  | { kind: 'policy'; label: string; decision?: Decision; tier?: Tier; tool?: string; reasons: string[]; ruleIds: string[]; tainted: boolean }
  | { kind: 'injection'; label: string; signals: string[]; score?: number; reason?: string }
  | { kind: 'grounding'; label: string; ok: boolean; checked?: number; ungrounded: string[] }
  | { kind: 'llm' | 'redaction' | 'error'; label: string; counts: { key: string; value: string }[] }

function slotValue(key: string, v: unknown, currency: Currency): string {
  if (typeof v === 'number' && /amount|limit|threshold|price/i.test(key) && Number.isInteger(v)) return fmt(v, currency)
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)?.slice(0, 40) ?? ''
}

function pairs(d: unknown, currency: Currency, max = 6): { key: string; value: string }[] {
  return Object.entries(asDetail(d)).slice(0, max).map(([k, v]) => ({ key: humanizeKey(k), value: slotValue(k, v, currency) }))
}

/** Turn raw TraceSteps into typed rows the UI can render (unknown shapes degrade to a plain label). */
export function digestTrace(trace: TraceStep[] | undefined, currency: Currency): TraceRow[] {
  return (trace ?? []).map((t): TraceRow => {
    const d = asDetail(t.detail)
    switch (t.kind) {
      case 'intent': {
        const alts = Array.isArray(d.alternatives) ? d.alternatives.map(asDetail) : []
        return {
          kind: 'intent',
          label: t.label,
          intent: str(d.intent) ?? str(d.act),
          confidence: num(d.confidence),
          rule: str(d.rule),
          slots: pairs(d.slots, currency),
          alternatives: alts.map((a) => ({ intent: str(a.intent) ?? '', confidence: num(a.confidence) ?? 0 })).filter((a) => a.intent).slice(0, 3),
        }
      }
      case 'tool_call':
        return { kind: 'tool_call', label: t.label, tool: str(d.tool) ?? t.label, proposedBy: str(d.proposedBy), args: pairs(d.args, currency, 4) }
      case 'tool_result':
        return { kind: 'tool_result', label: t.label, ok: d.ok !== false, untrusted: d.untrusted === true }
      case 'policy': {
        const decision = str(d.decision) as Decision | undefined
        const tier = num(d.tier) as Tier | undefined
        return { kind: 'policy', label: t.label, decision, tier, tool: str(d.tool), reasons: strings(d.reasons), ruleIds: strings(d.ruleIds), tainted: d.tainted === true }
      }
      case 'injection':
        return { kind: 'injection', label: t.label, signals: strings(d.signals), score: num(d.score), reason: str(d.reason) }
      case 'grounding':
        return { kind: 'grounding', label: t.label, ok: d.ok !== false, checked: num(d.checked), ungrounded: strings(d.ungrounded) }
      default:
        return { kind: t.kind === 'redaction' || t.kind === 'error' ? t.kind : 'llm', label: t.label, counts: pairs(d.counts, currency) }
    }
  })
}

export interface TraceSummary {
  intent?: string
  confidence?: number
  tools: number
  decisions: Decision[]
  tainted: boolean
  injection: boolean
  grounded: boolean
}

/** One line for the collapsed "How Bun got this" toggle. */
export function summarizeTrace(rows: TraceRow[], grounding?: GroundingReport): TraceSummary {
  const intent = rows.find((r): r is Extract<TraceRow, { kind: 'intent' }> => r.kind === 'intent' && r.confidence !== undefined)
    ?? rows.find((r): r is Extract<TraceRow, { kind: 'intent' }> => r.kind === 'intent')
  return {
    intent: intent?.intent,
    confidence: intent?.confidence,
    tools: rows.filter((r) => r.kind === 'tool_call').length,
    decisions: rows.flatMap((r) => (r.kind === 'policy' && r.decision ? [r.decision] : [])),
    tainted: rows.some((r) => r.kind === 'injection'),
    injection: rows.some((r) => r.kind === 'injection' && r.signals.length > 0),
    grounded: grounded(grounding) && !rows.some((r) => r.kind === 'grounding' && !r.ok),
  }
}

export function summaryText(s: TraceSummary): string {
  const parts: string[] = []
  if (s.intent) parts.push(`${humanize(s.intent)}${s.confidence !== undefined ? ` · ${Math.round(s.confidence * 100)}%` : ''}`)
  if (s.tools) parts.push(`${s.tools} tool${s.tools === 1 ? '' : 's'}`)
  if (s.decisions.includes('deny')) parts.push('blocked')
  if (s.injection) parts.push('injection caught')
  return parts.join(' · ')
}

export const DECISION_META: Record<Decision, { label: string; tone: 'under' | 'accent' | 'warn' | 'over' }> = {
  allow: { label: 'Allowed', tone: 'under' },
  confirm: { label: 'Needs your tap', tone: 'accent' },
  step_up: { label: 'Needs your PIN', tone: 'warn' },
  deny: { label: 'Denied', tone: 'over' },
}

export function proposerLabel(p: string | undefined): string {
  switch (p) {
    case 'llm': return 'proposed by the LLM'
    case 'offline': return 'proposed on-device'
    case 'user': return 'your button'
    case 'system': return 'system'
    default: return ''
  }
}

// ───────────────────────────── human handoff ─────────────────────────────

export interface HandoffSummary {
  topics: string[]
  messages: number
  awaiting: number
}

/** What a human adviser would receive: the user's own recent questions (trimmed) and open items — no secrets. */
export function handoffSummary(messages: Pick<ChatMessage, 'role' | 'text'>[], awaiting: number, maxTopics = 3): HandoffSummary {
  const asked = messages.filter((m) => m.role === 'user').map((m) => m.text.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const topics = asked.slice(-maxTopics).reverse().map((t) => maskDigits(t.length > 60 ? `${t.slice(0, 57)}…` : t))
  return { topics, messages: messages.length, awaiting }
}

/** The one-line summary recorded with the handoff request (masked again by the controller before auditing). */
export function handoffText(s: HandoffSummary): string {
  const topics = s.topics.length ? `Asked about: ${s.topics.map((t) => `“${t}”`).join(' · ')}` : 'No questions yet'
  const waiting = s.awaiting ? `${s.awaiting} action${s.awaiting === 1 ? '' : 's'} waiting` : 'nothing waiting'
  return `${topics}. ${s.messages} message${s.messages === 1 ? '' : 's'}, ${waiting}.`
}

/** Secrets never leave in a summary: long digit runs (account / card numbers) keep the last 4, PINs vanish. */
export function maskDigits(text: string): string {
  return text
    .replace(/(pin|passcode|password|密码)(\W{0,3}(?:is\W{1,3})?)\d{4,6}\b/gi, '$1$2••••')
    .replace(/\d(?:[\d ]{7,}\d)/g, (run) => {
      const digits = run.replace(/\D/g, '')
      return digits.length >= 8 ? `•••• ${digits.slice(-4)}` : run
    })
}
