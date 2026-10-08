import { describe, expect, it } from 'vitest'
import type { ChatCard, ChatMessage, DreamItem, TraceStep } from '../../../core/types'
import {
  digestTrace,
  firstName,
  greeting,
  grounded,
  showGroundingFlag,
  handoffSummary,
  handoffText,
  hasConversation,
  humanize,
  layoutConversation,
  maskDigits,
  messageMood,
  proposerLabel,
  shortGoalName,
  starterGoal,
  starterPrompts,
  summarizeTrace,
  summaryText,
  welcomeText,
} from './model'

const TS = '2026-10-22T10:00:00.000Z'
let n = 0
const user = (text: string): ChatMessage => ({ id: `u${++n}`, role: 'user', text, ts: TS })
const bot = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `b${++n}`, role: 'assistant', text, ts: TS, engine: 'offline', ...extra })

const dream = (name: string, price: number, kind: DreamItem['kind'] = 'goal', achievedAt?: string) => ({ name, price, kind, achievedAt })

describe('conversation shape', () => {
  it('counts a conversation only once the user has said something', () => {
    expect(hasConversation([bot('Hi')])).toBe(false)
    expect(hasConversation([bot('Hi'), user('Yo')])).toBe(true)
    expect(hasConversation([])).toBe(false)
  })

  it('surfaces the welcome only before the first question', () => {
    expect(welcomeText([bot('Hi Mei!')])).toBe('Hi Mei!')
    expect(welcomeText([bot('Hi Mei!'), user('Hey')])).toBeNull()
    expect(welcomeText([])).toBeNull()
  })
})

describe('starter prompts', () => {
  it('shortens goal names to what people say', () => {
    expect(shortGoalName('Weekend in Chengdu')).toBe('Chengdu')
    expect(shortGoalName('Flight home to Medan')).toBe('Medan')
    expect(shortGoalName('MacBook Air')).toBe('MacBook Air')
  })

  it('picks the cheapest unfinished goal (treats and achieved goals are skipped)', () => {
    const goals = [dream('Birkin 25', 9_800_000), dream('Weekend in Chengdu', 240_000), dream('Shoes', 89_900, 'treat'), dream('Old', 1_000, 'goal', '2026-01-01')]
    expect(starterGoal(goals)?.name).toBe('Weekend in Chengdu')
    expect(starterGoal([dream('Shoes', 89_900, 'treat')])).toBeUndefined()
  })

  it('covers the six judged tasks with the user’s currency and goal', () => {
    const prompts = starterPrompts({ currency: 'CNY', dreams: [dream('Birkin 25', 9_800_000), dream('Weekend in Chengdu', 240_000)], status: 'over' })
    expect(prompts.map((p) => p.text)).toEqual([
      'How am I doing this month?',
      'Where did my money go?',
      'Check my bills',
      'Can I afford ¥1,299 sneakers?',
      'Help me get back on track',
      'Move ¥300 to my Chengdu fund',
    ])
  })

  it('turns the plan prompt toward the surplus when under target, and falls back without goals', () => {
    const prompts = starterPrompts({ currency: 'USD', dreams: [], status: 'under' })
    expect(prompts.find((p) => p.id === 'plan')?.text).toBe('Make a plan for my surplus')
    expect(prompts.find((p) => p.id === 'save')?.text).toBe('Move $300 to my goal')
    expect(prompts.find((p) => p.id === 'afford')?.text).toBe('Can I afford $1,299 sneakers?')
  })
})

