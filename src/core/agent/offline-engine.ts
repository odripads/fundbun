import { computeMirror } from '../finance'
import type { AppState, PendingAction, Tone, ToolName } from '../types'
import { newCall, policyContext, rejectPending, runGated, undoPending, type ActionResult, type GateResult } from './actions'
import {
  choicesOf,
  detectDialogueAct,
  fillClarification,
  makeClarification,
  slotHints,
  type Choice,
  type Clarification,
  type DialogueAct,
  type SlotHints,
} from './dialogue'
import { TOOL_INTENT, actionFacts, readFacts, type Facts } from './facts'
import type { AgentHost } from './host'
import { replyLang, type Lang } from './lang'
import { evaluatePolicy } from '../security/policy'
import {
  ACTION_VERB_RE,
  VERB_GATED_INTENTS,
  correctTypos,
  extractCategory,
  isRefusalIntent,
  normalizeText,
  understand,
  type Intent,
  type NluContext,
  type NluResult,
} from './nlu'
import { cancelActivePlans, planIntent, planReply, runRecoveryPlan, type IntentPlan, type PlanNote, type Slots } from './planner'
import { TOOL_SPECS, isToolName } from './specs'
import { categoryLabel, findBill, findDream, firstName, isAfter, money, moneyCopy, nluContextOf, shortDate, summarizeArgs } from './support'
import { addCard, addNotice, addSource, taint, trace, type Turn } from './turn'
import { composeReply, hasLocalCopy, line, refusal, suggestionsIn, type ActionStage } from './voice'
import { categoryName, dateName, joinList, topicOf } from './voice-i18n'

/**
 * The on-device "Bun Engine": dialogue acts → clarification answers → NLU intent → planner → policy-gated
 * tool calls → facts → templated reply. Deterministic and fully offline. Replies follow the user's language
 * (English, Chinese, Indonesian) for the intents people ask most.
 */
export interface Reply {
  text: string
  /** intent the reply answers (suggestions + dialogue.lastIntent) */
  intent: string
  suggestions?: string[]
}

const ACTION_INTENTS = VERB_GATED_INTENTS
const ACTION_VERB = ACTION_VERB_RE
const READ_TWIN: Partial<Record<Intent, Intent>> = { save_to_goal: 'goals', withdraw_goal: 'goals', pay_bill: 'bills', cancel_sub: 'subscriptions', dispute: 'bills' }

export function toneOf(state: AppState): Tone {
  return state.profile?.tone ?? 'gentle'
}

function safeRecurring(host: AgentHost) {
  try {
    return host.recurring()
  } catch {
    return []
  }
}

export function nluContext(host: AgentHost): NluContext {
  return nluContextOf(host.state(), safeRecurring(host))
}

function langOf(turn: Turn): Lang {
  return turn.lang ?? 'en'
}

export function respondOffline(host: AgentHost, turn: Turn, text: string): Reply {
  if (!turn.lang) turn.lang = replyLang(text, host.state())
  if (turn.source === 'xray') return xrayPaste(host, turn, text)
  const act = detectDialogueAct(text)
  if (act) {
    const handled = handleAct(host, turn, act, text)
    if (handled) return handled
  }
  const ctx = nluContext(host)
  const clar = host.state().dialogue.pendingClarification
  if (clar) {
    const handled = handleClarification(host, turn, clar, text, ctx)
    if (handled) return handled
  }
  return handleUtterance(host, turn, act?.act === 'correction' ? act.body : text, ctx)
}

// ───────────────────────────── utterances ─────────────────────────────

/** Action intents the classifier guessed without an action verb ("Youku", "explain my bill") become read-only. */
export function guardIntent(nlu: NluResult, text: string): Intent {
  if (nlu.rule || !ACTION_INTENTS.includes(nlu.intent)) return nlu.intent
  return ACTION_VERB.test(text) ? nlu.intent : READ_TWIN[nlu.intent] ?? nlu.intent
}

export function handleUtterance(host: AgentHost, turn: Turn, text: string, ctx: NluContext): Reply {
  const nlu = understand(text, ctx)
  let intent = guardIntent(nlu, text)
  let slots = nlu.slots as Slots
  const follow = followUp(host, nlu, intent, text)
  if (follow) {
    intent = follow.intent
    slots = follow.slots
  }
  trace(turn, 'intent', `${intent} (${Math.round(nlu.confidence * 100)}%)${follow ? ' · follow-up' : ''}`, {
    intent, classifierIntent: nlu.intent, confidence: nlu.confidence, rule: nlu.rule, slots: summarizeArgs(nlu.slots as Record<string, unknown>),
    alternatives: nlu.alternatives, engine: 'offline', guarded: intent !== nlu.intent, lang: langOf(turn),
    ...(nlu.typos?.length ? { typos: nlu.typos.map(([a, b]) => `${a}→${b}`) } : {}),
    ...(nlu.override ? { override: nlu.override } : {}),
    ...(follow ? { followUp: true } : {}),
    effective: { intent, slots: summarizeArgs(slots as Record<string, unknown>) },
  })
  if (host.state().dialogue.pendingClarification && intent !== 'unknown') turn.dialogue.pendingClarification = null
  if (nlu.override) flagOverride(host, turn, nlu, intent)
  if (!nlu.rule && !follow) {
    const ask = disambiguate(turn, nlu, intent)
    if (ask) return ask
  }
  return runIntent(host, turn, intent, slots, text, nlu)
}

export function runIntent(host: AgentHost, turn: Turn, intent: Intent, slots: Slots, text: string, nlu?: NluResult): Reply {
  const plan = planIntent(intent, slots, text, host)
  turn.dialogue.lastIntent = intent
  const lang = langOf(turn)
  const override = Boolean(nlu?.override)
  const notes = 'notes' in plan && plan.notes ? plan.notes : []
  const prefix = joinSentences([override && plan.kind !== 'refusal' ? line('overrideNote', lang) : '', ...notes.map((n) => noteText(turn, n))], lang)
  const lead = (r: Reply): Reply => (prefix ? { ...r, text: joinSentences([prefix, r.text], lang) } : r)
  switch (plan.kind) {
    case 'chat': return lead(chatReply(host, turn, plan.intent, plan.focus, text, slots))
    case 'unknown': return lead(fallbackReply(host, turn, nlu, text))
    case 'refusal': return refusalReply(host, turn, plan, nlu)
    case 'read': return lead(readReply(host, turn, plan))
    case 'recommend': return lead(recommendCancel(host, turn))
    case 'action': return actionReply(host, turn, plan.intent, runGated(host, turn, newCall(plan.tool, plan.args, 'offline', turn)), prefix)
    case 'clarify':
      // an override attempt never opens a question — the attempt is logged and the rules restated
      if (override) return overrideOnly(host, turn)
      return lead(clarifyReply(host, turn, plan))
    case 'ask': return lead({ text: compose(host, turn, plan.intent, plan.facts), intent: plan.intent, suggestions: chips(turn, plan.intent) })
  }
}

