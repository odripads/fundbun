import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import config, {
  BUILD_CSP,
  CHUNK_GROUPS,
  EAGER_ROUTES,
  answerGatewayOffline,
  apiProxy,
  baseFor,
  cspMetaPlugin,
  fontPreloadPlugin,
  injectCspMeta,
  isStaticMode,
  routePreloadPlugin,
  shareMetaPlugin,
  siteUrlFor,
} from '../../vite.config'

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

async function resolveConfig(mode: string, command: 'build' | 'serve' = 'build') {
  return typeof config === 'function' ? await config({ mode, command }) : config
}

type HtmlTag = { tag: string; attrs: Record<string, string>; injectTo: string }
type IndexHtmlHook = { order: string; handler: (html: string, ctx: { bundle?: Record<string, unknown> }) => HtmlTag[] }

function runIndexHtmlHook(plugin: ReturnType<typeof fontPreloadPlugin>, bundle: Record<string, unknown>, base = '/'): HtmlTag[] {
  ;(plugin.configResolved as unknown as (c: { base: string }) => void)({ base })
  const hook = plugin.transformIndexHtml as unknown as IndexHtmlHook
  expect(hook.order).toBe('post')
  return hook.handler('<html><head></head><body></body></html>', { bundle })
}

describe('static build modes (GitHub Pages and Vercel)', () => {
  it('both are static (no gateway: llmBaseUrl null); only Pages lives under /fundbun/', async () => {
    expect(isStaticMode('pages')).toBe(true)
    expect(isStaticMode('vercel')).toBe(true)
    expect(isStaticMode('production')).toBe(false)
    expect(baseFor('pages')).toBe('/fundbun/')
    expect(baseFor('vercel')).toBe('/')
    expect(baseFor('production')).toBe('/')
    const vercel = await resolveConfig('vercel')
    expect(vercel.base).toBe('/')
    expect(vercel.define?.__FUNDBUN_STATIC__).toBe('true')
    const pages = await resolveConfig('pages')
    expect(pages.base).toBe('/fundbun/')
    expect(pages.define?.__FUNDBUN_STATIC__).toBe('true')
    const server = await resolveConfig('production')
    expect(server.define?.__FUNDBUN_STATIC__).toBe('false')
  })

  it('npm run build:vercel builds the vercel mode', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['build:vercel']).toMatch(/vite build --mode vercel$/)
  })

  it('ships no source maps unless asked for, and splits vendor code and the engine into named chunks', async () => {
    const built = await resolveConfig('vercel')
    expect(built.build?.sourcemap).toBe(process.env.FUNDBUN_SOURCEMAP === '1')
    expect(CHUNK_GROUPS.map((g) => g.name)).toEqual(['react', 'icons', 'engine'])
    const [reactGroup, icons, engine] = CHUNK_GROUPS
    expect(reactGroup.test.test('/x/node_modules/react-dom/client.js')).toBe(true)
    expect(reactGroup.test.test('/x/node_modules/scheduler/index.js')).toBe(true)
    expect(reactGroup.test.test('/x/node_modules/react-dom-extra/index.js')).toBe(false)
    expect(icons.test.test('C:\\app\\node_modules\\lucide-react\\dist\\esm\\icons\\eye.js')).toBe(true)
    // only the engine modules needed at boot (a screen-only module stays in its screen's chunk)
    expect(engine.test.test('/app/src/core/app.ts')).toBe(true)
    expect(engine.tags).toEqual(['$initial'])
  })

  it('preloads the two hero fonts (Latin Fraunces + DM Sans) under the build base', async () => {
    const names = ((await resolveConfig('vercel')).plugins ?? []).flat().map((p) => (p && typeof p === 'object' && 'name' in p ? p.name : ''))
    expect(names).toEqual(expect.arrayContaining(['fundbun:font-preload', 'fundbun:route-preload']))
    const plugin = fontPreloadPlugin()
    expect(plugin.apply).toBe('build')
    const bundle = Object.fromEntries(
      [
        'assets/fraunces-latin-full-normal-CFFu7zhK.woff2',
        'assets/fraunces-latin-ext-full-normal-YHFkNujK.woff2',
        'assets/dm-sans-latin-wght-normal-Xz1IZZA0.woff2',
        'assets/dm-sans-latin-ext-wght-normal-BOFOeGcA.woff2',
      ].map((f) => [f, { type: 'asset', fileName: f }]),
    )
    const tags = runIndexHtmlHook(plugin, bundle, '/fundbun/')
    expect(tags.map((t) => t.attrs.href)).toEqual([
      '/fundbun/assets/fraunces-latin-full-normal-CFFu7zhK.woff2',
      '/fundbun/assets/dm-sans-latin-wght-normal-Xz1IZZA0.woff2',
    ])
    for (const t of tags) expect(t.attrs).toMatchObject({ rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '' })
  })

  it('fetches the landing route (home) with the entry chunk: its JS, static imports and CSS', () => {
    expect(EAGER_ROUTES).toEqual(['src/ui/screens/home/HomeScreen.tsx'])
    const bundle = {
      'assets/index-a.js': { type: 'chunk', fileName: 'assets/index-a.js', facadeModuleId: '/app/index.html', imports: ['assets/react-b.js'] },
      'assets/react-b.js': { type: 'chunk', fileName: 'assets/react-b.js', imports: [] },
      'assets/HomeScreen-c.js': {
        type: 'chunk',
        fileName: 'assets/HomeScreen-c.js',
        facadeModuleId: '/app/src/ui/screens/home/HomeScreen.tsx',
        imports: ['assets/react-b.js', 'assets/sandbox-d.js'],
        viteMetadata: { importedCss: new Set(['assets/HomeScreen-c.css']) },
      },
      'assets/sandbox-d.js': { type: 'chunk', fileName: 'assets/sandbox-d.js', imports: ['assets/HomeScreen-c.js'], viteMetadata: { importedCss: new Set(['assets/sandbox-d.css']) } },
      'assets/GoalsScreen-e.js': { type: 'chunk', fileName: 'assets/GoalsScreen-e.js', facadeModuleId: '/app/src/ui/screens/goals/GoalsScreen.tsx', imports: [] },
    }
    const plugin = routePreloadPlugin()
    ;(plugin.configResolved as unknown as (c: { base: string }) => void)({ base: '/' })
    const hook = plugin.transformIndexHtml as unknown as IndexHtmlHook
    // react-b is already preloaded by Vite for the entry: not repeated
    const tags = hook.handler('<link rel="modulepreload" crossorigin href="/assets/react-b.js">', { bundle })
    expect(tags.map((t) => [t.attrs.rel, t.attrs.href])).toEqual([
      ['modulepreload', '/assets/HomeScreen-c.js'],
      ['modulepreload', '/assets/sandbox-d.js'],
      ['preload', '/assets/HomeScreen-c.css'],
      ['preload', '/assets/sandbox-d.css'],
    ])
    expect(tags.every((t) => t.attrs.crossorigin === '' && t.injectTo === 'head')).toBe(true)
  })
})

