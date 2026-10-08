import { describe, expect, it, vi } from 'vitest'
import { CONSENT_VERSION, createFundBunApp, createTestApp, memoryStorage, STORAGE_KEY } from '../src/core/app'
import { AUDIT_HEAD_SUFFIX, TEST_NOW, WARMING_UP } from '../src/core/controller/constants'
import { verifyAudit } from '../src/core/security/audit'
import { localISODate } from '../src/core/controller/util'
import type { AppState, AuditType } from '../src/core/types'
import { deferred, echoReply, fakeEngine } from './helpers/fake-engine'
import { PIN, SAMPLE_CSV, demoKit, kit, onboardingInput } from './helpers/fixtures'

const types = (s: AppState): AuditType[] => s.audit.map((e) => e.type)
const lastAudit = (s: AppState) => s.audit[s.audit.length - 1]
const stored = (k: ReturnType<typeof kit>) => k.storage.getItem(STORAGE_KEY)
const checking = (s: AppState) => s.bank.accounts.find((a) => a.type === 'checking')!
const account = (s: AppState, id: string) => s.bank.accounts.find((a) => a.id === id)!

describe('demo personas', () => {
  it('mei: onboarded OVER story — the mirror names the Weekend in Chengdu', () => {
    const { app } = demoKit('mei')
    const { state, derived } = app.getSnapshot()
    expect(app.isOnboarded()).toBe(true)
    expect(state.profile?.personaId ?? state.bank.personaId).toBe('mei')
    expect(state.bank.today).toBe('2026-10-22')
    expect(derived.mirror?.status).toBe('over')
    expect(derived.mirror?.headline).toContain('Weekend in Chengdu')
    expect(derived.summary?.spent).toBeGreaterThanOrEqual(1_200_000)
    expect(derived.summary?.spent).toBeLessThanOrEqual(1_240_000)
  })

  it('mei: mandate, settings, welcome message and audit trail', () => {
    const { app } = demoKit('mei')
    const { state, derived } = app.getSnapshot()
    expect(state.mandate.autonomy).toBe('copilot')
    expect(state.mandate.pinHash).toMatch(/^[0-9a-f]+$/)
    expect(JSON.stringify(state)).not.toContain('"2580"')
    expect(state.settings).toEqual({ glassBox: true, llmEnabled: true, notificationsEnabled: false, reducedMotion: false, vault: false })
    expect(state.chat).toHaveLength(1)
    expect(state.chat[0]).toMatchObject({ role: 'assistant', engine: 'offline' })
    expect(state.chat[0].suggestions?.length).toBeGreaterThan(0)
    expect(types(state)).toEqual(['session_start', 'onboarding', 'consent'])
    expect(app.verifyAudit()).toMatchObject({ ok: true, count: 3 })
    expect(derived.engine).toBe('offline')
    expect(derived.llm).toMatchObject({ checked: true, available: false })
  })

  it('mei: tripwires are primed at load — two unseen alerts on Home, nothing re-fires on the first purchase', () => {
    const { app } = demoKit('mei')
    const { state, derived } = app.getSnapshot()
    expect(state.tripwireEvents.map((e) => [e.tripwireId, e.seen])).toEqual([
      ['tw_month_100', true], ['tw_delivery_100', false], ['tw_pace_110', false],
    ])
    expect(derived.unseenEvents).toHaveLength(2)
    for (const id of ['tw_month_80', 'tw_month_100', 'tw_delivery_100', 'tw_pace_110']) {
      expect(state.tripwires.find((t) => t.id === id)?.lastFiredKey).toBe('2026-10')
    }
    expect(state.audit.find((e) => e.type === 'onboarding')?.data).toMatchObject({ tripwireEvents: 3 })
    const { events } = app.simulatePurchase({ merchant: 'Heytea', amount: 2_500 })
    expect(events).toEqual([])
    expect(app.getSnapshot().state.tripwireEvents).toHaveLength(3)
  })

  it('demo personas and onboarding record the same consent version', () => {
    expect(CONSENT_VERSION).toBe('consent-2026-10')
    for (const id of ['mei', 'arif']) {
      const { state } = demoKit(id).app.getSnapshot()
      expect(state.profile?.consent.version).toBe(CONSENT_VERSION)
      expect(state.audit.find((e) => e.type === 'consent')?.data).toMatchObject({ version: CONSENT_VERSION })
    }
  })

  it('mei: derived analyses are populated', () => {
    const { app } = demoKit('mei')
    const { derived } = app.getSnapshot()
    expect(derived.ctx?.profile.name).toBeTruthy()
    expect(derived.history).toHaveLength(6)
    expect(derived.recurring.length).toBeGreaterThanOrEqual(6)
    expect(derived.findings.length).toBeGreaterThan(0)
    expect(derived.insights.length).toBeGreaterThan(0)
    expect(derived.goals.some((g) => g.itemId === 'dream_birkin')).toBe(true)
    expect(derived.mirrorHistory).toHaveLength(6)
    expect(derived.mirrorHistory?.at(-1)).toMatchObject({ month: '2026-10', status: 'over' })
    expect(derived.couldve?.totalOver).toBeGreaterThan(0)
    expect(derived.couldve).toBe(app.getSnapshot().derived.couldve)
    const due = derived.upcomingBills.map((b) => b.dueDate)
    expect(due).toEqual([...due].sort())
    expect(derived.upcomingBills.every((b) => b.status !== 'paid')).toBe(true)
    expect(derived.awaiting).toEqual([])
    expect(derived.busy).toBe(false)
  })

  it('arif: the UNDER story', () => {
    const { derived } = demoKit('arif').app.getSnapshot()
    expect(derived.mirror?.status).toBe('under')
  })

  it('an unknown persona throws a readable error and leaves the app untouched', () => {
    const { app } = kit()
    expect(() => app.loadDemo('nobody')).toThrow(/nobody/)
    expect(app.isOnboarded()).toBe(false)
  })
})

