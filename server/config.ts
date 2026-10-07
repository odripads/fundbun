export type Env = Record<string, string | undefined>
export type ProviderKind = 'anthropic' | 'openai_compat' | 'mock'
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
export const DEFAULT_OPENAI_COMPAT_MODEL = 'deepseek-chat'
export const DEFAULT_PORT = 8787
export const DEFAULT_RATE_LIMIT_RPM = 30
export const DEFAULT_PROVIDER_TIMEOUT_MS = 40_000
export const MOCK_MODEL = 'fundbun-mock-1'

/** Models that accept the server-side `fallbacks: "default"` refusal fallback (beta, Claude API only). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])
const EFFORTS = new Set<AnthropicEffort>(['low', 'medium', 'high', 'xhigh', 'max'])

export type ResolvedProvider =
  | { ok: true; kind: 'anthropic'; model: string; apiKey: string; effort: AnthropicEffort | null; fallbacks: boolean }
  | { ok: true; kind: 'openai_compat'; model: string; apiKey: string; baseUrl: string }
  | { ok: true; kind: 'mock'; model: string }
  | { ok: false; kind: ProviderKind | 'none'; model?: string; reason: string }

export interface GatewayConfig {
  port: number
  /** undefined → all interfaces */
  host?: string
  production: boolean
  rateLimitRpm: number
  trustProxy: boolean
  providerTimeoutMs: number
  /** extra origins allowed to POST besides the request's own host, e.g. https://fundbun.example */
  allowedOrigins: string[]
  provider: ResolvedProvider
}

const flag = (value: string | undefined): boolean => value === '1' || value?.toLowerCase() === 'true'
const clean = (value: string | undefined): string => (value ?? '').trim()

export function parseIntInRange(value: string | undefined, min: number, max: number, fallback: number): number {
  const text = clean(value)
  if (!/^\d+$/.test(text)) return fallback
  const n = Number(text)
  return n >= min && n <= max ? n : fallback
}

export function resolveConfig(env: Env): GatewayConfig {
  const production = env.NODE_ENV === 'production'
  return {
    port: parseIntInRange(env.FUNDBUN_API_PORT, 0, 65535, DEFAULT_PORT),
    host: clean(env.FUNDBUN_API_HOST) || (production ? undefined : '127.0.0.1'),
    production,
    rateLimitRpm: parseIntInRange(env.FUNDBUN_RATE_LIMIT_RPM, 0, 100_000, DEFAULT_RATE_LIMIT_RPM),
    trustProxy: flag(env.FUNDBUN_TRUST_PROXY),
    providerTimeoutMs: parseIntInRange(env.FUNDBUN_PROVIDER_TIMEOUT_MS, 1000, 300_000, DEFAULT_PROVIDER_TIMEOUT_MS),
    allowedOrigins: clean(env.FUNDBUN_ALLOWED_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean),
    provider: resolveProvider(env),
  }
}

/**
 * LLM_PROVIDER selects explicitly. Without it: anthropic when ANTHROPIC_API_KEY is set, else
 * openai_compat when its key is set, else the mock only when FUNDBUN_ALLOW_MOCK=1, else nothing.
 * An explicit `mock` is refused in production unless FUNDBUN_ALLOW_MOCK=1 (fake answers must never ship by accident).
 */
export function resolveProvider(env: Env): ResolvedProvider {
  const explicit = clean(env.LLM_PROVIDER).toLowerCase()
  if (explicit === 'anthropic') return resolveAnthropic(env)
  if (explicit === 'openai_compat') return resolveOpenAiCompat(env)
  if (explicit === 'mock') return resolveMock(env)
  if (explicit) return { ok: false, kind: 'none', reason: 'LLM_PROVIDER must be anthropic, openai_compat or mock' }
  if (clean(env.ANTHROPIC_API_KEY)) return resolveAnthropic(env)
  if (clean(env.OPENAI_COMPAT_API_KEY)) return resolveOpenAiCompat(env)
  if (flag(env.FUNDBUN_ALLOW_MOCK)) return { ok: true, kind: 'mock', model: MOCK_MODEL }
  return { ok: false, kind: 'none', reason: 'No LLM provider configured (set ANTHROPIC_API_KEY); the on-device Bun Engine answers instead' }
}

function resolveAnthropic(env: Env): ResolvedProvider {
  const model = clean(env.ANTHROPIC_MODEL) || DEFAULT_ANTHROPIC_MODEL
  const apiKey = clean(env.ANTHROPIC_API_KEY)
  if (!apiKey) return { ok: false, kind: 'anthropic', model, reason: 'ANTHROPIC_API_KEY is not set' }
  return { ok: true, kind: 'anthropic', model, apiKey, effort: resolveEffort(env.ANTHROPIC_EFFORT), fallbacks: resolveFallbacks(env.ANTHROPIC_FALLBACKS, model) }
}

/** Chat replies are short, so `low` effort is the default; `none` omits the parameter for models without effort support. */
export function resolveEffort(value: string | undefined): AnthropicEffort | null {
  const text = clean(value).toLowerCase()
  if (text === 'none' || text === 'off') return null
  return EFFORTS.has(text as AnthropicEffort) ? (text as AnthropicEffort) : 'low'
}

export function resolveFallbacks(value: string | undefined, model: string): boolean {
  const text = clean(value).toLowerCase()
  if (text === '0' || text === 'false') return false
  if (text === '1' || text === 'true') return true
  return FALLBACK_MODELS.has(model)
}

function resolveOpenAiCompat(env: Env): ResolvedProvider {
  const model = clean(env.OPENAI_COMPAT_MODEL) || DEFAULT_OPENAI_COMPAT_MODEL
  const baseUrl = clean(env.OPENAI_COMPAT_BASE_URL)
  const apiKey = clean(env.OPENAI_COMPAT_API_KEY)
  const url = safeUrl(baseUrl)
  if (!url) return { ok: false, kind: 'openai_compat', model, reason: 'OPENAI_COMPAT_BASE_URL is missing or invalid' }
  const local = isLocalHost(url.hostname)
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return { ok: false, kind: 'openai_compat', model, reason: 'OPENAI_COMPAT_BASE_URL must use https (http only for localhost)' }
  }
  if (!apiKey && !local) return { ok: false, kind: 'openai_compat', model, reason: 'OPENAI_COMPAT_API_KEY is not set' }
  return { ok: true, kind: 'openai_compat', model, apiKey, baseUrl: baseUrl.replace(/\/+$/, '') }
}

function resolveMock(env: Env): ResolvedProvider {
  if (env.NODE_ENV === 'production' && !flag(env.FUNDBUN_ALLOW_MOCK)) {
    return { ok: false, kind: 'mock', model: MOCK_MODEL, reason: 'The mock provider is disabled in production (set FUNDBUN_ALLOW_MOCK=1)' }
  }
  return { ok: true, kind: 'mock', model: MOCK_MODEL }
}

function safeUrl(text: string): URL | null {
  try {
    return text ? new URL(text) : null
  } catch {
    return null
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}