describe('share-card meta (static builds)', () => {
  it('knows each static build’s public URL', () => {
    expect(siteUrlFor('pages', {})).toBe('https://odripads.github.io/fundbun/')
    expect(siteUrlFor('vercel', { VERCEL_PROJECT_PRODUCTION_URL: 'fundbun.vercel.app' })).toBe('https://fundbun.vercel.app/')
    expect(siteUrlFor('vercel', {})).toBeNull()
    expect(siteUrlFor('production', {})).toBeNull()
    expect(siteUrlFor('vercel', { FUNDBUN_SITE_URL: 'https://demo.example', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' })).toBe('https://demo.example/')
  })

  it('adds an absolute card image only when the URL is known', () => {
    const run = (url: string | null) => {
      const hook = shareMetaPlugin(url).transformIndexHtml as unknown as IndexHtmlHook
      return Object.fromEntries(hook.handler('', {}).map((t) => [t.attrs.property ?? t.attrs.name, t.attrs.content]))
    }
    const known = run('https://fundbun.vercel.app/')
    expect(known['og:image']).toBe('https://fundbun.vercel.app/og-image.png')
    expect(known['twitter:card']).toBe('summary_large_image')
    expect(known['og:title']).toContain('FundBun')
    const unknown = run(null)
    expect(unknown['og:title']).toContain('FundBun')
    expect(unknown['og:image']).toBeUndefined()
  })
})

describe('vercel.json (the Vercel deployment)', () => {
  const vercel = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8')) as {
    framework: null
    buildCommand: string
    outputDirectory: string
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }
  const headersFor = (source: string) => Object.fromEntries((vercel.headers.find((h) => h.source === source)?.headers ?? []).map((h) => [h.key, h.value]))

  it('builds the static app with npm run build:vercel into dist', () => {
    expect(vercel.framework).toBeNull()
    expect(vercel.buildCommand).toBe('npm run build:vercel')
    expect(vercel.outputDirectory).toBe('dist')
  })

  it('sends the same CSP as the <meta> tag, plus frame-ancestors (headers only)', () => {
    expect(headersFor('/(.*)')['Content-Security-Policy']).toBe(`${BUILD_CSP}; frame-ancestors 'none'`)
  })

  it('sends the security headers on every response', () => {
    const all = headersFor('/(.*)')
    expect(all).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
    })
    expect(all['Strict-Transport-Security']).toMatch(/^max-age=\d{8,}; includeSubDomains/)
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment']) expect(all['Permissions-Policy']).toContain(`${feature}=()`)
  })

  it('caches hashed assets for a year and always revalidates the page', () => {
    expect(headersFor('/assets/(.*)')['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(headersFor('/')['Cache-Control']).toBe('no-cache')
    expect(headersFor('/index.html')['Cache-Control']).toBe('no-cache')
  })

  it('.vercelignore keeps node_modules, evidence, docs (incl. logo concepts) and secrets out of the upload', () => {
    const ignored = readFileSync(resolve(process.cwd(), '.vercelignore'), 'utf8').split('\n').map((l) => l.trim())
    for (const entry of ['node_modules', '/dist', '/evidence', '/docs', '/deck', '.env', '.env.*', '/.vercel']) expect(ignored).toContain(entry)
    expect(ignored).toContain('!.env.example')
    // root-anchored: an unanchored "evidence" would also drop scripts/evidence/, which the build typechecks
    for (const dir of ['evidence', 'docs', 'deck', 'dist']) expect(ignored).not.toContain(dir)
  })
})
