import type { AgentPreset, AiPreset } from '../../src/core/ai/types'

/**
 * Provider quirks that are not part of the OpenAI wire format. Kept beside the catalogue so adding a provider is
 * one entry. `extraBody` is merged into the request; `maxTokensParam` names the output-limit field.
 */
export interface PresetWire {
  extraBody?: Record<string, unknown>
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens'
}

/**
 * Model ids are deliberately absent for most providers: they change often, so FundBun asks the endpoint for its
 * model list and the user picks. `defaultModel` is set only where the endpoint cannot list or the id is stable.
 */
export const PRESETS: readonly (AiPreset & { wire?: PresetWire })[] = [
  {
    id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'Your own DeepSeek API key.', wire: { extraBody: { thinking: { type: 'disabled' } } },
  },
  {
    id: 'qwen', name: 'Qwen', vendor: 'Alibaba Cloud Model Studio (China)', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com/',
    note: 'Your own Model Studio (Bailian) API key, mainland China endpoint.', wire: { extraBody: { enable_thinking: false } },
  },
  {
    id: 'qwen-intl', name: 'Qwen (international)', vendor: 'Alibaba Cloud Model Studio', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://modelstudio.console.alibabacloud.com/',
    note: 'Your own Model Studio API key, Singapore endpoint.', wire: { extraBody: { enable_thinking: false } },
  },
  {
    id: 'kimi', name: 'Kimi', vendor: 'Moonshot AI', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    note: 'Your own Moonshot API key.',
  },
  {
    id: 'glm', name: 'GLM', vendor: 'Zhipu AI', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: 'Your own Zhipu API key.',
  },
  {
    id: 'openai', name: 'OpenAI', vendor: 'OpenAI', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Your own OpenAI API key.', wire: { maxTokensParam: 'max_completion_tokens' },
  },
  {
    id: 'anthropic', name: 'Claude', vendor: 'Anthropic', kind: 'anthropic', group: 'key', needsKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys', defaultModel: 'claude-sonnet-5-5',
    note: 'Your own Claude API key.',
  },
  {
    id: 'gemini', name: 'Gemini', vendor: 'Google', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Your own Gemini API key.',
  },
  {
    id: 'xai', name: 'Grok', vendor: 'xAI', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/',
    note: 'Your own xAI API key.',
  },
  {
    id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', kind: 'openai_compat', group: 'key', needsKey: true,
    baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys',
    note: 'One key for many models.',
  },
  {
    id: 'custom', name: 'Another provider', vendor: 'OpenAI-compatible', kind: 'openai_compat', group: 'key', needsKey: false,
    note: 'Any address that answers /chat/completions.',
  },
  {
    id: 'ollama', name: 'Ollama', vendor: 'On this computer', kind: 'openai_compat', group: 'local', needsKey: false,
    baseUrl: 'http://127.0.0.1:11434/v1', keyUrl: 'https://ollama.com/download',
    note: 'A model running on this computer. Nothing is sent anywhere.',
  },
  {
    id: 'lmstudio', name: 'LM Studio', vendor: 'On this computer', kind: 'openai_compat', group: 'local', needsKey: false,
    baseUrl: 'http://127.0.0.1:1234/v1', keyUrl: 'https://lmstudio.ai/',
    note: 'A model running on this computer. Nothing is sent anywhere.',
  },
]

/**
 * Agents FundBun knows how to start. Launch lines come from the public ACP registry
 * (cdn.agentclientprotocol.com/registry, read 25 Nov 2026). The npm adapters are pinned to a release at least
 * two weeks old on that day (the project's dependency rule), not to the newest.
 */
export const AGENTS: readonly AgentPreset[] = [
  {
    id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', bin: 'claude', login: 'claude auth login',
    launch: { via: 'npx', package: '@agentclientprotocol/claude-agent-acp@0.106.0', args: [] },
    note: 'Uses the Claude plan you are signed in to.',
  },
  {
    id: 'codex', name: 'Codex', vendor: 'OpenAI', bin: 'codex', login: 'codex login',
    launch: { via: 'npx', package: '@agentclientprotocol/codex-acp@2.6.0', args: [] },
    note: 'Uses the ChatGPT plan you are signed in to.',
  },
  {
    id: 'qwen-code', name: 'Qwen Code', vendor: 'Alibaba', bin: 'qwen', login: 'qwen (then choose a sign-in)',
    launch: { via: 'bin', args: ['--acp'] },
    note: 'Uses your Qwen sign-in.',
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', vendor: 'Google', bin: 'gemini', login: 'gemini (then sign in with Google)',
    launch: { via: 'bin', args: ['--acp'] },
    note: 'Uses your Google sign-in.',
  },
  {
    id: 'opencode', name: 'OpenCode', vendor: 'OpenCode', bin: 'opencode', login: 'opencode auth login',
    launch: { via: 'bin', args: ['acp'] },
    note: 'Uses whichever provider you set up in OpenCode.',
  },
  {
    id: 'kimi-code', name: 'Kimi Code', vendor: 'Moonshot AI', bin: 'kimi', login: 'kimi (then sign in)',
    launch: { via: 'bin', args: ['acp'] },
    note: 'Uses your Kimi sign-in.',
  },
]

export const CUSTOM_AGENT_ID = 'custom-agent'

export function presetById(id: string): (AiPreset & { wire?: PresetWire }) | undefined {
  return PRESETS.find((p) => p.id === id)
}

export function agentById(id: string): AgentPreset | undefined {
  return AGENTS.find((a) => a.id === id)
}
