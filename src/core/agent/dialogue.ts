import type { DialogueState, ISODateTime } from '../types'
import { extractAmount, extractCategory, extractPercent, normalizeText, understand, type NluContext, type NluSlots } from './nlu'
import { nameScore } from './support'

/**
 * Dialogue manager: the conversational acts the intent classifier does not model — interrupt, correction,
 * affirm and plan_recovery — plus filling a pending clarification. Runs BEFORE nlu.understand.
 * Affirm never approves anything: approvals only happen through the structured action card (tap / PIN).
 */
export type DialogueAct =
  | { act: 'interrupt'; soft: boolean }
  | { act: 'affirm' }
  | { act: 'correction'; body: string }
  | { act: 'plan_recovery' }
  | { act: 'explain_bill' }
  /** roll back the last action that ran ("undo that", "cancel that payment", "撤销", "batalkan yang tadi") */
  | { act: 'undo' }
  /** file a charge under another category ("Recategorize the Tony Hair Studio charge as personal care") */
  | { act: 'recategorize'; subject: string; target: string }

const LEAD = '(?:(?:ok(?:ay)?|hey|bun|please|pls|just|oh|um+|uh+)[\\s,]+)*'
const TAIL = '(?:[\\s,]+(?:please|pls|bun|now|thanks|thank you|for now|right now|a sec(?:ond)?|a minute))*[\\s!.~]*$'

const INTERRUPT_CORE = [
  'stop(?: (?:it|that|this|everything|the plan|now|right there))?',
  'wait(?: a (?:sec|second|minute|moment))?',
  'hold (?:on|up|it)', 'hang on', 'pause', 'abort', 'halt', 'enough', 'never ?mind', 'nvm',
  'forget (?:it|that|about it|the plan)', 'scrap (?:it|that|the plan)', 'drop it',
  'cancel(?: (?:that|this|it|everything|all(?: of (?:it|that))?|the plan|my plan|the request))?',
  "don'?t(?: do (?:it|that))?", 'do not do (?:it|that)',
  '停|停下|等等|等一下|算了|取消|别做了|不要了', 'berhenti|batal|tunggu|stop dulu',
].join('|')
const INTERRUPT_RE = new RegExp(`^${LEAD}(?:actually[\\s,]+|no[\\s,]+)?(?:${INTERRUPT_CORE})${TAIL}`, 'i')
const NEGATE_RE = new RegExp(`^${LEAD}(?:no|nope|nah|no thanks|no thank you|not now|not really|negative|不|不用|tidak|nggak|gak)${TAIL}`, 'i')

const AFFIRM_RE = new RegExp(
  `^${LEAD}(?:yes|yeah|yea|yep|yup|ya|sure|ok(?:ay)?|k|do it|go ahead|go for it|confirm(?:ed)?|approve(?:d)?|proceed|sounds good|please do|let'?s do (?:it|this)|yes please|absolutely|of course|send it|make it so|that'?s fine|fine|correct|right|好|好的|是|是的|可以|确认|行|iya|oke|boleh)(?:[\\s,!.]+(?:please|pls|bun|thanks|do it|go ahead|yes|sure|ok))*${TAIL}`,
  'i',
)

const UNDO_CORE = [
  'undo', 'revert', 'reverse', 'roll ?back', 'take (?:it|that) back', 'put (?:it|that|the money) back',
  'give (?:it|that|me my money) back',
  "cancel (?:that|this|the|my) (?:last |previous |latest )?(?:payment|transfer|move|deposit|change|top[- ]?up|transaction|budget|tripwire|alert|reminder|one)",
  'cancel (?:what you (?:just )?did|the last (?:one|action|thing))',
  '(?:撤销|撤回)(?:刚才|上一笔|那笔|刚刚)?(?:的)?(?:转账|操作|付款|那笔)?', '取消(?:刚才|上一笔|那笔|刚刚)(?:的)?(?:转账|操作|付款|那笔)?', '退回(?:刚才)?(?:的)?(?:转账)?',
  'batalkan (?:yang )?(?:tadi|barusan)', 'batalkan (?:transfer|pembayaran|transaksi|pindahan) (?:itu|tadi|barusan)', 'kembalikan(?: uang(?:nya)?)?(?: tadi)?',
].join('|')
const UNDO_RE = new RegExp(`^${LEAD}(?:${UNDO_CORE})(?:[\\s,]+(?:that|it|this|the last one|last one|my last one|the last (?:one|action|move|transfer|change)|my last (?:one|action|move|transfer|change)|tadi|itu|barusan))*${TAIL}`, 'i')

