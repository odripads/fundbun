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

const STOP_REASONS = new Set<LlmResponse['stopReason']>(['end_turn', 'tool_use', 'max_tokens', 'refusal', 'other'])
const MAX_ERROR_MESSAGE = 300

export class LlmClient {
  constructor(public baseUrl = '/api', private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  /** GET {baseUrl}/health — never throws; ok=false when unreachable or no key configured. */
  async health(timeoutMs = 2500): Promise<LlmHealth> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal })
      const body = await readJson(res)
      if (!res.ok) return { ok: false, reason: errorMessage(body) ?? `Gateway answered HTTP ${res.status}` }
      return toHealth(body)
    } catch {
      return { ok: false, reason: controller.signal.aborted ? 'Gateway health check timed out' : 'Gateway unreachable' }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * POST {baseUrl}/llm — throws LlmError on non-2xx. Status 0 = network failure or caller abort,
   * 408 = this client's timeout; other statuses come from the gateway (400/413/429/502/503…).
   */
  async complete(req: LlmRequest, timeoutMs = 45000, signal?: AbortSignal): Promise<LlmResponse> {
    if (signal?.aborted) throw new LlmError(0, 'The request was cancelled', 'aborted')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal,
      })
      const body = await readJson(res)
      if (!res.ok) throw httpError(res, body)
      if (!isLlmResponse(body)) throw new LlmError(502, 'The LLM gateway returned a malformed response', 'malformed')
      return body
    } catch (err) {
      if (err instanceof LlmError) throw err
      if (timedOut) throw new LlmError(408, `The LLM gateway did not answer within ${timeoutMs} ms`, 'timeout')
      if (signal?.aborted) throw new LlmError(0, 'The request was cancelled', 'aborted')
      throw new LlmError(0, 'The LLM gateway is unreachable', 'network')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

export class LlmError extends Error {
  constructor(
    public status: number,
    message: string,
    /** machine-readable reason: gateway error code (rate_limited, invalid_request, provider_error…) or timeout/network/aborted/malformed */
    public code?: string,
    /** seconds to wait before retrying (429) */
    public retryAfterSec?: number,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function httpError(res: Response, body: unknown): LlmError {
  const b = isObject(body) ? body : {}
  const code = typeof b.error === 'string' ? b.error : undefined
  const retry = Number(res.headers.get('retry-after') ?? b.retryAfterSec)
  return new LlmError(res.status, errorMessage(body) ?? `LLM gateway error (HTTP ${res.status})`, code, Number.isFinite(retry) && retry > 0 ? retry : undefined)
}

function errorMessage(body: unknown): string | undefined {
  if (!isObject(body)) return undefined
  const msg = typeof body.message === 'string' ? body.message : typeof body.reason === 'string' ? body.reason : undefined
  return msg ? msg.slice(0, MAX_ERROR_MESSAGE) : undefined
}

function toHealth(body: unknown): LlmHealth {
  if (!isObject(body) || typeof body.ok !== 'boolean') return { ok: false, reason: 'Gateway health response was malformed' }
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const health: LlmHealth = { ok: body.ok }
  const provider = str(body.provider)
  const model = str(body.model)
  const reason = str(body.reason)
  if (provider) health.provider = provider
  if (model) health.model = model
  if (reason) health.reason = reason.slice(0, MAX_ERROR_MESSAGE)
  return health
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isBlock(b: unknown): b is LlmContentBlock {
  if (!isObject(b)) return false
  if (b.type === 'text') return typeof b.text === 'string'
  if (b.type === 'tool_use') return typeof b.id === 'string' && typeof b.name === 'string' && isObject(b.input)
  if (b.type === 'tool_result') return typeof b.tool_use_id === 'string' && typeof b.content === 'string'
  return false
}

export function isLlmResponse(v: unknown): v is LlmResponse {
  return (
    isObject(v) &&
    Array.isArray(v.content) &&
    v.content.every(isBlock) &&
    STOP_REASONS.has(v.stopReason as LlmResponse['stopReason']) &&
    typeof v.provider === 'string' &&
    typeof v.model === 'string'
  )
}
