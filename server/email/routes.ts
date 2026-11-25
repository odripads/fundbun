import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RouteTools } from '../ai/routes'
import type { EmailService } from './service'

export interface EmailRouteTools extends RouteTools {
  methodNotAllowed(res: ServerResponse, allow: string): void
}

/** The local-only email routes; the public sandbox routes (/api/email/sources, /api/email/fetch) are not these. */
export function isEmailAccountPath(pathname: string): boolean {
  return pathname === '/api/email/account' || pathname.startsWith('/api/email/account/') || pathname === '/api/email/check'
}

/** Reads the body and lets it go (up to 1 MB): for routes that take none. */
function discard(req: IncomingMessage): void {
  let seen = 0
  req.on('data', (chunk: Buffer) => {
    seen += chunk.length
    if (seen > 1024 * 1024) req.destroy()
  })
  req.resume()
}

/**
 * /api/email/account and /api/email/check: the user's own mailbox. Only mounted by the local server (desktop
 * app, `npm run local`), and callers are checked for a local Host and same-origin first, exactly like /api/ai/*.
 * No response ever holds the password; message bodies are UNTRUSTED and go to the app's filters as they are.
 */
export async function handleEmail(email: EmailService, req: IncomingMessage, res: ServerResponse, pathname: string, tools: EmailRouteTools): Promise<void> {
  const { sendJson, readJson, methodNotAllowed } = tools
  const method = req.method ?? 'GET'

  if (pathname === '/api/email/account') {
    if (method === 'GET') {
      discard(req)
      return sendJson(res, 200, email.state())
    }
    if (method === 'POST') {
      const body = await readJson(req, res)
      if (!body) return
      const r = await email.connect(body)
      if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error, message: r.message })
      return sendJson(res, 200, { ok: true, account: r.account, ms: r.ms, messageCount: r.messageCount })
    }
    if (method === 'PATCH') {
      const body = await readJson(req, res)
      if (!body) return
      const r = email.setTrustedDomains(body)
      if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error, message: r.message })
      return sendJson(res, 200, { ok: true, account: r.account })
    }
    if (method === 'DELETE') {
      discard(req)
      email.remove()
      return sendJson(res, 200, { ok: true })
    }
    discard(req)
    return methodNotAllowed(res, 'GET, POST, PATCH, DELETE')
  }

  if (pathname === '/api/email/account/test') {
    discard(req)
    if (method !== 'POST') return methodNotAllowed(res, 'POST')
    return sendJson(res, 200, await email.test())
  }

  if (pathname === '/api/email/check') {
    if (method !== 'POST') {
      discard(req)
      return methodNotAllowed(res, 'POST')
    }
    // the body is optional: { days } or nothing at all
    let body: Record<string, unknown> = {}
    if (req.headers['content-type'] && req.headers['content-length'] !== '0') {
      const read = await readJson(req, res)
      if (!read) return
      body = read
    } else discard(req)
    const r = await email.check(body)
    if (!r.ok) return sendJson(res, r.status, { error: r.error, message: r.message })
    return sendJson(res, 200, r.value)
  }

  discard(req)
  return sendJson(res, 404, { error: 'not_found', message: 'Unknown API route.' })
}
