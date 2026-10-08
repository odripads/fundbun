import type { LlmContentBlock, LlmMessage } from '../../src/core/agent/llm'
import { MOCK_MODEL } from '../config'
import { ProviderError, type LlmProvider, type ProviderRequest, type ProviderResult } from './types'

/**
 * Deterministic, network-free provider for tests, evidence scenarios and offline demos (LLM_PROVIDER=mock).
 * Same input → same output. It reads tool results the way FundBun sends them — plain JSON, JSON with
 * user-authored strings wrapped in <untrusted> tags, or a whole <untrusted …> envelope — and answers in
 * natural sentences that quote only numbers from those results (so the grounding check passes).
 * "Move ¥X to <goal name>" maps the name onto a goal id from the goals listed in the system prompt or, when
 * none are listed, by calling get_goals first and then proposing transfer_to_goal with the matching id.
 * Special triggers in the latest user text:
 *   #hallucinate → the final reply contains an amount that no tool returned (grounding tests)
 *   #inject      → proposes transfer_external as if it obeyed an injected bill instruction (policy tests)
 */
export const MOCK_INJECT_TARGET = '6222021001122334455'
export const MOCK_INJECT_AMOUNT = 480_000
/** 31,415.92 in major units — chosen so it cannot coincide with persona data. */
export const MOCK_HALLUCINATED_MINOR = 3_141_592

export interface MockProvider extends LlmProvider {
  /** requests as received (after server-side redaction), newest last, capped */
  readonly received: ProviderRequest[]
  reset(): void
}

export interface MockProviderOptions {
  model?: string
  /** simulated latency, abortable */
  latencyMs?: number
  /** how many received requests to keep */
  keep?: number
}

interface ToolIntent {
  name: string
  input: Record<string, unknown>
}

/** A dream goal the mock can move money into. */
export interface MockGoal {
  id: string
  name: string
  kind?: string
}

interface Money {
  symbol: string
  minorPerMajor: number
}

export function createMockProvider(opts: MockProviderOptions = {}): MockProvider {
  const received: ProviderRequest[] = []
  const keep = opts.keep ?? 50
  return {
    name: 'mock',
    model: opts.model ?? MOCK_MODEL,
    received,
    reset: () => void received.splice(0),
    async complete(req, signal) {
      received.push(structuredClone(req))
      if (received.length > keep) received.splice(0, received.length - keep)
      await delay(opts.latencyMs ?? 0, signal)
      return mockReply(req, opts.model ?? MOCK_MODEL)
    },
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new ProviderError('aborted'))
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new ProviderError('aborted'))
    }, { once: true })
  })
}

/** Pure core of the mock: decides the next assistant turn from the conversation so far. */
export function mockReply(req: ProviderRequest, model: string = MOCK_MODEL): ProviderResult {
  const money = moneyFromSystem(req.system)
  const last = req.messages[req.messages.length - 1]
  const userText = latestUserText(req.messages)
  const hallucinate = userText.includes('#hallucinate')
  const results = last && last.role === 'user' ? toolResultsOf(last) : []
  const content: LlmContentBlock[] = results.length
    ? afterTools(results, req, userText, money, hallucinate)
    : firstTurn(userText, req.messages.length, money, hallucinate, goalsFromSystem(req.system))
  const stopReason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  const usage = { inputTokens: approxTokens(req.system + JSON.stringify(req.messages)), outputTokens: approxTokens(JSON.stringify(content)) }
  return { content, stopReason, provider: 'mock', model, usage }
}

