#!/usr/bin/env node
/**
 * Viewport verification for FundBun: Desktop 1440x920, iPhone 390x844, Android 412x915.
 *
 *   npm run build && node scripts/verify-viewports.mjs          (starts its own local server on a free port)
 *   node scripts/verify-viewports.mjs --url http://127.0.0.1:47600   (use a server that is already running)
 *
 * Options
 *   --url <base>         use this address instead of starting server/local.ts from dist/
 *   --dist <dir>         built app to serve when the script starts the server (default dist/)
 *   --only <ids>         comma list of desktop,iphone,android (default: all three)
 *   --out <dir>          screenshot and report folder (default /tmp/fundbun-viewport-checks)
 *   --demo <persona>     sandbox persona to load (default jing)
 *   --channel <name>     browser channel: chrome (default, no download) or chromium (Playwright's own)
 *   --headed             show the browser
 *   --timeout <ms>       per-wait timeout (default 15000)
 *   --enable-creator     with --url: switch Creator Mode on for the run (it is put back afterwards)
 *   --require-creator    fail (instead of skip) when Creator Mode is not available
 *   --allow-llm          do not fail the offline checks when an AI connection answers
 *   --allow-console <re> ignore console errors matching this regular expression
 *   --skip-flows         only the console and overflow checks
 *   --help
 *
 * What is checked on every viewport
 *   1. no uncaught page error and no console error
 *   2. no horizontal overflow (documentElement.scrollWidth <= innerWidth + 1) on Home/Overview, Insights, Bills,
 *      Goals, Activity, Settings and Chat; on desktop also the Glass box tab and the Phone view (the classic device
 *      frame); any control labelled "Classic" or "Terminal" is opened and measured too when the build has one
 *   3. chat flows with the on-device engine (no AI connected):
 *        a) "what are my big spending" gives a grounded biggest-purchase answer, not the unknown fallback
 *        b) "blorf xyzzy help me do something" gives a tappable clarify task picker, and one option answers
 *        c) with Creator Mode on: the three-part look request shows a preview card with Apply (nothing applied
 *           before the tap), Apply sets <html data-theme>, the Kamen Rider helmet and the wordmark, Undo or Reset
 *           puts everything back
 *   4. screenshots in the output folder: desktop-1440.png, iphone-390.png, android-412.png and feature states
 *
 * Exit code: 0 when nothing failed, 1 when a check failed, 2 when the run could not start.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_OUT = '/tmp/fundbun-viewport-checks'

const VIEWPORTS = [
  { id: 'desktop', label: 'desktop-1440', width: 1440, height: 920, mobile: false, scale: 1 },
  {
    id: 'iphone',
    label: 'iphone-390',
    width: 390,
    height: 844,
    mobile: true,
    scale: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'android',
    label: 'android-412',
    width: 412,
    height: 915,
    mobile: true,
    scale: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  },
]

/** Routes measured for overflow, in visit order. `core` marks the ones the brief names. */
const ROUTES = [
  { key: 'home', hash: '#/home', label: 'Home/Overview', core: true },
  { key: 'insights', hash: '#/insights', label: 'Insights' },
  { key: 'bills', hash: '#/bills', label: 'Bills' },
  { key: 'goals', hash: '#/goals', label: 'Goals' },
  { key: 'activity', hash: '#/activity', label: 'Activity' },
  { key: 'settings', hash: '#/settings', label: 'Settings', core: true },
]

const PROMPT_BIG = 'what are my big spending'
const PROMPT_UNKNOWN = 'blorf xyzzy help me do something'
const PROMPT_LOOK = 'change theme to cyberpunk, put kamen rider helm on bun, and rename fundbun to #ilovemoney'
const LOOK_NAME = '#ilovemoney'
const LOOK_THEME = 'cyberpunk'
const LOOK_HAT = 'kamen_rider'

// keys and attributes the app itself uses (src/ui/components/plugins/shellAppearance.ts, desk/useDeskMode.ts)
const SHELL_KEY = 'fundbun.shell-appearance.v1'
const VIEW_KEY = 'fundbun.view'
const STATE_KEY = 'fundbun.v1'

// selectors, most specific first; the text and ARIA ones match src/ui as it is today
const SEL = {
  bot: 'li[id^="msg-"]:has([role="img"][aria-label^="AI-generated"])',
  anyMessage: 'li[id^="msg-"]',
  clarify: [
    '[data-testid="clarify-card"]',
    '[data-card="clarify"]',
    '[data-card-type="clarify"]',
    // ClarifyCard: <div role="group" aria-label={question}> with one <button> per option
    '[role="group"]:not([aria-label="Suggested replies"]):has(button)',
  ].join(', '),
  appearanceCard: [
    // PluginAppearanceCard: <div data-appearance-card={proposalId} data-status="idle|applied|blocked">
    '[data-appearance-card]',
    '[data-testid="plugin-appearance-card"]',
    '[data-testid="appearance-card"]',
    '[data-card="appearance"]',
    '[data-card="plugin-appearance"]',
    '[data-plugin-action="appearance"]',
    '[data-action="appearance"]',
    '[data-proposal-id]',
  ].join(', '),
  // the helmet drawn inside the mascot's <svg>; the page-level data-shell-hat attribute is checked separately
  helmet: [
    // BunMascot: <svg data-hat="kamen_rider"> with a <g data-hat-part="kamen_rider"> inside
    `svg[data-hat="${LOOK_HAT}"]`,
    `svg [data-hat-part="${LOOK_HAT}"]`,
    `svg [data-hat="${LOOK_HAT}"]`,
    `svg [data-mascot-hat="${LOOK_HAT}"]`,
    `svg[data-mascot-hat="${LOOK_HAT}"]`,
    `[data-hat="${LOOK_HAT}"] svg`,
    `[data-mascot-hat="${LOOK_HAT}"] svg`,
    `svg [data-testid="mascot-hat-${LOOK_HAT}"]`,
    `svg [data-testid="bun-hat-${LOOK_HAT}"]`,
    'svg [data-testid="mascot-hat"]',
    'svg [data-part="hat"]',
    'svg g[class*="hat" i]',
    'svg g[class*="helmet" i]',
    'svg g[class*="kamen" i]',
  ].join(', '),
}

const UNKNOWN_TEXT_RE = /not sure i understood|went over my bun|\bnot understood\b/i
const MONEY_RE = /(?:[¥$€£₩]|\b(?:CNY|RMB|Rp|IDR|USD)\b)\s?-?\d|\d[\d,.]*\s?(?:元|yuan)\b/i
const BIGGEST_RE = /\b(?:biggest|largest|highest|priciest|most expensive|top|big)\b[^.!?\n]{0,60}\b(?:purchase|spend|spending|expense|transaction|buy|charge|payment|order)s?\b|最大|最贵|terbesar|termahal/i

// ───────────────────────────── arguments ─────────────────────────────

function parseArgs(argv) {
  const flags = new Set(['headed', 'enable-creator', 'require-creator', 'allow-llm', 'skip-flows', 'help'])
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
    if (flags.has(key)) out[key] = true
    else if (eq !== -1) out[key] = a.slice(eq + 1)
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[key] = argv[++i]
    else out[key] = ''
  }
  return out
}

const ARGS = parseArgs(process.argv.slice(2))
const OUT_DIR = resolve(ARGS.out || DEFAULT_OUT)
const TIMEOUT = Number(ARGS.timeout) > 0 ? Number(ARGS.timeout) : 15_000
const DEMO = (ARGS.demo || 'jing').trim()
const ALLOW_CONSOLE = ARGS['allow-console'] ? new RegExp(ARGS['allow-console'], 'i') : null

