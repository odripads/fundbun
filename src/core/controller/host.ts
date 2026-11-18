import type { AgentHost } from '../agent/host'
import type { LlmClient } from '../agent/llm'
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

export function createHost({ store, now, llmClient }: HostDeps): AgentHost {
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
      return engineFor(store.get(), store.runtime().llm) === 'llm' ? llmClient : null
    },
    afterTransactions: (txns) => store.mutate((draft) => applyTripwires(draft, txns, now())),
  }
}
