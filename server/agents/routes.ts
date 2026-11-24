import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentEvent } from '../../src/core/ai/types'
import type { RouteTools } from '../ai/routes'
import { AcpError } from './acp'
import type { AgentRuntime } from './runtime'

const KEY = /^[A-Za-z0-9_:.-]{1,120}$/
const MAX_TEXT = 16_000
const MAX_PREAMBLE = 12_000
const MAX_RESULT = 200_000

/**
 * /api/agent/* — one agent turn as a stream of events, and the two ways the app answers back mid-turn.
 *   POST /api/agent/turn        { connectionId, sessionKey, text, preamble } → application/x-ndjson of AgentEvent
 *   POST /api/agent/tool-result { callId, content, isError }
 *   POST /api/agent/permission  { requestId, optionId | null }
 *   POST /api/agent/cancel      { sessionKey }
 *   POST /api/agent/close       { sessionKey }
 *   POST /api/agent/mcp         the MCP bridge (Authorization: Bearer <session token>), not the browser
 */
export async function handleAgent(agents: AgentRuntime, req: IncomingMessage, res: ServerResponse, pathname: string, tools: RouteTools): Promise<void> {
  const { sendJson, readJson } = tools
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return sendJson(res, 405, { error: 'method_not_allowed', message: 'Use POST.' })
  }
  const route = pathname.slice('/api/agent/'.length)

  if (route === 'mcp') {
    const auth = req.headers.authorization ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    // a browser never calls this route: pages cannot set this header cross-origin, and same-origin pages have no token
    if (!/^[a-f0-9]{48}$/.test(token) || req.headers.origin) return sendJson(res, 401, { error: 'unauthorized', message: 'Bridge token required.' })
    const body = await readJson(req, res)
    if (!body) return
    try {
      return sendJson(res, 200, await agents.bridge(token, body))
    } catch (e) {
      const status = e instanceof AcpError && e.code === 401 ? 401 : 400
      return sendJson(res, status, { error: 'bridge_error', message: 'The FundBun bridge refused this request.' })
    }
  }

  const body = await readJson(req, res)
  if (!body) return
  const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)

  if (route === 'turn') {
    const connectionId = str(body.connectionId, 64)
    const sessionKey = str(body.sessionKey, 120)
    const text = str(body.text, MAX_TEXT)
    const preamble = str(body.preamble ?? '', MAX_PREAMBLE)
    if (!connectionId || !sessionKey || !KEY.test(sessionKey) || !text?.trim() || preamble === null) {
      return sendJson(res, 400, { error: 'invalid_request', message: 'Send { connectionId, sessionKey, text, preamble }.' })
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
    const gone = new AbortController()
    res.once('close', () => {
      if (!res.writableFinished) gone.abort()
    })
    const emit = (event: AgentEvent) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`)
    }
    try {
      await agents.turn({ connectionId, sessionKey, text, preamble }, emit, gone.signal)
    } catch {
      emit({ type: 'error', code: 'agent_failed', message: 'The agent could not answer.' })
    }
    res.end()
    return
  }
  if (route === 'tool-result') {
    const callId = str(body.callId, 64)
    const content = str(body.content, MAX_RESULT)
    if (!callId || content === null) return sendJson(res, 400, { error: 'invalid_request', message: 'Send { callId, content, isError }.' })
    return sendJson(res, 200, { ok: agents.toolResult(callId, content, body.isError === true) })
  }
  if (route === 'permission') {
    const requestId = str(body.requestId, 64)
    const optionId = body.optionId === null ? null : str(body.optionId, 120)
    if (!requestId || optionId === undefined) return sendJson(res, 400, { error: 'invalid_request', message: 'Send { requestId, optionId }.' })
    return sendJson(res, 200, { ok: agents.permission(requestId, optionId) })
  }
  if (route === 'cancel' || route === 'close') {
    const sessionKey = str(body.sessionKey, 120)
    if (!sessionKey || !KEY.test(sessionKey)) return sendJson(res, 400, { error: 'invalid_request', message: 'Send { sessionKey }.' })
    if (route === 'cancel') agents.cancel(sessionKey)
    else agents.close(sessionKey)
    return sendJson(res, 200, { ok: true })
  }
  return sendJson(res, 404, { error: 'not_found', message: 'Unknown API route.' })
}