function usage() {
  console.log(
    [
      'node scripts/verify-viewports.mjs [options]',
      '  --url <base>          address of a running FundBun (default: start server/local.ts from dist/ on a free port)',
      '  --dist <dir>          built app to serve when the script starts the server (default dist/)',
      '  --only <ids>          desktop,iphone,android',
      `  --out <dir>           default ${DEFAULT_OUT}`,
      '  --demo <persona>      default jing',
      '  --channel <name>      chrome (default) or chromium',
      '  --headed              show the browser',
      '  --timeout <ms>        default 15000',
      '  --enable-creator      with --url: switch Creator Mode on for the run and put it back afterwards',
      '  --require-creator     fail when Creator Mode is not available',
      '  --allow-llm           do not fail the offline checks when an AI connection answers',
      '  --allow-console <re>  ignore console errors matching this pattern',
      '  --skip-flows          only the console and overflow checks',
    ].join('\n'),
  )
}

// ───────────────────────────── results and logging ─────────────────────────────

const MARK = { PASS: 'ok  ', FAIL: 'FAIL', WARN: 'warn', SKIP: 'skip', INFO: 'info' }
const results = []

function record(viewport, name, status, detail = '') {
  results.push({ viewport, name, status, detail })
  const line = `[${viewport}] ${MARK[status] ?? status} ${name}${detail ? `: ${detail}` : ''}`
  if (status === 'FAIL') console.error(line)
  else console.log(line)
}

function log(viewport, text) {
  console.log(`[${viewport}] .... ${text}`)
}

const short = (value, max = 220) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}...` : s
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)

// ───────────────────────────── local server ─────────────────────────────

/** A small JSON request from Node (no browser console involved). `origin` is sent for state-changing calls. */
function requestJson(method, url, body, origin) {
  return new Promise((done) => {
    let target
    try {
      target = new URL(url)
    } catch {
      return done({ status: 0, json: null, error: 'bad url' })
    }
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const headers = { Accept: 'application/json' }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(payload.byteLength)
    }
    if (origin) headers.Origin = origin
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(target, { method, headers, timeout: 5000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try {
          json = JSON.parse(text)
        } catch {
          // not JSON (a static host answers with a page): the caller treats it as "not available"
        }
        done({ status: res.statusCode ?? 0, json, error: null })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', (err) => done({ status: 0, json: null, error: String(err?.message ?? err) }))
    if (payload) req.write(payload)
    req.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Runs inside the child process: starts server/local.ts through its own startLocal() on port 0 (the system picks
 * a free port), with a throwaway home and no .env, prints the address, and closes cleanly on SIGTERM.
 */
const SERVER_BOOT = `
const path = require('node:path')
const { pathToFileURL } = require('node:url')
;(async () => {
  const mod = await import(pathToFileURL(path.resolve('server/local.ts')).href)
  const local = await mod.startLocal({ port: 0, home: process.env.FUNDBUN_HOME, distDir: process.env.FUNDBUN_VERIFY_DIST })
  process.stdout.write('FUNDBUN_VERIFY_URL=' + local.url + '\\n')
  const stop = () => {
    setTimeout(() => process.exit(0), 3000).unref()
    local.close().then(() => process.exit(0), () => process.exit(0))
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
})().catch((err) => {
  console.error((err && err.stack) || String(err))
  process.exit(1)
})
`

/**
 * Starts the local server (the app, the plugin engine and no AI connection) from the built app on an ephemeral
 * port, with a throwaway FUNDBUN_HOME so the run never touches ~/.fundbun. Resolves once /api/health answers.
 */
async function startLocalServer(distDir) {
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`${join(distDir, 'index.html')} is missing: run \`npm run build\` first, or pass --url <address>`)
  }
  const home = mkdtempSync(join(tmpdir(), 'fundbun-verify-'))
  const output = []
  let url = null
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', SERVER_BOOT], {
    cwd: ROOT,
    env: { ...process.env, FUNDBUN_HOME: home, FUNDBUN_VERIFY_DIST: distDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let exited = null
  child.once('exit', (code, signal) => {
    exited = { code, signal }
  })
  child.once('error', (err) => {
    output.push(String(err?.message ?? err))
    exited = exited ?? { code: 'spawn error', signal: null }
  })
  const keep = (chunk) => {
    const text = String(chunk)
    const found = /FUNDBUN_VERIFY_URL=(\S+)/.exec(text)
    if (found) url = found[1]
    output.push(text)
    if (output.length > 40) output.shift()
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)

  const stop = async () => {
    if (!exited) {
      child.kill('SIGTERM')
      for (let i = 0; i < 40 && !exited; i++) await sleep(100)
      if (!exited) {
        child.kill('SIGKILL')
        for (let i = 0; i < 20 && !exited; i++) await sleep(100)
      }
    }
    rmSync(home, { recursive: true, force: true })
  }

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (exited) {
      rmSync(home, { recursive: true, force: true })
      throw new Error(`the local server stopped while starting (code ${exited.code ?? exited.signal}): ${short(output.join(''), 600)}`)
    }
    if (url) {
      const health = await requestJson('GET', `${url}/api/health`)
      if (health.status === 200) return { url, stop, home }
    }
    await sleep(200)
  }
  await stop()
  throw new Error(`the local server did not come up within 45 s: ${short(output.join(''), 600)}`)
}

// ───────────────────────────── page helpers ─────────────────────────────

/** Fonts ready, two frames painted, then a short pause for entrance transitions. */
async function settle(page, extraMs = 250) {
  await page
    .evaluate(async () => {
      try {
        await document.fonts.ready
      } catch {
        // fonts API missing: nothing to wait for
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    .catch(() => undefined)
  await page.waitForTimeout(extraMs)
}

async function gotoHash(page, hash) {
  await page.evaluate((h) => {
    if (window.location.hash !== h) window.location.hash = h
  }, hash)
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)
  await settle(page, 350)
}

/**
 * Measures horizontal overflow. `limit` is the configured viewport width: mobile emulation can report a wider
 * innerWidth when the page overflows, so the stricter of the two is used. Also lists the elements that stick out
 * (for the fix) and controls or text cut off by a clipping ancestor.
 */
function measureOverflowInPage(limit) {
  const root = document.documentElement
  const inner = window.innerWidth
  const vw = Math.min(inner, limit)
  const scrollWidth = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0)
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
    const id = el.id ? `#${el.id}` : ''
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90)
  }
  const sticking = []
  const clipped = []
  const seen = new Set()
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    if (r.right <= vw + 1 && r.left >= -1) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
    if (el.closest('[aria-hidden="true"], .sr-only, [hidden], [inert]')) continue
    let scroller = false
    let clip = false
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') {
        scroller = true
        break
      }
      if (ox === 'hidden' || ox === 'clip') clip = true
    }
    // inside a sideways scroller (a chip row, a table) the content is reachable: not an overflow
    if (scroller) continue
    if (el.parentElement && seen.has(el.parentElement)) {
      seen.add(el)
      continue
    }
    seen.add(el)
    const entry = { el: name(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }
    if (!clip) sticking.push(entry)
    else {
      const interactive = el.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"]')
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
      const fixed = cs.position === 'fixed' || cs.position === 'absolute'
      if ((interactive || hasText) && !fixed) clipped.push(entry)
    }
  }
  return { inner, limit, vw, scrollWidth, ok: scrollWidth <= vw + 1, sticking: sticking.slice(0, 6), clipped: clipped.slice(0, 6) }
}

