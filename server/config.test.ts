import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_PORT,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_RPM,
  MOCK_MODEL,
  parseIntInRange,
  resolveConfig,
  resolveEffort,
  resolveFallbacks,
  resolveProvider,
} from './config'
import { parseDotenv } from './env'

describe('resolveProvider', () => {
  it('defaults to anthropic when ANTHROPIC_API_KEY is set', () => {
    const p = resolveProvider({ ANTHROPIC_API_KEY: 'sk-test' })
    expect(p).toMatchObject({ ok: true, kind: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL, apiKey: 'sk-test', effort: 'low', fallbacks: true })
  })

  it('uses ANTHROPIC_MODEL and only enables fallbacks for models that support them', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-opus-5-5' })).toMatchObject({ model: 'claude-opus-5-5', fallbacks: true })
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-haiku-4-5' })).toMatchObject({ model: 'claude-haiku-4-5', fallbacks: false })
  })

  it('falls back to the mock only when FUNDBUN_ALLOW_MOCK=1', () => {
    expect(resolveProvider({ FUNDBUN_ALLOW_MOCK: '1' })).toEqual({ ok: true, kind: 'mock', model: MOCK_MODEL })
    const none = resolveProvider({})
    expect(none.ok).toBe(false)
    expect(none.kind).toBe('none')
  })

  it('prefers anthropic over the mock when both are possible', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k', FUNDBUN_ALLOW_MOCK: '1' }).kind).toBe('anthropic')
  })

  it('picks openai_compat when only its key is set', () => {
    expect(resolveProvider({ OPENAI_COMPAT_API_KEY: 'k', OPENAI_COMPAT_BASE_URL: 'https://api.deepseek.com/v1/' })).toEqual({
      ok: true, kind: 'openai_compat', model: 'deepseek-chat', apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1',
    })
  })

  it('honours an explicit LLM_PROVIDER even when the key is missing (.env.example defaults)', () => {
    const p = resolveProvider({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '', FUNDBUN_ALLOW_MOCK: '1' })
    expect(p).toMatchObject({ ok: false, kind: 'anthropic', reason: 'ANTHROPIC_API_KEY is not set' })
  })

  it('accepts explicit mock in development but refuses it in production unless allowed', () => {
    expect(resolveProvider({ LLM_PROVIDER: 'mock' }).ok).toBe(true)
    expect(resolveProvider({ LLM_PROVIDER: 'mock', NODE_ENV: 'production' })).toMatchObject({ ok: false, kind: 'mock' })
    expect(resolveProvider({ LLM_PROVIDER: 'MOCK', NODE_ENV: 'production', FUNDBUN_ALLOW_MOCK: 'true' }).ok).toBe(true)
  })

  it('rejects unknown provider names', () => {
    expect(resolveProvider({ LLM_PROVIDER: 'gpt', ANTHROPIC_API_KEY: 'k' })).toMatchObject({ ok: false, kind: 'none' })
  })

  it('requires https for remote OpenAI-compatible endpoints', () => {
    const p = resolveProvider({ LLM_PROVIDER: 'openai_compat', OPENAI_COMPAT_BASE_URL: 'http://api.example.com/v1', OPENAI_COMPAT_API_KEY: 'k' })
    expect(p).toMatchObject({ ok: false, reason: expect.stringContaining('https') })
  })

  it('allows keyless http for local OpenAI-compatible servers', () => {
    const p = resolveProvider({ LLM_PROVIDER: 'openai_compat', OPENAI_COMPAT_BASE_URL: 'http://localhost:11434/v1', OPENAI_COMPAT_MODEL: 'qwen2.5' })
    expect(p).toMatchObject({ ok: true, kind: 'openai_compat', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', apiKey: '' })
  })

  it('rejects a missing or invalid base URL and a missing remote key', () => {
    expect(resolveProvider({ LLM_PROVIDER: 'openai_compat', OPENAI_COMPAT_API_KEY: 'k' }).ok).toBe(false)
    expect(resolveProvider({ LLM_PROVIDER: 'openai_compat', OPENAI_COMPAT_BASE_URL: 'not a url', OPENAI_COMPAT_API_KEY: 'k' }).ok).toBe(false)
    expect(resolveProvider({ LLM_PROVIDER: 'openai_compat', OPENAI_COMPAT_BASE_URL: 'https://api.example.com/v1' })).toMatchObject({ ok: false, reason: expect.stringContaining('OPENAI_COMPAT_API_KEY') })
  })

  it('never puts secrets into the unavailable reason', () => {
    const p = resolveProvider({ LLM_PROVIDER: 'openai_compat', OPENAI_COMPAT_BASE_URL: 'ftp://x', OPENAI_COMPAT_API_KEY: 'sk-secret-123' })
    expect(JSON.stringify(p)).not.toContain('sk-secret-123')
  })
})