/** Sentences joined the way the language writes them (no spaces between Chinese sentences). */
export function joinSentences(parts: string[], lang: Lang): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(lang === 'zh' ? '' : ' ')
}

function noteText(turn: Turn, note: PlanNote): string {
  if (note.facts) addSource(turn, note.facts)
  if (note.sources) addSource(turn, note.sources)
  return line(note.key, langOf(turn), note.facts ?? {})
}

function compose(host: AgentHost, turn: Turn, intent: Intent, facts: Facts): string {
  return composeReply(intent, facts, toneOf(host.state()), langOf(turn))
}

function chips(turn: Turn, intent: Intent): string[] {
  return suggestionsIn(intent, langOf(turn))
}

// ───────────────────────────── chat, fallback, disambiguation ─────────────────────────────

const ADD_DREAM_LABEL_RE = /(?:dream|wish(?:list)?|goal|梦想|心愿|impian)\s*(?:called|named|for|of|:|：|-)?\s*(.+)$/i

function chatReply(host: AgentHost, turn: Turn, intent: Intent, focus: string | undefined, text: string, slots: Slots): Reply {
  const state = host.state()
  const facts: Facts = {}
  const name = firstName(state)
  if (name) facts.name = name
  if (focus) facts.focus = focus
  if (intent === 'greeting') {
    try {
      const headline = computeMirror(host.ctx()).headline
      if (headline && langOf(turn) === 'en') {
        facts.headline = headline
        addSource(turn, { headline })
      }
    } catch {
      // no headline before onboarding data exists
    }
  }
  const c = moneyCopy(state)
  if (focus === 'profile' && state.profile) {
    facts.target = c(state.profile.targetSpend)
    facts.income = c(state.profile.monthlyIncome)
    if (slots.amount) facts.amount = c(slots.amount)
  }
  if (focus === 'add_dream') {
    const raw = text.match(ADD_DREAM_LABEL_RE)?.[1]?.replace(/(?:¥|￥|\$|rmb\s?)?\d[\d,]*(?:\.\d+)?\s?(?:元|块|yuan)?/gi, '').replace(/[.!?。！？,，]+$/, '').trim()
    if (raw && raw.length <= 40) facts.label = raw
    if (slots.amount) facts.amount = money(state)(slots.amount)
  }
  if (focus === 'handoff') {
    const lang = langOf(turn)
    addNotice(turn, 'info', line('handoffNoticeTitle', lang), line('handoffNoticeText', lang), 'handoff')
    trace(turn, 'policy', 'Human handoff offered', { route: 'chat menu → Talk to a human' })
  }
  if (focus === 'export') trace(turn, 'policy', 'Self-export: pointed to Settings → Privacy → Export (stays on this device)', { rule: 'R-SELF-EXPORT' })
  return { text: compose(host, turn, intent, facts), intent, suggestions: chips(turn, intent) }
}

const ALT_CHIPS: Partial<Record<Intent, string>> = {
  overview: 'How am I doing this month?',
  breakdown: 'Where did my money go?',
  search: 'Show my recent transactions',
  subscriptions: 'List my subscriptions',
  bills: 'Check my bills',
  insights: 'Any insights for me?',
  afford: 'Can I afford something?',
  goals: 'Show my goals',
  save_to_goal: 'Move money to my goal',
  set_budget: 'Set a delivery budget',
  budget_plan: 'Make me a budget plan',
  tripwire: 'Alert me at 80% of my target',
  pay_bill: 'Pay a bill',
  cancel_sub: 'Cancel a subscription',
}

/** The same quick commands in Chinese / Indonesian (each one is understood by the NLU). */
const ALT_CHIPS_I18N: Record<'zh' | 'id', Partial<Record<Intent, string>>> = {
  zh: {
    overview: '这个月花得怎么样？', breakdown: '我的钱都花哪了', search: '显示最近的交易', subscriptions: '我有哪些订阅', bills: '账单什么时候到期',
    insights: '有什么省钱建议', goals: '我的目标进度', save_to_goal: '存钱到梦想', budget_plan: '帮我做个预算', pay_bill: '交电费', cancel_sub: '取消自动续费',
  },
  id: {
    overview: 'Bulan ini aku boros nggak?', breakdown: 'Pengeluaran per kategori', search: 'Lihat transaksi terakhir', subscriptions: 'Langganan aku apa aja',
    bills: 'Tagihan apa saja yang jatuh tempo?', insights: 'Kasih tips hemat dong', goals: 'Progres tabungan aku', save_to_goal: 'Tabung ke impian',
    budget_plan: 'Buatkan anggaran bulanan', pay_bill: 'Bayar tagihan listrik',
  },
}

function altChip(intent: Intent, lang: Lang): string | undefined {
  return lang === 'en' ? ALT_CHIPS[intent] : ALT_CHIPS_I18N[lang][intent] ?? ALT_CHIPS[intent]
}

/** Never a dead end: out-of-scope gets a plain "I only handle money", a bare amount gets "what is it for?". */
function fallbackReply(host: AgentHost, turn: Turn, nlu: NluResult | undefined, text: string): Reply {
  const lang = langOf(turn)
  const topic = topicOf(text, lang)
  const focus = nlu?.slots.focus ?? (topic ? 'out_of_scope' : undefined)
  if (focus === 'bare_amount' && nlu?.slots.amount) return bareAmountReply(host, turn, nlu.slots.amount)
  if (focus === 'out_of_scope') {
    const facts: Facts = { focus }
    if (topic) facts.topic = topic
    const safe = lang === 'zh' ? '还能花多少' : lang === 'id' ? 'Sisa budget bulan ini berapa' : 'How much can I still spend?'
    return { text: compose(host, turn, 'unknown', facts), intent: 'unknown', suggestions: [safe, ...chips(turn, 'overview').slice(0, 2)] }
  }
  const guesses = (nlu?.alternatives ?? []).filter((a) => a.confidence >= 0.2).map((a) => altChip(a.intent, lang)).filter((c): c is string => !!c)
  const suggestions = [...new Set([...guesses, ...chips(turn, 'unknown')])].slice(0, 4)
  const tail = guesses.length ? (lang === 'zh' ? '也可以点下面的建议——我猜你可能想问其中一个。' : lang === 'id' ? 'Atau ketuk salah satu saran di bawah — mungkin itu yang kamu maksud.' : 'Or tap one of the suggestions below — I think you might mean one of those.') : ''
  return { text: joinSentences([compose(host, turn, 'unknown', {}), tail], lang), intent: 'unknown', suggestions }
}

