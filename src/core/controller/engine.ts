import type { AgentEngine, AgentEngineFactory, AgentHost } from '../agent/host'
import { WARMING_UP } from './constants'
import { assistantMessage, unavailablePending, userMessage } from './messages'

export interface EngineHolder {
  /** the agent engine, created on first use; a fallback engine if the factory throws */
  get(): AgentEngine
  /** drop the engine (new profile / reset) — recreated lazily */
  reset(): void
  usingFallback(): boolean
}

export function createEngineHolder(factory: AgentEngineFactory, host: AgentHost): EngineHolder {
  let engine: AgentEngine | null = null
  let fallback = false
  return {
    get() {
      if (engine) return engine
      try {
        engine = factory(host)
        fallback = false
      } catch (e) {
        console.error('[fundbun] agent engine unavailable, using fallback:', e)
        engine = fallbackEngine(host)
        fallback = true
      }
      return engine
    },
    reset() {
      engine = null
      fallback = false
    },
    usingFallback: () => fallback,
  }
}

/** Minimal engine used when the real runtime cannot start: answers politely, never acts. */
export function fallbackEngine(host: AgentHost): AgentEngine {
  return {
    async respond(text) {
      const ts = host.now()
      const reply = assistantMessage(WARMING_UP, ts, { suggestions: [] })
      host.mutate((draft) => {
        draft.chat.push(userMessage(text, ts), reply)
      })
      return reply
    },
    async propose(action, proposedBy) {
      return unavailablePending(action, proposedBy, WARMING_UP, host.now())
    },
    async approve() {
      return { ok: false, error: WARMING_UP }
    },
    reject() {},
    undo() {
      return { ok: false, error: WARMING_UP }
    },
    expire() {},
    preview(call) {
      return { title: call.tool, summary: WARMING_UP, reversible: false, risk: 'high', effects: [] }
    },
  }
}