describe('resolveEffort / resolveFallbacks', () => {
  it('defaults effort to low, accepts valid levels and none', () => {
    expect(resolveEffort(undefined)).toBe('low')
    expect(resolveEffort('HIGH')).toBe('high')
    expect(resolveEffort('none')).toBeNull()
    expect(resolveEffort('turbo')).toBe('low')
  })

  it('lets the env force fallbacks on or off', () => {
    expect(resolveFallbacks('0', 'claude-sonnet-5-5')).toBe(false)
    expect(resolveFallbacks('1', 'claude-haiku-4-5')).toBe(true)
    expect(resolveFallbacks(undefined, 'claude-fable-5-1')).toBe(true)
  })
})

describe('resolveConfig', () => {
  it('applies defaults', () => {
    const c = resolveConfig({})
    expect(c).toMatchObject({ port: DEFAULT_PORT, host: '127.0.0.1', production: false, rateLimitRpm: DEFAULT_RATE_LIMIT_RPM, trustProxy: false, allowedOrigins: [] })
  })

  it('reads port, rpm, proxy trust, timeout and origins', () => {
    const c = resolveConfig({
      FUNDBUN_API_PORT: '9000', FUNDBUN_RATE_LIMIT_RPM: '5', FUNDBUN_TRUST_PROXY: '1', FUNDBUN_PROVIDER_TIMEOUT_MS: '5000',
      FUNDBUN_ALLOWED_ORIGINS: 'https://a.test, https://b.test', NODE_ENV: 'production',
    })
    expect(c).toMatchObject({ port: 9000, rateLimitRpm: 5, trustProxy: true, providerTimeoutMs: 5000, allowedOrigins: ['https://a.test', 'https://b.test'], production: true, host: undefined })
  })

  it('falls back to defaults for invalid numbers', () => {
    const c = resolveConfig({ FUNDBUN_API_PORT: '99999', FUNDBUN_RATE_LIMIT_RPM: '-3', FUNDBUN_PROVIDER_TIMEOUT_MS: 'abc' })
    expect(c.port).toBe(DEFAULT_PORT)
    expect(c.rateLimitRpm).toBe(DEFAULT_RATE_LIMIT_RPM)
    expect(c.providerTimeoutMs).toBe(40_000)
  })

  it('allows rpm 0 (limiting disabled) and port 0 (ephemeral)', () => {
    expect(resolveConfig({ FUNDBUN_RATE_LIMIT_RPM: '0', FUNDBUN_API_PORT: '0' })).toMatchObject({ rateLimitRpm: 0, port: 0 })
  })
})

describe('parseIntInRange', () => {
  it('accepts only plain integers inside the range', () => {
    expect(parseIntInRange(' 42 ', 0, 100, 7)).toBe(42)
    expect(parseIntInRange('4.2', 0, 100, 7)).toBe(7)
    expect(parseIntInRange('1e3', 0, 10_000, 7)).toBe(7)
    expect(parseIntInRange('101', 0, 100, 7)).toBe(7)
    expect(parseIntInRange(undefined, 0, 100, 7)).toBe(7)
  })
})

describe('.env.example', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const vars = parseDotenv(example)

  it('documents every variable the gateway reads', () => {
    const source = readFileSync(new URL('./config.ts', import.meta.url), 'utf8')
    const read = new Set([...source.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]).filter((k) => k !== 'NODE_ENV'))
    expect([...read].sort()).toEqual(expect.arrayContaining([
      'ANTHROPIC_EFFORT', 'ANTHROPIC_FALLBACKS', 'FUNDBUN_ALLOWED_ORIGINS', 'FUNDBUN_ALLOW_MOCK', 'FUNDBUN_API_HOST',
      'FUNDBUN_PROVIDER_TIMEOUT_MS', 'FUNDBUN_TRUST_PROXY',
    ]))
    for (const key of read) expect(Object.keys(vars), key).toContain(key)
  })

  it('copied as-is it keeps the documented defaults', () => {
    const config = resolveConfig(vars)
    expect(config).toMatchObject({
      port: DEFAULT_PORT,
      host: '127.0.0.1',
      rateLimitRpm: DEFAULT_RATE_LIMIT_RPM,
      trustProxy: false,
      allowedOrigins: [],
      providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
      provider: { ok: false, kind: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL },
    })
    expect(resolveEffort(vars.ANTHROPIC_EFFORT)).toBe('low')
    expect(resolveFallbacks(vars.ANTHROPIC_FALLBACKS, DEFAULT_ANTHROPIC_MODEL)).toBe(true)
    expect(resolveProvider({ ...vars, LLM_PROVIDER: 'mock', NODE_ENV: 'production' }).ok).toBe(false)
  })
})