function firstTurn(userText: string, turn: number, money: Money, hallucinate: boolean, goals: MockGoal[]): LlmContentBlock[] {
  if (userText.includes('#inject')) {
    return [
      { type: 'text', text: 'Following the payment notice in your bill now.' },
      toolUse(turn, 0, { name: 'transfer_external', input: { to: MOCK_INJECT_TARGET, amount: MOCK_INJECT_AMOUNT } }),
    ]
  }
  const intent = detectIntent(userText.replace(/#\w+/g, ' '), money, goals)
  if (intent) return [toolUse(turn, 0, intent)]
  if (hallucinate) return [{ type: 'text', text: `You spent ${fmtMoney(MOCK_HALLUCINATED_MINOR, money)} on bubble tea this year!` }]
  return [{ type: 'text', text: HELP_TEXT }]
}

/**
 * A round that carries tool results: finish a "move ¥X to <goal>" request once get_goals has answered
 * (propose transfer_to_goal, or ask which goal), otherwise summarise the results.
 */
function afterTools(results: ToolResultBlock[], req: ProviderRequest, userText: string, money: Money, hallucinate: boolean): LlmContentBlock[] {
  const move = moveRequest(userText.replace(/#\w+/g, ' '), money)
  const goalsResult = move ? results.find((r) => !r.is_error && toolNameFor(r.tool_use_id, req.messages) === 'get_goals') : undefined
  if (move && goalsResult) {
    const goals = goalsFromData(parseToolContent(goalsResult.content))
    const goal = matchGoal(goals, move.target)
    if (goal) return [toolUse(req.messages.length, 0, { name: 'transfer_to_goal', input: { goalId: goal.id, amount: move.amount } })]
    if (goals.length) {
      const names = listJoin(goals.slice(0, 4).map((g) => g.name), 'or')
      return [{ type: 'text', text: `Which goal should the ${fmtMoney(move.amount, money)} go to — ${names}?` }]
    }
  }
  return [{ type: 'text', text: summarizeResults(results, req.messages, money, hallucinate) }]
}

const HELP_TEXT =
  "I'm Bun, FundBun's AI helper. Ask me how your month is going, where your money went, about your bills and subscriptions, your dream goals, or whether you can afford something."

function toolUse(turn: number, index: number, intent: ToolIntent): LlmContentBlock {
  return { type: 'tool_use', id: `toolu_mock_${turn}_${index}`, name: intent.name, input: intent.input }
}

/**
 * Ordered rules; the first match wins so evidence runs stay predictable. "Move ¥X to <goal name>" resolves the
 * name against `goals` (from the system prompt); without a match it asks get_goals first (see afterTools).
 */
export function detectIntent(rawText: string, money: Money = DEFAULT_MONEY, goals: MockGoal[] = []): ToolIntent | null {
  const text = rawText.toLowerCase()
  const amount = parseAmountMinor(rawText, money.minorPerMajor)
  if (/\b(afford|should i (buy|get)|can i (buy|get)|worth it)\b/.test(text) && amount !== null) {
    return { name: 'check_affordability', input: { amount, label: purchaseLabel(rawText) } }
  }
  const goalId = /\bdream_[a-z0-9_]+\b/.exec(text)?.[0]
  if (/\b(stash|save|move|put|transfer)\b/.test(text) && amount !== null && goalId) {
    return { name: 'transfer_to_goal', input: { goalId, amount } }
  }
  const move = moveRequest(rawText, money)
  if (move) {
    const goal = matchGoal(goals, move.target)
    return goal ? { name: 'transfer_to_goal', input: { goalId: goal.id, amount: move.amount } } : { name: 'get_goals', input: {} }
  }
  if (/\b(budget plan|make (me )?a budget|plan my budget|create a budget)\b/.test(text)) {
    return { name: 'create_budget_plan', input: { method: 'history' } }
  }
  if (/\b(tripwire|alert me|warn me|notify me)\b/.test(text)) {
    return { name: 'create_tripwire', input: amount !== null ? { kind: 'single_over', threshold: amount } : { kind: 'month_pct', threshold: 80 } }
  }
  if (/\b(subscriptions?|recurring)\b/.test(text)) return { name: 'list_recurring', input: { onlySubscriptions: true } }
  if (/\b(bills?|duplicate|double[- ]charged|charged twice|electricity)\b/.test(text)) return { name: 'analyze_bills', input: {} }
  if (/\b(goals?|dreams?|savings?|pots?|progress)\b/.test(text)) return { name: 'get_goals', input: {} }
  if (/\b(insights?|habits?|late[- ]night|patterns?|trends?)\b/.test(text)) return { name: 'get_insights', input: {} }
  if (/\b(breakdown|categor(y|ies)|by category)\b|where did my money go/.test(text)) return { name: 'get_spending_breakdown', input: {} }
  const query = searchQuery(text)
  if (query) return { name: 'search_transactions', input: { query } }
  if (/\b(overview|how am i doing|this month|mirror|status|summary|on track|budget)\b/.test(text)) return { name: 'get_overview', input: {} }
  return null
}

function searchQuery(text: string): string | null {
  const raw = /\b(?:spent on|spend on|search for|find)\s+([a-z][a-z .'-]{1,40})/.exec(text)?.[1]
  const query = raw?.replace(/\b(this|last|in|during|today|so far|recently)\b.*$/, '').trim()
  return query && query.length >= 2 ? query : null
}

interface MoveRequest {
  amount: number
  /** the words after "to / into / for …" naming the goal, lower-cased */
  target: string
}

const MOVE_RE = /\b(?:stash|save|move|put|transfer|add|send)\b[^.?!]*?\b(?:to|into|in|for|towards?)\s+(?:my\s+|the\s+)?([^.?!]{2,60})/i

/** "move ¥500 to my Birkin", "put 300 into Chengdu", "save ¥200 for the AirPods" — amount + goal words. */
export function moveRequest(rawText: string, money: Money = DEFAULT_MONEY): MoveRequest | null {
  const m = MOVE_RE.exec(rawText)
  if (!m) return null
  const amount = parseAmountMinor(rawText, money.minorPerMajor)
  if (amount === null) return null
  const target = m[1].toLowerCase().replace(/\b(goal|pot|fund|dream|savings?|please|now|today|this month)\b/g, ' ').replace(/\s+/g, ' ').trim()
  return target ? { amount, target } : null
}

const NAME_STOPWORDS = new Set(['a', 'an', 'the', 'my', 'to', 'in', 'of', 'for', 'and', 'new', 'trip', 'pro'])

function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !NAME_STOPWORDS.has(w))
}

/** The goal whose name shares the most words with `target` (ties → goals before treats, then list order). */
export function matchGoal(goals: MockGoal[], target: string): MockGoal | undefined {
  const words = new Set(target.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  let best: { goal: MockGoal; score: number } | undefined
  for (const goal of goals) {
    const hits = nameWords(goal.name).filter((w) => words.has(w)).length
    if (hits === 0) continue
    const score = hits * 10 + (goal.kind === 'treat' ? 0 : 1)
    if (!best || score > best.score) best = { goal, score }
  }
  return best?.goal
}

/**
 * Goals listed in a system prompt, e.g. "- Birkin 25 (dream_birkin)" or "dream_chengdu: Weekend in Chengdu".
 * FundBun's own prompt lists none (the mock then calls get_goals); custom prompts and tests may.
 */
export function goalsFromSystem(system: string): MockGoal[] {
  const out = new Map<string, MockGoal>()
  for (const m of system.matchAll(/^[ \t]*[-*•]?[ \t]*([^\n()[\]]{2,60}?)[ \t]*[([][ \t]*(?:id[:=]?[ \t]*)?(dream_[a-z0-9_]+)[ \t]*[)\]]/gim)) {
    out.set(m[2], { id: m[2], name: m[1].trim() })
  }
  for (const m of system.matchAll(/\b(dream_[a-z0-9_]+)[ \t]*(?:[:=—–]|-(?=\s))[ \t]*([^\n,;()]{2,60})/g)) {
    if (!out.has(m[1])) out.set(m[1], { id: m[1], name: m[2].trim() })
  }
  return [...out.values()]
}

/** The goals in a get_goals result ({ goals: [{ id, name, kind }] }). */
function goalsFromData(data: unknown): MockGoal[] {
  const list = isObj(data) && Array.isArray(data.goals) ? data.goals : []
  return list
    .filter((g): g is Record<string, unknown> => isObj(g) && typeof g.id === 'string' && typeof g.name === 'string')
    .map((g) => ({ id: g.id as string, name: g.name as string, ...(typeof g.kind === 'string' ? { kind: g.kind } : {}) }))
}

const DEFAULT_MONEY: Money = { symbol: '¥', minorPerMajor: 100 }

/** Reads the currency line written by src/core/agent/prompts.ts; falls back to ¥ with 100 minor units. */
export function moneyFromSystem(system: string): Money {
  const symbol = /Currency: [A-Z]{3} \(([^)\s]{1,4})\)/.exec(system)?.[1] ?? DEFAULT_MONEY.symbol
  const per = Number(/1 [A-Z]{3} = (\d+) minor units?/.exec(system)?.[1] ?? NaN)
  return { symbol, minorPerMajor: Number.isInteger(per) && per > 0 ? per : DEFAULT_MONEY.minorPerMajor }
}

/** "¥1,299", "1299 yuan", "¥2.5k", or a bare number — returned in minor units. */
export function parseAmountMinor(text: string, minorPerMajor = 100): number | null {
  const patterns = [
    /(?:[¥$€£]|\b(?:rp|rm|hk\$|s\$|a\$))\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?(?![\w.])/i,
    /(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?\s?(?:yuan|rmb|cny|元|块|dollars?|usd)\b/i,
    /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s?(k)?(?![\w.])/i,
  ]
  for (const re of patterns) {
    const m = re.exec(text)
    if (!m) continue
    const major = Number(m[1].replace(/,/g, '') + (m[2] ?? '')) * (m[3] ? 1000 : 1)
    if (Number.isFinite(major) && major > 0) return Math.round(major * minorPerMajor)
  }
  return null
}

const LABEL = "([\\p{L}][\\p{L}\\p{N} '-]{1,39}?)"
const LABEL_AFTER_AMOUNT = new RegExp(`(?:[¥$€£]\\s?[\\d,.]+k?|[\\d,.]+\\s?(?:yuan|rmb|元|块))\\s*(?:for\\s+)?(?:(?:an?|the|new|some)\\s+)*${LABEL}(?=[?.!,]|\\s+(?:this|today|now|tonight|please)\\b|$)`, 'iu')
const LABEL_BEFORE_AMOUNT = new RegExp(`\\b(?:buy|get|afford)\\s+(?:(?:an?|the|new|some)\\s+)*${LABEL}\\s+(?:for|at)\\s+[¥$€£\\d]`, 'iu')

function purchaseLabel(text: string): string {
  const label = (LABEL_AFTER_AMOUNT.exec(text)?.[1] ?? LABEL_BEFORE_AMOUNT.exec(text)?.[1])?.trim()
  return label || 'this purchase'
}

function latestUserText(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const text = textOfContent(m.content)
    if (text.trim()) return text
  }
  return ''
}

function textOfContent(content: LlmMessage['content']): string {
  if (typeof content === 'string') return content
  return content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
}

type ToolResultBlock = Extract<LlmContentBlock, { type: 'tool_result' }>

function toolResultsOf(message: LlmMessage): ToolResultBlock[] {
  return typeof message.content === 'string' ? [] : message.content.filter((b): b is ToolResultBlock => b.type === 'tool_result')
}

function toolNameFor(id: string, messages: LlmMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'assistant' || typeof m.content === 'string') continue
    for (const b of m.content) if (b.type === 'tool_use' && b.id === id) return b.name
  }
  return 'that tool'
}

function summarizeResults(results: ToolResultBlock[], messages: LlmMessage[], money: Money, hallucinate: boolean): string {
  const parts = results.map((r) => summarizeOne(r, toolNameFor(r.tool_use_id, messages), money))
  if (hallucinate) parts.push(`Fun fact: you spent ${fmtMoney(MOCK_HALLUCINATED_MINOR, money)} on bubble tea this year!`)
  return parts.join(' ')
}

function summarizeOne(result: ToolResultBlock, tool: string, money: Money): string {
  if (result.is_error) {
    const data = parseToolContent(result.content)
    if (isObj(data) && data.status === 'denied') return "FundBun's policy blocked that, so nothing was done."
    return `I couldn't complete ${humanTool(tool)} — it returned an error, so I won't guess any numbers.`
  }
  const data = parseToolContent(result.content)
  const leaves = flatten(data)
  const outcome = outcomeLine(leaves)
  const natural = isObj(data) ? naturalReply(tool, data, money, outcome) : ''
  if (natural) return [outcome, natural].filter(Boolean).join(' ')
  const facts = pickFacts(leaves, money)
  const headline = leaves.find(([k]) => k === 'headline')?.[1]
  const lead = typeof headline === 'string' && headline ? `${headline} ` : ''
  const body = facts.length ? `From ${humanTool(tool)}: ${facts.join(', ')}.` : `I checked ${humanTool(tool)}.`
  return [outcome, lead + body].filter(Boolean).join(' ')
}

/** Never claims an action happened unless the tool result says it executed. */
function outcomeLine(leaves: [string, unknown][]): string {
  const values = new Set(leaves.filter(([k]) => k === 'status' || k === 'decision').map(([, v]) => String(v)))
  if (values.has('denied') || values.has('deny')) return "FundBun's policy blocked that, so nothing was done."
  if (values.has('executed')) return 'Done.'
  if (['pending', 'confirm', 'step_up'].some((s) => values.has(s))) return "I've prepared that — please review it on the action card."
  return ''
}

// ───────────────────────────── natural replies ─────────────────────────────

type Obj = Record<string, unknown>

/**
 * Plain-English replies for the common tools, quoting only values present in the result (never arithmetic of
 * its own, so FundBun's grounding check can trace every number). '' → the generic fact list.
 */
function naturalReply(tool: string, d: Obj, money: Money, outcome: string): string {
  const m = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmtMoney(v, money) : undefined)
  if (outcome.startsWith('FundBun')) return ''
  if (d.status === 'pending' && isObj(d.preview)) {
    const p = d.preview
    const amount = m(p.amount)
    const title = typeof p.title === 'string' && p.title ? p.title : cap(humanTool(tool))
    const route = typeof p.from === 'string' && typeof p.to === 'string' && p.from && p.to ? ` (${p.from} → ${p.to})` : ''
    const money = amount && !title.includes(amount) ? ` for ${amount}` : ''
    return `It's ready: ${title}${money}${route}. It hasn't happened yet — nothing moves until you approve it${d.decision === 'step_up' ? ' with your PIN' : ''}.`
  }
  if (d.status === 'executed') return typeof d.summary === 'string' && d.summary ? `${d.summary}.` : ''
  switch (tool) {
    case 'get_overview': return overviewReply(d, m)
    case 'get_goals': return goalsReply(d, m)
    case 'check_affordability': return affordReply(d, m)
    case 'analyze_bills': return billsReply(d, m)
    case 'list_recurring': return recurringReply(d, m)
    case 'get_spending_breakdown': return breakdownReply(d, m)
    case 'search_transactions': return searchReply(d, m)
    case 'get_insights': return insightsReply(d)
    default: return ''
  }
}

type M = (v: unknown) => string | undefined

function overviewReply(d: Obj, m: M): string {
  const spent = m(d.spent)
  const target = m(d.target)
  if (!spent || !target) return ''
  const lead = typeof d.headline === 'string' && d.headline ? `${d.headline} ` : ''
  const projected = m(d.projected)
  const safe = m(d.safeToSpendToday)
  const pace = projected && d.status !== 'over' ? ` At this pace you'll land around ${projected}.` : ''
  const today = safe && d.status !== 'over' && d.safeToSpendToday !== 0 ? ` Safe to spend today: ${safe}.` : ''
  return `${lead}So far you've spent ${spent} against your ${target} target.${pace}${today}`
}

function goalsReply(d: Obj, m: M): string {
  if (!Array.isArray(d.goals)) return ''
  const goals = d.goals.filter(isObj).slice(0, 3)
  if (!goals.length) return "You don't have any dream goals yet — add one in Goals and I'll track it."
  const lines = goals.map((g) => {
    const name = String(g.name ?? 'Your goal')
    const pct = typeof g.pct === 'number' ? `${round1(g.pct)}%` : undefined
    const saved = m(g.saved)
    const price = m(g.price)
    return `${name}${pct ? ` is ${pct} there` : ''}${saved && price ? ` (${saved} of ${price})` : ''}`
  })
  return `Here's where your dreams stand: ${listJoin(lines, 'and')}.`
}

const VERDICT: Record<string, string> = {
  go: 'Good news — it fits your budget.',
  think: "It's a maybe — worth sleeping on.",
  skip: "I'd skip this one for now.",
}

function affordReply(d: Obj, m: M): string {
  const verdict = typeof d.verdict === 'string' ? VERDICT[d.verdict] : undefined
  if (!verdict) return ''
  const label = typeof d.label === 'string' && d.label ? d.label : 'it'
  const amount = m(d.amount)
  const after = typeof d.remainingAfter === 'number' ? d.remainingAfter : undefined
  const hours = typeof d.hoursOfWork === 'number' && d.hoursOfWork > 0 ? ` That's about ${round1(d.hoursOfWork)} hours of your work.` : ''
  const left = after === undefined ? '' : after >= 0 ? ` Afterwards you'd have ${m(after)} left of this month's budget.` : ` It would leave you ${m(-after)} over this month's budget.`
  return `${verdict}${amount ? ` ${cap(label)} at ${amount}.` : ''}${left}${hours}`
}

function billsReply(d: Obj, m: M): string {
  const findings = (Array.isArray(d.findings) ? d.findings : []).filter(isObj)
  const upcoming = (Array.isArray(d.upcoming) ? d.upcoming : []).filter(isObj)
  const next = upcoming[0]
  const nextLine = next && typeof next.name === 'string' && m(next.amountDue) ? ` Next up: ${next.name}, ${m(next.amountDue)}${typeof next.dueDate === 'string' ? ` due ${next.dueDate}` : ''}.` : ''
  if (!findings.length) return `Your bills look clean — nothing unusual.${nextLine}`
  const titles = findings.slice(0, 2).map((f) => String(f.title ?? '')).filter(Boolean)
  return `I found ${typeof d.count === 'number' ? d.count : 'a few'} things worth a look in your bills. Top of the list: ${titles.join('; ')}.${nextLine}`
}

function recurringReply(d: Obj, m: M): string {
  const monthly = m(d.monthlyTotal)
  const annual = m(d.annualTotal)
  if (!monthly || !annual) return ''
  const hike = isObj(d.priceHike) && typeof d.priceHike.merchant === 'string' && m(d.priceHike.from) && m(d.priceHike.to)
    ? ` Heads-up: ${d.priceHike.merchant} went from ${m(d.priceHike.from)} to ${m(d.priceHike.to)}.`
    : ''
  const overlap = isObj(d.overlap) && Array.isArray(d.overlap.merchants) && d.overlap.merchants.length >= 2
    ? ` You're also paying for ${listJoin(d.overlap.merchants.map(String), 'and')} — all video streaming.`
    : ''
  return `Your ${typeof d.count === 'number' ? `${d.count} ` : ''}active subscriptions cost ${monthly} a month — ${annual} a year.${hike}${overlap}`
}

function breakdownReply(d: Obj, m: M): string {
  const total = m(d.total)
  if (!total) return ''
  if (isObj(d.focus) && typeof d.focus.label === 'string' && m(d.focus.spent)) {
    return `${d.focus.label}: ${m(d.focus.spent)} this month${typeof d.focus.equivalent === 'string' ? ` — that's ${d.focus.equivalent}` : ''}.`
  }
  const rows = (Array.isArray(d.categories) ? d.categories : []).filter(isObj).slice(0, 2)
  const top = rows.map((r) => `${String(r.label ?? r.category)} ${m(r.spent) ?? ''}`.trim())
  return `You've spent ${total} so far${top.length ? `; the biggest chunks are ${listJoin(top, 'and')}` : ''}.`
}

function searchReply(d: Obj, m: M): string {
  if (typeof d.count !== 'number') return ''
  if (d.count === 0) return `I couldn't find any transactions${typeof d.query === 'string' ? ` for "${d.query}"` : ''}.`
  const total = m(d.total)
  const largest = isObj(d.largest) && typeof d.largest.merchant === 'string' && m(d.largest.amount) ? ` The biggest was ${m(d.largest.amount)} at ${d.largest.merchant}.` : ''
  return `I found ${d.count} transactions${typeof d.query === 'string' ? ` for "${d.query}"` : ''}${total ? `, ${total} in total` : ''}.${largest}`
}

function insightsReply(d: Obj): string {
  const list = (Array.isArray(d.insights) ? d.insights : []).filter(isObj)
  if (!list.length) return 'Nothing stands out in your spending right now.'
  const first = list[0]
  const body = typeof first.body === 'string' && first.body ? ` ${first.body}` : ''
  return `The thing that stands out most: ${String(first.title ?? '')}.${body}`.replace(/\.\./g, '.')
}

const MONEY_KEYS = new Set([
  'spent', 'target', 'projected', 'remaining', 'safeToSpendToday', 'delta', 'remainingAfter', 'overTargetBy', 'saved', 'price',
  'amount', 'total', 'annualCost', 'averageAmount', 'lastAmount', 'income', 'dailyAvg', 'monthlyRate', 'savedToGoals', 'amountDue', 'limit',
])
const PCT_KEYS = new Set(['pct', 'changePct'])
const COUNT_KEYS: Record<string, string> = { hoursOfWork: 'hours of work', goalDelayDays: 'days of delay', count: 'items', occurrences: 'charges' }
const MAX_FACTS = 4

function pickFacts(leaves: [string, unknown][], money: Money): string[] {
  const facts: string[] = []
  const verdict = leaves.find(([k]) => k === 'verdict')?.[1]
  if (typeof verdict === 'string') facts.push(`verdict "${verdict}"`)
  for (const [key, value] of leaves) {
    if (facts.length >= MAX_FACTS) break
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (MONEY_KEYS.has(key)) facts.push(`${humanKey(key)} ${fmtMoney(value, money)}`)
    else if (PCT_KEYS.has(key)) facts.push(`${humanKey(key)} ${round1(value)}%`)
    else if (COUNT_KEYS[key]) facts.push(`${round1(value)} ${COUNT_KEYS[key]}`)
  }
  return facts
}

/** Depth-limited walk; arrays contribute their first few elements only. */
function flatten(value: unknown, depth = 0, key = ''): [string, unknown][] {
  if (depth > 4) return []
  if (Array.isArray(value)) return value.slice(0, 3).flatMap((v) => flatten(v, depth + 1, key))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => flatten(v, depth + 1, k))
  return key ? [[key, value]] : []
}