function bareAmountReply(host: AgentHost, turn: Turn, amount: number): Reply {
  const lang = langOf(turn)
  const amt = money(host.state())(amount)
  const options = lang === 'zh'
    ? [`存${amt}到梦想`, `我买得起${amt}的东西吗`, `单笔超过${amt}提醒我`]
    : lang === 'id'
      ? [`Tabung ${amt} ke impian`, `Aku mampu beli barang ${amt}?`, `Ingatkan kalau belanja lebih dari ${amt}`]
      : [`Move ${amt} to my goal`, `Can I afford ${amt}?`, `Alert me on purchases over ${amt}`]
  const text = compose(host, turn, 'unknown', { focus: 'bare_amount', amount: amt })
  addCard(turn, { type: 'clarify', question: text, options: options.map((o) => ({ label: o, value: o })) })
  trace(turn, 'intent', 'Clarification needed: what the amount is for', { options })
  return { text, intent: 'unknown', suggestions: options }
}

/**
 * Low confidence → ask instead of guessing: a two-option question from the classifier's top two intents when
 * the best guess is weak or the runner-up is close. Rule-decided intents never come here.
 */
function disambiguate(turn: Turn, nlu: NluResult, intent: Intent): Reply | null {
  if (['unknown', 'greeting', 'help', 'thanks'].includes(intent) || isRefusalIntent(intent)) return null
  const conf = nlu.confidence
  const alt = nlu.alternatives.find((a) => a.intent !== intent && !isRefusalIntent(a.intent) && ALT_CHIPS[a.intent])
  const close = alt !== undefined && conf - alt.confidence <= 0.1
  if (!(conf < 0.5 || (conf < 0.6 && close))) return null
  const lang = langOf(turn)
  const a = altChip(intent, lang)
  const b = alt ? altChip(alt.intent, lang) : undefined
  if (!a || !b || a === b) return null
  const text = line('disambiguate', lang, { a, b })
  addCard(turn, { type: 'clarify', question: text, options: [a, b].map((o) => ({ label: o, value: o })) })
  trace(turn, 'intent', `Low confidence (${Math.round(conf * 100)}%): asked instead of guessing`, { candidates: [intent, alt?.intent], confidence: conf })
  turn.dialogue.lastIntent = 'clarify'
  return { text, intent: 'unknown', suggestions: [a, b] }
}

// ───────────────────────────── follow-ups ─────────────────────────────

const ELLIPSIS_RE = /^(?:and|what about|how about|and for|and in|and on|same for|also|or|then|ok and|那|那么|还有|dan|kalau|terus|gimana kalau|bagaimana dengan)\b|^(?:那|那么|还有)|呢[?？]?\s*$/i
const FOLLOW_INTENTS = new Set<Intent>(['breakdown', 'search', 'overview', 'insights'])

/** The intent and slots the previous assistant reply answered (from its trace). */
function previousContext(state: AppState): { intent: Intent; slots: Record<string, unknown> } | undefined {
  for (let i = state.chat.length - 1, seen = 0; i >= 0 && seen < 3; i--) {
    const m = state.chat[i]
    if (m.role !== 'assistant') continue
    seen++
    const step = [...(m.trace ?? [])].reverse().find((t) => t.kind === 'intent' && typeof t.detail === 'object' && t.detail && 'effective' in (t.detail as object))
    const eff = (step?.detail as { effective?: { intent?: string; slots?: Record<string, unknown> } } | undefined)?.effective
    if (eff?.intent) return { intent: eff.intent as Intent, slots: eff.slots ?? {} }
    return undefined
  }
  return undefined
}

/**
 * "And last month?", "what about coffee?", "那上个月呢": keep the previous question and change only what the
 * follow-up names (month, category, merchant), so the delivery question stays about delivery.
 */
function followUp(host: AgentHost, nlu: NluResult, intent: Intent, text: string): { intent: Intent; slots: Slots } | null {
  if (nlu.rule && !['R-COMPARE', 'R-RANGE'].includes(nlu.rule)) return null
  const prev = previousContext(host.state())
  if (!prev || !FOLLOW_INTENTS.has(prev.intent)) return null
  const t = text.trim()
  const words = t.split(/\s+/).filter(Boolean).length
  const elliptical = ELLIPSIS_RE.test(t) || words <= 3
  const s = nlu.slots
  const carries = Boolean(s.month || s.category || s.group || s.merchant || s.months || s.focus === 'compare')
  if (!elliptical || !carries) return null
  // a confident, different question is a new question
  if (!ELLIPSIS_RE.test(t) && intent !== prev.intent && nlu.confidence >= 0.8 && intent !== 'unknown') return null
  const keep: Record<string, unknown> = {}
  for (const k of ['category', 'month', 'merchant', 'group']) if (prev.slots[k] !== undefined) keep[k] = prev.slots[k]
  if (s.category || s.group) {
    delete keep.category
    delete keep.group
    delete keep.merchant
  }
  if (s.merchant) {
    delete keep.category
    delete keep.group
  }
  const merged: Slots = { ...keep } as Slots
  for (const [k, v] of Object.entries(s)) if (v !== undefined) (merged as Record<string, unknown>)[k] = v
  const next = s.focus === 'compare' ? 'breakdown' : prev.intent
  return { intent: next, slots: merged }
}

// ───────────────────────────── refusals & overrides ─────────────────────────────

/** A message tried to switch off FundBun's rules: an injection signal from the user — taint, trace, audit. */
function flagOverride(host: AgentHost, turn: Turn, nlu: NluResult, intent: Intent): void {
  const lang = langOf(turn)
  taint(turn, 'The message tried to override FundBun’s safety rules')
  trace(turn, 'injection', 'Override attempt in the message — safety rules stay on', { source: 'user_message', signals: ['instruction_override'], rule: nlu.override, underlying: intent })
  host.audit('system', 'injection_detected', 'A chat message tried to override the assistant’s rules — ignored', {
    source: 'user_message', kind: 'override_attempt', rule: nlu.override, underlying: intent, slots: summarizeArgs(nlu.slots as Record<string, unknown>),
  })
  addNotice(turn, 'warn', line('overrideNoticeTitle', lang), line('overrideNoticeText', lang), 'override')
}

