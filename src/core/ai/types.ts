/**
 * "Bring your own AI": what the local FundBun server (server/ai, server/agents) and the app agree on.
 * A connection is one AI the user plugged in. Three kinds:
 *   openai_compat — any /chat/completions endpoint with the user's own key (DeepSeek, Qwen, OpenAI, …) or a model
 *                   running on this computer (Ollama, LM Studio)
 *   anthropic     — the Claude API with the user's own key
 *   agent         — an agent already installed and signed in on this computer (Claude Code, Codex, Qwen Code, …),
 *                   driven over the Agent Client Protocol (ACP)
 * Keys never reach the app: the server answers `hasKey`, never the key.
 */
export type ConnectionKind = 'openai_compat' | 'anthropic' | 'agent'

export type PresetGroup = 'key' | 'local' | 'agent'

export interface AiPreset {
  id: string
  name: string
  /** who runs it, e.g. "DeepSeek", "Alibaba Cloud", "on this computer" */
  vendor: string
  kind: Exclude<ConnectionKind, 'agent'>
  group: Exclude<PresetGroup, 'agent'>
  /** fixed endpoint; absent for "custom" (the user types it) */
  baseUrl?: string
  /** a model to start with when the endpoint cannot list its models */
  defaultModel?: string
  /** where a person gets a key */
  keyUrl?: string
  needsKey: boolean
  /** one plain sentence shown under the name */
  note: string
}

export interface AgentPreset {
  id: string
  name: string
  vendor: string
  /** the command people already have, e.g. "claude", "qwen" */
  bin: string
  /** how the user signs in, shown as a hint */
  login: string
  /** what FundBun runs: the agent's own ACP mode, or its ACP adapter from npm */
  launch: { via: 'bin'; args: string[] } | { via: 'npx'; package: string; args: string[] }
  note: string
}

export interface DetectedAgent extends AgentPreset {
  installed: boolean
}

export interface AiConnection {
  id: string
  kind: ConnectionKind
  presetId: string
  label: string
  baseUrl?: string
  model?: string
  hasKey: boolean
  /** runs on this computer: nothing is sent to a company's servers */
  local: boolean
  /** kind 'agent': the command line FundBun starts */
  command?: string[]
  createdAt: string
  /** last successful test or answer */
  okAt?: string
  lastError?: string
}

export interface AiState {
  /** false on the hosted web app: connections need the desktop app or the local server */
  local: boolean
  presets: AiPreset[]
  agents: DetectedAgent[]
  connections: AiConnection[]
  activeId: string | null
  /** how keys are kept on this machine, in plain words */
  keyStorage: string
}

export interface NewConnectionInput {
  presetId: string
  label?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  /** kind 'agent' with presetId 'custom-agent': the command to run, one argument per item */
  command?: string[]
}

export interface ConnectionTest {
  ok: boolean
  ms: number
  model?: string
  /** the model answered with a tool call when asked to (needed for Bun to read your numbers) */
  tools?: boolean
  error?: string
}

/** Events of one agent turn, sent from the local server to the app as newline-delimited JSON. */
export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; delta: string }
  | { type: 'thought'; delta: string }
  /** a tool the agent runs itself (its shell, its file reads): shown, not run by FundBun */
  | { type: 'tool'; id: string; title: string; kind: string; status: string }
  /** the agent asks to use a FundBun tool: the app runs it through the policy gate and posts the result back */
  | { type: 'fundbun_tool'; callId: string; name: string; args: Record<string, unknown> }
  /** the agent asks the user for permission to use one of its own tools */
  | { type: 'permission'; requestId: string; title: string; detail?: string; options: { id: string; name: string; kind: string }[] }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; code: string; message: string }

export const AI_UNAVAILABLE: AiState = { local: false, presets: [], agents: [], connections: [], activeId: null, keyStorage: '' }
