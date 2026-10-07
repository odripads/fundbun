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
export function createHost({ store, now, llmClient }: HostDeps): AgentHost {
  return {
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