/** Nothing actionable behind the override (or it would need a question): restate the rules, act on nothing. */
function overrideOnly(host: AgentHost, turn: Turn): Reply {
  const r = refusal('sensitive_request', toneOf(host.state()), { override: true, attack: true, lang: langOf(turn) })
  trace(turn, 'policy', 'Override refused — nothing was changed', { rule: 'R-OVERRIDE-ATTEMPT' })
  turn.dialogue.pendingClarification = null
  return { text: r.text, intent: 'sensitive_request', suggestions: chips(turn, 'sensitive_request') }
}

function refusalReply(host: AgentHost, turn: Turn, plan: Extract<IntentPlan, { kind: 'refusal' }>, nlu?: NluResult): Reply {
  const state = host.state()
  const lang = langOf(turn)
  const override = Boolean(nlu?.override)
  const attack = override || turn.tainted || Boolean(nlu?.slots.account)
  if (plan.intent === 'sensitive_request' && nlu?.rule === 'R-OVERRIDE-ATTEMPT') return overrideOnly(host, turn)
  const r = refusal(plan.intent, toneOf(state), { attack, lang })
  if (plan.t4) {
    const call = newCall(plan.t4.tool, plan.t4.args, 'offline', turn)
    if (plan.t4.store) runGated(host, turn, call)
    else unstoredDenial(host, turn, call.tool, call.args)
  } else {
    host.audit('policy', 'sensitive_request_refused', 'Refused a request for secrets, full numbers or a data export', { rule: nlu?.rule ?? 'sensitive_request' })
    trace(turn, 'policy', 'Sensitive request refused', { rule: nlu?.rule })
    addNotice(turn, 'block', r.title, lang === 'zh' ? '没有泄露、导出或发送任何内容。' : lang === 'id' ? 'Tidak ada yang dibuka, diekspor, atau dikirim.' : 'Nothing was revealed, exported or sent.')
  }
  const notes = (plan.notes ?? []).map((n) => noteText(turn, n))
  return { text: joinSentences([override ? line('overrideNote', lang) : '', ...notes, r.text], lang), intent: plan.intent, suggestions: chips(turn, plan.intent) }
}

/** Invest / credit: policy-decided and audited, but not stored as an attempt (it's a question, not an act). */
function unstoredDenial(host: AgentHost, turn: Turn, tool: string, args: Record<string, unknown>): void {
  const state = host.state()
  const call = newCall(tool, args, 'offline', turn)
  const decision = evaluatePolicy(call, policyContext(host, state, turn.tainted))
  host.mutate(() => {
    host.audit('agent', 'tool_call', `offline proposed ${tool}`, { callId: call.id, tool, proposedBy: 'offline', args: summarizeArgs(args) })
    host.audit('policy', 'policy_decision', `${decision.decision.toUpperCase()} ${tool} (${decision.ruleIds.join(', ')})`, { callId: call.id, tool, decision: decision.decision, tier: decision.tier, ruleIds: decision.ruleIds })
  })
  trace(turn, 'policy', `${decision.decision.toUpperCase()} · ${tool}`, { tool, decision: decision.decision, ruleIds: decision.ruleIds, reasons: decision.reasons })
  addNotice(turn, 'block', `Blocked: ${isToolName(tool) ? TOOL_SPECS[tool].label : tool}`, decision.reasons[0] ?? 'Not allowed for the assistant')
}

// ───────────────────────────── reads ─────────────────────────────

function readReply(host: AgentHost, turn: Turn, plan: Extract<IntentPlan, { kind: 'read' }>): Reply {
  const r = runGated(host, turn, newCall(plan.tool, plan.args, 'offline', turn))
  const intent = plan.intent
  if (r.status === 'denied') return { text: `I can’t look at that right now: ${r.reason ?? 'blocked by your settings'}`, intent, suggestions: chips(turn, intent) }
  if (r.status !== 'done' || !r.outcome) return { text: `I couldn’t load that just now${r.reason ? ` (${r.reason})` : ''}. Nothing was changed.`, intent, suggestions: chips(turn, intent) }
  const facts = readFacts(plan.tool, r.outcome.data, host.state(), { lang: langOf(turn), recurring: safeRecurring(host) })
  if (plan.focus) facts.focus = plan.focus
  const suggestions = chips(turn, intent)
  if (plan.focus === 'duplicate' && facts.dupMerchant) suggestions.unshift(langOf(turn) === 'zh' ? '申诉重复扣款' : langOf(turn) === 'id' ? 'Komplain transaksi ganda' : 'Dispute the duplicate charge')
  if (plan.focus === 'safe_to_spend' || plan.focus === 'balance') addSource(turn, r.outcome.data)
  return { text: compose(host, turn, intent, facts), intent, suggestions: [...new Set(suggestions)].slice(0, 4) }
}

/**
 * "Which subscriptions should I cancel?": a recommendation, not a menu. Overlapping services (the cheapest of
 * three video apps), a fresh price hike and the priciest membership, each with its reason and a one-tap
 * "Cancel X" that still goes through the PIN step-up.
 */