async function checkOverflow(page, vp, label, { core = true } = {}) {
  const name = `no horizontal overflow: ${label}`
  try {
    const top = await page.evaluate(measureOverflowInPage, vp.width)
    // the same measurement at the end of the page: long screens lay out more content below the fold
    await page.evaluate(() => {
      const scroller = document.scrollingElement
      if (scroller) scroller.scrollTop = scroller.scrollHeight
      for (const el of document.querySelectorAll('main, [class*="screen"], [class*="scroll"]')) {
        if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight
      }
    })
    await page.waitForTimeout(150)
    const bottom = await page.evaluate(measureOverflowInPage, vp.width)
    await page.evaluate(() => {
      const scroller = document.scrollingElement
      if (scroller) scroller.scrollTop = 0
      for (const el of document.querySelectorAll('main, [class*="screen"], [class*="scroll"]')) el.scrollTop = 0
    })
    const worst = bottom.scrollWidth > top.scrollWidth ? bottom : top
    const offenders = [...top.sticking, ...bottom.sticking]
    const list = offenders.length ? ` | sticking out: ${offenders.slice(0, 5).map((o) => `${o.el} (right ${o.right}px)`).join('; ')}` : ''
    if (!worst.ok) {
      record(vp.label, name, 'FAIL', `scrollWidth ${worst.scrollWidth}px > ${worst.vw}px + 1${list}`)
    } else {
      record(vp.label, name, 'PASS', `scrollWidth ${worst.scrollWidth}px, innerWidth ${worst.inner}px`)
    }
    const cut = [...top.clipped, ...bottom.clipped]
    if (cut.length) {
      const unique = [...new Map(cut.map((c) => [c.el, c])).values()].slice(0, 5)
      record(vp.label, `content cut off at the edge: ${label}`, 'WARN', unique.map((o) => `${o.el} (right ${o.right}px of ${worst.vw}px)`).join('; '))
    }
    return worst.ok
  } catch (err) {
    record(vp.label, name, core ? 'FAIL' : 'WARN', `could not measure: ${short(err?.message ?? err)}`)
    return false
  }
}

async function shot(page, vp, file) {
  const path = join(OUT_DIR, file)
  try {
    await page.screenshot({ path, type: 'png' })
    log(vp.label, `screenshot ${path}`)
    return path
  } catch (err) {
    record(vp.label, `screenshot ${file}`, 'WARN', short(err?.message ?? err))
    return null
  }
}

async function failShot(page, vp, name) {
  await shot(page, vp, `${vp.label}-FAIL-${slug(name)}.png`)
}

/** Runs one named part of the run; an unexpected error is recorded as a failure and the run goes on. */
async function step(page, vp, name, fn) {
  try {
    return await fn()
  } catch (err) {
    record(vp.label, name, 'FAIL', short(err?.message ?? err, 400))
    await failShot(page, vp, name)
    return undefined
  }
}

async function click(vp, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: TIMEOUT }).catch(() => undefined)
  if (vp.mobile) await locator.tap({ timeout: TIMEOUT })
  else await locator.click({ timeout: TIMEOUT })
}

const visible = (locator) => locator.filter({ visible: true })

// ───────────────────────────── chat helpers ─────────────────────────────

async function composer(page) {
  const byLabel = visible(page.getByRole('textbox', { name: /message bun/i }))
  if (await byLabel.count()) return byLabel.last()
  return visible(page.locator('form textarea')).last()
}

/** Opens Ask Bun: its own screen on a phone, the side panel on the desk layout. */
async function openChat(page) {
  const existing = await composer(page)
  if (await existing.count()) return existing
  await gotoHash(page, '#/chat')
  const box = await composer(page)
  await box.waitFor({ state: 'visible', timeout: TIMEOUT })
  return box
}

function countVisibleInPage(selector) {
  return Array.from(document.querySelectorAll(selector)).filter((e) => e.getClientRects().length > 0).length
}

/** Sends a chat message and waits for Bun's next reply to finish. Returns the reply's <li>. */
async function ask(page, vp, text) {
  const box = await openChat(page)
  const before = await page.evaluate(countVisibleInPage, SEL.bot)
  log(vp.label, `chat: "${text}"`)
  await box.fill(text)
  const form = page.locator('form').filter({ has: box })
  const send = form.getByRole('button', { name: /^send$/i })
  if ((await send.count()) && (await send.first().isEnabled().catch(() => false))) await click(vp, send.first())
  else await box.press('Enter')
  await waitForReply(page, before)
  return visible(page.locator(SEL.bot)).last()
}

async function waitForReply(page, before) {
  await page.waitForFunction(
    ({ selector, n }) => {
      const shown = Array.from(document.querySelectorAll(selector)).filter((e) => e.getClientRects().length > 0).length
      return shown > n && !document.querySelector('form[aria-busy="true"]')
    },
    { selector: SEL.bot, n: before },
    { timeout: Math.max(TIMEOUT, 20_000) },
  )
  await settle(page, 500)
}

/** What a reply shows: its text, engine label and the cards in it. */
async function describeReply(message) {
  return message.evaluate((li, clarifySelector) => {
    const badge = li.querySelector('[role="img"][aria-label^="AI-generated"]')
    const groups = Array.from(li.querySelectorAll(clarifySelector)).filter((g) => g.getClientRects().length > 0)
    const chips = li.querySelector('[role="group"][aria-label="Suggested replies"]')
    return {
      id: li.id.replace(/^msg-/, ''),
      text: (li.innerText || '').replace(/\s+/g, ' ').trim(),
      engineLabel: badge ? badge.getAttribute('aria-label') : null,
      clarifyGroups: groups.length,
      clarifyOptions: groups.length ? Array.from(groups[0].querySelectorAll('button')).map((b) => (b.innerText || '').trim()) : [],
      suggestionChips: chips ? Array.from(chips.querySelectorAll('button')).map((b) => (b.innerText || '').trim()) : [],
      listRows: li.querySelectorAll('section li, section [role="listitem"]').length,
    }
  }, SEL.clarify)
}

/** The same reply as the app stored it (engine, card types, trace), when the saved state is readable. */
async function storedReply(page, id) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const found = await page.evaluate(
      ({ key, id }) => {
        try {
          const state = JSON.parse(localStorage.getItem(key) ?? 'null')
          const chat = Array.isArray(state?.chat) ? state.chat : Array.isArray(state?.state?.chat) ? state.state.chat : null
          const m = chat ? chat.find((x) => x && x.id === id) : null
          if (!m) return null
          return {
            engine: m.engine ?? null,
            via: m.via ?? null,
            cards: Array.isArray(m.cards) ? m.cards.map((c) => (c.type === 'plugin_action' && c.action ? `plugin_action:${c.action}` : c.type)) : [],
            trace: Array.isArray(m.trace) ? m.trace.map((t) => `${t.kind}: ${t.label}`).slice(0, 12) : [],
          }
        } catch {
          return null
        }
      },
      { key: STATE_KEY, id },
    )
    if (found) return found
    await page.waitForTimeout(200)
  }
  return null
}

/** True when the reply came from the on-device engine (the stored message, else its AI badge). */
function isOffline(reply, stored) {
  if (stored?.engine) return stored.engine === 'offline' && !stored.via
  return /on-device/i.test(reply.engineLabel ?? '')
}

// ───────────────────────────── shell appearance helpers ─────────────────────────────

function readLookInPage({ key, helmetSelector, cardSelector }) {
  const root = document.documentElement
  let stored = null
  try {
    stored = localStorage.getItem(key)
  } catch {
    stored = null
  }
  // the chat card draws its own preview (a mascot with the helmet, the new name): that is not the app's look
  const shown = (el) => el.getClientRects().length > 0 && !el.closest(cardSelector)
  const logos = Array.from(document.querySelectorAll('[role="img"][data-app-name]')).filter(shown)
  const helmets = Array.from(document.querySelectorAll(helmetSelector)).filter(shown)
  return {
    dataTheme: root.getAttribute('data-theme'),
    shellTheme: root.getAttribute('data-shell-theme'),
    shellHat: root.getAttribute('data-shell-hat'),
    shellName: root.hasAttribute('data-shell-name'),
    inlineAccent: root.style.getPropertyValue('--accent').trim() || null,
    accent: getComputedStyle(root).getPropertyValue('--accent').trim(),
    title: document.title,
    stored,
    logoNames: logos.map((l) => l.getAttribute('data-app-name')),
    logoLabels: Array.from(document.querySelectorAll('[role="img"][aria-label*="FundBun"]')).filter(shown).map((l) => l.getAttribute('aria-label')),
    helmets: helmets.length,
    mascots: Array.from(document.querySelectorAll('svg')).filter((s) => shown(s) && /bun|mascot/i.test(`${s.getAttribute('class') ?? ''} ${s.parentElement?.getAttribute('class') ?? ''}`)).length,
  }
}