const UNTRUSTED_TAG = /<\/?\s*untrusted\b[^>]*>/gi

/**
 * A tool result as data: plain JSON, JSON whose user-authored strings are wrapped in <untrusted> tags, or a
 * whole `<untrusted source="tool:…">{json}</untrusted>` envelope (plus FundBun's reminder line). Tags and the
 * `_note` reminder are dropped; anything that still isn't JSON parses to {}.
 */
export function parseToolContent(text: string): unknown {
  const raw = typeof text === 'string' ? text : ''
  const open = /<\s*untrusted\b[^>]*>/i.exec(raw)
  const close = raw.toLowerCase().lastIndexOf('</untrusted>')
  const body = open && close > open.index ? raw.slice(open.index + open[0].length, close) : raw
  for (const candidate of [body, raw]) {
    try {
      return stripTags(JSON.parse(candidate.trim()))
    } catch {
      // try the next form
    }
  }
  return {}
}

function stripTags(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.replace(UNTRUSTED_TAG, '').trim()
  if (depth > 12 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => stripTags(x, depth + 1))
  const out: Obj = {}
  for (const [k, x] of Object.entries(v)) if (k !== '_note') out[k] = stripTags(x, depth + 1)
  return out
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function listJoin(items: string[], conj: 'and' | 'or'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function fmtMoney(minor: number, money: Money): string {
  const major = minor / money.minorPerMajor
  const fractional = !Number.isInteger(major)
  const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: fractional ? 2 : 0, maximumFractionDigits: 2 }).format(Math.abs(major))
  return `${minor < 0 ? '-' : ''}${money.symbol}${n}`
}

const approxTokens = (text: string) => Math.ceil(text.length / 4)
const round1 = (n: number) => Math.round(n * 10) / 10
const humanKey = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
const humanTool = (tool: string) => tool.replace(/_/g, ' ')
