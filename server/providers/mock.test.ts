import { describe, expect, it } from 'vitest'
import { fakeHost } from '../../tests/helpers/fake-host'
import type { LlmClient, LlmMessage, LlmResponse } from '../../src/core/agent/llm'
import { wrapUserText } from '../../src/core/agent/llm-engine'
import { buildSystemPrompt } from '../../src/core/agent/prompts'
import { createAgentEngine } from '../../src/core/agent/runtime'
import { wrapUntrusted } from '../../src/core/security/injection'
import { ProviderError, type ProviderRequest } from './types'
import {
  createMockProvider,
  detectIntent,
  fmtMoney,
  goalsFromSystem,
  matchGoal,
  MOCK_HALLUCINATED_MINOR,
  MOCK_INJECT_AMOUNT,
  MOCK_INJECT_TARGET,
  mockReply,
  moneyFromSystem,
  moveRequest,
  parseAmountMinor,
  parseToolContent,
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
    expect(text).toBe("You could've gotten a Weekend in Chengdu. So far you've spent ¥12,140 against your ¥9,500 target. At this pace you'll land around ¥17,100.50.")
  })

  it('quotes verdicts, percentages and hours', () => {
    const text = textOf(mockReply(roundTrip('Can I afford ¥1,299 headphones?', { label: 'headphones', amount: 129_900, verdict: 'think', remainingAfter: -120_000, hoursOfWork: 12.34, equivalents: [{ fraction: 0.013, pct: 1.3 }] })))
    expect(text).toContain("It's a maybe")
    expect(text).toContain('Headphones at ¥1,299.')
    expect(text).toContain('It would leave you ¥1,200 over')
    expect(text).toContain('12.3 hours of your work')
    // unknown shapes still fall back to the plain fact list
    const generic = textOf(mockReply(roundTrip('Can I afford ¥1,299 headphones?', { verdict: 'meh', remainingAfter: -120_000, hoursOfWork: 12.34 })))
    expect(generic).toContain('verdict "meh"')
    expect(generic).toContain('remaining after -¥1,200')
    expect(generic).toContain('12.3 hours of work')
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

const MEI_GOALS = {
  count: 4,
  goals: [
    { id: 'dream_birkin', name: 'Birkin 25', kind: 'goal', saved: 2_340_000, price: 9_800_000, pct: 23.9 },
    { id: 'dream_chengdu', name: 'Weekend in Chengdu', kind: 'goal', saved: 0, price: 240_000, pct: 0 },
    { id: 'dream_airpods', name: 'AirPods Pro', kind: 'treat', saved: 0, price: 189_900, pct: 0 },
    { id: 'dream_shoes', name: 'New running shoes', kind: 'treat', saved: 0, price: 89_900, pct: 0 },
  ],
}
/** get_goals the way FundBun sends it: dream names are user-authored, so they arrive wrapped as untrusted */
const wrappedGoals = () => JSON.stringify(wrapUserText(MEI_GOALS, MEI_GOALS.goals.map((g) => g.name)))

function toolCallOf(r: ReturnType<typeof mockReply>) {
  const call = r.content.find((b) => b.type === 'tool_use')
  if (!call || call.type !== 'tool_use') throw new Error('expected a tool call')
  return call
}

describe('parseToolContent', () => {
  it('reads plain JSON, inline <untrusted> strings and whole <untrusted> envelopes', () => {
    expect(parseToolContent('{"spent":100}')).toEqual({ spent: 100 })
    const inline = parseToolContent(wrappedGoals()) as typeof MEI_GOALS & { _note?: string }
    expect(inline._note).toBeUndefined()
    expect(inline.goals.map((g) => g.name)).toEqual(['Birkin 25', 'Weekend in Chengdu', 'AirPods Pro', 'New running shoes'])
    const envelope = wrapUntrusted('tool:search_transactions', JSON.stringify({ count: 2, total: 12_900, query: 'taobao' }))
    expect(envelope).toContain('<untrusted')
    expect(parseToolContent(envelope)).toEqual({ count: 2, total: 12_900, query: 'taobao' })
    expect(parseToolContent('<untrusted source="x">not json</untrusted>')).toEqual({})
  })

  it('answers with numbers from a wrapped result instead of giving up', () => {
    const r = mockReply(req([
      { role: 'user', content: 'How much did I spend on taobao?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'search_transactions', input: { query: 'taobao' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: wrapUntrusted('tool:search_transactions', JSON.stringify({ count: 3, total: 182_700, query: 'taobao', largest: { merchant: 'Taobao', amount: 129_900, date: '2026-10-18' } })) }] },
    ]))
    expect(textOf(r)).toBe('I found 3 transactions for "taobao", ¥1,827 in total. The biggest was ¥1,299 at Taobao.')
  })
})

describe('"move ¥X to <goal name>"', () => {
  it('moveRequest finds the amount and the goal words', () => {
    expect(moveRequest('Move ¥500 to my Birkin')).toEqual({ amount: 50_000, target: 'birkin' })
    expect(moveRequest('put 300 into the Chengdu fund please')).toEqual({ amount: 30_000, target: 'chengdu' })
    expect(moveRequest('save 500 this month')).toBeNull()
    expect(moveRequest('move it to Birkin')).toBeNull()
  })

  it('matchGoal prefers the most overlapping name, goals over treats', () => {
    expect(matchGoal(MEI_GOALS.goals, 'birkin')?.id).toBe('dream_birkin')
    expect(matchGoal(MEI_GOALS.goals, 'weekend in chengdu')?.id).toBe('dream_chengdu')
    expect(matchGoal(MEI_GOALS.goals, 'airpods')?.id).toBe('dream_airpods')
    expect(matchGoal(MEI_GOALS.goals, 'a new car')).toBeUndefined()
  })

  it('uses goals listed in the system prompt to propose transfer_to_goal directly', () => {
    const system = `${SYSTEM}\n\n## Goals\n- Birkin 25 (dream_birkin)\n- Weekend in Chengdu (dream_chengdu)`
    expect(goalsFromSystem(system)).toEqual([{ id: 'dream_birkin', name: 'Birkin 25' }, { id: 'dream_chengdu', name: 'Weekend in Chengdu' }])
    expect(goalsFromSystem('Goals: dream_macbook: MacBook Air, dream_flight — Flight home')).toEqual([
      { id: 'dream_macbook', name: 'MacBook Air' }, { id: 'dream_flight', name: 'Flight home' },
    ])
    const r = mockReply(req([{ role: 'user', content: 'Move ¥300 to Chengdu' }], system))
    expect(toolCallOf(r)).toMatchObject({ name: 'transfer_to_goal', input: { goalId: 'dream_chengdu', amount: 30_000 } })
  })

  it('without listed goals: get_goals first, then transfer_to_goal with the matching id (wrapped names)', () => {
    const question = 'Move ¥500 to my Birkin'
    const first = mockReply(ask(question))
    const call = toolCallOf(first)
    expect(call).toMatchObject({ name: 'get_goals', input: {} })
    const history: LlmMessage[] = [
      { role: 'user', content: question },
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: wrappedGoals() }] },
    ]
    const second = mockReply(req(history))
    const transfer = toolCallOf(second)
    expect(transfer).toMatchObject({ name: 'transfer_to_goal', input: { goalId: 'dream_birkin', amount: 50_000 } })
    expect(transfer.id).not.toBe(call.id)
    const pending = { status: 'pending', pendingId: 'pa_1', decision: 'confirm', message: 'Proposed to the user. It has NOT happened.', preview: { title: 'Move ¥500 to Birkin 25', amount: 50_000, from: 'Checking •••• 4821', to: 'Birkin 25 pot' } }
    const third = mockReply(req([
      ...history,
      { role: 'assistant', content: second.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: transfer.id, content: JSON.stringify(pending) }] },
    ]))
    expect(third.stopReason).toBe('end_turn')
    const text = textOf(third)
    expect(text).toContain('action card')
    expect(text).toContain('¥500')
    expect(text).toBe("I've prepared that — please review it on the action card. It's ready: Move ¥500 to Birkin 25 (Checking •••• 4821 → Birkin 25 pot). It hasn't happened yet — nothing moves until you approve it.")
    expect(text).not.toMatch(/\bDone\b/)
  })

  it('asks which goal when the name matches none', () => {
    const question = 'Move ¥500 to my yacht'
    const first = mockReply(ask(question))
    const call = toolCallOf(first)
    const r = mockReply(req([
      { role: 'user', content: question },
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: wrappedGoals() }] },
    ]))
    expect(r.stopReason).toBe('end_turn')
    expect(textOf(r)).toBe('Which goal should the ¥500 go to — Birkin 25, Weekend in Chengdu, AirPods Pro or New running shoes?')
  })
})

