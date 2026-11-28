#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'
import { renderServiceWorker } from './pwa-build.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length) ?? 'production'
if (!['production', 'vercel', 'pages'].includes(mode)) throw new Error(`Unknown preview mode: ${mode}`)
const basePath = mode === 'pages' ? '/fundbun/' : '/'
const port = await availablePort()
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [vite, 'preview', '--mode', mode, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverOutput = ''
server.stdout.on('data', (chunk) => (serverOutput += chunk))
server.stderr.on('data', (chunk) => (serverOutput += chunk))
const profile = mkdtempSync(join(tmpdir(), 'fundbun-pwa-chrome-'))
let context

try {
  await waitForServer(`${origin}${basePath}index.html`)
  const options = { ...devices['Pixel 7'], headless: true, serviceWorkers: 'allow' }
  context = await chromium.launchPersistentContext(profile, { ...options, channel: 'chrome' }).catch(() => chromium.launchPersistentContext(profile, options))
  const page = context.pages()[0] ?? (await context.newPage())
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`))
  await page.goto(`${origin}${basePath}?demo=jing`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.body.innerText.includes('Over budget'))

  const worker = await page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not activate')), 15000)),
    ])
    if (!registration.active) throw new Error('Service worker is not active')
    const keys = await caches.keys()
    const key = keys.find((name) => name.startsWith('fundbun-'))
    if (!key) throw new Error('FundBun cache is missing')
    const cached = await (await caches.open(key)).keys()
    return { scope: registration.scope, cache: key, files: cached.length }
  })
  assert.equal(worker.scope, `${origin}${basePath}`)
  assert.ok(worker.files >= 90, `Only ${worker.files} app files were cached`)
  const cacheProbe = await page.evaluate(async () => {
    const asset = performance.getEntriesByType('resource').find((entry) => entry.name.includes('/assets/index-') && entry.name.endsWith('.js'))?.name
    if (!asset) throw new Error('Could not find the entry asset to probe')
    const normal = await caches.match(asset)
    const ignoringVary = await caches.match(asset, { ignoreVary: true })
    return { asset, normal: Boolean(normal), ignoringVary: Boolean(ignoringVary), vary: ignoringVary?.headers.get('vary') }
  })
  console.log(`[pwa] cache probe: ${JSON.stringify(cacheProbe)}`)

  const cdp = await context.newCDPSession(page)
  await cdp.send('Page.enable')
  const manifest = await cdp.send('Page.getAppManifest')
  assert.equal(JSON.parse(manifest.data).name, 'FundBun')
  assert.deepEqual(manifest.errors.filter((error) => error.critical), [])
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  assert.deepEqual(installabilityErrors, [], `Installability errors: ${JSON.stringify(installabilityErrors)}`)

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  try {
    await page.waitForFunction(() => document.body.innerText.includes('Over budget'), undefined, { timeout: 10000 })
  } catch (error) {
    console.error(`[pwa] offline URL: ${page.url()}`)
    console.error(`[pwa] offline body: ${(await page.locator('body').innerText()).slice(0, 2000)}`)
    console.error(`[pwa] offline controller: ${await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? 'none')}`)
    console.error(`[pwa] page errors: ${JSON.stringify(pageErrors)}`)
    console.error(`[pwa] console errors: ${JSON.stringify(consoleErrors)}`)
    console.error(`[pwa] failed requests: ${JSON.stringify(failedRequests)}`)
    throw error
  }
  await page.evaluate(() => (window.location.hash = '#/settings'))
  await page.waitForFunction(() => document.body.innerText.includes('Settings') && document.body.innerText.includes('Your AI'))
  assert.deepEqual(pageErrors, [])
  console.log(`[pwa] Pixel 7: installable, ${worker.files} files cached, Home and Settings work offline`)
  await context.setOffline(false)
  await verifyFreshPrecache(context)
} catch (error) {
  if (serverOutput) console.error(serverOutput)
  throw error
} finally {
  if (context) await context.close()
  rmSync(profile, { recursive: true, force: true })
  if (server.exitCode === null) {
    server.kill('SIGTERM')
    await Promise.race([once(server, 'exit'), delay(2000)])
    if (server.exitCode === null) server.kill('SIGKILL')
  }
}

async function verifyFreshPrecache(context) {
  let version = 'a'
  const template = readFileSync(join(root, 'scripts', 'pwa-sw.template.js'), 'utf8')
  const workers = {
    a: renderServiceWorker(template, ['index.html'], 'fundbun-update-a'),
    b: renderServiceWorker(template, ['index.html'], 'fundbun-update-b'),
  }
  const html = () => `<!doctype html><html><body>version-${version}<script>navigator.serviceWorker.register('/sw.js')</script></body></html>`
  const server = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/sw.js') {
      response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' })
      response.end(workers[version])
      return
    }
    if (pathname === '/index.html') {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'public, max-age=600' })
      response.end(html())
      return
    }
    response.writeHead(404)
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const page = await context.newPage()
  try {
    await page.goto(`http://127.0.0.1:${address.port}/index.html`)
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    version = 'b'
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) throw new Error('Update test registration is missing')
      await registration.update()
    })
    await page.waitForFunction(async () => {
      const cache = await caches.open('fundbun-update-b')
      return Boolean(await cache.match(`${location.origin}/index.html`))
    })
    const cachedHtml = await page.evaluate(async () => {
      const cache = await caches.open('fundbun-update-b')
      return (await (await cache.match(`${location.origin}/index.html`)).text())
    })
    assert.equal(cachedHtml, html(), 'An update precached stale HTML from the browser HTTP cache')
    console.log('[pwa] update precache bypasses stale HTTP-cached HTML')
  } finally {
    await page.close()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function availablePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  assert.ok(address && typeof address === 'object')
  const { port: selected } = address
  await new Promise((resolve) => listener.close(resolve))
  return selected
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite preview exited with ${server.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The listener may not be ready yet.
    }
    await delay(100)
  }
  throw new Error('Vite preview did not start within 10 seconds')
}
