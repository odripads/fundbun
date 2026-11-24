import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NewConnectionInput } from '../../src/core/ai/types'
import type { AiService } from './service'

export interface RouteTools {
  readJson(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null>
  sendJson(res: ServerResponse, status: number, body: unknown): void
}

const ID = /^ai_[a-f0-9-]{6,40}$/

/**
 * /api/ai/* — the user's AI connections. Only mounted by the local server (desktop app, `npm run local`):
 * the hosted gateway never accepts anyone's keys. Callers are checked for same-origin and a local Host first.
 */
export async function handleAi(ai: AiService, req: IncomingMessage, res: ServerResponse, pathname: string, tools: RouteTools): Promise<void> {
  const { sendJson, readJson } = tools
  const method = req.method ?? 'GET'
  const rest = pathname.slice('/api/ai/'.length).split('/').filter(Boolean)

  if (rest[0] === 'state' && rest.length === 1 && method === 'GET') return sendJson(res, 200, ai.state())

  if (rest[0] === 'active' && rest.length === 1 && method === 'POST') {
    const body = await readJson(req, res)
    if (!body) return
    const id = body.id === null ? null : typeof body.id === 'string' && ID.test(body.id) ? body.id : undefined
    if (id === undefined) return sendJson(res, 400, { error: 'invalid_request', message: 'Send { id } or { id: null }.' })
    const r = ai.setActive(id)
    return r.ok ? sendJson(res, 200, ai.state()) : sendJson(res, 404, { error: 'not_found', message: r.error })
  }

  if (rest[0] === 'connections') {
    if (rest.length === 1 && method === 'POST') {
      const body = await readJson(req, res)
      if (!body) return
      const r = await ai.add(body as unknown as NewConnectionInput)
      return r.ok ? sendJson(res, 200, { connection: r.value, state: ai.state() }) : sendJson(res, 400, { error: 'invalid_connection', message: r.error })
    }
    const id = rest[1]
    if (!id || !ID.test(id)) return sendJson(res, 404, { error: 'not_found', message: 'Unknown connection.' })
    if (rest.length === 2 && method === 'PATCH') {
      const body = await readJson(req, res)
      if (!body) return
      const patch: { label?: string; model?: string; apiKey?: string } = {}
      if (typeof body.label === 'string') patch.label = body.label
      if (typeof body.model === 'string') patch.model = body.model
      if (typeof body.apiKey === 'string') patch.apiKey = body.apiKey
      const r = ai.update(id, patch)
      return r.ok ? sendJson(res, 200, { connection: r.value, state: ai.state() }) : sendJson(res, 404, { error: 'not_found', message: r.error })
    }
    if (rest.length === 2 && method === 'DELETE') {
      return ai.remove(id) ? sendJson(res, 200, ai.state()) : sendJson(res, 404, { error: 'not_found', message: 'Unknown connection.' })
    }
    if (rest.length === 3 && rest[2] === 'models' && method === 'GET') {
      const r = await ai.models(id)
      return r.ok ? sendJson(res, 200, { models: r.value }) : sendJson(res, 502, { error: 'models_unavailable', message: r.error })
    }
    if (rest.length === 3 && rest[2] === 'test' && method === 'POST') {
      return sendJson(res, 200, await ai.test(id))
    }
  }
  return sendJson(res, 404, { error: 'not_found', message: 'Unknown API route.' })
}