/** "recategorize X as Y", "mark the X charge as Y", "move X to the Y category", "把X归类为Y", "ubah kategori X jadi Y". */
const RECATEGORIZE_RES: RegExp[] = [
  /^(?:(?:please|pls|can you|could you)\s+)?(?:re-?categori[sz]e|reclassify|re-?label|re-?file)\s+(.{2,80}?)\s+(?:as|to|into|under)\s+(.{2,40}?)(?:\s+category)?[.!?]*$/i,
  /^(?:(?:please|pls|can you|could you)\s+)?(?:mark|tag|file|count|classify|categori[sz]e|log)\s+(.{2,80}?)\s+(?:as|under)\s+(.{2,40}?)(?:\s+category)?[.!?]*$/i,
  /^(?:(?:please|pls|can you|could you)\s+)?(?:move|put|change)\s+(.{2,80}?)\s+(?:to|into|under)\s+(?:the\s+)?(.{2,40}?)\s+category[.!?]*$/i,
  /^(?:把|将)(.{2,30}?)(?:改成|改为|归到|归类为|归类到|算作|分类为|算到)(.{2,20}?)(?:类|类别|里)?[。!！?？]*$/u,
  /^(?:ubah|ganti|pindahkan)\s+kategori\s+(.{2,80}?)\s+(?:jadi|menjadi|ke)\s+(.{2,40}?)[.!?]*$/i,
]

const CORRECTION_RE = /^(?:actually|no|nope|sorry|oops|wait|hmm|i meant|i mean|make (?:it|that)|change (?:it|that)(?: to)?|instead|rather|not that one|other one|wrong (?:one|amount))\b[\s,:-]*/i
const CORRECTION_HINT = /\b(?:make (?:it|that)|change (?:it|that)|instead|i meant|i mean|the .{1,30} one|not .{1,30}(?:,| but))\b/i

const PLAN_RE = /\b(?:back on track|on track again|fix (?:my|this) (?:month|budget|spending|finances|money)|save (?:money )?faster|make (?:me )?a plan|(?:recovery|rescue|savings?|action) plan|rescue (?:my|the|this) month|turn (?:my|this|the) month around|get (?:my )?(?:spending|finances|budget|month) (?:under control|back)|help me (?:save (?:more|faster)?|cut back|spend less)|plan to save|how (?:do|can) i (?:get back on track|save more|catch up))\b|回到正轨|省钱计划/i

const EXPLAIN_BILL_RE = /\b(?:explain|what'?s (?:in|on)|what is (?:in|on)|read|walk me through|break down|tell me about|go through|why is|why's|understand|look at|show me)\b[^?.!]{0,40}\bbill\b/i

export function detectDialogueAct(text: string): DialogueAct | null {
  const t = (text ?? '').trim()
  if (!t || t.length > 200) return null
  if (UNDO_RE.test(t)) return { act: 'undo' }
  for (const re of RECATEGORIZE_RES) {
    const m = t.match(re)
    if (m) return { act: 'recategorize', subject: m[1].trim(), target: m[2].trim() }
  }
  if (INTERRUPT_RE.test(t)) return { act: 'interrupt', soft: false }
  if (NEGATE_RE.test(t)) return { act: 'interrupt', soft: true }
  if (AFFIRM_RE.test(t)) return { act: 'affirm' }
  const cue = t.match(CORRECTION_RE)
  if (cue || CORRECTION_HINT.test(t)) {
    const body = cue ? t.slice(cue[0].length).trim() : t
    if (body) return { act: 'correction', body }
  }
  if (PLAN_RE.test(t)) return { act: 'plan_recovery' }
  if (EXPLAIN_BILL_RE.test(t)) return { act: 'explain_bill' }
  return null
}

/** Slot values a correction / clarification answer carries ("¥150", "the Chengdu one", "Youku", "delivery"). */
export interface SlotHints {
  amount?: number
  percent?: number
  goalId?: string
  billId?: string
  recurringId?: string
  category?: NluSlots['category']
}

