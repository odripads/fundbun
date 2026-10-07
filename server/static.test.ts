import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contentTypeFor, createStaticHandler, IMMUTABLE_CACHE, isHashedAsset, resolveSafePath, REVALIDATE_CACHE } from './static'

describe('resolveSafePath', () => {
  const root = resolve('/srv/dist')

  it('maps normal paths inside the root', () => {
    expect(resolveSafePath(root, '/')).toBe(root)
    expect(resolveSafePath(root, '/assets/app-AbCdEf12.js')).toBe(join(root, 'assets/app-AbCdEf12.js'))
    expect(resolveSafePath(root, '/a%20b.png')).toBe(join(root, 'a b.png'))
  })

  it('rejects traversal in every spelling', () => {
    for (const p of ['/../etc/passwd', '/%2e%2e/etc/passwd', '/assets/..%2f..%2fsecret', '/..%5c..%5csecret', '/a/../../b']) {
      expect(resolveSafePath(root, p)).toBeNull()
    }
  })

  it('rejects dotfiles, NUL bytes and malformed escapes', () => {
    expect(resolveSafePath(root, '/.env')).toBeNull()
    expect(resolveSafePath(root, '/.git/config')).toBeNull()
    expect(resolveSafePath(root, '/a%00.js')).toBeNull()
    expect(resolveSafePath(root, '/%E0%A4%A')).toBeNull()
  })

  it('collapses duplicate slashes without escaping root', () => {
    expect(resolveSafePath(root, '//assets///x.js')).toBe(join(root, 'assets/x.js'))
  })
})

describe('isHashedAsset / contentTypeFor', () => {
  it('recognises Vite content-hashed assets only', () => {
    expect(isHashedAsset('/assets/index-BXk3dSd2.js')).toBe(true)
    expect(isHashedAsset('/assets/dm-sans-latin-wght-normal-Xz_9-aB12c.woff2')).toBe(true)
    expect(isHashedAsset('/assets/logo.svg')).toBe(false)
    expect(isHashedAsset('/index-BXk3dSd2.js')).toBe(false)
    expect(isHashedAsset('/assets/a-short.js')).toBe(false)
  })

  it('maps extensions to safe content types', () => {
    expect(contentTypeFor('x.js')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('x.WOFF2')).toBe('font/woff2')
    expect(contentTypeFor('x.svg')).toBe('image/svg+xml')
    expect(contentTypeFor('x.unknown')).toBe('application/octet-stream')
  })
})

describe('createStaticHandler (HTTP)', () => {
  let dir: string
  let server: Server
  let port: number

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fundbun-dist-'))
    mkdirSync(join(dir, 'dist/assets'), { recursive: true })
    writeFileSync(join(dir, 'dist/index.html'), '<!doctype html><title>FundBun</title>')
    writeFileSync(join(dir, 'dist/assets/index-AbCdEf12.js'), 'console.log(1)')
    writeFileSync(join(dir, 'dist/favicon.svg'), '<svg/>')
    writeFileSync(join(dir, 'dist/.env'), 'SECRET=1')
    writeFileSync(join(dir, 'secret.txt'), 'outside root')
    const handler = createStaticHandler({ root: join(dir, 'dist') })
    server = createServer((req, res) => void handler(req, res, (req.url ?? '/').split('?')[0]))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise((r) => server.close(r))
    rmSync(dir, { recursive: true, force: true })
  })

  const raw = (path: string, method = 'GET') =>
    new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (body += c))
        res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }))
      })
      req.on('error', fail)
      req.end()
    })

  it('serves index.html at / with revalidation', async () => {
    const r = await raw('/')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(r.headers['cache-control']).toBe(REVALIDATE_CACHE)
    expect(r.body).toContain('FundBun')
  })

  it('serves hashed assets with a long immutable cache', async () => {
    const r = await raw('/assets/index-AbCdEf12.js')
    expect(r.status).toBe(200)
    expect(r.headers['cache-control']).toBe(IMMUTABLE_CACHE)
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(r.body).toBe('console.log(1)')
  })

  it('serves unhashed files without the long cache', async () => {
    const r = await raw('/favicon.svg')
    expect(r.status).toBe(200)
    expect(r.headers['cache-control']).toBe(REVALIDATE_CACHE)
  })

  it('falls back to index.html for client-side routes (SPA)', async () => {
    const r = await raw('/settings/privacy?tab=1')
    expect(r.status).toBe(200)
    expect(r.body).toContain('FundBun')
  })

  it('returns 404 for missing files with an extension instead of HTML', async () => {
    const r = await raw('/assets/missing-AbCdEf12.js')
    expect(r.status).toBe(404)
    expect(r.body).not.toContain('FundBun')
  })

  it('refuses traversal and dotfiles over the wire', async () => {
    expect((await raw('/../secret.txt')).status).toBe(404)
    expect((await raw('/%2e%2e/secret.txt')).status).toBe(404)
    const env = await raw('/.env')
    expect(env.status).toBe(404)
    expect(env.body).not.toContain('SECRET')
  })

  it('answers HEAD without a body and rejects other methods', async () => {
    const head = await raw('/', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBe('')
    const post = await raw('/', 'POST')
    expect(post.status).toBe(405)
    expect(post.headers.allow).toBe('GET, HEAD')
  })

  it('reports a missing build instead of crashing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'fundbun-empty-'))
    const handler = createStaticHandler({ root: empty })
    const s = createServer((req, res) => void handler(req, res, '/'))
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/`)
    expect(res.status).toBe(503)
    await new Promise((r) => s.close(r))
    rmSync(empty, { recursive: true, force: true })
  })
})
