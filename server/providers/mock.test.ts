import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '../../src/core/agent/llm'
import { buildSystemPrompt } from '../../src/core/agent/prompts'
import { ProviderError, type ProviderRequest } from './types'
import {
  createMockProvider,
  detectIntent,
  fmtMoney,
  MOCK_HALLUCINATED_MINOR,
  MOCK_INJECT_AMOUNT,
  MOCK_INJECT_TARGET,
  mockReply,
  moneyFromSystem,
  parseAmountMinor,
} from './mock'

const SYSTEM = buildSystemPrompt({ name: 'Mei', currency: 'CNY', today: '2026-10-22', tone: 'cheeky', autonomy: 'copilot' })
const req = (messages: LlmMessage[], system = SYSTEM): ProviderRequest => ({ system, messages, tools: [], maxTokens: 512 })
const ask = (text: string) => req([{ role: 'user', content: text }])

function roundTrip(question: string, result: unknown, isError = false): ProviderRequest {
  const first = mockReply(ask(question))
  const call = first.content.find((b) => b.type === 'tool_use')
  if (!call || call.type !== 'tool_use') throw new Error('expected a tool call')
  return req([
    { role: 'user', content: question },
    { role: 'assistant', content: first.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result), is_error: isError }] },
  ])
}

const textOf = (r: ReturnType<typeof mockReply>) => r.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')

describe('parseAmountMinor', () => {
  it.each([
    ['Can I afford ¥1,299 headphones?', 129_900],
    ['¥486.20 bill', 48_620],
    ['¥2.5k trip', 250_000],
    ['1299 yuan', 129_900],
    ['spend 300 on shoes', 30_000],
    ['$12.5', 1_250],
  ])('%s → %d', (text, minor) => expect(parseAmountMinor(text)).toBe(minor))

  it('respects currencies without minor units', () => {
    expect(parseAmountMinor('¥2,500', 1)).toBe(2_500)
  })

  it('returns null when there is no amount', () => {
    expect(parseAmountMinor('can I afford new shoes?')).toBeNull()
  })

  it('does not read amounts out of words', () => {
    expect(parseAmountMinor('perform 300')).toBe(30_000)
    expect(parseAmountMinor('abc123def')).toBeNull()
  })
})

describe('moneyFromSystem', () => {
  it('reads currency and minor units from the FundBun system prompt', () => {
    expect(moneyFromSystem(SYSTEM)).toEqual({ symbol: '¥', minorPerMajor: 100 })
    const jpy = buildSystemPrompt({ name: 'K', currency: 'JPY', today: '2026-10-22', tone: 'gentle', autonomy: 'suggest' })
    expect(moneyFromSystem(jpy)).toEqual({ symbol: '¥', minorPerMajor: 1 })
    const idr = buildSystemPrompt({ name: 'A', currency: 'IDR', today: '2026-10-22', tone: 'gentle', autonomy: 'suggest' })
    expect(moneyFromSystem(idr).symbol).toBe('Rp')
  })

  it('falls back to ¥ / 100 for unknown prompts', () => {
    expect(moneyFromSystem('anything')).toEqual({ symbol: '¥', minorPerMajor: 100 })
  })
})

describe('detectIntent', () => {
  it.each([
    ['How am I doing this month?', 'get_overview'],
    ['Show me my overview', 'get_overview'],
    ['Where did my money go?', 'get_spending_breakdown'],
    ['Breakdown by category please', 'get_spending_breakdown'],
    ['Any subscriptions I should cancel?', 'list_recurring'],
    ['Was I charged twice?', 'analyze_bills'],
    ['Check my electricity bill', 'analyze_bills'],
    ['How are my dream goals?', 'get_goals'],
    ['Any habits I should know about?', 'get_insights'],
    ['How much have I spent on milk tea this month?', 'search_transactions'],
    ['Make me a budget plan', 'create_budget_plan'],
    ['Warn me about any purchase over ¥500', 'create_tripwire'],
  ])('%s → %s', (text, tool) => expect(detectIntent(text)?.name).toBe(tool))

  it('builds check_affordability with minor units and a label', () => {
    expect(detectIntent('Can I afford ¥1,299 headphones?')).toEqual({ name: 'check_affordability', input: { amount: 129_900, label: 'headphones' } })
    expect(detectIntent('Should I buy AirPods for ¥1,899?')).toEqual({ name: 'check_affordability', input: { amount: 189_900, label: 'AirPods' } })
  })

  it('only proposes transfer_to_goal with an explicit goal id and amount', () => {
    expect(detectIntent('stash ¥620 in dream_birkin')).toEqual({ name: 'transfer_to_goal', input: { goalId: 'dream_birkin', amount: 62_000 } })
    expect(detectIntent('stash ¥620 somewhere')?.name).not.toBe('transfer_to_goal')
  })

  it('cleans search queries', () => {
    expect(detectIntent('How much have I spent on milk tea this month?')?.input).toEqual({ query: 'milk tea' })
  })

  it('returns null for small talk', () => {
    expect(detectIntent('hello there')).toBeNull()
  })
})

