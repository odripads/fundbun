import type { LlmContentBlock, LlmMessage } from '../../src/core/agent/llm'
import { MOCK_MODEL } from '../config'
import { ProviderError, type LlmProvider, type ProviderRequest, type ProviderResult } from './types'

/**
 * Deterministic, network-free provider for tests, evidence scenarios and offline demos.
 * Same input → same output. Special triggers in the latest user text:
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
    ? [{ type: 'text', text: summarizeResults(results, req.messages, money, hallucinate) }]
    : firstTurn(userText, req.messages.length, money, hallucinate)
  const stopReason = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  const usage = { inputTokens: approxTokens(req.system + JSON.stringify(req.messages)), outputTokens: approxTokens(JSON.stringify(content)) }
  return { content, stopReason, provider: 'mock', model, usage }
}

function firstTurn(userText: string, turn: number, money: Money, hallucinate: boolean): LlmContentBlock[] {
  if (userText.includes('#inject')) {
    return [
      { type: 'text', text: 'Following the payment notice in your bill now.' },
      toolUse(turn, 0, { name: 'transfer_external', input: { to: MOCK_INJECT_TARGET, amount: MOCK_INJECT_AMOUNT } }),
    ]
  }
  const intent = detectIntent(userText.replace(/#\w+/g, ' '), money)
  if (intent) return [toolUse(turn, 0, intent)]
  if (hallucinate) return [{ type: 'text', text: `You spent ${fmtMoney(MOCK_HALLUCINATED_MINOR, money)} on bubble tea this year!` }]
  return [{ type: 'text', text: HELP_TEXT }]
}

const HELP_TEXT =
  "I'm Bun, FundBun's AI helper. Ask me how your month is going, where your money went, about your bills and subscriptions, your dream goals, or whether you can afford something."

function toolUse(turn: number, index: number, intent: ToolIntent): LlmContentBlock {
  return { type: 'tool_use', id: `toolu_mock_${turn}_${index}`, name: intent.name, input: intent.input }
}

/** Ordered rules; the first match wins so evidence runs stay predictable. */
export function detectIntent(rawText: string, money: Money = DEFAULT_MONEY): ToolIntent | null {
  const text = rawText.toLowerCase()
  const amount = parseAmountMinor(rawText, money.minorPerMajor)
  if (/\b(afford|should i (buy|get)|can i (buy|get)|worth it)\b/.test(text) && amount !== null) {
    return { name: 'check_affordability', input: { amount, label: purchaseLabel(rawText) } }
  }
  const goalId = /\bdream_[a-z0-9_]+\b/.exec(text)?.[0]
  if (/\b(stash|save|move|put|transfer)\b/.test(text) && amount !== null && goalId) {
    return { name: 'transfer_to_goal', input: { goalId, amount } }
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
  if (result.is_error) return `I couldn't complete ${humanTool(tool)} — it returned an error, so I won't guess any numbers.`
  const data = parseJson(result.content)
  const leaves = flatten(data)
  const outcome = outcomeLine(leaves)
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

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