function recommendCancel(host: AgentHost, turn: Turn): Reply {
  const lang = langOf(turn)
  const subs = runGated(host, turn, newCall('list_recurring', { onlySubscriptions: true }, 'offline', turn), { cards: false })
  const bills = runGated(host, turn, newCall('analyze_bills', {}, 'offline', turn), { cards: false })
  const state = host.state()
  const f = money(state)
  const c = moneyCopy(state)
  type Row = { id: string; merchant: string; lastAmount: number; annualCost: number; status?: string; isSubscription?: boolean; priceChange?: { from: number; to: number } }
  const series = ((subs.outcome?.data as { series?: Row[] } | undefined)?.series ?? []).filter((s) => s.status === 'active' && s.isSubscription !== false)
  const overlap = (subs.outcome?.data as { overlap?: { merchants?: string[] } } | undefined)?.overlap?.merchants ?? []
  const findings = (bills.outcome?.data as { findings?: { kind: string; recurringId?: string }[] } | undefined)?.findings ?? []
  const picks: { s: Row; why: string }[] = []
  const add = (s: Row | undefined, why: string) => {
    if (s && !picks.some((p) => p.s.id === s.id)) picks.push({ s, why })
  }
  if (overlap.length >= 2) {
    const pool = series.filter((s) => overlap.includes(s.merchant)).sort((a, b) => a.lastAmount - b.lastAmount || a.merchant.localeCompare(b.merchant))
    const s = pool[0]
    if (s) add(s, lang === 'zh' ? `${s.merchant}（每月${f(s.lastAmount)}，你有${overlap.length}个视频会员）` : lang === 'id' ? `${s.merchant} (${f(s.lastAmount)}/bulan — salah satu dari ${overlap.length} aplikasi video)` : `${s.merchant} (${f(s.lastAmount)}/month — one of your ${overlap.length} video apps)`)
  }
  const hike = series.find((s) => findings.some((x) => x.kind === 'price_hike' && x.recurringId === s.id) || (s.priceChange && s.priceChange.to > s.priceChange.from))
  if (hike?.priceChange) add(hike, lang === 'zh' ? `${hike.merchant}（刚从${f(hike.priceChange.from)}涨到${f(hike.priceChange.to)}）` : lang === 'id' ? `${hike.merchant} (baru naik dari ${f(hike.priceChange.from)} ke ${f(hike.priceChange.to)})` : `${hike.merchant} (just went up from ${f(hike.priceChange.from)} to ${f(hike.priceChange.to)})`)
  const priciest = [...series].sort((a, b) => b.lastAmount - a.lastAmount)[0]
  const median = [...series].map((s) => s.lastAmount).sort((a, b) => a - b)[Math.floor(series.length / 2)] ?? 0
  if (priciest && priciest.lastAmount >= median * 3) add(priciest, lang === 'zh' ? `${priciest.merchant}（每月${f(priciest.lastAmount)}，最贵的一个——如果不常用的话）` : lang === 'id' ? `${priciest.merchant} (${f(priciest.lastAmount)}/bulan — paling mahal; kalau jarang dipakai)` : `${priciest.merchant} (${f(priciest.lastAmount)}/month — your priciest, if you’re not using it)`)
  const facts: Facts = { focus: 'recommend' }
  const annual = (subs.outcome?.data as { annualTotal?: number } | undefined)?.annualTotal
  if (annual) facts.annualTotal = c(annual)
  if (picks.length) {
    facts.recommend = lang === 'en' ? listJoinEn(picks.map((p) => p.why)) : joinList(picks.map((p) => p.why), lang)
    const saving = picks.reduce((sum, p) => sum + p.s.annualCost, 0)
    facts.saving = c(saving)
    addSource(turn, { saving, picks: picks.map((p) => ({ merchant: p.s.merchant, monthly: p.s.lastAmount, annual: p.s.annualCost, from: p.s.priceChange?.from, to: p.s.priceChange?.to })) })
  }
  const verb = lang === 'zh' ? '取消' : lang === 'id' ? 'Batalkan ' : 'Cancel '
  const options = picks.map((p) => `${verb}${p.s.merchant}`)
  if (findings.some((x) => x.kind === 'duplicate_charge')) options.push(lang === 'zh' ? '申诉重复扣款' : lang === 'id' ? 'Komplain transaksi ganda' : 'Dispute the duplicate charge')
  const text = compose(host, turn, 'subscriptions', facts)
  if (options.length) addCard(turn, { type: 'clarify', question: text, options: options.map((o) => ({ label: o, value: o })) })
  trace(turn, 'intent', `Recommendation: ${picks.map((p) => p.s.merchant).join(', ') || 'nothing stands out'}`, { picks: picks.map((p) => p.s.id) })
  return { text, intent: 'subscriptions', suggestions: options.length ? options.slice(0, 4) : chips(turn, 'subscriptions') }
}

