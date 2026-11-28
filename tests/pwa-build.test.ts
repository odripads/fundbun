import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServiceWorker, renderServiceWorker } from '../scripts/pwa-build.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const TEMPLATE = join(ROOT, 'scripts', 'pwa-sw.template.js')

describe('installable web app build', () => {
  let dist: string

  beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'fundbun-pwa-'))
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'index.html'), '<div>FundBun</div>')
    writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"FundBun"}')
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("FundBun")')
    writeFileSync(join(dist, 'sw.js'), 'old worker')
  })

  afterEach(() => rmSync(dist, { recursive: true, force: true }))

  it('renders the cache name and every app file without placeholders', () => {
    const source = renderServiceWorker(readFileSync(TEMPLATE, 'utf8'), ['assets/app.js', 'index.html'], 'fundbun-test')
    expect(source).toContain("const CACHE_NAME = 'fundbun-test'")
    expect(source).toContain('const PRECACHE = ["assets/app.js","index.html"]')
    expect(source).not.toContain('__FUNDBUN_')
  })

  it('precaches the whole app except the old worker and changes the cache when content changes', () => {
    const first = buildServiceWorker(dist, TEMPLATE)
    expect(first.fileCount).toBe(3)
    expect(first.cacheName).toMatch(/^fundbun-[a-f0-9]{16}$/)
    const source = readFileSync(join(dist, 'sw.js'), 'utf8')
    expect(source).toContain('["assets/app.js","index.html","manifest.webmanifest"]')
    expect(source).not.toContain('old worker')

    const second = buildServiceWorker(dist, TEMPLATE)
    expect(second).toEqual(first)
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("new version")')
    expect(buildServiceWorker(dist, TEMPLATE).cacheName).not.toBe(first.cacheName)
  })

  it('refuses an incomplete web build', () => {
    rmSync(join(dist, 'index.html'))
    expect(() => buildServiceWorker(dist, TEMPLATE)).toThrow('Build the web app')
  })
})