describe('mockReply', () => {
  it('answers small talk with help text and end_turn', () => {
    const r = mockReply(ask('hello'))
    expect(r.stopReason).toBe('end_turn')
    expect(textOf(r)).toContain('Bun')
    expect(r.provider).toBe('mock')
  })

  it('emits a tool_use block with a deterministic id', () => {
    const a = mockReply(ask('How am I doing this month?'))
    const b = mockReply(ask('How am I doing this month?'))
    expect(a).toEqual(b)
    expect(a.stopReason).toBe('tool_use')
    expect(a.content).toEqual([{ type: 'tool_use', id: 'toolu_mock_1_0', name: 'get_overview', input: {} }])
  })

  it('quotes numbers from tool results, formatted as money', () => {
    const r = mockReply(roundTrip('How am I doing this month?', { spent: 1_214_000, target: 950_000, projected: 1_710_050, headline: "You could've gotten a Weekend in Chengdu." }))
    expect(r.stopReason).toBe('end_turn')
    const text = textOf(r)
    expect(text).toContain("You could've gotten a Weekend in Chengdu.")
    expect(text).toContain('spent ¥12,140')
    expect(text).toContain('target ¥9,500')
    expect(text).toContain('projected ¥17,100.50')
  })

  it('quotes verdicts, percentages and hours', () => {
    const text = textOf(mockReply(roundTrip('Can I afford ¥1,299 headphones?', { verdict: 'think', remainingAfter: -120_000, hoursOfWork: 12.34, equivalents: [{ fraction: 0.013, pct: 1.3 }] })))
    expect(text).toContain('verdict "think"')
    expect(text).toContain('remaining after -¥1,200')
    expect(text).toContain('12.3 hours of work')
  })

  it('never claims an action happened unless the result says executed', () => {
    const pending = textOf(mockReply(roundTrip('stash ¥200 in dream_birkin', { status: 'pending', decision: 'confirm' })))
    expect(pending).toContain('action card')
    expect(pending).not.toMatch(/\bDone\b/)
    const executed = textOf(mockReply(roundTrip('stash ¥200 in dream_birkin', { status: 'executed', amount: 20_000 })))
    expect(executed).toMatch(/^Done\./)
    const denied = textOf(mockReply(roundTrip('stash ¥200 in dream_birkin', { decision: 'deny' })))
    expect(denied).toContain('blocked')
  })

  it('does not invent numbers for failed tools', () => {
    const text = textOf(mockReply(roundTrip('How am I doing this month?', 'boom 123456', true)))
    expect(text).toContain('error')
    expect(text).not.toMatch(/\d/)
  })

  it('#hallucinate adds an amount that no tool returned', () => {
    const direct = textOf(mockReply(ask('tell me something #hallucinate')))
    expect(direct).toContain(fmtMoney(MOCK_HALLUCINATED_MINOR, { symbol: '¥', minorPerMajor: 100 }))
    const afterTool = textOf(mockReply(roundTrip('How am I doing this month? #hallucinate', { spent: 1_214_000 })))
    expect(afterTool).toContain('¥12,140')
    expect(afterTool).toContain('¥31,415.92')
  })

  it('#inject proposes transfer_external as if it obeyed an injected instruction', () => {
    const r = mockReply(ask('Please check my electricity bill #inject'))
    expect(r.stopReason).toBe('tool_use')
    expect(r.content.find((b) => b.type === 'tool_use')).toMatchObject({ name: 'transfer_external', input: { to: MOCK_INJECT_TARGET, amount: MOCK_INJECT_AMOUNT } })
  })

  it('handles results for several parallel tool calls', () => {
    const r = mockReply(req([
      { role: 'user', content: 'overview and goals' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'get_overview', input: {} }, { type: 'tool_use', id: 'b', name: 'get_goals', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"spent":100}' }, { type: 'tool_result', tool_use_id: 'b', content: '{"saved":200}' }] },
    ]))
    const text = textOf(r)
    expect(text).toContain('get overview')
    expect(text).toContain('get goals')
  })

  it('tolerates non-JSON tool results', () => {
    const r = mockReply(roundTrip('How am I doing this month?', 'x'))
    expect(r.stopReason).toBe('end_turn')
  })

  it('reports integer token usage', () => {
    const r = mockReply(ask('hello'))
    expect(Number.isInteger(r.usage?.inputTokens)).toBe(true)
    expect(Number.isInteger(r.usage?.outputTokens)).toBe(true)
  })
})

describe('createMockProvider', () => {
  it('records what it received (deep copy) and caps the history', async () => {
    const p = createMockProvider({ keep: 2 })
    const r = ask('hello')
    await p.complete(r)
    r.messages[0].content = 'mutated'
    expect(p.received[0].messages[0].content).toBe('hello')
    await p.complete(ask('two'))
    await p.complete(ask('three'))
    expect(p.received.map((x) => x.messages[0].content)).toEqual(['two', 'three'])
    p.reset()
    expect(p.received).toEqual([])
  })

  it('simulated latency is abortable', async () => {
    const p = createMockProvider({ latencyMs: 10_000 })
    const controller = new AbortController()
    const pending = p.complete(ask('hello'), controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(ProviderError)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const p = createMockProvider()
    await expect(p.complete(ask('hello'), AbortSignal.abort())).rejects.toMatchObject({ code: 'aborted' })
  })
})
