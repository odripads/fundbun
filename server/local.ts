import { realpathSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAgentRuntime, defaultWorkspace, type AgentRuntime } from './agents/runtime'
import { createAiService, type AiService } from './ai/service'
import { createFileStore, defaultHome, PLAIN_CODEC, type SecretCodec } from './ai/store'
import { createGatewayServer } from './app'
import { resolveConfig, type Env } from './config'
import { loadEnvFile } from './env'
import { createStaticHandler } from './static'

/**
 * FundBun on this computer: the app, the user's AI connections and the agents, all behind one address that only
 * this machine can reach. The desktop app starts it in-process; `npm run local` starts it for a browser.
 */
export const LOCAL_PORT = 47600

export interface LocalOptions {
  port?: number
  /** FundBun's folder for connections and the agents' workspace (default ~/.fundbun) */
  home?: string
  /** built web app to serve; null serves the API only (Vite dev server in front) */
  distDir?: string | null
  codec?: SecretCodec
  /** path of the MCP bridge script and the program that runs it */
  bridgeScript?: string
  nodePath?: string
  nodeEnv?: Record<string, string>
  env?: Env
  log?: (line: string) => void
}

export interface LocalServer {
  server: Server
  port: number
  url: string
  ai: AiService
  agents: AgentRuntime
  close(): Promise<void>
}

export async function startLocal(opts: LocalOptions = {}): Promise<LocalServer> {
  const env = opts.env ?? process.env
  const home = opts.home ?? defaultHome(env)
  const config = resolveConfig(env)
  const ai = createAiService({ store: createFileStore(home), codec: opts.codec ?? PLAIN_CODEC })
  let port = opts.port ?? LOCAL_PORT
  const agents = createAgentRuntime({
    ai,
    workspace: defaultWorkspace(home),
    bridgeUrl: () => `http://127.0.0.1:${port}/api/agent/mcp`,
    bridgeScript: opts.bridgeScript ?? fileURLToPath(new URL('./agents/mcp-bridge.mjs', import.meta.url)),
    ...(opts.nodePath ? { nodePath: opts.nodePath } : {}),
    ...(opts.nodeEnv ? { nodeEnv: opts.nodeEnv } : {}),
  })
  const server = createGatewayServer({
    // only what the user connected ever answers here: "Built-in engine" must mean that nothing leaves
    provider: null,
    unavailableReason: 'No AI connected yet',
    rateLimitRpm: 240,
    providerTimeoutMs: config.providerTimeoutMs,
    // development: the Vite dev server sits in front, on another port
    allowedOrigins: config.allowedOrigins,
    ai,
    agents,
    staticHandler: opts.distDir ? createStaticHandler({ root: opts.distDir }) : null,
    ...(opts.log ? { log: opts.log } : {}),
  })
  // agent turns stream for minutes: the request deadline is for receiving the request, not for answering it
  server.requestTimeout = 0
  await new Promise<void>((ready, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => ready())
  })
  port = (server.address() as AddressInfo).port
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    ai,
    agents,
    close: () =>
      new Promise<void>((done) => {
        agents.close()
        server.close(() => done())
        server.closeAllConnections?.()
      }),
  }
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
  const root = fileURLToPath(new URL('..', import.meta.url))
  loadEnvFile(`${root}.env`, process.env)
  const dev = process.argv.includes('--api-only')
  const port = Number(process.env.FUNDBUN_LOCAL_PORT) || (dev ? 8787 : LOCAL_PORT)
  startLocal({ port, distDir: dev ? null : fileURLToPath(new URL('../dist', import.meta.url)) })
    .then(async (local) => {
      // development: turn the key in .env into a normal connection once, so it shows in "Your AI" like any other
      if (process.argv.includes('--seed-env') && !local.ai.state().connections.length && process.env.OPENAI_COMPAT_API_KEY && process.env.OPENAI_COMPAT_BASE_URL) {
        const baseUrl = process.env.OPENAI_COMPAT_BASE_URL.replace(/\/+$/, '')
        const preset = local.ai.state().presets.find((p) => p.baseUrl === baseUrl)
        await local.ai.add({ presetId: preset?.id ?? 'custom', apiKey: process.env.OPENAI_COMPAT_API_KEY, baseUrl, model: process.env.OPENAI_COMPAT_MODEL })
        local.ai.setActive(null)
      }
      console.log(`[fundbun] running on ${local.url}${dev ? ' (API only: open the Vite dev server)' : ''} · connections in ${defaultHome()}`)
      const stop = () => void local.close().then(() => process.exit(0))
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    .catch((err: unknown) => {
      const code = (err as { code?: string }).code
      console.error(code === 'EADDRINUSE' ? `[fundbun] port ${port} is already in use: is FundBun already running?` : `[fundbun] failed to start${code ? ` (${code})` : ''}`)
      process.exit(1)
    })
}
