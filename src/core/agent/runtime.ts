import type { AgentEngineFactory } from './host'

/** Creates the FundBun agent runtime (offline Bun Engine + LLM tool loop, policy-gated). */
export const createAgentEngine: AgentEngineFactory = (host) => {
  throw new Error('TODO createAgentEngine ' + typeof host)
}
