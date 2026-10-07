import type { LlmMessage, LlmResponse, LlmToolDef } from '../../src/core/agent/llm'

/** A validated, server-side-redacted request as every provider receives it. */
export interface ProviderRequest {
  system: string
  messages: LlmMessage[]
  tools: LlmToolDef[]
  maxTokens: number
}

/** The gateway adds `redactions`; providers fill the rest. */
export type ProviderResult = Omit<LlmResponse, 'redactions'>

export interface LlmProvider {
  readonly name: string
  readonly model: string
  complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult>
}

export type ProviderErrorCode =
  | 'upstream_rate_limited'
  | 'upstream_config'
  | 'upstream_bad_request'
  | 'upstream_unavailable'
  | 'upstream_timeout'
  | 'upstream_malformed'
  | 'upstream_error'
  | 'aborted'

/** User-safe wording only — upstream bodies and stack traces never reach the client or the log. */
const SAFE_MESSAGES: Record<ProviderErrorCode, string> = {
  upstream_rate_limited: 'The AI provider is rate-limiting requests. Try again shortly.',
  upstream_config: 'The AI provider rejected the gateway credentials or model.',
  upstream_bad_request: 'The AI provider rejected the request.',
  upstream_unavailable: 'The AI provider is unavailable right now.',
  upstream_timeout: 'The AI provider took too long to answer.',
  upstream_malformed: 'The AI provider returned an unexpected response.',
  upstream_error: 'The AI provider failed.',
  aborted: 'The request was aborted.',
}

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly upstreamStatus?: number,
  ) {
    super(SAFE_MESSAGES[code])
    this.name = 'ProviderError'
  }
}

/** Classify an upstream HTTP status into a provider error code. */
export function codeForStatus(status: number): ProviderErrorCode {
  if (status === 429) return 'upstream_rate_limited'
  if (status === 401 || status === 403 || status === 404) return 'upstream_config'
  if (status === 408 || status === 504) return 'upstream_timeout'
  if (status === 400 || status === 413 || status === 422) return 'upstream_bad_request'
  if (status >= 500) return 'upstream_unavailable'
  return 'upstream_error'
}
