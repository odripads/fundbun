import type { AgentHost } from '../../src/core/agent/host'
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/core/agent/llm'
import { analyzeBills, detectRecurring, evaluateTripwires } from '../../src/core/finance'
import { SandboxBank } from '../../src/core/sandbox/bank'
import { loadPersona } from '../../src/core/sandbox/personas'
import { createAuditEntry } from '../../src/core/security/audit'
import { createPin } from '../../src/core/security/pin'
import { defaultMandate } from '../../src/core/security/policy'
import type { AppState, BillFinding, FinanceContext, Mandate, RecurringSeries } from '../../src/core/types'

export const PIN = '2580'
export const SANDBOX_TODAY = '2026-10-22'
export const START = '2026-10-22T02:00:00.000Z'

export interface FakeHostOptions {
  persona?: 'mei' | 'arif'
  now?: string
  llm?: LlmClient | null
  mandate?: Partial<Mandate>
  /** deep-freeze committed states so in-place mutation outside mutate() throws (default true) */
  freeze?: boolean
}

export interface FakeHost extends AgentHost {
  clock: { now: string; set(iso: string): void; advanceSeconds(s: number): void; advanceMinutes(m: number): void }
  setLlm(client: LlmClient | null): void
  /** test-only direct edit of the committed state (bypasses the agent) */
  edit(recipe: (draft: AppState) => void): void
  commits(): number
}

export function personaState(persona: 'mei' | 'arif' = 'mei', mandate: Partial<Mandate> = {}): AppState {
  const b = loadPersona(persona, SANDBOX_TODAY)
  return {
    version: 1,
    profile: b.profile,
    bank: b.bank,
    dreams: b.dreams,
    budget: b.budget,
    tripwires: b.tripwires,
    tripwireEvents: [],
    mandate: { ...defaultMandate(), ...createPin(PIN), failedPinAttempts: 0, ...mandate },
    pending: [],
    chat: [],
    audit: [],
    categoryRules: {},
    billReminders: {},
    plans: [],
    dialogue: {},
    settings: { glassBox: true, llmEnabled: true, notificationsEnabled: false, reducedMotion: false, vault: false },
  }
}

function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v
  Object.freeze(v)
  for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x)
  return v
}

function ctxOf(state: AppState): FinanceContext {
  if (!state.profile) throw new Error('not onboarded')
  const { profile, bank, dreams, budget, tripwires } = state
  return { profile, bank, dreams, budget, tripwires }
}

/** A real AgentHost (host.ts semantics: atomic mutate with nested join, hash-chained audit) over a persona. */
export function fakeHost(opts: FakeHostOptions = {}): FakeHost {
  const freeze = opts.freeze ?? true
  let state = personaState(opts.persona ?? 'mei', opts.mandate)
  if (freeze) deepFreeze(state)
  let tx: { draft: AppState; bank: SandboxBank } | null = null
  let llm: LlmClient | null = opts.llm ?? null
  let commits = 0
  const recurringMemo = new WeakMap<AppState, RecurringSeries[]>()
  const findingsMemo = new WeakMap<AppState, BillFinding[]>()
  const clock = {
    now: opts.now ?? START,
    set(iso: string) {
      clock.now = new Date(iso).toISOString()
    },
    advanceSeconds(s: number) {
      clock.now = new Date(Date.parse(clock.now) + s * 1000).toISOString()
    },
    advanceMinutes(m: number) {
      clock.advanceSeconds(m * 60)
    },
  }

  const host: FakeHost = {
    clock,
    state: () => state,
    ctx: () => ctxOf(state),
    recurring() {
      let r = recurringMemo.get(state)
      if (!r) {
        r = detectRecurring(state.bank.transactions, state.bank.today, state.bank.cancelledMerchants)
        recurringMemo.set(state, r)
      }
      return r
    },
    findings() {
      let f = findingsMemo.get(state)
      if (!f) {
        f = analyzeBills(ctxOf(state), host.recurring())
        findingsMemo.set(state, f)
      }
      return f
    },
    now: () => clock.now,
    mutate(recipe) {
      if (tx) return recipe(tx.draft, tx.bank)
      const draft = structuredClone(state) as AppState
      const bank = new SandboxBank(draft.bank, { userRules: draft.categoryRules })
      tx = { draft, bank }
      let result
      try {
        result = recipe(draft, bank)
      } finally {
        tx = null
      }
      draft.bank = bank.state
      state = freeze ? deepFreeze(draft) : draft
      commits++
      return result
    },
    audit(actor, type, summary, data = {}) {
      host.mutate((draft) => {
        draft.audit.push(createAuditEntry(draft.audit, { actor, type, summary, data, ts: clock.now }))
      })
    },
    llm: () => llm,
    afterTransactions(txns) {
      return host.mutate((draft) => {
        const out = evaluateTripwires(ctxOf(draft), { newTxns: txns, now: clock.now })
        draft.tripwires = out.tripwires
        draft.tripwireEvents = [...draft.tripwireEvents, ...out.events]
        for (const ev of out.events) {
          draft.audit.push(createAuditEntry(draft.audit, { actor: 'system', type: 'tripwire_fired', summary: ev.title, data: { tripwireId: ev.tripwireId, eventId: ev.id }, ts: clock.now }))
        }
        return out.events
      })
    },
    setLlm(client) {
      llm = client
    },
    edit(recipe) {
      const draft = structuredClone(state) as AppState
      recipe(draft)
      state = freeze ? deepFreeze(draft) : draft
    },
    commits: () => commits,
  }
  return host
}

// ───────────────────────────── scripted LLM ─────────────────────────────

export type LlmStep = LlmResponse | Error | ((req: LlmRequest) => LlmResponse | Error)

export interface ScriptedLlm {
  client: LlmClient
  requests: LlmRequest[]
}

/** A fake LlmClient replaying scripted responses (one per complete() call; the last one repeats). */
export function scriptedLlm(steps: LlmStep[]): ScriptedLlm {
  const requests: LlmRequest[] = []
  let i = 0
  const client = {
    baseUrl: 'fake',
    async health() {
      return { ok: true, provider: 'fake', model: 'scripted' }
    },
    async complete(req: LlmRequest) {
      requests.push(structuredClone(req))
      const step = steps[Math.min(i++, steps.length - 1)]
      const out = typeof step === 'function' ? step(req) : step
      if (out instanceof Error) throw out
      return structuredClone(out)
    },
  } as unknown as LlmClient
  return { client, requests }
}

export function llmText(text: string): LlmResponse {
  return { content: [{ type: 'text', text }], stopReason: 'end_turn', provider: 'fake', model: 'scripted' }
}

export function llmTool(name: string, input: Record<string, unknown>, id = `toolu_${name}`, text?: string): LlmResponse {
  return {
    content: [...(text ? [{ type: 'text' as const, text }] : []), { type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    provider: 'fake',
    model: 'scripted',
  }
}

/** The JSON payload of the last tool_result the model received (unwrapped when possible). */
export function lastToolResult(req: LlmRequest): { content: string; is_error?: boolean } | undefined {
  const last = req.messages[req.messages.length - 1]
  if (!last || typeof last.content === 'string') return undefined
  const block = last.content.find((b) => b.type === 'tool_result')
  return block && block.type === 'tool_result' ? { content: block.content, is_error: block.is_error } : undefined
}