describe('onboarding', () => {
  it('requires separate financial-data consent (nothing pre-ticked)', () => {
    const { app } = kit()
    const r = app.completeOnboarding(onboardingInput({ consent: { financialData: false, llmProcessing: false, notifications: false } }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/consent/i)
    expect(app.isOnboarded()).toBe(false)
  })

  it.each([
    ['pin too simple', { pin: '1234' }, /PIN/],
    ['pin too short', { pin: '12' }, /PIN/],
    ['payday out of range', { payday: 29 }, /Payday/],
    ['zero income', { monthlyIncome: 0 }, /income/i],
    ['fractional target', { targetSpend: 1234.5 }, /target/i],
    ['no dreams', { dreams: [] }, /dream/i],
    ['bad dream price', { dreams: [{ name: 'X', price: -5, image: 'preset:gift', kind: 'treat' as const }] }, /price/i],
    ['bad cap', { caps: { dailyCap: 0 } }, /dailyCap/],
    ['bad tripwire', { tripwires: [{ kind: 'single_over' as const, threshold: 0 }] }, /threshold/i],
    ['negative starting balance', { dataSource: { kind: 'empty' as const, startingBalance: -1 } }, /balance/i],
  ])('rejects %s', (_label, over, msg) => {
    const { app } = kit()
    const r = app.completeOnboarding(onboardingInput(over))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(msg)
    expect(app.isOnboarded()).toBe(false)
  })

  it('empty data source: fresh bank, user profile, goal pots, defaults', () => {
    const { app } = kit()
    expect(app.completeOnboarding(onboardingInput())).toEqual({ ok: true })
    const s = app.getSnapshot().state
    expect(s.profile).toMatchObject({ name: 'Lin Test', targetSpend: 800_000, workHoursPerMonth: 174 })
    expect(s.profile?.consent).toMatchObject({ financialData: true, llmProcessing: false, version: 'consent-2026-10' })
    expect(s.bank.today).toBe(localISODate(new Date(TEST_NOW)))
    expect(checking(s).balance).toBe(2_000_000)
    expect(s.bank.transactions).toHaveLength(0)
    expect(s.dreams.map((d) => d.id)).toEqual(['dream_trip_to_japan', 'dream_concert_ticket'])
    expect(s.dreams[0].potAccountId).toBe('pot_dream_trip_to_japan')
    expect(account(s, 'pot_dream_trip_to_japan').balance).toBe(0)
    expect(s.dreams[1].potAccountId).toBeUndefined()
    expect(s.tripwires.length).toBeGreaterThan(0)
    expect(s.budget?.method).toBe('fifty_thirty_twenty')
    expect(s.mandate.autonomy).toBe('copilot')
    expect(s.mandate.pinHash).toBeTruthy()
    expect(types(s)).toEqual(['onboarding', 'consent'])
    expect(lastAudit(s).data).toMatchObject({ version: 'consent-2026-10' })
    expect(app.verifyAudit().ok).toBe(true)
  })

  it('persona data source: persona bank, but the user\'s own profile and dreams', () => {
    const { app } = kit()
    const r = app.completeOnboarding(onboardingInput({ dataSource: { kind: 'persona', personaId: 'mei' }, autonomy: 'suggest' }))
    expect(r).toEqual({ ok: true })
    const s = app.getSnapshot().state
    expect(s.profile?.name).toBe('Lin Test')
    expect(s.profile?.personaId).toBe('mei')
    expect(s.bank.transactions.length).toBeGreaterThan(100)
    expect(s.dreams.map((d) => d.name)).toEqual(['Trip to Japan', 'Concert ticket'])
    expect(account(s, 'pot_dream_trip_to_japan')).toBeDefined()
    expect(s.budget?.method).toBe('history')
    expect(s.mandate.autonomy).toBe('suggest')
  })

  it('csv data source: imports into a fresh bank dated by the real clock', () => {
    const { app } = kit()
    const r = app.completeOnboarding(onboardingInput({ dataSource: { kind: 'csv', text: SAMPLE_CSV, startingBalance: 500_000 } }))
    expect(r).toEqual({ ok: true })
    const s = app.getSnapshot().state
    expect(s.bank.transactions).toHaveLength(6)
    expect(s.bank.today).toBe(localISODate(new Date(TEST_NOW)))
    expect(checking(s).balance).toBe(500_000)
    const dates = s.bank.transactions.map((t) => t.date)
    expect(dates).toEqual([...dates].sort())
    expect(s.budget?.method).toBe('history')
  })

  it('csv data source without readable rows is rejected', () => {
    const { app } = kit()
    const r = app.completeOnboarding(onboardingInput({ dataSource: { kind: 'csv', text: 'nothing,useful\n', startingBalance: 0 } }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/CSV/)
  })

  it('dedupes dream ids and honours explicit tripwires + caps', () => {
    const { app } = kit()
    app.completeOnboarding(onboardingInput({
      dreams: [
        { name: 'Trip', price: 100_000, image: 'preset:plane', kind: 'goal' },
        { name: 'Trip', price: 200_000, image: 'preset:plane', kind: 'goal' },
      ],
      tripwires: [{ kind: 'single_over', threshold: 30_000 }],
      caps: { perActionCap: 20_000 },
    }))
    const s = app.getSnapshot().state
    expect(s.dreams.map((d) => d.id)).toEqual(['dream_trip', 'dream_trip_2'])
    expect(s.tripwires).toHaveLength(1)
    expect(s.tripwires[0]).toMatchObject({ kind: 'single_over', threshold: 30_000, enabled: true, createdBy: 'user' })
    expect(s.tripwires[0].label).toBeTruthy()
    expect(s.mandate.perActionCap).toBe(20_000)
  })
})

describe('snapshots', () => {
  it('getSnapshot is stable between commits and replaced on every commit', () => {
    const { app } = demoKit()
    const a = app.getSnapshot()
    expect(app.getSnapshot()).toBe(a)
    expect(app.getSnapshot().derived.mirror).toBe(a.derived.mirror)
    const listener = vi.fn()
    const unsubscribe = app.subscribe(listener)
    app.addTripwire({ kind: 'daily_over', threshold: 50_000 })
    expect(listener).toHaveBeenCalledTimes(1)
    const b = app.getSnapshot()
    expect(b).not.toBe(a)
    expect(b.state).not.toBe(a.state)
    expect(a.state.tripwires.length + 1).toBe(b.state.tripwires.length)
    expect(app.getSnapshot()).toBe(b)
    unsubscribe()
    app.freeze()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('snapshots are frozen; test apps deep-freeze committed state', () => {
    const { app } = demoKit()
    const snap = app.getSnapshot()
    expect(Object.isFrozen(snap)).toBe(true)
    expect(() => { snap.state.dreams.push(snap.state.dreams[0]) }).toThrow(TypeError)
    expect(() => { snap.state.mandate.frozen = true }).toThrow(TypeError)
  })

  it('a non-cloneable value slipped into state does not brick later mutations', () => {
    const { app, engine } = demoKit()
    app.rejectAction('none')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    engine.host().mutate((d) => {
      (d.dialogue as Record<string, unknown>).oops = () => 1
    })
    expect(app.contributeToGoal('dream_chengdu', 1_000)).toEqual({ ok: true })
    expect((app.getSnapshot().state.dialogue as Record<string, unknown>).oops).toBeUndefined()
    errors.mockRestore()
  })
})

describe('AgentHost semantics (fake engine)', () => {
  it('mutate commits once, nested mutate/audit join the outer transaction', () => {
    const { app, engine } = demoKit()
    app.rejectAction('none') // creates the engine
    const host = engine.host()
    const listener = vi.fn()
    app.subscribe(listener)
    const before = app.getSnapshot().state
    const out = host.mutate((draft) => {
      draft.chat.push({ id: 'm1', role: 'system', text: 'outer', ts: host.now() })
      host.audit('agent', 'tool_call', 'inner audit')
      host.mutate((d2) => {
        expect(d2).toBe(draft)
        d2.chat.push({ id: 'm2', role: 'system', text: 'inner', ts: host.now() })
      })
      expect(host.state()).toBe(before) // committed state is untouched mid-transaction
      return 42
    })
    expect(out).toBe(42)
    expect(listener).toHaveBeenCalledTimes(1)
    const after = app.getSnapshot().state
    expect(after.chat.slice(-2).map((m) => m.text)).toEqual(['outer', 'inner'])
    expect(lastAudit(after).type).toBe('tool_call')
    expect(before.chat.length + 2).toBe(after.chat.length)
    expect(app.verifyAudit().ok).toBe(true)
  })

  it('mutate discards the draft when the recipe throws', () => {
    const { app, engine } = demoKit()
    app.rejectAction('none')
    const host = engine.host()
    const snap = app.getSnapshot()
    const balance = checking(snap.state).balance
    expect(() => host.mutate((draft, bank) => {
      bank.transferInternal(checking(draft).id, 'pot_dream_chengdu', 10_000, 'x', 'agent')
      host.audit('agent', 'action_executed', 'should vanish')
      throw new Error('boom')
    })).toThrow('boom')
    expect(app.getSnapshot()).toBe(snap)
    expect(checking(app.getSnapshot().state).balance).toBe(balance)
  })

  it('rejects async recipes', () => {
    const { app, engine } = demoKit()
    app.rejectAction('none')
    expect(() => engine.host().mutate(async () => 1)).toThrow(/synchronous/)
  })

  it('ctx(), recurring() and findings() reflect committed state and are memoised', () => {
    const { app, engine } = demoKit()
    app.rejectAction('none')
    const host = engine.host()
    expect(host.ctx().profile.name).toBe(app.getSnapshot().state.profile?.name)
    expect(host.recurring()).toBe(host.recurring())
    expect(host.recurring()).toBe(app.getSnapshot().derived.recurring)
    expect(host.findings()).toBe(app.getSnapshot().derived.findings)
    expect(host.now()).toBe(new Date(TEST_NOW).toISOString())
    expect(host.llm()).toBeNull()
  })

  it('ctx() throws before onboarding', () => {
    const { app, engine } = kit()
    app.rejectAction('none')
    expect(() => engine.host().ctx()).toThrow()
  })

  it('afterTransactions stores tripwire events and audits each one', () => {
    const { app, engine } = demoKit()
    app.addTripwire({ kind: 'single_over', threshold: 30_000 })
    app.rejectAction('none')
    const host = engine.host()
    const events = host.mutate((_draft, bank) => {
      const txn = bank.simulatePurchase({ merchant: 'JD.com', amount: 45_900 })
      return host.afterTransactions([txn])
    })
    expect(events.length).toBeGreaterThan(0)
    const s = app.getSnapshot()
    expect(s.state.tripwireEvents.slice(-events.length)).toEqual(events)
    expect(types(s.state).filter((t) => t === 'tripwire_fired').length).toBe(events.length)
  })
})

describe('agent delegation', () => {
  it('sendMessage marks busy while the engine works and clears it after', async () => {
    const gate = deferred<void>()
    const { app, engine } = demoKit('mei', {
      engine: { respond: async (text, host) => { await gate.promise; return echoReply(host, text) } },
    })
    const stateBefore = app.getSnapshot().state
    const p = app.sendMessage('How am I doing?')
    expect(app.getSnapshot().derived.busy).toBe(true)
    expect(app.getSnapshot().state).toBe(stateBefore) // runtime flags never touch persisted state
    gate.resolve()
    const msg = await p
    expect(msg.text).toBe('echo: How am I doing?')
    expect(app.getSnapshot().derived.busy).toBe(false)
    expect(engine.log.respond).toEqual([{ text: 'How am I doing?', source: 'chat' }])
    expect(engine.log.expire).toBeGreaterThan(0)
    expect(app.getSnapshot().state.chat.slice(-2).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('an engine error becomes an assistant message, never a throw', async () => {
    const { app } = demoKit('mei', { engine: { respond: async () => { throw new Error('kaput') } } })
    const msg = await app.sendMessage('hello')
    expect(msg.role).toBe('assistant')
    expect(msg.cards?.[0]).toMatchObject({ type: 'notice', level: 'warn' })
    const chat = app.getSnapshot().state.chat
    expect(chat.slice(-2).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(chat[chat.length - 2].text).toBe('hello')
    expect(app.getSnapshot().derived.busy).toBe(false)
  })

  it('falls back to a "warming up" engine when the runtime cannot start', async () => {
    const { app } = demoKit('mei', { engine: { throwOnCreate: true } })
    const msg = await app.sendMessage('hi')
    expect(msg.text).toContain('Bun is still warming up')
    expect(msg.text).toBe(WARMING_UP)
    expect(await app.approveAction('x')).toMatchObject({ ok: false })
    const pa = await app.runSuggestedAction({ tool: 'cancel_subscription', args: {}, label: 'Cancel' })
    expect(pa.status).toBe('denied')
  })

  it('the real runtime factory is used by default and never crashes the app', async () => {
    const app = createTestApp()
    app.loadDemo()
    const msg = await app.sendMessage('How am I doing this month?')
    expect(msg.role).toBe('assistant')
    expect(msg.text.length).toBeGreaterThan(0)
  })

  it('xrayBill, approve, reject, undo and suggested actions delegate to the engine', async () => {
    const { app, engine } = demoKit()
    await app.xrayBill('Total due ¥486.20')
    expect(engine.log.respond.at(-1)).toEqual({ text: 'Total due ¥486.20', source: 'xray' })
    const pa = await app.runSuggestedAction({ tool: 'transfer_to_goal', args: { goalId: 'dream_chengdu', amount: 30_000 }, label: 'Stash' })
    expect(engine.log.propose[0].proposedBy).toBe('user')
    expect(app.getSnapshot().derived.awaiting.map((p) => p.id)).toEqual([pa.id])
    const before = app.getSnapshot().state
    expect(await app.approveAction(pa.id, PIN)).toEqual({ ok: true })
    const after = app.getSnapshot().state
    expect(checking(after).balance).toBe(checking(before).balance - 30_000)
    expect(account(after, 'pot_dream_chengdu').balance).toBe(account(before, 'pot_dream_chengdu').balance + 30_000)
    expect(app.getSnapshot().derived.awaiting).toEqual([])
    expect(app.undoAction(pa.id)).toEqual({ ok: false, error: 'nothing to undo' })
    app.rejectAction('other')
    expect(engine.log.reject).toEqual(['other'])
    expect(app.verifyAudit().ok).toBe(true)
  })

  it('a throwing propose yields a denied action instead of a rejection', async () => {
    const broken = fakeEngine()
    const app = createTestApp({
      engineFactory: (h) => ({ ...broken.factory(h), propose: async () => { throw new Error('policy offline') } }),
    })
    app.loadDemo()
    const pa = await app.runSuggestedAction({ tool: 'pay_bill', args: {}, label: 'Pay' })
    expect(pa.status).toBe('denied')
    expect(pa.error).toMatch(/policy offline/)
  })

  it('refuses turns before onboarding without touching the engine', async () => {
    const { app, engine } = kit()
    const msg = await app.sendMessage('hi')
    expect(msg.role).toBe('assistant')
    expect(engine.log.created).toBe(0)
    expect(app.getSnapshot().state.chat).toEqual([])
  })

  it('clearChat empties chat and dialogue state', () => {
    const { app } = demoKit()
    app.clearChat()
    expect(app.getSnapshot().state.chat).toEqual([])
    expect(app.getSnapshot().state.dialogue).toEqual({})
  })

  it('checkLlm on a static build reports the on-device engine', async () => {
    const { app } = demoKit()
    await app.checkLlm()
    expect(app.getSnapshot().derived.llm).toEqual({ checked: true, available: false, reason: 'Static build — on-device engine only' })
    expect(app.getSnapshot().derived.engine).toBe('offline')
  })

  it('uses the LLM engine only when enabled, consented and the gateway is healthy', async () => {
    const health = { ok: true, provider: 'mock', model: 'mock-1' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(health), { status: 200 }))
    const { app, engine } = kit({ app: { llmBaseUrl: 'http://gateway.test/api' } })
    app.loadDemo()
    expect(app.getSnapshot().state.profile?.consent.llmProcessing).toBe(true)
    await app.checkLlm()
    expect(fetchSpy).toHaveBeenCalledWith('http://gateway.test/api/health', expect.anything())
    expect(app.getSnapshot().derived.llm).toEqual({ checked: true, available: true, provider: 'mock', model: 'mock-1' })
    expect(app.getSnapshot().derived.engine).toBe('llm')
    app.rejectAction('none')
    expect(engine.host().llm()).not.toBeNull()
    app.setSettings({ llmEnabled: false })
    expect(app.getSnapshot().derived.engine).toBe('offline')
    expect(engine.host().llm()).toBeNull()
    app.setSettings({ llmEnabled: true })
    app.setConsent({ llmProcessing: false })
    expect(app.getSnapshot().derived.engine).toBe('offline')
    expect(engine.host().llm()).toBeNull()
    fetchSpy.mockRestore()
  })

  it('an unhealthy gateway keeps the on-device engine', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"ok":false,"reason":"no key"}', { status: 200 }))
    const { app } = kit({ app: { llmBaseUrl: 'http://gateway.test/api' } })
    app.loadDemo()
    await app.checkLlm()
    expect(app.getSnapshot().derived.llm).toMatchObject({ checked: true, available: false, reason: 'no key' })
    expect(app.getSnapshot().derived.engine).toBe('offline')
    fetchSpy.mockRestore()
  })

  it('checkLlm without LLM consent never contacts the gateway', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { app } = kit({ app: { llmBaseUrl: 'http://127.0.0.1:9/api' } })
    app.completeOnboarding(onboardingInput())
    await app.checkLlm()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(app.getSnapshot().derived.llm.available).toBe(false)
    expect(app.getSnapshot().derived.engine).toBe('offline')
    fetchSpy.mockRestore()
  })
})

describe('persistence', () => {
  it('round-trips through storage into a new instance', () => {
    const first = demoKit()
    first.app.addDream({ name: 'Kindle', price: 99_900, image: 'preset:gift', kind: 'treat' })
    const before = first.app.getSnapshot().state
    const second = kit({ storage: first.storage })
    const s = second.app.getSnapshot().state
    expect(second.app.isOnboarded()).toBe(true)
    expect(s.profile).toEqual(before.profile)
    expect(s.dreams).toEqual(before.dreams)
    expect(s.bank).toEqual(before.bank)
    expect(s.mandate).toEqual(before.mandate)
    expect(s.audit.slice(0, before.audit.length)).toEqual(before.audit)
    expect(lastAudit(s)).toMatchObject({ type: 'session_start', data: { auditIntact: true } })
    expect(second.app.verifyAudit().ok).toBe(true)
  })

  it('uses a custom storage key', () => {
    const storage = memoryStorage()
    const app = createTestApp({ storage, storageKey: 'custom.key' })
    app.loadDemo()
    expect(storage.getItem('custom.key')).toBeTruthy()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['invalid JSON', '{not json'],
    ['wrong version', JSON.stringify({ version: 2, bank: {} })],
    ['wrong shape', JSON.stringify({ version: 1, bank: { accounts: 'x' } })],
  ])('tolerates corrupt data (%s): starts fresh and audits it', (_label, raw) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, raw)
    const { app } = kit({ storage })
    const s = app.getSnapshot().state
    expect(app.isOnboarded()).toBe(false)
    expect(types(s)).toEqual(['data_wiped'])
    expect(JSON.parse(storage.getItem(STORAGE_KEY) as string).version).toBe(1)
  })

  it('in-memory default storage works without localStorage', () => {
    const app = createFundBunApp({ llmBaseUrl: null, now: () => new Date(TEST_NOW) })
    app.loadDemo()
    expect(app.isOnboarded()).toBe(true)
  })
})

describe('vault', () => {
  it('encrypts at rest, starts locked, unlocks only with the PIN', async () => {
    const first = demoKit()
    expect(await first.app.enableVault(PIN)).toEqual({ ok: true })
    const blob = stored(first) as string
    expect(blob.startsWith('fbv1:')).toBe(true)
    expect(blob).not.toContain('"profile"')
    expect(() => JSON.parse(blob)).toThrow()
    expect(first.app.getSnapshot().state.settings.vault).toBe(true)

    const second = kit({ storage: first.storage })
    expect(second.app.isLocked()).toBe(true)
    expect(second.app.isOnboarded()).toBe(false)
    expect(second.app.getSnapshot().state.profile).toBeNull()
    expect(await second.app.unlock('9999')).toMatchObject({ ok: false })
    expect(second.app.isLocked()).toBe(true)
    expect(stored(second)).toBe(blob)

    expect(await second.app.unlock(PIN)).toEqual({ ok: true })
    expect(second.app.isLocked()).toBe(false)
    expect(second.app.getSnapshot().state.profile?.name).toBe(first.app.getSnapshot().state.profile?.name)
    expect(lastAudit(second.app.getSnapshot().state)).toMatchObject({ type: 'session_start' })
    await second.app.flush()
    expect(stored(second)?.startsWith('fbv1:')).toBe(true)
    expect(stored(second)).not.toBe(blob)
  })

  it('while locked, changes are refused and the encrypted blob is never overwritten', async () => {
    const first = demoKit()
    await first.app.enableVault(PIN)
    const blob = stored(first)
    const { app, storage } = kit({ storage: first.storage })
    expect(app.completeOnboarding(onboardingInput()).ok).toBe(false)
    expect(app.setAutonomy('observe').ok).toBe(false)
    app.loadDemo()
    app.freeze()
    expect(app.isOnboarded()).toBe(false)
    expect(storage.getItem(STORAGE_KEY)).toBe(blob)
  })

  it('saves after unlock are queued sequentially and decrypt to the latest state', async () => {
    const first = demoKit()
    await first.app.enableVault(PIN)
    for (let i = 0; i < 5; i++) first.app.addTripwire({ kind: 'daily_over', threshold: 10_000 + i })
    await first.app.flush()
    const second = kit({ storage: first.storage })
    await second.app.unlock(PIN)
    expect(second.app.getSnapshot().state.tripwires.length).toBe(first.app.getSnapshot().state.tripwires.length)
  })

  it('enableVault with a wrong PIN fails and keeps plaintext', async () => {
    const k = demoKit()
    expect((await k.app.enableVault('9999')).ok).toBe(false)
    expect(stored(k)?.startsWith('{')).toBe(true)
    expect(k.app.getSnapshot().state.mandate.failedPinAttempts).toBe(1)
  })

  it('disableVault returns to plaintext storage', async () => {
    const k = demoKit()
    await k.app.enableVault(PIN)
    expect((await k.app.disableVault('9999')).ok).toBe(false)
    await k.app.flush()
    expect(stored(k)?.startsWith('fbv1:')).toBe(true)
    expect(await k.app.disableVault(PIN)).toEqual({ ok: true })
    const raw = stored(k) as string
    expect(raw.startsWith('{')).toBe(true)
    expect(JSON.parse(raw).settings.vault).toBe(false)
  })

  it('changing the PIN re-keys the vault', async () => {
    const first = demoKit()
    await first.app.enableVault(PIN)
    expect(first.app.changePin(PIN, '7391')).toEqual({ ok: true })
    await first.app.flush()
    const second = kit({ storage: first.storage })
    expect((await second.app.unlock(PIN)).ok).toBe(false)
    expect(await second.app.unlock('7391')).toEqual({ ok: true })
  })
})

describe('safety controls', () => {
  it('raising autonomy needs the PIN; lowering never does', () => {
    const { app } = demoKit()
    const noPin = app.setAutonomy('autopilot')
    expect(noPin.ok).toBe(false)
    expect(app.getSnapshot().state.mandate.autonomy).toBe('copilot')
    expect(lastAudit(app.getSnapshot().state)).toMatchObject({ type: 'step_up_failed', data: { reason: 'pin_required' } })

    expect(app.setAutonomy('autopilot', '9999').ok).toBe(false)
    expect(app.getSnapshot().state.mandate.failedPinAttempts).toBe(1)

    expect(app.setAutonomy('autopilot', PIN)).toEqual({ ok: true })
    expect(app.getSnapshot().state.mandate).toMatchObject({ autonomy: 'autopilot', failedPinAttempts: 0 })
    expect(lastAudit(app.getSnapshot().state)).toMatchObject({ type: 'mandate_changed', data: { from: 'copilot', to: 'autopilot' } })

    expect(app.setAutonomy('observe')).toEqual({ ok: true })
    expect(app.getSnapshot().state.mandate.autonomy).toBe('observe')
    expect(app.setAutonomy('suggest').ok).toBe(false)
  })

  it('failed PIN attempts are persisted', () => {
    const k = demoKit()
    k.app.setAutonomy('autopilot', '9999')
    const reloaded = kit({ storage: k.storage })
    expect(reloaded.app.getSnapshot().state.mandate.failedPinAttempts).toBe(1)
  })

  it('locks PIN entry after 3 failures, even for the right PIN, until the lock expires', () => {
    const { app, clock } = demoKit()
    for (let i = 0; i < 3; i++) expect(app.setAutonomy('autopilot', '0000').ok).toBe(false)
    const m = app.getSnapshot().state.mandate
    expect(m.pinLockedUntil).toBeTruthy()
    expect(app.setAutonomy('autopilot', PIN).ok).toBe(false)
    expect(app.getSnapshot().state.mandate.autonomy).toBe('copilot')
    expect(types(app.getSnapshot().state).filter((t) => t === 'step_up_failed').length).toBe(4)
    clock.advanceMinutes(6)
    expect(app.setAutonomy('autopilot', PIN)).toEqual({ ok: true })
  })

  it('caps: raising needs the PIN, tightening does not', () => {
    const { app } = demoKit()
    const { dailyCap } = app.getSnapshot().state.mandate
    expect(app.setCaps({ dailyCap: dailyCap * 10 }).ok).toBe(false)
    expect(app.getSnapshot().state.mandate.dailyCap).toBe(dailyCap)
    expect(app.setCaps({ dailyCap: dailyCap / 2 })).toEqual({ ok: true })
    expect(app.getSnapshot().state.mandate.dailyCap).toBe(dailyCap / 2)
    expect(app.setCaps({ dailyCap: dailyCap * 2 }, PIN)).toEqual({ ok: true })
    expect(app.setCaps({ perActionCap: -5 }).ok).toBe(false)
  })

  it('tools: disabling is instant; re-enabling T2/T3 needs the PIN', () => {
    const { app } = demoKit()
    expect(app.setToolEnabled('pay_bill', false)).toEqual({ ok: true })
    expect(app.getSnapshot().state.mandate.disabledTools).toContain('pay_bill')
    expect(app.setToolEnabled('pay_bill', true).ok).toBe(false)
    expect(app.setToolEnabled('pay_bill', true, PIN)).toEqual({ ok: true })
    expect(app.getSnapshot().state.mandate.disabledTools).not.toContain('pay_bill')
    app.setToolEnabled('create_tripwire', false)
    expect(app.setToolEnabled('create_tripwire', true)).toEqual({ ok: true })
    expect(app.setToolEnabled('nope' as never, false).ok).toBe(false)
  })

  it('kill switch: freeze is instant, unfreeze needs the PIN and clears the breaker', () => {
    const { app, engine } = demoKit()
    app.freeze()
    expect(app.getSnapshot().state.mandate.frozen).toBe(true)
    expect(lastAudit(app.getSnapshot().state).type).toBe('kill_switch')
    app.rejectAction('none')
    engine.host().mutate((d) => {
      d.mandate.breakerTrippedAt = d.audit[0].ts
      d.mandate.breakerReason = '3 denied money attempts'
    })
    expect(app.unfreeze('9999').ok).toBe(false)
    expect(app.getSnapshot().state.mandate.frozen).toBe(true)
    expect(app.unfreeze(PIN)).toEqual({ ok: true })
    const m = app.getSnapshot().state.mandate
    expect(m.frozen).toBe(false)
    expect(m.breakerTrippedAt).toBeUndefined()
    expect(m.breakerReason).toBeUndefined()
    expect(lastAudit(app.getSnapshot().state)).toMatchObject({ type: 'kill_switch', data: { frozen: false } })
  })

  it('changePin validates the new PIN and requires the old one', () => {
    const { app } = demoKit()
    expect(app.changePin(PIN, '1111').ok).toBe(false)
    expect(app.changePin('9999', '7391').ok).toBe(false)
    expect(app.changePin(PIN, '7391')).toEqual({ ok: true })
    expect(app.setAutonomy('autopilot', PIN).ok).toBe(false)
    expect(app.setAutonomy('autopilot', '7391')).toEqual({ ok: true })
    expect(JSON.stringify(app.getSnapshot().state.audit)).not.toContain('7391')
  })
})

describe('audit log', () => {
  it('stays a valid hash chain after 50+ operations and detects tampering', () => {
    const k = demoKit()
    const { app } = k
    for (let i = 0; i < 12; i++) app.addTripwire({ kind: 'daily_over', threshold: 20_000 + i })
    for (let i = 0; i < 10; i++) app.contributeToGoal('dream_chengdu', 1_000)
    for (let i = 0; i < 10; i++) app.setAutonomy(i % 2 ? 'copilot' : 'observe', PIN)
    for (let i = 0; i < 10; i++) app.setCategoryBudget('delivery', 50_000 + i * 100)
    for (let i = 0; i < 5; i++) app.simulatePurchase({ merchant: 'Luckin Coffee', amount: 1_800 })
    app.freeze()
    app.unfreeze(PIN)
    app.exportData()
    const s = app.getSnapshot().state
    expect(s.audit.length).toBeGreaterThanOrEqual(50)
    expect(app.verifyAudit()).toEqual({ ok: true, count: s.audit.length })
    expect(s.audit.map((e) => e.seq)).toEqual(s.audit.map((_, i) => s.audit[0].seq + i))
    expect(app.exportAuditJSONL().trim().split('\n')).toHaveLength(s.audit.length)

    const raw = JSON.parse(k.storage.getItem(STORAGE_KEY) as string) as AppState
    const victim = raw.audit[20]
    victim.summary = victim.summary + ' (edited)'
    k.storage.setItem(STORAGE_KEY, JSON.stringify(raw))
    const tampered = kit({ storage: k.storage })
    const v = tampered.app.verifyAudit()
    expect(v.ok).toBe(false)
    expect(v.brokenAt).toBe(victim.seq)
    expect(lastAudit(tampered.app.getSnapshot().state).data).toMatchObject({ auditIntact: false })
  })
})

describe('audit head anchoring (truncation of the newest entries)', () => {
  const HEAD_KEY = `${STORAGE_KEY}${AUDIT_HEAD_SUFFIX}`
  const head = (k: ReturnType<typeof kit>) => JSON.parse(k.storage.getItem(HEAD_KEY) as string) as { hash: string; count: number; seq: number }

  /** a demo with some history, saved */
  function busyDemo() {
    const k = demoKit()
    for (let i = 0; i < 4; i++) k.app.addTripwire({ kind: 'daily_over', threshold: 30_000 + i })
    k.app.contributeToGoal('dream_chengdu', 5_000)
    k.app.setCategoryBudget('delivery', 60_000)
    return k
  }

  it('every saved commit records the head hash + count under a separate key', () => {
    const k = busyDemo()
    const log = k.app.getSnapshot().state.audit
    expect(head(k)).toEqual({ hash: log.at(-1)!.hash, count: log.length, seq: log.at(-1)!.seq })
    k.app.freeze()
    expect(head(k).count).toBe(log.length + 1)
    expect(k.app.verifyAudit()).toEqual({ ok: true, count: log.length + 1 })
  })

  it('deleting the last 3 entries in storage → verifyAudit fails after reload (and keeps failing)', () => {
    const k = busyDemo()
    const raw = JSON.parse(k.storage.getItem(STORAGE_KEY) as string) as AppState
    const removed = raw.audit.splice(-3)
    k.storage.setItem(STORAGE_KEY, JSON.stringify(raw))
    // the truncated chain on its own is still a perfectly valid hash chain…
    expect(verifyAudit(raw.audit).ok).toBe(true)
    const reloaded = kit({ storage: k.storage })
    const v = reloaded.app.verifyAudit()
    expect(v.ok).toBe(false)
    expect(v.brokenAt).toBe(removed[0].seq)
    expect(v.reason).toMatch(/newest entries/)
    expect(lastAudit(reloaded.app.getSnapshot().state)).toMatchObject({ type: 'session_start', data: { auditIntact: false, brokenAt: removed[0].seq } })
    // the anchor is not moved onto the truncated chain, so later activity can't launder it
    reloaded.app.addTripwire({ kind: 'daily_over', threshold: 40_000 })
    expect(head(reloaded).hash).toBe(removed.at(-1)!.hash)
    expect(reloaded.app.verifyAudit().ok).toBe(false)
    expect(kit({ storage: k.storage }).app.verifyAudit().ok).toBe(false)
  })

  it('an untouched reload stays intact; the anchor moves forward along the same chain', () => {
    const k = busyDemo()
    const reloaded = kit({ storage: k.storage })
    expect(reloaded.app.verifyAudit().ok).toBe(true)
    expect(lastAudit(reloaded.app.getSnapshot().state).data).toMatchObject({ auditIntact: true })
    expect(head(reloaded).count).toBe(reloaded.app.getSnapshot().state.audit.length)
  })

  it('a deliberately fresh chain gets a fresh anchor: loadDemo and resetAll', () => {
    const k = busyDemo()
    const raw = JSON.parse(k.storage.getItem(STORAGE_KEY) as string) as AppState
    raw.audit.splice(-3)
    k.storage.setItem(STORAGE_KEY, JSON.stringify(raw))
    const reloaded = kit({ storage: k.storage })
    expect(reloaded.app.verifyAudit().ok).toBe(false)
    reloaded.app.loadDemo('arif')
    expect(reloaded.app.verifyAudit()).toMatchObject({ ok: true })
    expect(head(reloaded).count).toBe(reloaded.app.getSnapshot().state.audit.length)
    reloaded.app.resetAll()
    expect(k.storage.getItem(HEAD_KEY)).toBeNull()
  })

  it('unreadable stored data resets the anchor along with the data', () => {
    const k = busyDemo()
    k.storage.setItem(STORAGE_KEY, '{not json')
    const fresh = kit({ storage: k.storage })
    expect(fresh.app.verifyAudit().ok).toBe(true)
    expect(head(fresh).count).toBe(1)
  })

  it('vault: the anchor follows the encrypted saves and an intact unlock verifies', async () => {
    const k = busyDemo()
    expect(await k.app.enableVault(PIN)).toEqual({ ok: true })
    await k.app.flush()
    expect(head(k).count).toBe(k.app.getSnapshot().state.audit.length)
    const second = kit({ storage: k.storage })
    expect(second.app.verifyAudit().ok).toBe(true)
    expect(await second.app.unlock(PIN)).toEqual({ ok: true })
    expect(second.app.verifyAudit().ok).toBe(true)
    expect(lastAudit(second.app.getSnapshot().state).data).toMatchObject({ vault: true, auditIntact: true })
  })
})

describe('data rights', () => {
  it('exportData excludes the PIN hash and salt, and is audited', () => {
    const { app } = demoKit()
    const { pinHash, pinSalt } = app.getSnapshot().state.mandate
    const json = app.exportData()
    const parsed = JSON.parse(json) as AppState
    expect(parsed.mandate.pinHash).toBeUndefined()
    expect(parsed.mandate.pinSalt).toBeUndefined()
    expect(json).not.toContain(pinHash as string)
    expect(json).not.toContain(pinSalt as string)
    expect(parsed.bank.transactions.length).toBe(app.getSnapshot().state.bank.transactions.length)
    expect(lastAudit(app.getSnapshot().state).type).toBe('data_export')
    expect(app.getSnapshot().state.mandate.pinHash).toBe(pinHash)
  })

  it('resetAll wipes storage and memory and starts a fresh chain', async () => {
    const k = demoKit()
    await k.app.enableVault(PIN)
    k.app.resetAll()
    expect(stored(k)).toBeNull()
    expect(k.app.isOnboarded()).toBe(false)
    expect(k.app.isLocked()).toBe(false)
    const s = k.app.getSnapshot().state
    expect(s.profile).toBeNull()
    expect(s.bank.transactions).toEqual([])
    expect(types(s)).toEqual(['data_wiped'])
    expect(s.audit[0].prevHash).toBe('0'.repeat(64))
    expect(k.app.verifyAudit()).toEqual({ ok: true, count: 1 })
    await k.app.flush()
    expect(stored(k)).toBeNull()
  })

  it('resetAll also works while the vault is locked', async () => {
    const first = demoKit()
    await first.app.enableVault(PIN)
    const { app, storage } = kit({ storage: first.storage })
    expect(app.isLocked()).toBe(true)
    app.resetAll()
    expect(app.isLocked()).toBe(false)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
    app.loadDemo()
    expect(app.isOnboarded()).toBe(true)
  })
})

describe('sandbox & data', () => {
  it('simulatePurchase over a single_over tripwire fires an event with a dream equivalent', () => {
    const { app } = demoKit()
    const tw = app.addTripwire({ kind: 'single_over', threshold: 30_000 })
    const { txn, events } = app.simulatePurchase({ merchant: 'JD.com', amount: 45_900 })
    expect(txn.amount).toBe(-45_900)
    expect(txn.date).toBe('2026-10-22')
    const fired = events.filter((e) => e.tripwireId === tw.id)
    expect(fired).toHaveLength(1)
    expect(fired[0].txnId).toBe(txn.id)
    expect(fired[0].dream?.itemName).toBeTruthy()
    const s = app.getSnapshot()
    expect(s.derived.unseenEvents.map((e) => e.id)).toContain(fired[0].id)
    expect(types(s.state)).toContain('tripwire_fired')
    expect(lastAudit(s.state)).toMatchObject({ type: 'sandbox_event', data: { txnId: txn.id } })
    app.markEventsSeen([fired[0].id])
    expect(app.getSnapshot().derived.unseenEvents.map((e) => e.id)).not.toContain(fired[0].id)
    app.markEventsSeen()
    expect(app.getSnapshot().derived.unseenEvents).toEqual([])
  })

  it('simulatePurchase validates input', () => {
    const { app } = demoKit()
    expect(() => app.simulatePurchase({ merchant: '', amount: 100 })).toThrow()
    expect(() => app.simulatePurchase({ merchant: 'JD', amount: 0 })).toThrow()
  })

  it('advanceDays moves the sandbox clock, generates transactions and expires pending actions', () => {
    const { app, engine } = demoKit()
    const before = app.getSnapshot().state.bank.transactions.length
    const { txns } = app.advanceDays(3)
    const s = app.getSnapshot().state
    expect(s.bank.today).toBe('2026-10-25')
    expect(txns.length).toBeGreaterThan(0)
    expect(s.bank.transactions.length).toBe(before + txns.length)
    expect(lastAudit(s)).toMatchObject({ type: 'sandbox_event', data: { days: 3, to: '2026-10-25' } })
    expect(() => app.advanceDays(0)).toThrow()
    expect(engine.log.created).toBe(0) // no pending actions → no need to wake the engine
  })

  it('importCsv merges new rows and skips duplicates (date + amount + merchant)', () => {
    const { app } = kit()
    app.completeOnboarding(onboardingInput({ dataSource: { kind: 'csv', text: SAMPLE_CSV, startingBalance: 500_000 } }))
    const again = app.importCsv(SAMPLE_CSV)
    expect(again.added).toBe(0)
    expect(again.skipped).toBe(6)
    const more = app.importCsv(`${SAMPLE_CSV}\n2026-10-09,Mixue,Mixue ice cream,-6.00`)
    expect(more.added).toBe(1)
    expect(app.getSnapshot().state.bank.transactions).toHaveLength(7)
    expect(lastAudit(app.getSnapshot().state)).toMatchObject({ type: 'data_import', data: { added: 1, duplicates: 6 } })
    const ids = app.getSnapshot().state.bank.transactions.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('importCsv before onboarding reports an error', () => {
    const { app } = kit()
    expect(app.importCsv(SAMPLE_CSV)).toMatchObject({ added: 0, errors: [expect.stringMatching(/setting up/)] })
  })

  it('transactions() filters by month, category and text, newest first', () => {
    const { app } = demoKit()
    const oct = app.transactions({ month: '2026-10' })
    expect(oct.length).toBeGreaterThan(0)
    expect(oct.every((t) => t.date.startsWith('2026-10'))).toBe(true)
    expect(oct[0].date >= oct[oct.length - 1].date).toBe(true)
    const delivery = app.transactions({ category: 'delivery' })
    expect(delivery.every((t) => t.category === 'delivery')).toBe(true)
    const q = app.transactions({ query: 'iqiyi' })
    expect(q.length).toBeGreaterThan(0)
  })
})

describe('dreams, tripwires & budget', () => {
  it('contributeToGoal is a user action that moves money checking → pot', () => {
    const { app } = demoKit()
    const before = app.getSnapshot().state
    expect(app.contributeToGoal('dream_chengdu', 20_000)).toEqual({ ok: true })
    const after = app.getSnapshot().state
    expect(checking(after).balance).toBe(checking(before).balance - 20_000)
    expect(account(after, 'pot_dream_chengdu').balance).toBe(account(before, 'pot_dream_chengdu').balance + 20_000)
    expect(lastAudit(after)).toMatchObject({ type: 'user_action', actor: 'user', data: { initiatedBy: 'user', amount: 20_000 } })
    const moved = after.bank.transactions.slice(-2)
    expect(moved.every((t) => t.initiatedBy === 'user')).toBe(true)
    expect(after.pending).toEqual(before.pending)
  })

  it('contributeToGoal refuses bad input and overdrafts', () => {
    const { app } = demoKit()
    expect(app.contributeToGoal('dream_chengdu', 0).ok).toBe(false)
    expect(app.contributeToGoal('dream_nope', 100).ok).toBe(false)
    expect(app.contributeToGoal('dream_airpods', 100).ok).toBe(false)
    const huge = checking(app.getSnapshot().state).balance + 100
    expect(app.contributeToGoal('dream_chengdu', huge).ok).toBe(false)
  })

  it('add / update / achieve / remove dreams', () => {
    const { app } = demoKit()
    const d = app.addDream({ name: 'Film camera', price: 250_000, image: 'preset:camera', kind: 'goal' })
    expect(d.id).toBe('dream_film_camera')
    expect(d.potAccountId).toBe('pot_dream_film_camera')
    expect(app.updateDream(d.id, { price: 260_000, name: 'Film camera (used)' })).toEqual({ ok: true })
    expect(app.updateDream(d.id, { price: -1 }).ok).toBe(false)
    expect(app.contributeToGoal(d.id, 10_000).ok).toBe(true)
    const balance = checking(app.getSnapshot().state).balance
    expect(app.markDreamAchieved(d.id)).toEqual({ ok: true })
    expect(app.getSnapshot().state.dreams.find((x) => x.id === d.id)?.achievedAt).toBe('2026-10-22')
    expect(app.removeDream(d.id)).toEqual({ ok: true })
    const s = app.getSnapshot().state
    expect(s.dreams.find((x) => x.id === d.id)).toBeUndefined()
    expect(checking(s).balance).toBe(balance + 10_000)
    expect(app.removeDream(d.id).ok).toBe(false)
    expect(() => app.addDream({ name: '', price: 1, image: '', kind: 'treat' })).toThrow()
  })

  it('tripwire update / remove', () => {
    const { app } = demoKit()
    const t = app.addTripwire({ kind: 'category_pct', threshold: 90, category: 'delivery' })
    expect(app.updateTripwire(t.id, { threshold: 75 })).toEqual({ ok: true })
    expect(app.getSnapshot().state.tripwires.find((x) => x.id === t.id)?.threshold).toBe(75)
    expect(app.updateTripwire(t.id, { threshold: -1 }).ok).toBe(false)
    expect(app.updateTripwire(t.id, { enabled: false })).toEqual({ ok: true })
    expect(app.removeTripwire(t.id)).toEqual({ ok: true })
    expect(app.removeTripwire(t.id).ok).toBe(false)
    expect(() => app.addTripwire({ kind: 'category_pct', threshold: 80 })).toThrow(/category/)
  })

  it('setCategoryBudget sets, updates and removes a limit', () => {
    const { app } = demoKit()
    expect(app.setCategoryBudget('delivery', 60_000)).toEqual({ ok: true })
    let plan = app.getSnapshot().state.budget!
    expect(plan.categories.find((c) => c.category === 'delivery')?.limit).toBe(60_000)
    expect(plan.total).toBe(plan.categories.reduce((a, c) => a + c.limit, 0))
    expect(plan).toMatchObject({ method: 'custom', createdBy: 'user' })
    expect(app.setCategoryBudget('delivery', 0)).toEqual({ ok: true })
    plan = app.getSnapshot().state.budget!
    expect(plan.categories.find((c) => c.category === 'delivery')).toBeUndefined()
    expect(app.setCategoryBudget('income', 100).ok).toBe(false)
  })

  it('recategorize updates the transaction and learns a merchant rule', () => {
    const { app } = demoKit()
    const txn = app.transactions({ category: 'coffee_tea' })[0]
    expect(app.recategorize(txn.id, 'dining')).toEqual({ ok: true })
    const s = app.getSnapshot().state
    expect(s.bank.transactions.find((t) => t.id === txn.id)).toMatchObject({ category: 'dining', categorySource: 'user', categoryConfidence: 1 })
    expect(Object.values(s.categoryRules)).toContain('dining')
    expect(app.recategorize('missing', 'dining').ok).toBe(false)
  })
})

describe('profile & settings', () => {
  it('setProfile validates and audits', () => {
    const { app } = demoKit()
    expect(app.setProfile({ targetSpend: 1_000_000, tone: 'numbers' })).toEqual({ ok: true })
    expect(app.getSnapshot().state.profile).toMatchObject({ targetSpend: 1_000_000, tone: 'numbers' })
    expect(app.setProfile({ payday: 31 }).ok).toBe(false)
    expect(app.setProfile({ name: ' ' }).ok).toBe(false)
  })

  it('setConsent / setSettings change state; vault is not a plain setting', () => {
    const { app } = demoKit()
    app.setConsent({ llmProcessing: false })
    expect(app.getSnapshot().state.profile?.consent.llmProcessing).toBe(false)
    expect(lastAudit(app.getSnapshot().state).type).toBe('consent')
    app.setSettings({ glassBox: false, vault: true })
    expect(app.getSnapshot().state.settings).toMatchObject({ glassBox: false, vault: false })
  })

  it('actions before onboarding fail cleanly', () => {
    const { app } = kit()
    expect(app.setAutonomy('autopilot', PIN).ok).toBe(false)
    expect(app.contributeToGoal('x', 1).ok).toBe(false)
    expect(app.setProfile({ name: 'x' }).ok).toBe(false)
    expect(() => app.addDream({ name: 'x', price: 1, image: '', kind: 'treat' })).toThrow()
    expect(app.verifyAudit()).toEqual({ ok: true, count: 0 })
  })
})