describe('natural replies quote tool numbers', () => {
  const after = (tool: string, data: unknown, question = 'hi') => textOf(mockReply(req([
    { role: 'user', content: question },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: tool, input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: typeof data === 'string' ? data : JSON.stringify(data) }] },
  ])))

  it('goals, bills, subscriptions, breakdown, insights, executed and denied', () => {
    expect(after('get_goals', wrappedGoals())).toBe("Here's where your dreams stand: Birkin 25 is 23.9% there (¥23,400 of ¥98,000), Weekend in Chengdu is 0% there (¥0 of ¥2,400) and AirPods Pro is 0% there (¥0 of ¥1,899).")
    expect(after('analyze_bills', { count: 6, findings: [{ title: 'Tencent Video charged you twice' }, { title: 'iQIYI went up ¥5' }], upcoming: [{ name: 'China Mobile', amountDue: 12_800, dueDate: '2026-10-25' }] }))
      .toBe('I found 6 things worth a look in your bills. Top of the list: Tencent Video charged you twice; iQIYI went up ¥5. Next up: China Mobile, ¥128 due 2026-10-25.')
    expect(after('list_recurring', { count: 6, monthlyTotal: 52_000, annualTotal: 624_000, priceHike: { merchant: 'iQIYI', from: 2_500, to: 3_000 }, overlap: { merchants: ['iQIYI', 'Tencent Video', 'Youku'] } }))
      .toBe("Your 6 active subscriptions cost ¥520 a month — ¥6,240 a year. Heads-up: iQIYI went from ¥25 to ¥30. You're also paying for iQIYI, Tencent Video and Youku — all video streaming.")
    expect(after('get_spending_breakdown', { total: 1_214_000, categories: [{ label: 'Housing', spent: 420_000 }, { label: 'Food delivery', spent: 100_740 }] }))
      .toBe("You've spent ¥12,140 so far; the biggest chunks are Housing ¥4,200 and Food delivery ¥1,007.40.")
    expect(after('get_insights', { count: 1, insights: [{ title: 'The midnight snack tax: ¥1,007', body: '12 purchases between 10pm and 4am.' }] }))
      .toBe('The thing that stands out most: The midnight snack tax: ¥1,007. 12 purchases between 10pm and 4am.')
    expect(after('create_tripwire', { status: 'executed', summary: 'Tripwire added: any purchase over ¥300', data: {} })).toBe('Done. Tripwire added: any purchase over ¥300.')
    expect(after('transfer_external', { status: 'denied', reason: 'Blocked' })).toContain('blocked')
  })
})