function listJoinEn(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// ───────────────────────────── actions ─────────────────────────────

function stageOf(r: GateResult): ActionStage {
  return r.status === 'done' ? 'done' : r.status === 'pending' ? 'confirm' : 'blocked'
}

export function actionReply(host: AgentHost, turn: Turn, intent: Intent, r: GateResult, prefix = ''): Reply {
  const state = host.state()
  const tool = r.call.tool as ToolName
  const stage = stageOf(r)
  // an intent without hand-written copy in the user's language answers wholly in English (never half and half)
  const lang = hasLocalCopy(TOOL_INTENT[tool] ?? intent, langOf(turn)) ? langOf(turn) : 'en'
  const facts = actionFacts(tool, r.call.args, state, { stage, data: r.outcome?.data, reason: r.reason, recurring: safeRecurring(host), lang })
  let text = tool === 'set_bill_reminder' && stage !== 'done' ? reminderText(host, r, stage) : composeReply(TOOL_INTENT[tool] ?? intent, facts, toneOf(state), lang)
  const p = r.pending
  if (r.reused && p) text = joinSentences([lang === 'zh' ? '这个已经在等你确认了——就在下面这张卡片上。' : lang === 'id' ? 'Yang ini sudah menunggu konfirmasimu — di kartu bawah.' : 'You already have this one waiting — approve it on the card below.', text], lang)
  if (stage === 'done' && p?.undoUntil) text += lang === 'zh' ? ` ${state.mandate.undoWindowSec}秒内可以撤销。` : lang === 'id' ? ` Bisa dibatalkan dalam ${state.mandate.undoWindowSec} detik.` : ` You can undo it for ${state.mandate.undoWindowSec} seconds.`
  if (stage === 'confirm' && p?.decision.ruleIds.includes('P-TAINT')) text += lang === 'en' ? ' Because this conversation included outside text, it waits for your tap.' : lang === 'zh' ? ' 因为这段对话里有外部文本，需要你点确认。' : ' Karena percakapan ini memuat teks dari luar, ini menunggu ketukanmu.'
  if (turn.noticeKeys.has('breaker')) text += ' For your safety I’ve paused myself — you can unfreeze me in Settings with your PIN.'
  return { text: joinSentences([prefix, text], langOf(turn)), intent, suggestions: chips(turn, intent) }
}

function reminderText(host: AgentHost, r: GateResult, stage: ActionStage): string {
  const bill = findBill(host.state(), r.call.args.billId)
  const days = Number(r.call.args.daysBefore)
  if (stage === 'blocked') return `I couldn’t set that reminder${r.reason ? `: ${r.reason}` : '.'}`
  return `Set a reminder ${days} day${days === 1 ? '' : 's'} before ${bill?.name ?? 'that bill'} is due? Tap to confirm.`
}

function clarifyReply(host: AgentHost, turn: Turn, plan: Extract<IntentPlan, { kind: 'clarify' }>): Reply {
  const text = compose(host, turn, plan.intent, plan.facts)
  const clar = makeClarification(plan.intent, plan.slots, plan.missing, plan.choices, host.now())
  turn.dialogue.pendingClarification = clar
  if (plan.choices.length) addCard(turn, { type: 'clarify', question: text, options: plan.choices.map((c) => ({ label: c.label, value: c.label })) })
  trace(turn, 'intent', `Clarification needed: ${plan.missing}`, { intent: plan.intent, missing: plan.missing, options: plan.choices.map((c) => c.label) })
  const labels = plan.choices.map((c) => c.label).slice(0, 4)
  return { text, intent: plan.intent, suggestions: labels.length ? labels : chips(turn, plan.intent) }
}

// ───────────────────────────── dialogue acts ─────────────────────────────

function handleAct(host: AgentHost, turn: Turn, act: DialogueAct, text: string): Reply | null {
  switch (act.act) {
    case 'interrupt': return interruptReply(host, turn, act.soft)
    case 'affirm': return affirmReply(host, turn)
    case 'correction': return correctionReply(host, turn, act.body)
    case 'plan_recovery': return planRecoveryReply(host, turn, text)
    case 'explain_bill': return explainBill(host, turn, text)
    case 'undo': return undoReply(host, turn)
    case 'recategorize': return recategorizeReply(host, turn, act.subject, act.target)
  }
}

/**
 * "Recategorize the Tony Hair Studio charge as personal care": the latest charge from that merchant moves to the
 * named category (a reversible T1 change, through the policy gate) and FundBun learns the merchant rule.
 */
function recategorizeReply(host: AgentHost, turn: Turn, subject: string, target: string): Reply | null {
  const state = host.state()
  const ctx = nluContext(host)
  const category = extractCategory(correctTypos(normalizeText(target), ctx).text)
  if (!category) return null
  const merchant = understand(subject, ctx).slots.merchant ?? ctx.merchants.find((m) => normalizeText(subject).includes(normalizeText(m)))
  if (!merchant) return null
  const txn = [...state.bank.transactions].reverse().find((t) => t.amount < 0 && t.merchant.toLowerCase() === merchant.toLowerCase() && t.date <= state.bank.today)
  if (!txn) return null
  const lang = langOf(turn)
  const f = money(state)
  const label = (c: string) => (lang === 'en' ? categoryLabel(c) : categoryName(c, lang) ?? categoryLabel(c))
  const facts = { merchant: txn.merchant, amount: f(-txn.amount), date: lang === 'en' ? shortDate(txn.date) : dateName(txn.date, lang) ?? txn.date, to: label(category), from: label(txn.category) }
  trace(turn, 'intent', 'recategorize (dialogue)', { act: 'recategorize', txnId: txn.id, from: txn.category, to: category, engine: 'offline' })
  turn.dialogue.pendingClarification = null
  turn.dialogue.lastIntent = 'recategorize'
  addSource(turn, { amount: -txn.amount })
  if (txn.category === category) return { text: line('recatSame', lang, facts), intent: 'breakdown', suggestions: chips(turn, 'breakdown') }
  const r = runGated(host, turn, newCall('recategorize_transaction', { txnId: txn.id, category }, 'offline', turn))
  const key = r.status === 'done' ? 'recatDone' : r.status === 'pending' ? 'recatConfirm' : 'recatBlocked'
  let text = line(key, lang, { ...facts, ...(r.reason ? { reason: r.reason.replace(/[.!\s]+$/, '') } : {}) })
  if (r.status === 'done' && r.pending?.undoUntil) text = joinSentences([text, lang === 'zh' ? `${state.mandate.undoWindowSec}秒内可以撤销。` : lang === 'id' ? `Bisa dibatalkan dalam ${state.mandate.undoWindowSec} detik.` : `You can undo it for ${state.mandate.undoWindowSec} seconds.`], lang)
  return { text, intent: 'breakdown', suggestions: chips(turn, 'breakdown') }
}

function interruptReply(host: AgentHost, turn: Turn, soft: boolean): Reply {
  const state = host.state()
  trace(turn, 'intent', soft ? 'negate (dialogue)' : 'interrupt (dialogue)', { act: soft ? 'negate' : 'interrupt', engine: 'offline' })
  const plans = cancelActivePlans(host, 'Stopped by you')
  let rejected = plans.rejected
  const last = state.dialogue.lastProposalId
  if (last && rejectPending(host, last, 'interrupted')) rejected++
  const hadClar = Boolean(state.dialogue.pendingClarification)
  turn.dialogue.pendingClarification = null
  turn.dialogue.lastIntent = 'interrupt'
  if (plans.plans) trace(turn, 'policy', 'Plan cancelled by the user', plans)
  const parts: string[] = []
  if (plans.plans) parts.push(`Stopped. I cancelled the plan and skipped ${plans.skipped === 1 ? 'the remaining step' : `the remaining ${plans.skipped} steps`}.`)
  if (rejected) parts.push(`${rejected === 1 ? 'The pending action was' : `${rejected} pending actions were`} dropped — nothing will run.`)
  if (!parts.length) parts.push(hadClar ? 'No problem — dropped that.' : 'Okay — nothing is running right now, so there’s nothing to stop.')
  if (plans.plans) parts.push('Anything already done stays done; you can undo it from its card.')
  return { text: parts.join(' '), intent: 'interrupt', suggestions: ['How am I doing this month?', 'Show my goals', 'Check my bills'] }
}

function affirmReply(host: AgentHost, turn: Turn): Reply {
  const state = host.state()
  const lang = langOf(turn)
  trace(turn, 'intent', 'affirm (dialogue)', { act: 'affirm', note: 'Approvals happen only on the action card (tap / PIN), never from chat text' })
  const awaiting = state.pending.filter((p) => p.status === 'pending')
  const latest = awaiting.find((p) => p.id === state.dialogue.lastProposalId) ?? awaiting[awaiting.length - 1]
  if (latest) {
    addCard(turn, { type: 'action', pendingId: latest.id })
    const pin = latest.decision.decision === 'step_up' ? line('pinSuffix', lang) : ''
    return { text: line('approveFromCard', lang, { pin }).replace(/\s+\./, '.'), intent: 'affirm', suggestions: ['What can you do?', 'How am I doing this month?'] }
  }
  const clar = state.dialogue.pendingClarification
  if (clar) return reAsk(turn, clar)
  return { text: 'Great! What should we look at next?', intent: 'affirm', suggestions: chips(turn, 'thanks') }
}

/**
 * "Undo that" / "cancel that payment" / "撤销": the newest thing in the conversation. A proposal that never ran
 * is dropped; an executed reversible action inside its window is undone through the same undoPending path as
 * the card's Undo button; otherwise the reply says why it can't be (window passed, or final by nature).
 */
function undoReply(host: AgentHost, turn: Turn): Reply {
  const state = host.state()
  const lang = langOf(turn)
  turn.dialogue.pendingClarification = null
  turn.dialogue.lastIntent = 'undo'
  trace(turn, 'intent', 'undo (dialogue)', { act: 'undo', engine: 'offline' })
  const ts = (p: PendingAction) => p.executedAt ?? p.createdAt
  const candidates = state.pending.filter((p) => p.status === 'pending' || p.status === 'executed' || p.status === 'undone')
  const latest = [...candidates].sort((a, b) => (ts(a) < ts(b) ? -1 : ts(a) > ts(b) ? 1 : 0)).pop()
  const suggestions = chips(turn, 'overview').slice(0, 3)
  if (!latest) return { text: line('undoNothing', lang), intent: 'undo', suggestions }
  const title = latest.preview.title
  addSource(turn, latest)
  if (latest.status === 'pending') {
    rejectPending(host, latest.id, 'undone in chat')
    addCard(turn, { type: 'action', pendingId: latest.id })
    trace(turn, 'policy', `Dropped before it ran: ${title}`, { pendingId: latest.id, tool: latest.call.tool })
    return { text: line('undoPending', lang, { title }), intent: 'undo', suggestions }
  }
  if (latest.status === 'undone') return { text: line('undoAlready', lang, { title }), intent: 'undo', suggestions }
  const result = (latest.result ?? {}) as ActionResult
  const f = money(state)
  if (!latest.undoUntil || !result.undo) {
    addCard(turn, { type: 'action', pendingId: latest.id })
    return { text: line('undoFinal', lang, { title }), intent: 'undo', suggestions: [lang === 'en' ? 'Dispute a charge' : lang === 'zh' ? '我要退款' : 'Komplain tagihan', ...suggestions].slice(0, 3) }
  }
  if (isAfter(host.now(), latest.undoUntil)) {
    const goal = latest.call.tool === 'transfer_to_goal' ? findDream(state, latest.call.args.goalId)?.name : undefined
    const facts: Record<string, string> = { title, seconds: String(state.mandate.undoWindowSec) }
    if (goal && latest.preview.amount) Object.assign(facts, { goal, amount: f(latest.preview.amount) })
    addCard(turn, { type: 'action', pendingId: latest.id })
    return { text: line('undoExpired', lang, facts), intent: 'undo', suggestions }
  }
  const res = undoPending(host, latest.id)
  if (!res.ok) return { text: res.error ?? 'I couldn’t undo that.', intent: 'undo', suggestions }
  addCard(turn, { type: 'action', pendingId: latest.id })
  trace(turn, 'tool_result', `Undone: ${title}`, { pendingId: latest.id, tool: latest.call.tool })
  const movesMoney = isToolName(latest.call.tool) && TOOL_SPECS[latest.call.tool].movesMoney
  const text = movesMoney && latest.preview.amount ? line('undoMoney', lang, { amount: f(latest.preview.amount) }) : line('undoOther', lang, { title })
  return { text, intent: 'undo', suggestions }
}

const HINT_ARGS: Partial<Record<ToolName, (args: Record<string, unknown>, h: SlotHints) => Record<string, unknown> | null>> = {
  transfer_to_goal: (a, h) => patch(a, { amount: h.amount, goalId: h.goalId }),
  withdraw_from_goal: (a, h) => patch(a, { amount: h.amount, goalId: h.goalId }),
  set_category_budget: (a, h) => patch(a, { limit: h.amount, category: h.category }),
  create_tripwire: (a, h) => patch(a, { threshold: a.kind === 'single_over' || a.kind === 'daily_over' ? h.amount : h.percent, category: a.kind === 'category_pct' ? h.category : undefined }),
  pay_bill: (a, h) => patch(a, { billId: h.billId }),
  cancel_subscription: (a, h) => patch(a, { recurringId: h.recurringId }),
  set_bill_reminder: (a, h) => patch(a, { billId: h.billId }),
}

function patch(args: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> | null {
  const next = { ...args }
  let changed = false
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || next[k] === v) continue
    next[k] = v
    changed = true
  }
  return changed ? next : null
}