describe('greeting', () => {
  it('speaks in the chosen tone, gentle by default', () => {
    expect(greeting('gentle', 'Mei').title).toBe('Hi, Mei — I’m Bun')
    expect(greeting('cheeky', 'Mei').title).toBe('Spill the tea, Mei')
    expect(greeting('numbers', '').title).toBe('Ask me anything')
    expect(greeting('gentle', '').body).toMatch(/only with your OK/)
  })

  it('takes the first name', () => {
    expect(firstName('Mei Lin')).toBe('Mei')
    expect(firstName('  ')).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})

describe('layoutConversation', () => {
  const action = (pendingId: string): ChatCard => ({ type: 'action', pendingId })

  it('shows an action in full the first time and as a receipt afterwards', () => {
    const m1 = bot('Ready?', { cards: [action('pa1')] })
    const m2 = bot('Done.', { cards: [action('pa1')] })
    const layout = layoutConversation([user('Move'), m1, m2], [])
    expect(layout.get(m1.id)?.cards[0].actionMode).toBe('card')
    expect(layout.get(m2.id)?.cards[0].actionMode).toBe('receipt')
  })

  it('does not repeat actions that the plan card already embeds', () => {
    const plan: ChatCard = { type: 'plan', planId: 'plan1' }
    const m = bot('Plan', { cards: [plan, action('pa1'), action('pa2')] })
    const later = bot('Done', { cards: [action('pa1')] })
    const layout = layoutConversation([user('Help'), m, later], [{ id: 'plan1', steps: [{ id: 's1', tool: 'transfer_to_goal', args: {}, dependsOn: [], label: 'x', status: 'needs_approval', pendingId: 'pa1' }] }])
    expect(layout.get(m.id)?.cards.map((c) => c.card.type)).toEqual(['plan', 'action'])
    expect(layout.get(m.id)?.cards[1].card).toEqual(action('pa2'))
    expect(layout.get(later.id)?.cards[0].actionMode).toBe('receipt')
  })

  it('keeps suggestion chips on the latest reply only, minus options already on a card', () => {
    const clarify: ChatCard = { type: 'clarify', question: 'Which?', options: [{ label: 'Birkin 25', value: 'Birkin 25' }] }
    const old = bot('Hi', { suggestions: ['A', 'B'] })
    const latest = bot('Which?', { cards: [clarify], suggestions: ['Birkin 25', 'Show my goals'] })
    const layout = layoutConversation([old, user('Move'), latest], [])
    expect(layout.get(old.id)?.suggestions).toEqual([])
    expect(layout.get(latest.id)?.suggestions).toEqual(['Show my goals'])
    expect(layout.get(latest.id)?.answer).toBeNull()
  })

  it('drops the "Stop" chip next to a plan (the card has its own Stop button)', () => {
    const m = bot('Plan', { cards: [{ type: 'plan', planId: 'p' }], suggestions: ['Stop', 'Show my goals'] })
    expect(layoutConversation([user('Help'), m], []).get(m.id)?.suggestions).toEqual(['Show my goals'])
  })

  it('records the user’s answer to a clarify card', () => {
    const q = bot('Which?', { cards: [{ type: 'clarify', question: 'Which?', options: [{ label: 'A', value: 'A' }] }] })
    const layout = layoutConversation([user('Move'), q, user('A'), bot('Ok')], [])
    expect(layout.get(q.id)?.answer).toBe('A')
    expect(layout.get(q.id)?.suggestions).toEqual([])
  })

  it('caps chips at four and ignores user messages', () => {
    const m = bot('x', { suggestions: ['1', '2', '3', '4', '5'] })
    const u = user('y')
    const layout = layoutConversation([u, m], [])
    expect(layout.get(m.id)?.suggestions).toHaveLength(4)
    expect(layout.has(u.id)).toBe(false)
  })
})

describe('messageMood', () => {
  it('reacts to what the reply says', () => {
    expect(messageMood({ cards: [{ type: 'notice', level: 'block', title: 'x', text: 'y' }] })).toBe('worried')
    expect(messageMood({ cards: [{ type: 'goals', goals: [] }] })).toBe('happy')
    expect(messageMood({ cards: [] })).toBe('calm')
    expect(messageMood({})).toBe('calm')
  })

  it('follows the mirror and the affordability verdict', () => {
    const mirror = { type: 'mirror', mirror: { mood: 'burnt' } } as unknown as ChatCard
    expect(messageMood({ cards: [mirror] })).toBe('burnt')
    const afford = (verdict: string) => ({ type: 'affordability', result: { verdict } }) as unknown as ChatCard
    expect(messageMood({ cards: [afford('go')] })).toBe('happy')
    expect(messageMood({ cards: [afford('skip')] })).toBe('worried')
    expect(messageMood({ cards: [afford('think')] })).toBe('calm')
  })

  it('treats a missing grounding report as grounded', () => {
    expect(grounded(undefined)).toBe(true)
    expect(grounded({ ok: false, checked: 2, ungrounded: ['¥9'] })).toBe(false)
  })

  it('flags removed numbers once — not when the runtime already added its notice', () => {
    const bad = { ok: false, checked: 2, ungrounded: ['¥9'] }
    expect(showGroundingFlag({ grounding: bad })).toBe(true)
    expect(showGroundingFlag({ grounding: bad, cards: [{ type: 'notice', level: 'info', title: 'Unverified number removed', text: 'x' }] })).toBe(false)
    expect(showGroundingFlag({ grounding: { ok: true, checked: 1, ungrounded: [] } })).toBe(false)
  })
})

describe('digestTrace', () => {
  const t = (kind: TraceStep['kind'], label: string, detail?: unknown): TraceStep => ({ kind, label, detail, ts: TS })

  it('types every step the runtime emits', () => {
    const rows = digestTrace([
      t('intent', 'save_to_goal (100%)', { intent: 'save_to_goal', confidence: 1, rule: 'R-SAVE', slots: { amount: 30000, goalId: 'dream_chengdu' }, alternatives: [{ intent: 'external_transfer', confidence: 0.45 }] }),
      t('tool_call', 'offline → transfer_to_goal', { tool: 'transfer_to_goal', proposedBy: 'offline', args: { amount: 30000 } }),
      t('policy', 'CONFIRM · transfer_to_goal', { decision: 'confirm', tier: 2, tool: 'transfer_to_goal', reasons: ['Needs your tap'], ruleIds: ['P-TIER-MATRIX'], tainted: true }),
      t('tool_result', 'Shenzhen Power Supply', { ok: true, untrusted: true }),
      t('injection', 'Prompt injection detected', { signals: ['ai-addressed'], score: 1 }),
      t('grounding', 'Ungrounded', { ok: false, checked: 3, ungrounded: ['¥1'] }),
      t('redaction', 'Redacted', { counts: { card: 2 } }),
      t('error', 'Boom'),
    ], 'CNY')
    expect(rows[0]).toMatchObject({ kind: 'intent', intent: 'save_to_goal', confidence: 1, rule: 'R-SAVE', alternatives: [{ intent: 'external_transfer', confidence: 0.45 }] })
    expect(rows[0].kind === 'intent' && rows[0].slots).toEqual([{ key: 'Amount', value: '¥300' }, { key: 'Goal id', value: 'dream_chengdu' }])
    expect(rows[1]).toMatchObject({ kind: 'tool_call', tool: 'transfer_to_goal', proposedBy: 'offline' })
    expect(rows[2]).toMatchObject({ kind: 'policy', decision: 'confirm', tier: 2, ruleIds: ['P-TIER-MATRIX'], tainted: true })
    expect(rows[3]).toMatchObject({ kind: 'tool_result', ok: true, untrusted: true })
    expect(rows[4]).toMatchObject({ kind: 'injection', signals: ['ai-addressed'], score: 1 })
    expect(rows[5]).toMatchObject({ kind: 'grounding', ok: false, ungrounded: ['¥1'] })
    expect(rows[6]).toMatchObject({ kind: 'redaction', counts: [{ key: 'Card', value: '2' }] })
    expect(rows[7]).toMatchObject({ kind: 'error', label: 'Boom' })
  })

  it('degrades gracefully on odd details', () => {
    const rows = digestTrace([t('intent', 'interrupt (dialogue)', { act: 'interrupt' }), t('policy', 'Sensitive request refused', 'nope'), t('llm', 'LLM request')], 'CNY')
    expect(rows[0]).toMatchObject({ kind: 'intent', intent: 'interrupt', slots: [], alternatives: [] })
    expect(rows[1]).toMatchObject({ kind: 'policy', reasons: [], ruleIds: [], tainted: false })
    expect(rows[2]).toMatchObject({ kind: 'llm', counts: [] })
    expect(digestTrace(undefined, 'CNY')).toEqual([])
  })

  it('summarises for the collapsed toggle', () => {
    const rows = digestTrace([
      t('intent', 'Task plan', { planId: 'x' }),
      t('intent', 'xray (90%)', { intent: 'xray', confidence: 0.9 }),
      t('tool_call', 'a', { tool: 'xray_bill' }),
      t('policy', 'DENY', { decision: 'deny' }),
      t('injection', 'found', { signals: ['urgency'] }),
    ], 'CNY')
    const s = summarizeTrace(rows, { ok: true, checked: 1, ungrounded: [] })
    expect(s).toMatchObject({ intent: 'xray', confidence: 0.9, tools: 1, decisions: ['deny'], tainted: true, injection: true, grounded: true })
    expect(summaryText(s)).toBe('X-ray · 90% · 1 tool · blocked · injection caught')
    expect(summaryText(summarizeTrace([], undefined))).toBe('')
  })

  it('labels proposers and humanises ids', () => {
    expect(proposerLabel('llm')).toBe('proposed by the LLM')
    expect(proposerLabel('offline')).toBe('proposed on-device')
    expect(proposerLabel(undefined)).toBe('')
    expect(humanize('ai-addressed')).toBe('AI addressed')
    expect(humanize('save_to_goal')).toBe('Save to goal')
  })
})

describe('handoffSummary', () => {
  it('sends the latest questions (newest first, trimmed) and open items — never full account numbers', () => {
    const msgs = [user('one'), bot('x'), user('Send ¥4,800 to account 6222 0210 0112 3456 789'), user('three'), user('four '.repeat(20))]
    const s = handoffSummary(msgs, 2)
    expect(s.topics).toHaveLength(3)
    expect(s.topics[0].endsWith('…')).toBe(true)
    expect(s.topics[2]).toBe('Send ¥4,800 to account •••• 6789')
    expect(s).toMatchObject({ messages: 5, awaiting: 2 })
  })

  it('masks long digit runs but keeps amounts and short numbers', () => {
    expect(maskDigits('card 6222021001123456789 ok')).toBe('card •••• 6789 ok')
    expect(maskDigits('¥4,800 on Oct 22')).toBe('¥4,800 on Oct 22')
    expect(maskDigits('my PIN is 2580')).toBe('my PIN is ••••')
    expect(maskDigits('PIN: 2580, pin 123456')).toBe('PIN: ••••, pin ••••')
  })
})

describe('handoffText', () => {
  it('one line with topics and open items', () => {
    expect(handoffText({ topics: ['Why am I over?', 'Pay my bill'], messages: 4, awaiting: 1 })).toBe('Asked about: “Why am I over?” · “Pay my bill”. 4 messages, 1 action waiting.')
    expect(handoffText({ topics: [], messages: 1, awaiting: 0 })).toBe('No questions yet. 1 message, nothing waiting.')
  })
})