const readLook = (page) => page.evaluate(readLookInPage, { key: SHELL_KEY, helmetSelector: SEL.helmet, cardSelector: SEL.appearanceCard })

/** Nothing of a custom look is on the page or in storage. */
function lookIsDefault(look, baseline) {
  const problems = []
  if (look.shellTheme) problems.push(`data-shell-theme="${look.shellTheme}"`)
  if (look.dataTheme !== baseline.dataTheme) problems.push(`data-theme="${look.dataTheme}" (was ${JSON.stringify(baseline.dataTheme)})`)
  if (look.shellHat) problems.push(`data-shell-hat="${look.shellHat}"`)
  if (look.shellName) problems.push('data-shell-name is set')
  if (look.inlineAccent) problems.push(`inline --accent ${look.inlineAccent}`)
  if (look.stored) problems.push(`${SHELL_KEY} is still stored`)
  if (look.title !== baseline.title) problems.push(`title "${look.title}" (was "${baseline.title}")`)
  if (look.logoNames.length) problems.push(`wordmark still shows "${look.logoNames[0]}"`)
  if (look.helmets) problems.push('the helmet is still drawn')
  return problems
}

async function creatorState(base) {
  const res = await requestJson('GET', `${base}/api/plugins/state`)
  if (res.status !== 200 || res.json?.local !== true) return { local: false, enabled: false, status: res.status }
  return { local: true, enabled: res.json.enabled === true, status: 200 }
}

async function setCreatorMode(base, enabled) {
  const res = await requestJson('POST', `${base}/api/plugins/mode`, { enabled }, new URL(base).origin)
  return res.status === 200
}

// ───────────────────────────── the checks ─────────────────────────────

async function checkRoutes(page, vp) {
  for (const route of ROUTES) {
    await step(page, vp, `open ${route.label}`, async () => {
      await gotoHash(page, route.hash)
      const snag = await page.getByText(/hit a snag/i).count()
      if (snag) {
        record(vp.label, `renders: ${route.label}`, 'FAIL', 'the screen shows its error fallback')
        await failShot(page, vp, `renders-${route.key}`)
        return
      }
      await checkOverflow(page, vp, route.label, { core: Boolean(route.core) })
      if (route.key === 'home') await shot(page, vp, `${vp.label}.png`)
      if (route.key === 'settings') await shot(page, vp, `${vp.label}-settings.png`)
    })
  }
}

/** Desktop only: the side panel's Glass box tab, and the phone view (the classic device frame) with its way back. */
async function checkDesktopViews(page, vp) {
  await step(page, vp, 'desk layout', async () => {
    await gotoHash(page, '#/home')
    const desk = await page.locator('[data-desk]').count()
    record(vp.label, 'desk layout is used at this width', desk ? 'PASS' : 'FAIL', desk ? '[data-desk] shell present' : 'no [data-desk] shell: the phone layout rendered instead')
  })

  await step(page, vp, 'Glass box tab', async () => {
    await openChat(page)
    const tab = page.getByRole('tab', { name: /glass box/i })
    if (!(await tab.count())) return record(vp.label, 'no horizontal overflow: Glass box (side panel)', 'SKIP', 'no Glass box tab in the side panel')
    await click(vp, tab.first())
    await settle(page)
    await checkOverflow(page, vp, 'Glass box (side panel)')
    await shot(page, vp, `${vp.label}-glass-box.png`)
    const chatTab = page.getByRole('tab', { name: /ask bun/i })
    if (await chatTab.count()) await click(vp, chatTab.first())
    await settle(page)
  })

  await step(page, vp, 'Phone view (classic device frame)', async () => {
    const toPhone = page.getByRole('button', { name: /^phone view$/i })
    if (!(await toPhone.count())) return record(vp.label, 'no horizontal overflow: Phone view', 'SKIP', 'no "Phone view" button in the sidebar')
    await click(vp, toPhone.first())
    await page.waitForFunction((key) => !document.querySelector('[data-desk]') && localStorage.getItem(key) === 'phone', VIEW_KEY, { timeout: TIMEOUT })
    await settle(page, 400)
    for (const route of [{ hash: '#/home', label: 'Phone view Home' }, { hash: '#/chat', label: 'Phone view Chat' }, { hash: '#/settings', label: 'Phone view Settings' }]) {
      await gotoHash(page, route.hash)
      await checkOverflow(page, vp, route.label)
      if (route.hash === '#/home') await shot(page, vp, `${vp.label}-phone-view.png`)
    }
    await gotoHash(page, '#/home')
    const back = page.getByRole('button', { name: /desktop view/i })
    if (await back.count()) {
      await click(vp, back.first())
      await page.waitForFunction(() => Boolean(document.querySelector('[data-desk]')), undefined, { timeout: TIMEOUT })
      record(vp.label, 'Phone view switches back to the desktop view', 'PASS')
    } else {
      record(vp.label, 'Phone view switches back to the desktop view', 'FAIL', 'no "Switch to the desktop view" button beside the device frame')
      await page.evaluate((key) => localStorage.setItem(key, 'desk'), VIEW_KEY)
      await page.reload({ waitUntil: 'load' })
    }
    await settle(page, 400)
  })
}

/** Any control labelled Classic or Terminal (none in src/ui today): open it, measure it, come back. */
async function checkNamedViews(page, vp) {
  await step(page, vp, 'Classic/Terminal views', async () => {
    await gotoHash(page, '#/home')
    const pattern = /\b(classic|terminal)\b/i
    const controls = visible(page.getByRole('button', { name: pattern }).or(page.getByRole('tab', { name: pattern })).or(page.getByRole('link', { name: pattern })))
    const total = await controls.count()
    if (!total) {
      const covered = vp.mobile ? 'the phone layout is the only view at this width' : 'covered by the Phone view (classic device frame) and Glass box checks'
      return record(vp.label, 'Classic/Terminal view controls', 'SKIP', `no control labelled Classic or Terminal in this build; ${covered}`)
    }
    const labels = []
    for (let i = 0; i < total; i++) labels.push(short((await controls.nth(i).innerText().catch(() => '')) || (await controls.nth(i).getAttribute('aria-label')) || `control ${i + 1}`, 40))
    for (const label of labels) {
      await gotoHash(page, '#/home')
      const control = visible(page.getByRole('button', { name: label }).or(page.getByRole('tab', { name: label })).or(page.getByRole('link', { name: label }))).first()
      if (!(await control.count())) continue
      await click(vp, control)
      await settle(page, 500)
      await checkOverflow(page, vp, `${label} view`)
      await shot(page, vp, `${vp.label}-${slug(label)}-view.png`)
    }
    // leave the app the way the other checks expect it
    await page.evaluate((key) => localStorage.removeItem(key), VIEW_KEY).catch(() => undefined)
    await page.reload({ waitUntil: 'load' })
    await settle(page, 400)
  })
}