function correctionReply(host: AgentHost, turn: Turn, body: string): Reply | null {
  const state = host.state()
  const lang = langOf(turn)
  const ctx = nluContext(host)
  const clar = state.dialogue.pendingClarification
  if (clar) {
    const filled = fillClarification(clar, body, ctx)
    if (filled) return resumeClarification(host, turn, clar, filled, body)
  }
  const last = state.pending.find((p) => p.id === state.dialogue.lastProposalId)
  if (!last || !isToolName(last.call.tool)) return null
  const hints = slotHints(body, ctx)
  // "make it ¥450" on a bill: bills are paid in full — say so and keep the one card that is already there
  if (last.call.tool === 'pay_bill' && last.status === 'pending' && hints.amount !== undefined && !hints.billId) {
    const bill = findBill(state, last.call.args.billId)
    if (bill) {
      addCard(turn, { type: 'action', pendingId: last.id })
      const facts = { bill: bill.name, due: money(state)(bill.amountDue) }
      addSource(turn, facts)
      trace(turn, 'intent', 'correction (dialogue): bill amounts are fixed', { act: 'correction', tool: 'pay_bill', pendingId: last.id })
      return { text: line('billAmountKeep', lang, facts), intent: 'pay_bill', suggestions: chips(turn, 'pay_bill') }
    }
  }
  const next = HINT_ARGS[last.call.tool]?.(last.call.args, hints)
  if (!next) return null
  trace(turn, 'intent', 'correction (dialogue)', { act: 'correction', tool: last.call.tool, from: summarizeArgs(last.call.args), to: summarizeArgs(next), previous: last.id })
  const intent = TOOL_INTENT[last.call.tool] ?? 'unknown'
  const spec = TOOL_SPECS[last.call.tool]
  if (last.status === 'executed') {
    if (spec.tier !== 1 || !spec.reversible) {
      return { text: line('correctedExecuted', lang, { seconds: String(state.mandate.undoWindowSec) }), intent: 'correction', suggestions: [lang === 'zh' ? '撤销' : lang === 'id' ? 'Batalkan yang tadi' : 'Undo that', ...chips(turn, intent)].slice(0, 3) }
    }
    // a reversible setting (budget, tripwire, reminder): put the old value back, then apply the corrected one
    if (last.undoUntil && !isAfter(host.now(), last.undoUntil)) undoPending(host, last.id)
    host.audit('user', 'user_action', `Correction: ${last.preview.title}`, { type: 'correction', pendingId: last.id, tool: last.call.tool, from: summarizeArgs(last.call.args), to: summarizeArgs(next) })
    const r = runGated(host, turn, newCall(last.call.tool, next, 'offline', turn))
    turn.dialogue.lastIntent = intent
    return actionReply(host, turn, intent, r, line('corrected', lang))
  }
  if (last.status === 'pending') rejectPending(host, last.id, 'corrected')
  const r = runGated(host, turn, newCall(last.call.tool, next, 'offline', turn))
  turn.dialogue.lastIntent = intent
  const prefix = last.status === 'pending' ? line('correctedPending', lang) : line('corrected', lang)
  return actionReply(host, turn, intent, r, prefix)
}

