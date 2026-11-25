import type { IncomingMessage, ServerResponse } from 'node:http'
import { PLUGIN_FRAME_CSP } from './frame'
import type { PluginService, PluginServiceFailure } from './service'

export interface PluginRouteHelpers {
  sendJson: (res: ServerResponse, status: number, body: unknown) => void
  readJson: (req: IncomingMessage, res: ServerResponse) => Promise<Record<string, unknown> | null>
  methodNotAllowed: (res: ServerResponse, allow: string) => void
}

const FRAME_TOKEN_RE = /^[a-zA-Z0-9_-]{8,64}$/

function queryParam(req: IncomingMessage, key: string): string {
  const q = (req.url ?? '').split('?')[1] ?? ''
  if (!q) return ''
  try {
    return new URLSearchParams(q).get(key) ?? ''
  } catch {
    return ''
  }
}

function sendFailure(res: ServerResponse, helpers: PluginRouteHelpers, f: PluginServiceFailure): void {
  helpers.sendJson(res, f.status, {
    error: f.error,
    message: f.message,
    ...(f.issues ? { issues: f.issues } : {}),
  })
}

function sendFrameHtml(res: ServerResponse, html: string): void {
  const body = Buffer.from(html, 'utf8')
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Length', String(body.byteLength))
  res.setHeader('Content-Security-Policy', PLUGIN_FRAME_CSP)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    return ''
  }
}

/** Handles local-only Desktop Creator Mode endpoints under `/api/plugins/*`. */
export async function handlePlugins(
  plugins: PluginService,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  helpers: PluginRouteHelpers,
): Promise<void> {
  const method = req.method ?? 'GET'
  // a change must come from FundBun's own page: a browser always sends Origin on these methods, so a request without
  // one is another program on this computer, not the app
  if (method !== 'GET' && method !== 'HEAD' && !req.headers.origin) {
    return helpers.sendJson(res, 403, { error: 'forbidden_origin', message: 'Only the FundBun app may change plugins.' })
  }

  if (pathname === '/api/plugins/state') {
    if (method !== 'GET') return helpers.methodNotAllowed(res, 'GET')
    return helpers.sendJson(res, 200, plugins.state())
  }

  if (pathname === '/api/plugins/mode') {
    if (method !== 'POST') return helpers.methodNotAllowed(res, 'POST')
    const body = await helpers.readJson(req, res)
    if (!body) return
    if (typeof body.enabled !== 'boolean') {
      return helpers.sendJson(res, 400, { error: 'invalid_input', message: 'Send { enabled: boolean }.' })
    }
    const r = plugins.setEnabled(body.enabled)
    return r.ok ? helpers.sendJson(res, 200, { state: r.state }) : sendFailure(res, helpers, r)
  }

  if (pathname === '/api/plugins/drafts') {
    if (method !== 'POST') return helpers.methodNotAllowed(res, 'POST')
    const body = await helpers.readJson(req, res)
    if (!body) return
    const r = plugins.draft(body)
    return r.ok ? helpers.sendJson(res, 201, { draft: r.draft }) : sendFailure(res, helpers, r)
  }

  const starterMatch = /^\/api\/plugins\/starters\/([^/]+)\/install$/.exec(pathname)
  if (starterMatch) {
    if (method !== 'POST') return helpers.methodNotAllowed(res, 'POST')
    const id = decodeSegment(starterMatch[1])
    const r = plugins.installStarter(id)
    return r.ok ? helpers.sendJson(res, 200, { plugin: r.plugin, state: r.state }) : sendFailure(res, helpers, r)
  }

  const draftFrameMatch = /^\/api\/plugins\/drafts\/([^/]+)\/frame$/.exec(pathname)
  if (draftFrameMatch) {
    if (method !== 'GET') return helpers.methodNotAllowed(res, 'GET')
    const token = queryParam(req, 'token')
    if (!FRAME_TOKEN_RE.test(token)) {
      return helpers.sendJson(res, 400, { error: 'invalid_token', message: 'Missing valid frame token.' })
    }
    const r = plugins.renderDraftFrame(decodeSegment(draftFrameMatch[1]), token)
    return r.ok ? sendFrameHtml(res, r.html) : sendFailure(res, helpers, r)
  }

  const draftInstallMatch = /^\/api\/plugins\/drafts\/([^/]+)\/install$/.exec(pathname)
  if (draftInstallMatch) {
    if (method !== 'POST') return helpers.methodNotAllowed(res, 'POST')
    const r = plugins.installDraft(decodeSegment(draftInstallMatch[1]))
    return r.ok ? helpers.sendJson(res, 200, { plugin: r.plugin, state: r.state }) : sendFailure(res, helpers, r)
  }

  const draftMatch = /^\/api\/plugins\/drafts\/([^/]+)$/.exec(pathname)
  if (draftMatch) {
    if (method !== 'DELETE') return helpers.methodNotAllowed(res, 'DELETE')
    const r = plugins.discardDraft(decodeSegment(draftMatch[1]))
    return r.ok ? helpers.sendJson(res, 200, { discarded: r.discarded }) : sendFailure(res, helpers, r)
  }

  const installedFrameMatch = /^\/api\/plugins\/installed\/([^/]+)\/frame$/.exec(pathname)
  if (installedFrameMatch) {
    if (method !== 'GET') return helpers.methodNotAllowed(res, 'GET')
    const token = queryParam(req, 'token')
    if (!FRAME_TOKEN_RE.test(token)) {
      return helpers.sendJson(res, 400, { error: 'invalid_token', message: 'Missing valid frame token.' })
    }
    const r = plugins.renderInstalledFrame(decodeSegment(installedFrameMatch[1]), token)
    return r.ok ? sendFrameHtml(res, r.html) : sendFailure(res, helpers, r)
  }

  const installedMatch = /^\/api\/plugins\/installed\/([^/]+)$/.exec(pathname)
  if (installedMatch) {
    const id = decodeSegment(installedMatch[1])
    if (method === 'GET') {
      const r = plugins.get(id)
      return r.ok ? helpers.sendJson(res, 200, { plugin: r.plugin }) : sendFailure(res, helpers, r)
    }
    if (method === 'PATCH') {
      const body = await helpers.readJson(req, res)
      if (!body) return
      const r = plugins.updateMeta(id, body)
      return r.ok ? helpers.sendJson(res, 200, { plugin: r.plugin, state: r.state }) : sendFailure(res, helpers, r)
    }
    if (method === 'DELETE') {
      const r = plugins.uninstall(id)
      return r.ok ? helpers.sendJson(res, 200, { state: r.state }) : sendFailure(res, helpers, r)
    }
    return helpers.methodNotAllowed(res, 'GET, PATCH, DELETE')
  }

  return helpers.sendJson(res, 404, { error: 'not_found', message: 'Unknown plugin route.' })
}