export function slotHints(text: string, ctx: NluContext): SlotHints {
  const norm = normalizeText(text)
  const slots = understand(text, ctx).slots
  const hints: SlotHints = {}
  const amount = extractAmount(norm, ctx) ?? slots.amount
  if (amount !== undefined && amount > 0) hints.amount = amount
  const percent = extractPercent(norm)
  if (percent !== undefined) hints.percent = percent
  if (slots.goalId) hints.goalId = slots.goalId
  if (slots.billId) hints.billId = slots.billId
  if (slots.recurringId) hints.recurringId = slots.recurringId
  const category = extractCategory(norm) ?? slots.category
  if (category) hints.category = category
  return hints
}

export interface Choice {
  label: string
  id: string
}

export type Clarification = NonNullable<DialogueState['pendingClarification']>

export function makeClarification(intent: string, slots: Record<string, unknown>, missing: string, choices: Choice[], askedAt: ISODateTime): Clarification {
  return { intent, slots: { ...slots, _choices: choices }, missing, askedAt }
}

export function choicesOf(clar: Clarification): Choice[] {
  const raw = clar.slots._choices
  return Array.isArray(raw) ? (raw as Choice[]).filter((c) => c && typeof c.label === 'string' && typeof c.id === 'string') : []
}

/** Pick a stored choice by exact label/id, by the NLU entity matcher, or by fuzzy name. */
export function pickChoice(text: string, choices: Choice[], hinted?: string): Choice | undefined {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '')
  const exact = choices.find((c) => c.label.toLowerCase() === t || c.id.toLowerCase() === t)
  if (exact) return exact
  if (hinted) {
    const byId = choices.find((c) => c.id === hinted)
    if (byId) return byId
  }
  let best: { c: Choice; s: number } | undefined
  for (const c of choices) {
    const s = nameScore(text, c.label)
    if (s >= 0.5 && (!best || s > best.s)) best = { c, s }
  }
  return best?.c
}

const SLOT_HINT_KEY: Record<string, keyof SlotHints> = {
  goalId: 'goalId',
  billId: 'billId',
  recurringId: 'recurringId',
  category: 'category',
}

/** Fill the missing slot of a stored clarification from the user's answer; null when it doesn't answer it. */
export function fillClarification(clar: Clarification, text: string, ctx: NluContext): Record<string, unknown> | null {
  const { _choices: _drop, ...slots } = clar.slots
  void _drop
  const hints = slotHints(text, ctx)
  if (clar.missing === 'threshold') {
    const choice = pickChoice(text, choicesOf(clar))
    const fromChoice = choice ? thresholdFromChoice(choice.id) : undefined
    if (fromChoice) return { ...slots, ...fromChoice }
  }
  if (clar.missing === 'amount' || clar.missing === 'threshold') {
    const value = clar.missing === 'threshold' && hints.percent !== undefined ? hints.percent : hints.amount
    if (value === undefined) return null
    return clar.missing === 'threshold' && hints.percent !== undefined ? { ...slots, percent: hints.percent } : { ...slots, amount: value }
  }
  if (clar.missing === 'category') {
    return hints.category ? { ...slots, category: hints.category } : null
  }
  const choices = choicesOf(clar)
  const hintKey = SLOT_HINT_KEY[clar.missing]
  const hinted = hintKey ? (hints[hintKey] as string | undefined) : undefined
  const choice = pickChoice(text, choices, hinted)
  if (!choice) return null
  const filled: Record<string, unknown> = { ...slots, [clar.missing]: choice.id }
  if (hints.amount !== undefined && filled.amount === undefined && clar.missing !== 'txnId') filled.amount = hints.amount
  return filled
}

/** Tripwire clarification choices carry their kind and threshold in the id ("month_pct:80"). */
export function thresholdFromChoice(id: string): Record<string, unknown> | undefined {
  const m = /^(month_pct|single_over|pace_over|daily_over):(\d+)$/.exec(id)
  if (!m) return undefined
  const value = Number(m[2])
  return m[1] === 'single_over' || m[1] === 'daily_over' ? { tripwireKind: m[1], amount: value } : { tripwireKind: m[1], percent: value }
}