async function checkOfflineMode(page, vp, base) {
  return step(page, vp, 'offline engine', async () => {
    const health = await requestJson('GET', `${base}/api/health`)
    const aiOn = health.status === 200 && health.json?.ok === true
    await openChat(page)
    const line = await page.getByText(/on-device rules engine/i).count()
    const answered = await page.getByText(/answered on this device/i).count()
    const offline = !aiOn && (line > 0 || answered > 0)
    const detail = `health ${health.status === 200 ? JSON.stringify({ ok: health.json?.ok ?? null, reason: health.json?.reason ?? null }) : `status ${health.status}`}; chat shows ${line ? '"On-device rules engine"' : answered ? '"Answered on this device"' : 'no on-device label'}`
    if (offline) record(vp.label, 'Offline No-AI mode is active', 'PASS', detail)
    else record(vp.label, 'Offline No-AI mode is active', ARGS['allow-llm'] ? 'WARN' : 'FAIL', `${detail}. Disconnect the AI, or pass --allow-llm`)
    return offline
  })
}

/**
 * A see-through sticky top bar needs its backdrop blur, or the scrolled conversation reads through the title.
 * (A build that keeps only -webkit-backdrop-filter loses the blur in Chrome, on Android and in the desktop app.)
 * Reported as a warning: it is a legibility defect, not a broken flow.
 */
async function checkStickyHeaderBlur(page, vp) {
  await step(page, vp, 'sticky top bar blur', async () => {
    const found = await page.evaluate(() => {
      for (const header of document.querySelectorAll('header')) {
        const cs = getComputedStyle(header)
        if (cs.position !== 'sticky' || header.getClientRects().length === 0) continue
        const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(cs.backgroundColor)
        if (!alpha || Number(alpha[1]) >= 0.98 || Number(alpha[1]) === 0) continue
        const blur = cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none' ? cs.webkitBackdropFilter : null
        return { background: cs.backgroundColor, blur }
      }
      return null
    })
    if (!found) return record(vp.label, 'see-through sticky top bar keeps its backdrop blur', 'SKIP', 'no scrolled, see-through sticky header on screen')
    if (found.blur) record(vp.label, 'see-through sticky top bar keeps its backdrop blur', 'PASS', `${found.background}, ${found.blur}`)
    else record(vp.label, 'see-through sticky top bar keeps its backdrop blur', 'WARN', `background ${found.background} with backdrop-filter: none, so scrolled text shows through the bar (the built CSS has only -webkit-backdrop-filter)`)
  })
}

/** a) "what are my big spending": a grounded biggest-purchase answer from the on-device engine. */
async function flowBigSpending(page, vp) {
  const name = `chat a) "${PROMPT_BIG}" gives a grounded biggest-purchase answer`
  await step(page, vp, name, async () => {
    const message = await ask(page, vp, PROMPT_BIG)
    const reply = await describeReply(message)
    const stored = await storedReply(page, reply.id)
    await message.scrollIntoViewIfNeeded().catch(() => undefined)
    await shot(page, vp, `${vp.label}-big-spending.png`)

    const problems = []
    if (!isOffline(reply, stored) && !ARGS['allow-llm']) problems.push(`not answered by the on-device engine (${stored?.via ?? reply.engineLabel ?? 'no engine label'})`)
    if (UNKNOWN_TEXT_RE.test(reply.text)) problems.push('the unknown fallback answered')
    if (reply.clarifyGroups) problems.push('a clarify picker was shown instead of an answer')
    const hasMoney = MONEY_RE.test(reply.text)
    const namesBiggest = BIGGEST_RE.test(reply.text)
    const hasTxnCard = stored ? stored.cards.includes('transactions') : reply.listRows > 0
    if (!hasMoney) problems.push('no amount in the answer')
    if (!namesBiggest && !hasTxnCard) problems.push('neither a "biggest purchase" sentence nor a transactions card')
    const detail = `"${short(reply.text, 160)}"${stored ? ` | cards: ${stored.cards.join(', ') || 'none'} | ${stored.trace.find((t) => /^intent/.test(t)) ?? ''}` : ''}`
    if (problems.length) {
      record(vp.label, name, 'FAIL', `${problems.join('; ')} | ${detail}`)
      await failShot(page, vp, 'chat-a-big-spending')
    } else {
      record(vp.label, name, 'PASS', detail)
    }
    await checkOverflow(page, vp, 'Chat after the biggest-purchase answer')

    // the glass-box trace under the reply: the widest text in the chat
    const trace = message.getByRole('button', { name: /how bun got this/i })
    if (await trace.count()) {
      await click(vp, trace.first())
      await settle(page, 300)
      await checkOverflow(page, vp, 'Chat with the "How Bun got this" trace open')
      await shot(page, vp, `${vp.label}-trace.png`)
      await click(vp, trace.first()).catch(() => undefined)
    }
  })
}

/** b) nonsense: the clarify task picker shows, is tappable, and one option runs a working query. */
async function flowClarify(page, vp) {
  const name = `chat b) "${PROMPT_UNKNOWN}" shows a tappable clarify task picker`
  await step(page, vp, name, async () => {
    const message = await ask(page, vp, PROMPT_UNKNOWN)
    const reply = await describeReply(message)
    const stored = await storedReply(page, reply.id)
    await message.scrollIntoViewIfNeeded().catch(() => undefined)
    await shot(page, vp, `${vp.label}-clarify.png`)

    if (!isOffline(reply, stored) && !ARGS['allow-llm']) {
      record(vp.label, name, 'FAIL', `not answered by the on-device engine (${stored?.via ?? reply.engineLabel ?? 'no engine label'})`)
      return
    }
    const group = visible(message.locator(SEL.clarify)).first()
    if (!(await group.count())) {
      const chips = reply.suggestionChips.length ? `only suggestion chips (${reply.suggestionChips.join(' | ')})` : 'no options at all'
      record(vp.label, name, 'FAIL', `no clarify card in the reply: ${chips} | "${short(reply.text, 140)}"${stored ? ` | cards: ${stored.cards.join(', ') || 'none'}` : ''}`)
      await failShot(page, vp, 'chat-b-clarify')
      return
    }
    const options = group.getByRole('button')
    const count = await options.count()
    const enabled = []
    for (let i = 0; i < count; i++) if (await options.nth(i).isEnabled().catch(() => false)) enabled.push(i)
    if (enabled.length < 2) {
      record(vp.label, name, 'FAIL', `the clarify card has ${enabled.length} enabled option(s), expected at least 2 (${reply.clarifyOptions.join(' | ')})`)
      await failShot(page, vp, 'chat-b-clarify')
      return
    }
    const sizes = await options.evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().height)))
    const small = vp.mobile ? sizes.filter((h) => h < 40).length : 0
    record(vp.label, name, 'PASS', `${enabled.length} options: ${reply.clarifyOptions.join(' | ')}${stored ? ` | cards: ${stored.cards.join(', ')}` : ''}`)
    if (small) record(vp.label, 'clarify options are comfortable tap targets', 'WARN', `${small} option(s) under 40px tall (heights ${sizes.join(', ')}px)`)
    await checkOverflow(page, vp, 'Chat with the clarify card')

    const pickName = `chat b) tapping a clarify option submits a working query`
    const pick = options.nth(enabled[0])
    const label = short(await pick.innerText(), 80)
    const before = await page.evaluate(countVisibleInPage, SEL.bot)
    const messagesBefore = await page.evaluate(countVisibleInPage, SEL.anyMessage)
    log(vp.label, `chat: tap clarify option "${label}"`)
    await click(vp, pick)
    await waitForReply(page, before)
    const next = visible(page.locator(SEL.bot)).last()
    const nextReply = await describeReply(next)
    const nextStored = await storedReply(page, nextReply.id)
    const messagesAfter = await page.evaluate(countVisibleInPage, SEL.anyMessage)
    await next.scrollIntoViewIfNeeded().catch(() => undefined)
    await shot(page, vp, `${vp.label}-clarify-picked.png`)

    const problems = []
    if (messagesAfter < messagesBefore + 2) problems.push('the option did not post as a new chat message with a reply')
    if (!nextReply.text) problems.push('the reply is empty')
    if (UNKNOWN_TEXT_RE.test(nextReply.text)) problems.push('the option led back to the unknown fallback')
    if (nextReply.id === reply.id) problems.push('no new reply arrived')
    const stillOpen = await options.evaluateAll((buttons) => buttons.filter((b) => !b.disabled).length).catch(() => 0)
    if (problems.length) {
      record(vp.label, pickName, 'FAIL', `${problems.join('; ')} | option "${label}" | reply "${short(nextReply.text, 140)}"`)
      await failShot(page, vp, 'chat-b-clarify-picked')
    } else {
      record(vp.label, pickName, 'PASS', `"${label}" -> "${short(nextReply.text, 140)}"${nextStored ? ` | cards: ${nextStored.cards.join(', ') || 'none'}` : ''}`)
    }
    if (stillOpen) record(vp.label, 'answered clarify card becomes read-only', 'WARN', `${stillOpen} option(s) are still enabled after one was picked`)
    await checkOverflow(page, vp, 'Chat after a clarify option')
  })
}

