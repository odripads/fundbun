import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ProxyOptions, ResolvedConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The LLM gateway (server/index.ts) listens on 8787 in development.
const API_PORT = Number(process.env.FUNDBUN_API_PORT ?? 8787)

/**
 * Build modes that ship the static app (on-device engine only, no LLM gateway):
 *   pages  — GitHub Pages under /fundbun/      (npm run build:pages)
 *   vercel — Vercel at the domain root          (npm run build:vercel, see vercel.json)
 */
export const STATIC_MODES = ['pages', 'vercel'] as const

export function isStaticMode(mode: string): boolean {
  return (STATIC_MODES as readonly string[]).includes(mode)
}

/** Public base path per mode: GitHub Pages serves the project under /fundbun/, everything else at the root. */
export function baseFor(mode: string): string {
  return mode === 'pages' ? '/fundbun/' : '/'
}

/**
 * Content-Security-Policy for the built app (the static GitHub Pages build has no server to send headers).
 * Not applied in dev: Vite's HMR client needs inline styles/scripts and a websocket.
 */
export const BUILD_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** The page with the CSP <meta> right after <meta charset> (before any script or stylesheet it must govern). */
export function injectCspMeta(html: string, csp: string = BUILD_CSP): string {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}" />`
  if (html.includes('http-equiv="Content-Security-Policy"')) return html
  const charset = /<meta\s+charset=[^>]*>/i
  if (charset.test(html)) return html.replace(charset, (m) => `${m}\n    ${tag}`)
  return html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`)
}

/** Adds the CSP <meta> to the built index.html — build only. */
export function cspMetaPlugin(csp: string = BUILD_CSP): Plugin {
  return {
    name: 'fundbun:csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html: string) => injectCspMeta(html, csp),
    },
  }
}

/**
 * The dev proxy's answer when the gateway is not running (`npm run dev:web` alone). /api/health gets a normal
 * 200 "offline" body — the app treats it as "use the on-device engine" and the browser console stays clean;
 * other /api calls get a JSON 503 the LLM client can explain. Returns false when the response already started.
 */
export function answerGatewayOffline(req: Pick<IncomingMessage, 'url'>, res: ServerResponse): boolean {
  if (res.headersSent || res.writableEnded) return false
  const path = (req.url ?? '').split('?')[0]
  const isHealth = path === '/api/health'
  const body = isHealth
    ? { ok: false, reason: 'gateway offline' }
    : { error: 'gateway_offline', message: 'The LLM gateway is not running — Bun answers on-device.' }
  res.writeHead(isHealth ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
  return true
}

/**
 * The public URL of a static build, for absolute share-card links: Vercel exposes the production domain to
 * builds as VERCEL_PROJECT_PRODUCTION_URL; FUNDBUN_SITE_URL overrides; GitHub Pages has a fixed address.
 */
export function siteUrlFor(mode: string, env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.FUNDBUN_SITE_URL
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`
  if (mode === 'pages') return 'https://odripads.github.io/fundbun/'
  if (mode === 'vercel' && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}/`
  return null
}

const SHARE_TITLE = 'FundBun — the dream you could’ve had'
const SHARE_DESCRIPTION = 'The AI money buddy that turns overspending into the dream it cost. Runs on-device; money only moves with your OK.'

/** Open Graph / Twitter share-card tags (the card image needs an absolute URL, so it is added only when known). */
export function shareMetaPlugin(siteUrl: string | null): Plugin {
  const meta = (attr: 'name' | 'property', key: string, content: string) => ({
    tag: 'meta',
    attrs: { [attr]: key, content },
    injectTo: 'head' as const,
  })
  return {
    name: 'fundbun:share-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        meta('property', 'og:type', 'website'),
        meta('property', 'og:site_name', 'FundBun'),
        meta('property', 'og:title', SHARE_TITLE),
        meta('property', 'og:description', SHARE_DESCRIPTION),
        ...(siteUrl
          ? [
              meta('property', 'og:url', siteUrl),
              meta('property', 'og:image', `${siteUrl}og-image.png`),
              meta('property', 'og:image:width', '1200'),
              meta('property', 'og:image:height', '630'),
              meta('property', 'og:image:alt', 'Bun, the FundBun mascot: “You could’ve gotten a Birkin.”'),
              meta('name', 'twitter:card', 'summary_large_image'),
              meta('name', 'twitter:image', `${siteUrl}og-image.png`),
            ]
          : []),
      ],
    },
  }
}

/**
 * The hero fonts every first paint needs: the Latin cuts of Fraunces (headlines, the wordmark) and DM Sans (body).
 * The welcome screen keeps its logo row opaque while it slides in (Welcome.module.css): with every element
 * fading in from opacity 0 and the fonts already loaded, Chrome would see no largest contentful paint at all.
 */
export const HERO_FONTS: readonly RegExp[] = [/fraunces-latin-full-normal-[\w-]+\.woff2$/, /dm-sans-latin-wght-normal-[\w-]+\.woff2$/]

/**
 * `<link rel="preload" as="font">` for HERO_FONTS, so they download alongside the entry chunk instead of after
 * the stylesheet is parsed and the first screen has rendered. Build only (file names are content-hashed).
 */
export function fontPreloadPlugin(patterns: readonly RegExp[] = HERO_FONTS): Plugin {
  let base = '/'
  return {
    name: 'fundbun:font-preload',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const files = Object.keys(ctx.bundle ?? {})
        return patterns.flatMap((re) => {
          const file = files.find((f) => re.test(f))
          if (!file || html.includes(file)) return []
          return [
            {
              tag: 'link',
              attrs: { rel: 'preload', href: `${base}${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
              injectTo: 'head' as const,
            },
          ]
        })
      },
    },
  }
}