function resumeClarification(host: AgentHost, turn: Turn, clar: Clarification, slots: Record<string, unknown>, text: string): Reply {
  turn.dialogue.pendingClarification = null
  const { _asks: _drop, ...clean } = slots
  void _drop
  trace(turn, 'intent', `Clarification answered: ${clar.missing}`, {
    intent: clar.intent, missing: clar.missing, filled: summarizeArgs({ [clar.missing]: clean[clar.missing] }),
    effective: { intent: clar.intent, slots: summarizeArgs(clean) },
  })
  return runIntent(host, turn, clar.intent as Intent, clean as Slots, text)
}

const ENTITY_SLOTS = ['goalId', 'billId', 'recurringId'] as const

/**
 * An open question vs. what the user just said: a full new command (its own rule, a different intent, or a
 * different goal / bill / subscription than the one stored) starts that command; an answer fills the gap; a
 * second miss — or a long message that is clearly about something else — lets the question go.
 */
function handleClarification(host: AgentHost, turn: Turn, clar: Clarification, text: string, ctx: NluContext): Reply | null {
  const nlu = understand(text, ctx)
  const stored = clar.slots as Record<string, unknown>
  const conflicting = ENTITY_SLOTS.some((k) => nlu.slots[k] !== undefined && stored[k] !== undefined && nlu.slots[k] !== stored[k])
  const ownCommand = Boolean(nlu.rule) && nlu.intent !== 'unknown' && (nlu.intent !== clar.intent || conflicting || hasActionVerb(nlu, text))
  if (ownCommand || nlu.override) {
    turn.dialogue.pendingClarification = null
    trace(turn, 'intent', 'Open question dropped: a new request', { intent: clar.intent, missing: clar.missing, next: nlu.intent })
    return null
  }
  const filled = fillClarification(clar, text, ctx)
  if (filled) return resumeClarification(host, turn, clar, filled, text)
  if (nlu.intent !== 'unknown' && (nlu.rule || nlu.confidence >= 0.6)) {
    turn.dialogue.pendingClarification = null
    return null
  }
  const asks = Number(stored._asks ?? 0)
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (asks >= 1 || words > 5) {
    turn.dialogue.pendingClarification = null
    trace(turn, 'intent', 'Open question released after a miss', { intent: clar.intent, missing: clar.missing })
    return null
  }
  const again: Clarification = { ...clar, slots: { ...stored, _asks: asks + 1 } }
  turn.dialogue.pendingClarification = again
  return reAsk(turn, again)
}

/** A rule-decided request that names its own action ("Move ¥300 to Chengdu") is a command, not an answer. */
function hasActionVerb(nlu: NluResult, text: string): boolean {
  if (nlu.rule === 'R-BARE-AMOUNT') return false
  return ACTION_VERB_RE.test(text) && (nlu.slots.amount !== undefined || ENTITY_SLOTS.some((k) => nlu.slots[k] !== undefined))
}

function reAsk(turn: Turn, clar: Clarification): Reply {
  const lang = langOf(turn)
  const choices: Choice[] = choicesOf(clar)
  const question = line(choices.length ? 'reaskChoices' : 'reaskOpen', lang)
  if (choices.length) addCard(turn, { type: 'clarify', question, options: choices.map((c) => ({ label: c.label, value: c.label })) })
  trace(turn, 'intent', `Clarification repeated: ${clar.missing}`, { intent: clar.intent })
  return { text: question, intent: clar.intent, suggestions: choices.map((c) => c.label).slice(0, 4) }
}

function planRecoveryReply(host: AgentHost, turn: Turn, text: string): Reply | null {
  const ctx = nluContext(host)
  const hints = slotHints(text, ctx)
  if (hints.amount !== undefined) return null
  trace(turn, 'intent', 'plan_recovery (dialogue)', { act: 'plan_recovery', goalId: hints.goalId, engine: 'offline' })
  turn.dialogue.pendingClarification = null
  turn.dialogue.lastIntent = 'plan_recovery'
  const outcome = runRecoveryPlan(host, turn, { goalId: hints.goalId })
  turn.cards.unshift({ type: 'plan', planId: outcome.plan.id })
  for (const step of outcome.plan.steps) if (step.pendingId && step.status === 'needs_approval') addCard(turn, { type: 'action', pendingId: step.pendingId })
  const last = outcome.plan.steps.filter((s) => s.pendingId).map((s) => s.pendingId as string).pop()
  if (last) turn.dialogue.lastProposalId = last
  return { text: planReply(outcome, host.state(), toneOf(host.state())), intent: 'plan_recovery', suggestions: ['Stop', 'Show my goals', 'Where did my money go?'] }
}

/**
 * "Explain my electricity bill": X-ray the stored bill text (untrusted) — never a payment. Resolved against every
 * bill, paid ones included (the latest statement with text), so the injection scan runs before and after paying.
 */
function explainBill(host: AgentHost, turn: Turn, text: string): Reply | null {
  const state = host.state()
  const latestFirst = [...state.bank.bills].filter((b) => b.rawText).sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0))
  const seen = new Set<string>()
  const named = latestFirst.filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)))
  const ctx = { ...nluContext(host), bills: named.map((b) => ({ id: b.id, name: b.name })) }
  const billId = understand(text, ctx).slots.billId
  const bill = findBill(state, billId) ?? findBill(state, understand(text, nluContext(host)).slots.billId)
  if (!bill?.rawText) return null
  trace(turn, 'intent', 'explain_bill (dialogue)', { act: 'explain_bill', billId: bill.id, period: bill.period, status: bill.status, engine: 'offline' })
  turn.dialogue.lastIntent = 'xray'
  return readReply(host, turn, { kind: 'read', intent: 'xray', tool: 'xray_bill', args: { text: bill.rawText.slice(0, 8000) } })
}

function xrayPaste(host: AgentHost, turn: Turn, text: string): Reply {
  const body = understand(text.slice(0, 8000), nluContext(host)).slots.text ?? text
  trace(turn, 'intent', 'xray (pasted bill)', { intent: 'xray', chars: body.length, engine: 'offline' })
  turn.dialogue.lastIntent = 'xray'
  return readReply(host, turn, { kind: 'read', intent: 'xray', tool: 'xray_bill', args: { text: body.slice(0, 8000) } })
}

/** Unpaid bills a step-up is waiting on (for "never type your PIN in chat" replies). */
export function awaitingStepUp(state: AppState): PendingAction | undefined {
  const awaiting = state.pending.filter((p) => p.status === 'pending' && p.decision.decision === 'step_up')
  return awaiting.find((p) => p.id === state.dialogue.lastProposalId) ?? awaiting[awaiting.length - 1]
}