/** c) Creator Mode: preview card with Apply (nothing applied first), Apply, then Undo or Reset. */
async function flowAppearance(page, vp, base, creator) {
  const name = 'chat c) the look request shows a preview card with Apply (not applied yet)'
  if (!creator.local) {
    record(vp.label, name, ARGS['require-creator'] ? 'FAIL' : 'SKIP', `Creator Mode is not available at ${base} (GET /api/plugins/state answered ${creator.status}): it needs the desktop app or server/local.ts`)
    return
  }
  if (!creator.enabled) {
    record(vp.label, name, ARGS['require-creator'] ? 'FAIL' : 'SKIP', 'Creator Mode is off on this server. Run without --url, or pass --enable-creator')
    return
  }

  await step(page, vp, 'Creator Mode control in Settings', async () => {
    await gotoHash(page, '#/settings')
    const toggle = page.getByRole('switch', { name: /creator mode/i })
    if (!(await toggle.count())) return record(vp.label, 'Creator Mode control is visible in Settings', 'WARN', 'no "Creator Mode" switch found in Settings')
    await toggle.first().scrollIntoViewIfNeeded().catch(() => undefined)
    const checked = await toggle.first().getAttribute('aria-checked')
    record(vp.label, 'Creator Mode control is visible in Settings', checked === 'true' ? 'PASS' : 'WARN', `switch aria-checked="${checked}"`)
    // the Shell appearance row with its Reset control (CreatorSection): present once Creator Mode is on
    const row = page.locator('[data-shell-appearance]')
    const resetControl = page.getByRole('button', { name: /reset shell appearance/i })
    if (await row.count()) {
      record(vp.label, 'Shell appearance row and Reset control are in Settings', (await resetControl.count()) ? 'PASS' : 'WARN', `row state "${await row.first().getAttribute('data-shell-appearance')}", reset button ${(await resetControl.count()) ? 'present' : 'missing'}`)
    } else {
      record(vp.label, 'Shell appearance row and Reset control are in Settings', 'WARN', 'no [data-shell-appearance] row in the Creator Mode section')
    }
    await shot(page, vp, `${vp.label}-creator-settings.png`)
  })

  await step(page, vp, name, async () => {
    await openChat(page)
    // start from FundBun's own look, whatever an earlier run left behind
    await page.evaluate((key) => localStorage.removeItem(key), SHELL_KEY)
    const dirty = await readLook(page)
    if (dirty.shellTheme || dirty.shellHat || dirty.shellName) {
      await page.reload({ waitUntil: 'load' })
      await settle(page, 400)
      await openChat(page)
    }
    const baseline = await readLook(page)

    const message = await ask(page, vp, PROMPT_LOOK)
    const reply = await describeReply(message)
    const stored = await storedReply(page, reply.id)
    const card = visible(message.locator(SEL.appearanceCard)).first()
    const scope = (await card.count()) ? card : message
    const apply = visible(scope.getByRole('button', { name: /^\s*apply\b/i })).first()
    await message.scrollIntoViewIfNeeded().catch(() => undefined)
    await shot(page, vp, `${vp.label}-appearance-preview.png`)

    if (!(await apply.count())) {
      const off = /creator mode is off/i.test(reply.text) ? ' (the reply says Creator Mode is off)' : ''
      record(vp.label, name, 'FAIL', `no Apply button in the reply${off} | "${short(reply.text, 160)}"${stored ? ` | cards: ${stored.cards.join(', ') || 'none'}` : ''}`)
      await failShot(page, vp, 'chat-c-preview')
      return
    }
    const before = await readLook(page)
    const early = lookIsDefault(before, baseline)
    const cardText = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const missing = [[/cyber\s?punk/i, 'the Cyberpunk theme'], [/kamen\s*rider/i, 'the Kamen Rider helmet'], [/#ilovemoney/i, `the name ${LOOK_NAME}`]].filter(([re]) => !re.test(cardText)).map(([, what]) => what)
    const hasUndoBefore = await visible(scope.getByRole('button', { name: /^\s*undo\b/i })).count()
    const problems = []
    if (early.length) problems.push(`the look was applied before Apply was pressed: ${early.join(', ')}`)
    if (missing.length) problems.push(`the card does not name ${missing.join(' or ')}`)
    if (!(await apply.isEnabled().catch(() => false))) problems.push(`Apply is disabled ("${short(cardText, 120)}")`)
    if (stored && !stored.cards.includes('plugin_action:appearance')) problems.push(`the stored card is ${stored.cards.join(', ') || 'missing'}, expected plugin_action:appearance`)
    if (problems.length) {
      record(vp.label, name, 'FAIL', problems.join('; '))
      await failShot(page, vp, 'chat-c-preview')
      if (early.length || !(await apply.isEnabled().catch(() => false))) return
    } else {
      record(vp.label, name, 'PASS', `Apply ${hasUndoBefore ? 'and Undo ' : ''}shown; page untouched (data-theme ${JSON.stringify(before.dataTheme)}, nothing stored) | ${short(cardText, 140)}`)
    }
    await checkOverflow(page, vp, 'Chat with the appearance preview card')

    // ── Apply ──
    const applyName = 'chat c) Apply sets the theme, the helmet and the wordmark'
    await click(vp, apply)
    await page
      .waitForFunction(() => document.documentElement.hasAttribute('data-shell-theme') || document.documentElement.getAttribute('data-theme') === 'cyberpunk', undefined, { timeout: TIMEOUT })
      .catch(() => undefined)
    await settle(page, 500)
    let applied = await readLook(page)
    await shot(page, vp, `${vp.label}-appearance-applied.png`)

    const applyProblems = []
    const themed = applied.shellTheme === LOOK_THEME || applied.dataTheme === LOOK_THEME
    if (!themed) applyProblems.push(`<html> is not on the cyberpunk theme (data-theme=${JSON.stringify(applied.dataTheme)}, data-shell-theme=${JSON.stringify(applied.shellTheme)})`)
    if (!applied.dataTheme) applyProblems.push('<html data-theme> was not set')
    if (applied.accent === baseline.accent) applyProblems.push(`the accent colour did not change (${applied.accent})`)
    if (applied.shellHat && applied.shellHat !== LOOK_HAT) applyProblems.push(`data-shell-hat="${applied.shellHat}"`)
    if (!applied.helmets) applyProblems.push(`no Kamen Rider helmet drawn inside a mascot <svg> (data-shell-hat=${JSON.stringify(applied.shellHat)}, ${applied.mascots} mascot svg on screen)`)
    if (!applied.title.includes(LOOK_NAME)) applyProblems.push(`the window title is "${applied.title}"`)
    if (!applied.stored || !applied.stored.includes(LOOK_NAME)) applyProblems.push(`${SHELL_KEY} was not saved with the name`)

    // the wordmark: in the sidebar on the desk layout, in Home's top bar on a phone
    let wordmark = applied.logoNames.includes(LOOK_NAME)
    let leftChat = false
    if (!wordmark && !(await page.locator('[data-desk]').count())) {
      leftChat = true
      await gotoHash(page, '#/home')
      applied = await readLook(page)
      wordmark = applied.logoNames.includes(LOOK_NAME)
      if (!applied.helmets) applyProblems.push('no helmet on the Home mascot either')
      await shot(page, vp, `${vp.label}-appearance-applied-home.png`)
      await checkOverflow(page, vp, 'Home with the custom look applied')
    }
    const wordText = await visible(page.getByText(LOOK_NAME, { exact: false })).count()
    if (!wordmark) applyProblems.push(`no wordmark with data-app-name="${LOOK_NAME}" on screen (${wordText} visible text match(es), logo labels: ${applied.logoLabels.join(' | ') || 'none'})`)

    if (applyProblems.length) {
      record(vp.label, applyName, 'FAIL', applyProblems.join('; '))
      await failShot(page, vp, 'chat-c-applied')
    } else {
      record(vp.label, applyName, 'PASS', `data-theme="${applied.dataTheme}", data-shell-theme="${applied.shellTheme}", accent ${applied.accent}, ${applied.helmets} helmet(s), wordmark "${LOOK_NAME}", title "${applied.title}"`)
    }

    // ── Undo, else Reset ──
    const revertName = 'chat c) Undo or Reset puts FundBun\'s own look back'
    if (leftChat) await openChat(page)
    await checkOverflow(page, vp, 'Chat with the custom look applied')
    const liveMessage = visible(page.locator(SEL.bot)).last()
    const liveCard = visible(liveMessage.locator(SEL.appearanceCard)).first()
    const liveScope = (await liveCard.count()) ? liveCard : liveMessage
    let how = null
    const undo = visible(liveScope.getByRole('button', { name: /^\s*undo\b/i })).first()
    const reset = visible(liveScope.getByRole('button', { name: /\breset\b/i })).first()
    if ((await undo.count()) && (await undo.isEnabled().catch(() => false))) {
      await click(vp, undo)
      how = 'Undo on the card'
    } else if ((await reset.count()) && (await reset.isEnabled().catch(() => false))) {
      await click(vp, reset)
      how = 'Reset on the card'
    } else {
      // no button left on the card (for example after the screen was reopened): ask for the reset in chat
      const resetMessage = await ask(page, vp, 'Reset appearance')
      const resetApply = visible(resetMessage.getByRole('button', { name: /^\s*(apply|reset)\b/i })).first()
      if (await resetApply.count()) {
        await click(vp, resetApply)
        how = '"Reset appearance" in chat, then its Apply'
      }
    }
    if (!how) {
      // last resort: the one Reset control in Settings (Creator Mode section)
      await gotoHash(page, '#/settings')
      const settingsReset = visible(page.getByRole('button', { name: /reset shell appearance/i })).first()
      if ((await settingsReset.count()) && (await settingsReset.isEnabled().catch(() => false))) {
        await click(vp, settingsReset)
        how = '"Reset Shell Appearance" in Settings (the chat offered no Undo or Reset)'
      }
    }
    if (!how) {
      record(vp.label, revertName, 'FAIL', 'no Undo or Reset on the card, "Reset appearance" gave no card to apply, and Settings has no enabled reset')
      await failShot(page, vp, 'chat-c-revert')
    } else {
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-shell-theme'), undefined, { timeout: TIMEOUT }).catch(() => undefined)
      await settle(page, 500)
      const after = await readLook(page)
      const left = lookIsDefault(after, baseline)
      await shot(page, vp, `${vp.label}-appearance-reverted.png`)
      if (left.length) {
        record(vp.label, revertName, 'FAIL', `${how}, but ${left.join(', ')}`)
        await failShot(page, vp, 'chat-c-revert')
      } else {
        const note = leftChat && !/^Undo/.test(how) ? ' (Undo was no longer on the card after leaving and reopening the chat)' : ''
        record(vp.label, revertName, 'PASS', `${how}${note}: data-theme ${JSON.stringify(after.dataTheme)}, title "${after.title}", nothing stored`)
      }
      // when the first way back was not Undo (a phone leaves the chat to see the wordmark): Apply once more and
      // press Undo straight away, so Undo itself is exercised on every viewport
      if (!/^Undo/.test(how) && !left.length) {
        const undoName = 'chat c) Undo straight after Apply puts the look back'
        await openChat(page)
        const againCard = visible(page.locator(SEL.appearanceCard)).last()
        const againApply = visible(againCard.getByRole('button', { name: /^\s*apply\b/i })).first()
        if ((await againApply.count()) && (await againApply.isEnabled().catch(() => false))) {
          await click(vp, againApply)
          await page.waitForFunction(() => document.documentElement.hasAttribute('data-shell-theme'), undefined, { timeout: TIMEOUT }).catch(() => undefined)
          const againUndo = visible(againCard.getByRole('button', { name: /^\s*undo\b/i })).first()
          if (await againUndo.count()) {
            await click(vp, againUndo)
            await page.waitForFunction(() => !document.documentElement.hasAttribute('data-shell-theme'), undefined, { timeout: TIMEOUT }).catch(() => undefined)
            await settle(page, 400)
            const undone = lookIsDefault(await readLook(page), baseline)
            record(vp.label, undoName, undone.length ? 'FAIL' : 'PASS', undone.length ? undone.join(', ') : 'Apply, then Undo on the same card: back to the look before it')
            if (undone.length) await failShot(page, vp, 'chat-c-undo')
          } else {
            record(vp.label, undoName, 'FAIL', 'no Undo button on the card after Apply')
            await failShot(page, vp, 'chat-c-undo')
          }
        } else {
          record(vp.label, undoName, 'SKIP', 'the card offers no second Apply after the reset')
        }
      }
    }
    // never leave a custom look behind for the next check
    await page.evaluate((key) => localStorage.removeItem(key), SHELL_KEY).catch(() => undefined)
  })
}

// ───────────────────────────── one viewport ─────────────────────────────

async function runViewport(browser, vp, base, creator) {
  log(vp.label, `viewport ${vp.width}x${vp.height}${vp.mobile ? ' (touch)' : ''} at ${base}`)
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.scale,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    ...(vp.userAgent ? { userAgent: vp.userAgent } : {}),
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
  })
  context.setDefaultTimeout(TIMEOUT)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push({ kind: 'pageerror', text: String(err?.stack ?? err), at: page.url() }))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const where = msg.location()
    errors.push({ kind: 'console.error', text: msg.text(), at: where?.url ? `${where.url}:${where.lineNumber ?? 0}` : page.url() })
  })
  const failedRequests = []
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`)
  })
  page.on('requestfailed', (req) => {
    const reason = req.failure()?.errorText ?? ''
    if (!/ERR_ABORTED/.test(reason)) failedRequests.push(`failed ${req.method()} ${req.url()} ${reason}`)
  })

  try {
    const start = `${base.replace(/\/+$/, '')}/?demo=${encodeURIComponent(DEMO)}#/home`
    const opened = await step(page, vp, 'open the app', async () => {
      await page.goto(start, { waitUntil: 'load', timeout: Math.max(TIMEOUT, 30_000) })
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
      await page.waitForFunction(() => /^#\/home/.test(window.location.hash) && Boolean(document.querySelector('main, nav, [data-desk]')), undefined, { timeout: TIMEOUT })
      await settle(page, 500)
      const locked = await page.getByText(/enter your pin/i).count()
      if (locked) throw new Error('the app opened on the PIN lock screen')
      record(vp.label, 'app opens on Home with the demo persona', 'PASS', `${page.url()}`)
      return true
    })
    if (!opened) return

    await checkRoutes(page, vp)
    if (!vp.mobile) await checkDesktopViews(page, vp)
    await checkNamedViews(page, vp)

    await step(page, vp, 'open Chat', async () => {
      await openChat(page)
      await checkOverflow(page, vp, 'Chat')
      await shot(page, vp, `${vp.label}-chat.png`)
    })

    if (!ARGS['skip-flows']) {
      const offline = await checkOfflineMode(page, vp, base)
      if (offline || ARGS['allow-llm']) {
        await flowBigSpending(page, vp)
        await flowClarify(page, vp)
        // the conversation is long enough to scroll now
        await checkStickyHeaderBlur(page, vp)
      } else {
        record(vp.label, `chat a) "${PROMPT_BIG}" gives a grounded biggest-purchase answer`, 'SKIP', 'the on-device engine is not the one answering')
        record(vp.label, `chat b) "${PROMPT_UNKNOWN}" shows a tappable clarify task picker`, 'SKIP', 'the on-device engine is not the one answering')
      }
      await flowAppearance(page, vp, base, creator)
    }
  } finally {
    const counted = errors.filter((e) => !(ALLOW_CONSOLE && ALLOW_CONSOLE.test(e.text)))
    const pageErrors = counted.filter((e) => e.kind === 'pageerror')
    const consoleErrors = counted.filter((e) => e.kind === 'console.error')
    const describe = (list) => list.slice(0, 5).map((e) => `${short(e.text, 200)} (${short(e.at, 90)})`).join(' || ')
    record(vp.label, 'zero uncaught page errors', pageErrors.length ? 'FAIL' : 'PASS', pageErrors.length ? `${pageErrors.length}: ${describe(pageErrors)}` : '')
    const requests = failedRequests.length ? ` | requests: ${[...new Set(failedRequests)].slice(0, 5).join(' ; ')}` : ''
    record(vp.label, 'zero console errors', consoleErrors.length ? 'FAIL' : 'PASS', consoleErrors.length ? `${consoleErrors.length}: ${describe(consoleErrors)}${requests}` : '')
    if (errors.length !== counted.length) record(vp.label, 'console errors ignored by --allow-console', 'INFO', String(errors.length - counted.length))
    await context.close().catch(() => undefined)
  }
}