/**
 * Initial-bundle chunks: vendor code that changes rarely (React, icons) is cached apart from app code, and the
 * on-device engine (src/core, needed before the first screen) is one named chunk. Screens split by route.
 */
export const CHUNK_GROUPS = [
  { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
  { name: 'icons', test: /[\\/]node_modules[\\/]lucide-react[\\/]/, priority: 10 },
  { name: 'engine', test: /[\\/]src[\\/]core[\\/]/, tags: ['$initial' as const], priority: 5 },
]

/** The landing route of most visits (returning users and every `?demo=` link): fetched with the entry chunk. */
export const EAGER_ROUTES: readonly string[] = ['src/ui/screens/home/HomeScreen.tsx']

interface ChunkLike {
  type: 'chunk' | 'asset'
  fileName: string
  facadeModuleId?: string | null
  imports?: string[]
  viteMetadata?: { importedCss: Set<string> }
}

/**
 * `<link rel="modulepreload">` (plus a style preload) for the lazy chunks of `routes` and their static imports,
 * so the landing screen downloads in parallel with the entry chunk instead of after it has run. Build only.
 */
export function routePreloadPlugin(routes: readonly string[] = EAGER_ROUTES): Plugin {
  let base = '/'
  return {
    name: 'fundbun:route-preload',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = (ctx.bundle ?? {}) as Record<string, ChunkLike>
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
        const js = new Set<string>()
        const css = new Set<string>()
        const visit = (file: string) => {
          const chunk = bundle[file]
          if (!chunk || js.has(file)) return
          js.add(file)
          chunk.viteMetadata?.importedCss.forEach((f) => css.add(f))
          chunk.imports?.forEach(visit)
        }
        for (const route of routes) {
          const chunk = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, '/').endsWith(route))
          if (chunk) visit(chunk.fileName)
        }
        const fresh = (file: string) => !html.includes(`${base}${file}`)
        return [
          ...[...js].filter(fresh).map((file) => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: '', href: `${base}${file}` },
            injectTo: 'head' as const,
          })),
          ...[...css].filter(fresh).map((file) => ({
            tag: 'link',
            attrs: { rel: 'preload', as: 'style', crossorigin: '', href: `${base}${file}` },
            injectTo: 'head' as const,
          })),
        ]
      },
    },
  }
}

export function apiProxy(port: number = API_PORT): ProxyOptions {
  return {
    target: `http://localhost:${port}`,
    changeOrigin: true,
    configure(proxy) {
      // runs before Vite's own handler, which then sees headersSent and skips its bare 502
      proxy.on('error', (_err, req, res) => {
        if (res && 'writeHead' in res) answerGatewayOffline(req, res as ServerResponse)
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), cspMetaPlugin(), fontPreloadPlugin(), routePreloadPlugin(), shareMetaPlugin(siteUrlFor(mode))],
  base: baseFor(mode),
  define: {
    // static builds have no gateway: the app boots with llmBaseUrl null (on-device engine only)
    __FUNDBUN_STATIC__: JSON.stringify(isStaticMode(mode)),
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    proxy: { '/api': apiProxy() },
  },
  preview: {
    proxy: { '/api': apiProxy() },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // no source maps in what we deploy; FUNDBUN_SOURCEMAP=1 builds them for local debugging
    sourcemap: process.env.FUNDBUN_SOURCEMAP === '1',
    // the on-device engine (src/core) is one ~535 KB chunk by design: it boots before the first screen
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: { codeSplitting: { groups: CHUNK_GROUPS } },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
}))
