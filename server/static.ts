import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, posix, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
}

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
export const REVALIDATE_CACHE = 'no-cache'

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** Vite emits content-hashed files as assets/<name>-<hash>.<ext>; those can be cached forever. */
export function isHashedAsset(pathname: string): boolean {
  return /^\/assets\/(?:.+\/)?[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(pathname)
}

/**
 * Map a URL path to a file inside root, or null when it is malformed or would escape root.
 * Dot-segments are rejected outright (they also cover .env, .git and similar).
 */
export function resolveSafePath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((s) => s.startsWith('.'))) return null
  const normalized = posix.normalize(`/${segments.join('/')}`)
  const base = resolve(root)
  const file = resolve(base, `.${normalized}`)
  return file === base || file.startsWith(base + sep) ? file : null
}

export type StaticHandler = (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<void>

export interface StaticOptions {
  root: string
  indexFile?: string
}

/** Serves the production build with SPA fallback; unknown paths with a file extension stay 404. */
export function createStaticHandler(opts: StaticOptions): StaticHandler {
  const root = resolve(opts.root)
  const index = resolve(root, opts.indexFile ?? 'index.html')

  return async (req, res, pathname) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      return sendText(res, 405, 'Method Not Allowed')
    }
    const file = resolveSafePath(root, pathname)
    if (!file) return sendText(res, 404, 'Not Found')
    if (await isFile(file)) return sendFile(req, res, file, cacheFor(pathname, file === index))
    if (extname(pathname)) return sendText(res, 404, 'Not Found')
    if (await isFile(index)) return sendFile(req, res, index, REVALIDATE_CACHE)
    return sendText(res, 503, 'The web app has not been built yet (run npm run build).')
  }
}

function cacheFor(pathname: string, isIndex: boolean): string {
  return !isIndex && isHashedAsset(pathname) ? IMMUTABLE_CACHE : REVALIDATE_CACHE
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): Promise<void> {
  const info = await stat(file)
  res.writeHead(200, {
    'Content-Type': contentTypeFor(file),
    'Content-Length': info.size,
    'Cache-Control': cacheControl,
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  await new Promise<void>((done) => {
    const stream = createReadStream(file)
    stream.on('error', () => {
      res.destroy()
      done()
    })
    stream.on('end', done)
    stream.pipe(res)
  })
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' })
  res.end(text)
}