// ───────────────────────────── main ─────────────────────────────

async function launchBrowser() {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch (err) {
    throw new Error(`Playwright is not installed (run npm install): ${short(err?.message ?? err)}`)
  }
  // the repo's scripts use the system Chrome (no browser download); Playwright's own Chromium is the fallback
  const channels = ARGS.channel ? [ARGS.channel] : ['chrome', 'chromium']
  let last
  for (const channel of channels) {
    try {
      const browser = await chromium.launch({ headless: !ARGS.headed, ...(channel === 'chromium' ? {} : { channel }) })
      return { browser, channel }
    } catch (err) {
      last = err
    }
  }
  throw new Error(`could not start a browser (${channels.join(', ')}): ${short(last?.message ?? last, 300)}`)
}

function summarize() {
  const count = (status) => results.filter((r) => r.status === status).length
  console.log('')
  console.log('Summary by viewport')
  for (const label of [...new Set(results.map((r) => r.viewport))]) {
    const mine = results.filter((r) => r.viewport === label)
    const n = (status) => mine.filter((r) => r.status === status).length
    console.log(`  ${label.padEnd(14)} pass ${n('PASS')}  fail ${n('FAIL')}  warn ${n('WARN')}  skip ${n('SKIP')}`)
  }
  const failures = results.filter((r) => r.status === 'FAIL')
  if (failures.length) {
    console.log('')
    console.log('Failures')
    for (const f of failures) console.log(`  [${f.viewport}] ${f.name}: ${f.detail}`)
  }
  console.log('')
  console.log(`${count('PASS')} passed, ${count('FAIL')} failed, ${count('WARN')} warnings, ${count('SKIP')} skipped. Screenshots and report.json in ${OUT_DIR}`)
  return failures.length
}

