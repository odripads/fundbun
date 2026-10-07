import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { LlmHealth, LlmResponse } from '../src/core/agent/llm'
import { llmToolDefinitions } from '../src/core/agent/specs'
import { redactDeep } from '../src/core/security/redact'
import { ProviderError, type LlmProvider, type ProviderRequest } from './providers/types'
import { createRateLimiter, type RateLimiter } from './ratelimit'
import { LIMITS, parseLlmRequest } from './schema'
import type { StaticHandler } from './static'

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
}

export type Redactor = (value: unknown) => { value: unknown; counts: Record<string, number> }

export interface GatewayOptions {
  /** null when no provider is configured — health says why, /api/llm answers 503 */
  provider: LlmProvider | null
  /** shown by /api/health when provider is null */
  unavailableReason?: string
  /** provider kind/model to report when unavailable */
  providerLabel?: { provider: string; model?: string }
  rateLimitRpm: number
  rateLimiter?: RateLimiter
  trustProxy?: boolean
  allowedOrigins?: string[]
  providerTimeoutMs?: number
  /** server-side PII redaction; defaults to src/core/security/redact.redactDeep */
  redact?: Redactor
  /** tool names the LLM may be offered; defaults to the exposed specs (T4 tools are never offered) */
  allowedTools?: ReadonlySet<string>
  /** production: serve dist/ for non-API paths */
  staticHandler?: StaticHandler | null
  /** one line per request: method, path, status, latency, provider — never bodies */
  log?: (line: string) => void
  /** ms clock for latency */
  now?: () => number
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const defaultRedactor: Redactor = (value) => redactDeep(value)
const exposedToolNames = (): ReadonlySet<string> => new Set(llmToolDefinitions().map((t) => t.name))

export function createGatewayServer(opts: GatewayOptions): Server {
  const handler = createGatewayHandler(opts)
  const server = createServer((req, res) => void handler(req, res))
  // slow-loris guards; provider latency happens after the request is fully received
  server.headersTimeout = 15_000
  server.requestTimeout = 30_000
  return server
}

export function createGatewayHandler(opts: GatewayOptions): Handler {
  const limiter = opts.rateLimiter ?? createRateLimiter({ perMinute: opts.rateLimitRpm })
  const redact = opts.redact ?? defaultRedactor
  const allowedTools = opts.allowedTools ?? exposedToolNames()
  const log = opts.log ?? ((line: string) => console.log(line))
  const now = opts.now ?? Date.now
  const providerName = opts.provider?.name ?? opts.providerLabel?.provider ?? 'none'
  const ctx: RouteContext = { opts, limiter, redact, allowedTools }

  return async (req, res) => {
    const started = now()
    const pathname = (req.url ?? '/').split('?')[0] || '/'
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
    res.once('close', () => {
      const status = res.writableFinished ? res.statusCode : 499
      log(`[gateway] ${req.method} ${pathname.slice(0, 200)} ${status} ${now() - started}ms provider=${providerName}`)
    })
    try {
      await route(ctx, req, res, pathname)
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', message: 'Unexpected gateway error.' })
      else res.destroy()
    }
  }
}

interface RouteContext {
  opts: GatewayOptions
  limiter: RateLimiter
  redact: Redactor
  allowedTools: ReadonlySet<string>
}

async function route(ctx: RouteContext, req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (pathname === '/api/health') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD')
    return sendJson(res, 200, healthOf(ctx.opts), req.method === 'HEAD')
  }
  if (pathname === '/api/llm') {
    if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
    return handleLlm(ctx, req, res)
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found', message: 'Unknown API route.' })
  if (ctx.opts.staticHandler) return ctx.opts.staticHandler(req, res, pathname)
  return sendJson(res, 404, { error: 'not_found', message: 'This server only serves the API in development; open the Vite dev server.' })
}

export function healthOf(opts: GatewayOptions): LlmHealth {
  if (opts.provider) return { ok: true, provider: opts.provider.name, model: opts.provider.model }
  return {
    ok: false,
    provider: opts.providerLabel?.provider ?? 'none',
    ...(opts.providerLabel?.model ? { model: opts.providerLabel.model } : {}),
    reason: opts.unavailableReason ?? 'No LLM provider configured',
  }
}

async function handleLlm(ctx: RouteContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { opts } = ctx
  const discard = () => drain(req, LIMITS.bodyBytes * 4)
  if (!isSameOrigin(req, opts)) {
    discard()
    return sendJson(res, 403, { error: 'forbidden_origin', message: 'Cross-origin requests are not allowed.' })
  }
  const decision = ctx.limiter.take(clientIp(req, opts.trustProxy ?? false))
  if (!decision.allowed) {
    discard()
    res.setHeader('Retry-After', String(decision.retryAfterSec))
    return sendJson(res, 429, { error: 'rate_limited', message: 'Too many requests. Slow down a little.', retryAfterSec: decision.retryAfterSec })
  }
  if (!opts.provider) {
    discard()
    return sendJson(res, 503, { error: 'llm_unavailable', message: opts.unavailableReason ?? 'No LLM provider configured.' })
  }
  if (!isJson(req)) {
    discard()
    return sendJson(res, 415, { error: 'unsupported_media_type', message: 'Send application/json.' })
  }
  const body = await readBody(req, LIMITS.bodyBytes)
  if (body.kind === 'too_large') return sendJson(res, 413, { error: 'payload_too_large', message: `Request body exceeds ${LIMITS.bodyBytes} bytes.` }, false, true)
  if (body.kind === 'aborted') return
  const json = parseJsonSafe(body.data)
  if (json === undefined) return sendJson(res, 400, { error: 'invalid_json', message: 'Body is not valid JSON.' })
  const parsed = parseLlmRequest(json)
  if (!parsed.ok) return sendJson(res, 400, { error: 'invalid_request', message: 'The request does not match the LLM request schema.', issues: parsed.issues })
  const blocked = parsed.value.tools.find((t) => !ctx.allowedTools.has(t.name))
  if (blocked) return sendJson(res, 400, { error: 'tool_not_allowed', message: `Tool "${blocked.name}" may not be offered to the model.` })

  const redacted = redactSafely(ctx.redact, parsed.value)
  // fail closed: never forward text that could not be checked for personal data
  if (!redacted) return sendJson(res, 503, { error: 'redaction_unavailable', message: 'Server-side redaction is unavailable.' })
  const request: ProviderRequest = { ...redacted.value, tools: parsed.value.tools, maxTokens: parsed.value.maxTokens }
  await callProvider(opts.provider, request, redacted.counts, opts.providerTimeoutMs ?? 40_000, res)
}

type Redactable = Pick<ProviderRequest, 'system' | 'messages'>

function redactSafely(redact: Redactor, req: Redactable): { value: Redactable; counts: Record<string, number> } | null {
  try {
    const out = redact({ system: req.system, messages: req.messages })
    const value = out?.value as Partial<Redactable> | undefined
    if (typeof value?.system !== 'string' || !Array.isArray(value.messages) || value.messages.length !== req.messages.length) return null
    return { value: { system: value.system, messages: value.messages }, counts: out.counts ?? {} }
  } catch {
    return null
  }
}

async function callProvider(provider: LlmProvider, request: ProviderRequest, counts: Record<string, number>, timeoutMs: number, res: ServerResponse): Promise<void> {
  const clientGone = new AbortController()
  const onClose = () => {
    if (!res.writableFinished) clientGone.abort()
  }
  res.once('close', onClose)
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const result = await provider.complete(request, AbortSignal.any([clientGone.signal, timeout]))
    const response: LlmResponse = { ...result, redactions: counts }
    sendJson(res, 200, response)
  } catch (err) {
    if (clientGone.signal.aborted) return
    const error = timeout.aborted ? new ProviderError('upstream_timeout') : err instanceof ProviderError ? err : new ProviderError('upstream_error')
    sendJson(res, 502, { error: 'provider_error', code: error.code, message: error.message })
  } finally {
    res.off('close', onClose)
  }
}

