import type { AgentHost } from '../agent/host'
import type { LlmClient } from '../agent/llm'
import type { AiClient } from '../ai/client'
import type { FinanceContext } from '../types'
import { appendAudit } from './audit'
import { engineFor, financeFor } from './derive'
import type { Store } from './store'
import { applyTripwires } from './tripwires'

export interface HostDeps {
  store: Store
  now(): string
  /** the gateway client (null when llmBaseUrl is null) */
  llmClient: LlmClient | null
  /** the local server's client for the user's own AI connections (null with llmClient) */
  aiClient?: AiClient | null
  /** this conversation's name for an agent, and the Stop signal of the reply in flight */
  session?: AgentSession
}

/** One agent conversation: the key names it to the agent; a new key (New chat, reload) starts the agent afresh. */
export interface AgentSession {
  key(): string
  /** true until the first turn with this key was sent */
  fresh(): boolean
  used(): void
  signal(): AbortSignal
}

/**
 * The controller as the agent runtime sees it.
 * - state()/ctx()/recurring()/findings() reflect the last COMMITTED state, also while a mutate() is running —
 *   inside a recipe, read the `draft` argument instead.
 * - mutate(): structuredClone draft + live SandboxBank(draft.bank); commit on return, discard on throw; nested
 *   calls (including audit() and afterTransactions()) join the outer transaction. Recipes must be synchronous.
 */
/** After a failed LLM call the engine stays on-device this long (doubling per failure in a row, capped). */
export const LLM_COOLDOWN_MS = 60_000
export const LLM_COOLDOWN_MAX_MS = 10 * 60_000

export function createHost({ store, now, llmClient, aiClient, session }: HostDeps): AgentHost {
  let failuresInARow = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  /** Ask the gateway again once the cool-down is over; a healthy answer switches the LLM engine back on. */
  async function recheck(): Promise<void> {
    retryTimer = undefined
    if (!llmClient) return
    try {
      const h = await llmClient.health()
      const prev = store.runtime().llm
      store.setRuntime({ llm: { ...prev, checked: true, available: h.ok === true, ...(h.ok ? { reason: undefined } : { reason: h.reason ?? 'LLM gateway unavailable' }) } })
    } catch {
      // still unreachable: stay on-device; the next settings change or reload checks again
    }
  }

  return {
    llmOk() {
      failuresInARow = 0
    },
    llmFailed() {
      // the user's own AI: no cool-down. They chose it; the next message simply tries it again.
      if (store.runtime().llm.local) return
      failuresInARow++
      const wait = Math.min(LLM_COOLDOWN_MAX_MS, LLM_COOLDOWN_MS * 2 ** (failuresInARow - 1))
      const prev = store.runtime().llm
      store.setRuntime({ llm: { ...prev, checked: true, available: false, reason: `The AI model did not answer. Using the on-device engine and trying the model again in ${Math.round(wait / 60_000)} min.` } })
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => void recheck(), wait)
      // never keep a Node process (tests, scripts) alive just for this timer
      ;(retryTimer as { unref?: () => void }).unref?.()
    },
    state: () => store.get(),
    ctx(): FinanceContext {
      const ctx = financeFor(store.get()).ctx
      if (!ctx) throw new Error('FundBun is not set up yet (no profile)')
      return ctx
    },
    recurring: () => financeFor(store.get()).recurring,
    findings: () => financeFor(store.get()).findings,
    now,
    mutate: (recipe) => store.mutate(recipe),
    audit(actor, type, summary, data = {}) {
      store.mutate((draft) => appendAudit(draft, now(), actor, type, summary, data))
    },
    llm() {
      if (!llmClient) return null
      const status = store.runtime().llm
      if (status.kind === 'agent') return null
      return engineFor(store.get(), status) === 'llm' ? llmClient : null
    },
    agent() {
      const status = store.runtime().llm
      if (!aiClient || !session || status.kind !== 'agent' || !status.connectionId) return null
      if (engineFor(store.get(), status) !== 'llm') return null
      // the label names the model too, so the chat and the glass box say exactly who answered
      const label = [status.provider ?? 'Your agent', status.model].filter(Boolean).join(' · ')
      const link = { client: aiClient, connectionId: status.connectionId, label, sessionKey: session.key(), fresh: session.fresh(), signal: session.signal() }
      session.used()
      return link
    },
    llmInfo() {
      const status = store.runtime().llm
      return status.local ? { local: true, label: status.provider ?? 'Your AI', onDevice: status.onDevice === true } : null
    },
    live(reply) {
      store.setRuntime({ live: reply })
    },
    afterTransactions: (txns) => store.mutate((draft) => applyTripwires(draft, txns, now())),
  }
}
