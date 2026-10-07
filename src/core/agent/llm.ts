/**
 * Browser/Node client for FundBun's LLM gateway (server/index.ts). The gateway holds the API key,
 * redacts PII again server-side, rate-limits, and forwards to the configured provider.
 * Wire format mirrors Anthropic Messages content blocks so providers can be swapped.
 */
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string | LlmContentBlock[]
}

export interface LlmToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LlmRequest {
  system: string
  messages: LlmMessage[]
  tools: LlmToolDef[]
  maxTokens?: number
}

export interface LlmResponse {
  content: LlmContentBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other'
  provider: string
  model: string
  /** PII categories the gateway redacted in this request */
  redactions?: Record<string, number>
  usage?: { inputTokens: number; outputTokens: number }
}

export interface LlmHealth {
  ok: boolean
  provider?: string
  model?: string
  reason?: string
}

export class LlmClient {
  constructor(public baseUrl = '/api', private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  /** GET {baseUrl}/health — never throws; ok=false when unreachable or no key configured. */
  async health(timeoutMs = 2500): Promise<LlmHealth> {
    throw new Error('TODO health ' + timeoutMs + this.baseUrl + typeof this.fetchImpl)
  }

  /** POST {baseUrl}/llm — throws LlmError on non-2xx. */
  async complete(req: LlmRequest, timeoutMs = 45000): Promise<LlmResponse> {
    throw new Error('TODO complete ' + req.messages.length + timeoutMs)
  }
}

export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'LlmError'
  }
}
