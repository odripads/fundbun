import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { LlmHealth, LlmResponse } from '../src/core/agent/llm'
import { llmToolDefinitions } from '../src/core/agent/specs'
import { redactDeep } from '../src/core/security/redact'
import type { AgentRuntime } from './agents/runtime'
import { handleAgent } from './agents/routes'
import { handleAi } from './ai/routes'
import { isLocalHost, type AiService } from './ai/service'
import { emailSourcesMeta, fetchEmailMessages } from './email'
import { ProviderError, type LlmProvider, type ProviderRequest } from './providers/types'
import { createRateLimiter, type RateLimiter } from './ratelimit'
import { LIMITS, parseLlmRequest } from './schema'
import type { StaticHandler } from './static'

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
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
  /**
   * Local server only (desktop app, `npm run local`): the user's own AI connections. When set, /api/ai/* is served,
   * the active connection answers /api/llm, and every API call must come from this computer.
   */
  ai?: AiService
  /** Local server only: agents on this computer (Claude Code, Codex, …) driven over ACP */
  agents?: AgentRuntime
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
  if (pathname.startsWith('/api/ai/') || pathname.startsWith('/api/agent/')) {
    const { ai, agents } = ctx.opts
    // the hosted gateway has neither: it never takes anyone's keys and never starts programs
    if (!ai) return sendJson(res, 404, { error: 'not_found', message: 'Connections need the FundBun desktop app or the local server.' })
    const isBridge = pathname === '/api/agent/mcp'
    if (!isLocalRequest(req) || (!isBridge && !isSameOrigin(req, ctx.opts))) {
      return sendJson(res, 403, { error: 'forbidden_origin', message: 'Only this computer may use this route.' })
    }
    const tools = { sendJson: (r: ServerResponse, status: number, body: unknown) => sendJson(r, status, body), readJson: readJsonBody }
    if (pathname.startsWith('/api/ai/')) return handleAi(ai, req, res, pathname, tools)
    if (!agents) return sendJson(res, 404, { error: 'not_found', message: 'Agents are not available here.' })
    return handleAgent(agents, req, res, pathname, tools)
  }
  if (pathname === '/api/email/sources') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD')
    return sendJson(res, 200, emailSourcesMeta(), req.method === 'HEAD')
  }
  if (pathname === '/api/email/fetch') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD')
    return handleEmailFetch(req, res)
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found', message: 'Unknown API route.' })
  if (ctx.opts.staticHandler) return ctx.opts.staticHandler(req, res, pathname)
  return sendJson(res, 404, { error: 'not_found', message: 'This server only serves the API in development; open the Vite dev server.' })
}

export function healthOf(opts: GatewayOptions): LlmHealth {
  if (opts.ai) {
    const active = opts.ai.active()
    if (active?.kind === 'agent') return { ok: true, provider: active.label, model: active.modelName || active.model || '', local: true, kind: 'agent', connectionId: active.id }
    if (active?.model) return { ok: true, provider: active.label, model: active.model, local: true, kind: active.kind, connectionId: active.id, onDevice: active.local }
    return { ok: false, provider: 'none', local: true, reason: active ? 'Pick a model for your AI connection' : 'No AI connected yet' }
  }
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
  if (opts.ai && !isLocalRequest(req)) {
    discard()
    return sendJson(res, 403, { error: 'forbidden_origin', message: 'Only this computer may use this route.' })
  }
  const mine = opts.ai?.activeProvider() ?? null
  // on the local server only the user's own connection answers; the hosted gateway uses its configured provider
  const provider = opts.ai ? mine?.provider ?? null : opts.provider
  if (!provider) {
    discard()
    return sendJson(res, 503, { error: 'llm_unavailable', message: opts.ai ? 'No AI connected yet.' : opts.unavailableReason ?? 'No LLM provider configured.' })
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
  const outcome = await callProvider(provider, request, redacted.counts, mine?.timeoutMs ?? opts.providerTimeoutMs ?? 40_000, res)
  if (mine && outcome) {
    if (outcome.ok) opts.ai?.markOk(mine.connection.id)
    else opts.ai?.markError(mine.connection.id, outcome.message)
  }
}

/** A request the local server will act on must be addressed to this computer (stops DNS-rebinding pages). */
export function isLocalRequest(req: IncomingMessage): boolean {
  const host = header(req, 'host') ?? ''
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return isLocalHost(name)
}

/** Reads a small JSON object body; answers 4xx itself and returns null when it is not one. */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  if (!isJson(req)) {
    drain(req, LIMITS.bodyBytes * 4)
    sendJson(res, 415, { error: 'unsupported_media_type', message: 'Send application/json.' })
    return null
  }
  const body = await readBody(req, LIMITS.bodyBytes)
  if (body.kind === 'too_large') {
    sendJson(res, 413, { error: 'payload_too_large', message: `Request body exceeds ${LIMITS.bodyBytes} bytes.` }, false, true)
    return null
  }
  if (body.kind === 'aborted') return null
  const json = parseJsonSafe(body.data)
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    sendJson(res, 400, { error: 'invalid_json', message: 'Body is not a JSON object.' })
    return null
  }
  return json as Record<string, unknown>
}

/** Read-only email ingestion (the stage demo serves the synthetic sandbox mailbox — no IMAP account needed). */
async function handleEmailFetch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const source = queryParam(req, 'source') ?? 'sandbox'
  const result = await fetchEmailMessages(source)
  if (!result.ok) return sendJson(res, result.status, { error: result.error, message: result.message })
  return sendJson(res, 200, { source: result.source, messages: result.messages })
}

function queryParam(req: IncomingMessage, name: string): string | undefined {
  const q = (req.url ?? '').split('?')[1]
  if (!q) return undefined
  try {
    return new URLSearchParams(q).get(name) ?? undefined
  } catch {
    return undefined
  }
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

async function callProvider(
  provider: LlmProvider,
  request: ProviderRequest,
  counts: Record<string, number>,
  timeoutMs: number,
  res: ServerResponse,
): Promise<{ ok: true } | { ok: false; message: string } | null> {
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
    return { ok: true }
  } catch (err) {
    if (clientGone.signal.aborted) return null
    const error = timeout.aborted ? new ProviderError('upstream_timeout') : err instanceof ProviderError ? err : new ProviderError('upstream_error')
    sendJson(res, 502, { error: 'provider_error', code: error.code, message: error.message })
    return { ok: false, message: error.message }
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