describe('LLM-mode demo: the real agent engine driven by the mock provider', () => {
  function mockClient() {
    const requests: unknown[] = []
    const client = {
      baseUrl: 'mock',
      async health() {
        return { ok: true, provider: 'mock', model: 'mock' }
      },
      async complete(r: { system: string; messages: LlmMessage[]; tools: ProviderRequest['tools']; maxTokens: number }): Promise<LlmResponse> {
        requests.push(structuredClone(r))
        const out = mockReply({ system: r.system, messages: r.messages, tools: r.tools, maxTokens: r.maxTokens })
        return structuredClone({ content: out.content, stopReason: out.stopReason, provider: out.provider, model: out.model, usage: out.usage })
      },
    } as unknown as LlmClient
    return { client, requests }
  }

  it('"Move ¥500 to my Birkin" → get_goals → transfer_to_goal pending on the Birkin pot, with a grounded natural reply', async () => {
    const host = fakeHost({ persona: 'mei' })
    const { client, requests } = mockClient()
    host.setLlm(client)
    const msg = await createAgentEngine(host).respond('Move ¥500 to my Birkin')
    expect(msg.engine).toBe('llm')
    expect(requests).toHaveLength(3)
    const p = host.state().pending.find((x) => x.call.tool === 'transfer_to_goal')
    expect(p).toMatchObject({ status: 'pending', call: { proposedBy: 'llm', args: { goalId: 'dream_birkin', amount: 50_000 } } })
    expect(msg.text).toContain('action card')
    expect(msg.text).toContain('¥500')
    expect(msg.grounding?.ok).toBe(true)
  })

  it('"How am I doing this month?" quotes the real overview numbers and passes grounding', async () => {
    const host = fakeHost({ persona: 'mei' })
    host.setLlm(mockClient().client)
    const msg = await createAgentEngine(host).respond('How am I doing this month?')
    expect(msg.engine).toBe('llm')
    expect(msg.text).toMatch(/Weekend in Chengdu/)
    expect(msg.text).toMatch(/So far you've spent ¥[\d,.]+ against your ¥9,500 target\./)
    expect(msg.grounding?.ok).toBe(true)
  })
})
