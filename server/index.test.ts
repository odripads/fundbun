import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { resolveConfig } from './config'
import { createProvider, DIST_DIR, gatewayOptionsFor, main } from './index'

describe('createProvider', () => {
  it('builds each configured provider without touching the network', () => {
    expect(createProvider({ ok: true, kind: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-test', effort: 'low', fallbacks: true }, 40_000)).toMatchObject({ name: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(createProvider({ ok: true, kind: 'openai_compat', model: 'deepseek-chat', apiKey: 'k', baseUrl: 'https://api.deepseek.com/v1' }, 40_000)).toMatchObject({ name: 'openai_compat', model: 'deepseek-chat' })
    expect(createProvider({ ok: true, kind: 'mock', model: 'fundbun-mock-1' }, 40_000)).toMatchObject({ name: 'mock' })
  })

  it('returns null for an unusable configuration', () => {
    expect(createProvider({ ok: false, kind: 'none', reason: 'nope' }, 40_000)).toBeNull()
  })
})

describe('gatewayOptionsFor', () => {
  it('serves dist/ only in production', () => {
    expect(gatewayOptionsFor(resolveConfig({ LLM_PROVIDER: 'mock' })).staticHandler).toBeNull()
    expect(gatewayOptionsFor(resolveConfig({ NODE_ENV: 'production' })).staticHandler).toBeTypeOf('function')
    expect(DIST_DIR.endsWith('/dist')).toBe(true)
  })

  it('carries the unavailable reason and label for health', () => {
    const opts = gatewayOptionsFor(resolveConfig({ LLM_PROVIDER: 'anthropic' }))
    expect(opts.provider).toBeNull()
    expect(opts.unavailableReason).toBe('ANTHROPIC_API_KEY is not set')
    expect(opts.providerLabel).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' })
  })
})

describe('main', () => {
  it('starts on the configured port and answers /api/health', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const server = await main({ FUNDBUN_API_PORT: '0', LLM_PROVIDER: 'mock' })
    try {
      const { port } = server.address() as AddressInfo
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      expect(await res.json()).toEqual({ ok: true, provider: 'mock', model: 'fundbun-mock-1' })
      expect(log.mock.calls.some(([line]) => String(line).includes('listening on'))).toBe(true)
    } finally {
      await new Promise((r) => server.close(r))
      log.mockRestore()
    }
  })

  it('rejects when the port is taken', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const first = await main({ FUNDBUN_API_PORT: '0', LLM_PROVIDER: 'mock' })
    try {
      const { port } = first.address() as AddressInfo
      await expect(main({ FUNDBUN_API_PORT: String(port), LLM_PROVIDER: 'mock' })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      await new Promise((r) => first.close(r))
      log.mockRestore()
    }
  })
})
