import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import config, { BUILD_CSP, answerGatewayOffline, apiProxy, cspMetaPlugin, injectCspMeta } from '../../vite.config'

function fakeRes(started = false) {
  const out: { status?: number; headers?: Record<string, string>; body?: string } = {}
  const res = {
    headersSent: started,
    writableEnded: false,
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status
      out.headers = headers
      this.headersSent = true
      return this
    },
    end(body?: string) {
      out.body = body
      this.writableEnded = true
      return this
    },
  }
  return { res: res as unknown as ServerResponse, out }
}

describe('dev proxy when the LLM gateway is not running (F23)', () => {
  it('answers /api/health with a quiet 200 "offline" body the LLM client treats as unavailable', () => {
    const { res, out } = fakeRes()
    expect(answerGatewayOffline({ url: '/api/health?x=1' }, res)).toBe(true)
    expect(out.status).toBe(200)
    expect(out.headers?.['Content-Type']).toBe('application/json')
    expect(JSON.parse(out.body!)).toEqual({ ok: false, reason: 'gateway offline' })
  })

  it('answers other /api calls with a JSON 503 instead of a bare 502', () => {
    const { res, out } = fakeRes()
    answerGatewayOffline({ url: '/api/llm' }, res)
    expect(out.status).toBe(503)
    expect(JSON.parse(out.body!).error).toBe('gateway_offline')
  })

  it('leaves a response that already started alone', () => {
    const { res, out } = fakeRes(true)
    expect(answerGatewayOffline({ url: '/api/health' }, res)).toBe(false)
    expect(out.status).toBeUndefined()
  })

  it('wires the handler into the proxy error event (before Vite’s own 502 handler)', () => {
    const opts = apiProxy(1)
    const proxy = new EventEmitter()
    opts.configure?.(proxy as never, opts)
    const { res, out } = fakeRes()
    proxy.emit('error', new Error('ECONNREFUSED'), { url: '/api/health' }, res)
    expect(out.status).toBe(200)
    expect(res.headersSent).toBe(true)
  })

  it('is used by both the dev server and vite preview', async () => {
    const resolved = typeof config === 'function' ? await config({ mode: 'development', command: 'serve' }) : config
    const devApi = resolved.server?.proxy?.['/api']
    const previewApi = resolved.preview?.proxy?.['/api']
    expect(typeof devApi === 'object' && typeof devApi.configure).toBe('function')
    expect(typeof previewApi === 'object' && typeof previewApi.configure).toBe('function')
  })
})

describe('Content-Security-Policy meta (static build only)', () => {
  it('is the agreed policy', () => {
    expect(BUILD_CSP).toBe(
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    )
    expect(BUILD_CSP).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
  })

  it('applies to the build only, right after <meta charset> and before every script', () => {
    const plugin = cspMetaPlugin()
    expect(plugin.apply).toBe('build')
    const hook = plugin.transformIndexHtml as { order: string; handler: (html: string) => string }
    expect(hook.order).toBe('post')
    const page = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const out = hook.handler(page)
    const meta = `<meta http-equiv="Content-Security-Policy" content="${BUILD_CSP}" />`
    expect(out).toContain(meta)
    expect(out.indexOf('<meta charset')).toBeLessThan(out.indexOf(meta))
    expect(out.indexOf(meta)).toBeLessThan(out.indexOf('<script'))
    // idempotent, and works on a page without a charset meta
    expect(injectCspMeta(out)).toBe(out)
    expect(injectCspMeta('<html><head><title>x</title></head></html>')).toContain(`<head>\n    ${meta}`)
  })

  it('is registered in the config', async () => {
    const resolved = typeof config === 'function' ? await config({ mode: 'production', command: 'build' }) : config
    const names = (resolved.plugins ?? []).flat().map((p) => (p && typeof p === 'object' && 'name' in p ? p.name : ''))
    expect(names).toContain('fundbun:csp-meta')
  })
})
