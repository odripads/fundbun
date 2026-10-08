import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ProxyOptions } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The LLM gateway (server/index.ts) listens on 8787 in development.
const API_PORT = Number(process.env.FUNDBUN_API_PORT ?? 8787)

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
  plugins: [react(), cspMetaPlugin()],
  base: mode === 'pages' ? '/fundbun/' : '/',
  define: {
    __FUNDBUN_STATIC__: JSON.stringify(mode === 'pages'),
  },
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: false,
    proxy: { '/api': apiProxy() },
  },
  preview: {
    proxy: { '/api': apiProxy() },
  },
  build: { outDir: 'dist', sourcemap: true, target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
}))
