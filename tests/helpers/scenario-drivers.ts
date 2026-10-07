import type { AgentEngine } from '../../src/core/agent/host'
import { createAgentEngine } from '../../src/core/agent/runtime'
import { createTestApp, memoryStorage, type StorageLike } from '../../src/core/app'
import { computeMirror } from '../../src/core/finance'
import type { AppState, Autonomy, ChatMessage, Mandate, MirrorState, PendingAction, SuggestedAction, TripwireEvent } from '../../src/core/types'
import { PIN, START, fakeHost, type FakeHost } from './fake-host'

/** One scripted-scenario surface over either the fake AgentHost or the real controller (createTestApp + loadDemo). */
export interface Driver {
  kind: 'fake-host' | 'app'
  send(text: string): Promise<ChatMessage>
  xray(text: string): Promise<ChatMessage>
  approve(id: string, pin?: string): Promise<{ ok: boolean; error?: string }>
  reject(id: string): void
  undo(id: string): { ok: boolean; error?: string }
  propose(action: SuggestedAction): Promise<PendingAction>
  state(): AppState
  mirror(): MirrorState
  advanceSeconds(s: number): void
  setAutonomy(a: Autonomy, pin?: string): { ok: boolean; error?: string }
  setCaps(caps: Partial<Pick<Mandate, 'perActionCap' | 'dailyCap' | 'monthlyCap'>>, pin?: string): { ok: boolean; error?: string }
  freeze(): void
  unfreeze(pin: string): { ok: boolean; error?: string }
  purchase(merchant: string, amount: number): { events: TripwireEvent[] }
  advanceDays(n: number): void
}

export type DriverFactory = (persona?: 'mei' | 'arif') => Driver

export function fakeDriver(persona: 'mei' | 'arif' = 'mei'): Driver & { host: FakeHost; engine: AgentEngine } {
  const host = fakeHost({ persona })
  const engine = createAgentEngine(host)
  const turn = async (text: string, source: 'chat' | 'xray') => {
    engine.expire()
    return engine.respond(text, { source })
  }
  return {
    kind: 'fake-host',
    host,
    engine,
    send: (t) => turn(t, 'chat'),
    xray: (t) => turn(t, 'xray'),
    approve: (id, pin) => engine.approve(id, pin),
    reject: (id) => engine.reject(id),
    undo: (id) => engine.undo(id),
    propose: (a) => engine.propose(a, 'user'),
    state: () => host.state(),
    mirror: () => computeMirror(host.ctx()),
    advanceSeconds: (s) => host.clock.advanceSeconds(s),
    setAutonomy(a) {
      host.edit((d) => {
        d.mandate.autonomy = a
      })
      return { ok: true }
    },
    setCaps(caps) {
      host.edit((d) => Object.assign(d.mandate, caps))
      return { ok: true }
    },
    freeze() {
      host.edit((d) => {
        d.mandate.frozen = true
      })
    },
    unfreeze(pin) {
      if (pin !== PIN) return { ok: false, error: 'Wrong PIN' }
      host.mutate((d) => {
        d.mandate.frozen = false
        delete d.mandate.breakerTrippedAt
        delete d.mandate.breakerReason
      })
      host.audit('user', 'kill_switch', 'Kill switch off', { frozen: false })
      return { ok: true }
    },
    purchase(merchant, amount) {
      const txn = host.mutate((_d, bank) => bank.simulatePurchase({ merchant, amount }))
      return { events: host.afterTransactions([txn]) }
    },
    advanceDays(n) {
      host.mutate((_d, bank) => {
        bank.advanceDays(n)
      })
    },
  }
}

export function appDriver(persona: 'mei' | 'arif' = 'mei', storage: StorageLike = memoryStorage()): Driver & { app: ReturnType<typeof createTestApp>; clock: { now: Date }; storage: StorageLike } {
  const clock = { now: new Date(START) }
  const app = createTestApp({ storage, now: () => clock.now })
  app.loadDemo(persona)
  return {
    kind: 'app',
    app,
    clock,
    storage,
    send: (t) => app.sendMessage(t),
    xray: (t) => app.xrayBill(t),
    approve: (id, pin) => app.approveAction(id, pin),
    reject: (id) => app.rejectAction(id),
    undo: (id) => app.undoAction(id),
    propose: (a) => app.runSuggestedAction(a),
    state: () => app.getSnapshot().state,
    mirror: () => app.getSnapshot().derived.mirror as MirrorState,
    advanceSeconds(s) {
      clock.now = new Date(clock.now.getTime() + s * 1000)
    },
    setAutonomy: (a, pin) => app.setAutonomy(a, pin),
    setCaps: (caps, pin) => app.setCaps(caps, pin),
    freeze: () => app.freeze(),
    unfreeze: (pin) => app.unfreeze(pin),
    purchase(merchant, amount) {
      return { events: app.simulatePurchase({ merchant, amount }).events }
    },
    advanceDays(n) {
      app.advanceDays(n)
    },
  }
}
