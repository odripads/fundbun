import { describe, expect, it } from 'vitest'
import { PIN, fakeHost } from '../../../tests/helpers/fake-host'
import { checkGrounding } from '../security/grounding'
import type { ChatMessage } from '../types'
import { guardIntent } from './offline-engine'
import { understand } from './nlu'
import { createAgentEngine } from './runtime'
import { nluContextOf } from './support'

function setup(persona: 'mei' | 'arif' = 'mei') {
  const host = fakeHost({ persona })
  return { host, engine: createAgentEngine(host) }
}

const pendingOf = (host: ReturnType<typeof fakeHost>) => host.state().pending

describe('respond (offline Bun Engine)', () => {
  it('appends user + assistant messages with engine, trace, grounding, cards and suggestions', async () => {
    const { host, engine } = setup()
    const msg = await engine.respond('How am I doing this month?')
    expect(host.state().chat.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(host.state().chat[1]).toEqual(msg)
    expect(msg).toMatchObject({ role: 'assistant', engine: 'offline' })
    expect(msg.grounding?.ok).toBe(true)
    expect(msg.cards?.[0].type).toBe('mirror')
    expect(msg.trace?.[0]).toMatchObject({ kind: 'intent', detail: { intent: 'overview' } })
    expect(msg.suggestions?.length).toBeGreaterThan(0)
    expect(host.state().dialogue.lastIntent).toBe('overview')
  })

  it('every reply in a mixed session stays grounded', async () => {
    const { engine } = setup()
    const msgs: ChatMessage[] = []
    for (const t of ['hello', 'Where did my money go?', 'How much did I spend on coffee?', 'Any insights for me?', 'Check my bills', 'List my subscriptions', 'Show my goals', 'Can I afford ¥1,299 sneakers?', 'Show my Taobao transactions', 'Make me a budget', 'Move ¥300 to Chengdu']) {
      msgs.push(await engine.respond(t))
    }
    for (const m of msgs) expect(m.grounding, m.text).toMatchObject({ ok: true })
  })

  it('unknown input is never a dead end', async () => {
    const { engine } = setup()
    const msg = await engine.respond('what is the weather on mars')
    expect(msg.text.length).toBeGreaterThan(20)
    expect(msg.suggestions?.length).toBeGreaterThanOrEqual(3)
  })

  it('clarify → answer → correction → affirm (never approves by text)', async () => {
    const { host, engine } = setup()
    const ask = await engine.respond('Move ¥200 to my fund')
    expect(ask.cards?.[0]).toMatchObject({ type: 'clarify', options: expect.arrayContaining([{ label: 'Weekend in Chengdu', value: 'Weekend in Chengdu' }]) })
    expect(host.state().dialogue.pendingClarification).toMatchObject({ intent: 'save_to_goal', missing: 'goalId' })
    const proposed = await engine.respond('Chengdu')
    expect(host.state().dialogue.pendingClarification).toBeUndefined()
    const first = pendingOf(host)[0]
    expect(first).toMatchObject({ status: 'pending', call: { args: { goalId: 'dream_chengdu', amount: 20_000 } } })
    expect(proposed.cards).toContainEqual({ type: 'action', pendingId: first.id })
    await engine.respond('actually make it ¥150')
    expect(pendingOf(host)[0].status).toBe('rejected')
    expect(pendingOf(host)[1]).toMatchObject({ status: 'pending', call: { args: { goalId: 'dream_chengdu', amount: 15_000 } } })
    expect(host.state().dialogue.lastProposalId).toBe(pendingOf(host)[1].id)
    const yes = await engine.respond('yes do it')
    expect(yes.text).toMatch(/tap Approve/)
    expect(pendingOf(host)[1].status).toBe('pending')
  })

  it('a correction can switch the goal ("no, the Birkin one")', async () => {
    const { host, engine } = setup()
    await engine.respond('Move ¥100 to Chengdu')
    await engine.respond('no, the Birkin one')
    expect(pendingOf(host)[1].call.args).toEqual({ goalId: 'dream_birkin', amount: 10_000 })
  })

  it('a new request abandons an open clarification', async () => {
    const { host, engine } = setup()
    await engine.respond('Pay a bill')
    expect(host.state().dialogue.pendingClarification).toBeDefined()
    const msg = await engine.respond('How am I doing this month?')
    expect(msg.cards?.[0].type).toBe('mirror')
    expect(host.state().dialogue.pendingClarification).toBeUndefined()
  })

  it('an unclear answer re-asks with the same options', async () => {
    const { host, engine } = setup()
    await engine.respond('Cancel a subscription')
    const again = await engine.respond('hmm')
    expect(again.cards?.[0].type).toBe('clarify')
    expect(host.state().dialogue.pendingClarification).toBeDefined()
  })

  it('the classifier cannot turn a bare name into a money action (verb guard)', () => {
    const host = fakeHost()
    const ctx = nluContextOf(host.state(), host.recurring())
    for (const t of ['Youku', 'Rent', 'explain my electricity bill']) {
      const nlu = understand(t, ctx)
      expect(['cancel_sub', 'pay_bill', 'dispute', 'save_to_goal', 'withdraw_goal']).not.toContain(guardIntent(nlu, t))
    }
    expect(guardIntent(understand('Cancel Youku', ctx), 'Cancel Youku')).toBe('cancel_sub')
  })

  it('xray source: the turn is tainted, injection flagged, nothing proposed', async () => {
    const { host, engine } = setup()
    const raw = host.state().bank.bills.find((b) => b.id === 'bill_electricity_2026-09')!.rawText!
    const msg = await engine.respond(raw, { source: 'xray' })
    expect(msg.cards?.map((c) => c.type)).toEqual(['xray', 'notice'])
    expect(msg.trace?.some((t) => t.kind === 'injection' && /Prompt injection/.test(t.label))).toBe(true)
    expect(pendingOf(host)).toEqual([])
    expect(host.state().audit.some((e) => e.type === 'injection_detected')).toBe(true)
  })
})

describe('engine API', () => {
  it('propose(): a T0 button runs now (not stored); a T2 button becomes a pending action', async () => {
    const { host, engine } = setup()
    const read = await engine.propose({ tool: 'list_recurring', args: { onlySubscriptions: true }, label: 'Review subscriptions' }, 'user')
    expect(read.status).toBe('executed')
    expect(pendingOf(host)).toEqual([])
    const p = await engine.propose({ tool: 'transfer_to_goal', args: { goalId: 'dream_chengdu', amount: 20_000 }, label: 'Stash ¥200' }, 'user')
    expect(p).toMatchObject({ status: 'pending', call: { proposedBy: 'user' } })
    expect(host.state().chat.at(-1)?.cards).toContainEqual({ type: 'action', pendingId: p.id })
  })

  it('approve() posts a confirmation with an undo hint; undo() posts a short message', async () => {
    const { host, engine } = setup()
    await engine.respond('Move ¥300 to my Chengdu fund')
    const id = pendingOf(host)[0].id
    expect(await engine.approve(id)).toEqual({ ok: true })
    const done = host.state().chat.at(-1)!
    expect(done.text).toMatch(/¥300.*Weekend in Chengdu/)
    expect(done.text).toMatch(/Undo within 30s/)
    expect(done.trace?.some((t) => /Binding hash verified/.test(t.label))).toBe(true)
    expect(checkGrounding(done.text, [pendingOf(host)[0]], 'CNY').ok).toBe(true)
    expect(engine.undo(id)).toEqual({ ok: true })
    expect(host.state().chat.at(-1)?.text).toMatch(/Undone/)
    expect(engine.undo(id).ok).toBe(false)
  })

  it('approve() with PIN for T3; reject(); expire(); preview()', async () => {
    const { host, engine } = setup()
    await engine.respond('Cancel Youku')
    const id = pendingOf(host)[0].id
    expect((await engine.approve(id, '1357')).ok).toBe(false)
    expect(await engine.approve(id, PIN)).toEqual({ ok: true })
    expect(host.state().chat.at(-1)?.text).toMatch(/Youku/)
    await engine.respond('Pay my electricity bill')
    const bill = pendingOf(host)[1].id
    engine.reject(bill)
    expect(pendingOf(host)[1].status).toBe('rejected')
    await engine.respond('Move ¥100 to Chengdu')
    host.clock.advanceMinutes(15)
    engine.expire()
    expect(pendingOf(host)[2].status).toBe('expired')
    expect(engine.preview({ id: 'c', tool: 'pay_bill', args: { billId: 'bill_water_2026-09' }, proposedBy: 'user' }).title).toMatch(/Water/)
  })

  it('plan steps follow their pending actions: approve → done (plan done), undo → skipped', async () => {
    const { host, engine } = setup()
    const msg = await engine.respond('get me back on track')
    const planId = (msg.cards?.find((c) => c.type === 'plan') as { planId: string }).planId
    const plan = () => host.state().plans.find((p) => p.id === planId)!
    const cancel = plan().steps.find((s) => s.tool === 'cancel_subscription')!
    expect(plan().status).toBe('awaiting_user')
    expect(await engine.approve(cancel.pendingId!, PIN)).toEqual({ ok: true })
    expect(plan().steps.find((s) => s.id === cancel.id)?.status).toBe('done')
    expect(plan().status).toBe('done')
    const cap = plan().steps.find((s) => s.tool === 'set_category_budget')!
    expect(engine.undo(cap.pendingId!)).toEqual({ ok: true })
    expect(plan().steps.find((s) => s.id === cap.id)).toMatchObject({ status: 'skipped', resultSummary: 'Undone by you' })
  })

  it('assistant messages always carry engine, cards, trace, grounding and suggestions', async () => {
    const { host, engine } = setup()
    await engine.respond('hello')
    await engine.respond('Move ¥300 to Chengdu')
    await engine.approve(host.state().pending[0].id)
    for (const m of host.state().chat.filter((x) => x.role === 'assistant')) {
      expect(m.engine).toBeDefined()
      expect(Array.isArray(m.cards) && Array.isArray(m.trace) && Array.isArray(m.suggestions)).toBe(true)
      expect(m.grounding?.ok).toBe(true)
    }
  })
})
