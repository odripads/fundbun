import { realpathSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGatewayServer, type GatewayOptions } from './app'
import { resolveConfig, type Env, type GatewayConfig, type ResolvedProvider } from './config'
import { loadEnvFile } from './env'
import { createAnthropicProvider } from './providers/anthropic'
import { createMockProvider } from './providers/mock'
import { createOpenAiCompatProvider } from './providers/openai'
import type { LlmProvider } from './providers/types'
import { createStaticHandler } from './static'

export { createGatewayHandler, createGatewayServer, type GatewayOptions } from './app'
export { resolveConfig } from './config'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url))

/** Build the provider for a resolved config; null when it is not usable (health explains why). */
export function createProvider(resolved: ResolvedProvider, timeoutMs: number): LlmProvider | null {
  if (!resolved.ok) return null
  // the gateway enforces the overall deadline; the SDK/fetch timeout sits just inside it
  const inner = Math.max(1000, timeoutMs - 2000)
  switch (resolved.kind) {
    case 'anthropic':
      return createAnthropicProvider({ apiKey: resolved.apiKey, model: resolved.model, effort: resolved.effort, fallbacks: resolved.fallbacks, timeoutMs: inner, maxRetries: 1 })
    case 'openai_compat':
      return createOpenAiCompatProvider({ baseUrl: resolved.baseUrl, apiKey: resolved.apiKey, model: resolved.model, timeoutMs: inner })
    case 'mock':
      return createMockProvider({ model: resolved.model })
  }
}

export function gatewayOptionsFor(config: GatewayConfig, distDir = DIST_DIR): GatewayOptions {
  const provider = createProvider(config.provider, config.providerTimeoutMs)
  return {
    provider,
    unavailableReason: config.provider.ok ? undefined : config.provider.reason,
    providerLabel: { provider: config.provider.kind, model: config.provider.model },
    rateLimitRpm: config.rateLimitRpm,
    trustProxy: config.trustProxy,
    allowedOrigins: config.allowedOrigins,
    providerTimeoutMs: config.providerTimeoutMs,
    staticHandler: config.production ? createStaticHandler({ root: distDir }) : null,
  }
}

/** Load .env (real env wins), resolve config, listen. Resolves once the server is accepting connections. */
export async function main(env: Env = process.env): Promise<Server> {
  loadEnvFile(`${ROOT}.env`, env)
  const config = resolveConfig(env)
  const server = createGatewayServer(gatewayOptionsFor(config))
  await new Promise<void>((ready, fail) => {
    server.once('error', fail)
    server.listen(config.port, config.host, () => ready())
  })
  const { port } = server.address() as AddressInfo
  const p = config.provider
  const status = p.ok ? `provider=${p.kind} model=${p.model}` : `LLM unavailable (${p.reason})`
  console.log(`[gateway] listening on http://${config.host ?? 'localhost'}:${port} · ${config.production ? 'production (serving dist/)' : 'development (API only)'} · ${status}`)
  return server
}

function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main()
    .then((server) => {
      const stop = () => {
        server.close(() => process.exit(0))
        setTimeout(() => process.exit(0), 3000).unref()
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    .catch((err: unknown) => {
      const code = (err as { code?: string }).code
      console.error(`[gateway] failed to start${code ? ` (${code})` : ''}`)
      process.exit(1)
    })
}