/** Same-origin only: a browser Origin must match the Host (or an allow-listed origin); no CORS headers are ever sent. */
export function isSameOrigin(req: IncomingMessage, opts: Pick<GatewayOptions, 'trustProxy' | 'allowedOrigins'>): boolean {
  const site = header(req, 'sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = header(req, 'origin')
  if (!origin) return true
  if (opts.allowedOrigins?.includes(origin)) return true
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    return false
  }
  const forwarded = opts.trustProxy ? header(req, 'x-forwarded-host')?.split(',')[0].trim() : undefined
  return host === header(req, 'host') || (!!forwarded && host === forwarded)
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = trustProxy ? header(req, 'x-forwarded-for')?.split(',')[0].trim() : undefined
  const ip = forwarded || req.socket.remoteAddress || 'unknown'
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function isJson(req: IncomingMessage): boolean {
  return /^application\/json\s*(;|$)/i.test(header(req, 'content-type') ?? '')
}

type BodyResult = { kind: 'ok'; data: Buffer } | { kind: 'too_large' } | { kind: 'aborted' }

/** Reads up to `limit` bytes. Oversized bodies are drained (bounded) so the 413 reaches the client, then the connection closes. */
export function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  const declared = Number(header(req, 'content-length'))
  if (Number.isFinite(declared) && declared > limit) {
    drain(req, limit * 4)
    return Promise.resolve({ kind: 'too_large' })
  }
  return new Promise((done) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit * 4) {
        req.destroy()
        return
      }
      if (size > limit) tooLarge = true
      else chunks.push(chunk)
    })
    req.on('end', () => done(tooLarge ? { kind: 'too_large' } : { kind: 'ok', data: Buffer.concat(chunks) }))
    req.on('error', () => done({ kind: tooLarge ? 'too_large' : 'aborted' }))
    req.on('close', () => {
      if (!req.complete) done({ kind: tooLarge ? 'too_large' : 'aborted' })
    })
  })
}

function drain(req: IncomingMessage, cap: number): void {
  let seen = 0
  req.on('data', (chunk: Buffer) => {
    seen += chunk.length
    if (seen > cap) req.destroy()
  })
  req.resume()
}

function parseJsonSafe(data: Buffer): unknown {
  try {
    return JSON.parse(data.toString('utf8'))
  } catch {
    return undefined
  }
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader('Allow', allow)
  sendJson(res, 405, { error: 'method_not_allowed', message: `Use ${allow}.` })
}

function sendJson(res: ServerResponse, status: number, body: unknown, headOnly = false, close = false): void {
  if (res.headersSent) return
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...(close ? { Connection: 'close' } : {}),
  })
  res.end(headOnly ? undefined : text)
}