async function main() {
  if (ARGS.help) {
    usage()
    return 0
  }
  const only = ARGS.only ? new Set(ARGS.only.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : null
  const viewports = only ? VIEWPORTS.filter((v) => only.has(v.id) || only.has(v.label)) : VIEWPORTS
  if (!viewports.length) {
    console.error(`--only matched no viewport: choose from ${VIEWPORTS.map((v) => v.id).join(', ')}`)
    return 2
  }
  mkdirSync(OUT_DIR, { recursive: true })

  let server = null
  let browser = null
  let creatorWasSwitchedOn = false
  let base = ''
  const cleanup = async () => {
    if (browser) await browser.close().catch(() => undefined)
    browser = null
    if (creatorWasSwitchedOn && base && !server) {
      // a server the user already had running: put Creator Mode back the way it was
      const ok = await setCreatorMode(base, false)
      console.log(`[setup] .... Creator Mode switched back off on ${base}${ok ? '' : ' (FAILED: switch it off in Settings)'}`)
    }
    creatorWasSwitchedOn = false
    if (server) await server.stop().catch(() => undefined)
    server = null
  }
  const onSignal = (signal) => {
    console.error(`\n[setup] ${signal}: stopping`)
    void cleanup().finally(() => process.exit(130))
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let fatal = null
  try {
    if (ARGS.url) {
      base = ARGS.url.replace(/\/+$/, '')
      console.log(`[setup] .... using ${base}`)
    } else {
      const distDir = resolve(ARGS.dist || join(ROOT, 'dist'))
      console.log(`[setup] .... starting server/local.ts with ${distDir} on an ephemeral port (no AI connection, throwaway FUNDBUN_HOME)`)
      server = await startLocalServer(distDir)
      base = server.url
      console.log(`[setup] .... local server ready at ${base}`)
    }

    let creator = await creatorState(base)
    console.log(`[setup] .... Creator Mode: ${creator.local ? (creator.enabled ? 'available, on' : 'available, off') : `not available (status ${creator.status})`}`)
    if (creator.local && !creator.enabled && (server || ARGS['enable-creator'])) {
      // the app's own switch asks for the PIN; the run uses the same local route the switch calls
      if (await setCreatorMode(base, true)) {
        creatorWasSwitchedOn = true
        creator = await creatorState(base)
        console.log(`[setup] .... Creator Mode switched on for this run (${creator.enabled ? 'on' : 'still off'})`)
      } else {
        console.log('[setup] .... could not switch Creator Mode on (POST /api/plugins/mode was refused)')
      }
    }

    const launched = await launchBrowser()
    browser = launched.browser
    console.log(`[setup] .... browser: ${launched.channel} ${browser.version()}`)

    for (const vp of viewports) {
      try {
        await runViewport(browser, vp, base, creator)
      } catch (err) {
        record(vp.label, 'viewport run', 'FAIL', short(err?.stack ?? err, 500))
      }
    }
  } catch (err) {
    fatal = err
  } finally {
    await cleanup()
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }

  if (fatal) {
    console.error(`[setup] FAIL ${short(fatal?.message ?? fatal, 800)}`)
    return 2
  }
  const failed = summarize()
  try {
    writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify({ base, when: new Date().toISOString(), viewports: viewports.map((v) => v.label), results }, null, 2)}\n`)
  } catch (err) {
    console.error(`[setup] could not write report.json: ${short(err?.message ?? err)}`)
  }
  return failed ? 1 : 0
}

process.exitCode = await main()
