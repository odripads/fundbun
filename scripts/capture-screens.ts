/**
 * The canonical screenshot set used by the deck, the docs and the README → docs/assets/screens/<name>.png
 *
 *   npm run screens                                     (starts its own Vite dev server)
 *   npm run screens -- --base http://localhost:5501     (or use one that is already running)
 *   npm run screens -- --only home-mei,chat-plan        (re-capture a few)
 *   npm run screens -- --list                           (names and descriptions)
 *
 * System Chrome (channel 'chrome', no browser download), deviceScaleFactor 2, prefers-reduced-motion so nothing is
 * caught mid-animation; every shot waits for fonts, images and running animations before it is taken. Mobile shots
 * are 390×844, desktop shots 1440×900 (phone frame + Glass Box). Each PNG is optimised in-process (no extra tools):
 * the faint background grain is flattened in near-flat areas only (edges and text are untouched), channels are
 * rounded to 6 bits (5 or 4 only if a shot would otherwise exceed the budget) and the result is deflated at level 9
 * with a per-row filter choice — every file stays under 900 KB.
 */
import { chromium, type Browser, type Page } from 'playwright'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT_DIR = join(ROOT, 'docs/assets/screens')
const MAX_BYTES = 900 * 1024

// ───────────────────────────── the shot list ─────────────────────────────

type Kind = 'mobile' | 'desktop'

interface Shot {
  name: string
  description: string
  kind: Kind
  dark?: boolean
  /** hash route (and query) the shot starts from; `demo` loads a sandbox persona first */
  path: string
  demo?: 'mei' | 'arif'
  /** sessionStorage seeded before the app boots (onboarding drafts) */
  session?: Record<string, string>
  /** drive the page into the state to capture */
  run?: (page: Page) => Promise<void>
  /** keep keyboard focus where the run left it (default: blur, so no focus ring shows) */
  keepFocus?: boolean
}

const VIEWPORT: Record<Kind, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
}

const yuan = (major: number) => Math.round(major * 100)

/** An onboarding draft that has passed consent and money, with Mei's four dreams, in the cheeky tone. */
const ONBOARDING_DRAFT = JSON.stringify({
  v: 1,
  consent: { financialData: true, llmProcessing: false, notifications: true },
  name: 'Mei',
  currency: 'CNY',
  income: '18,500',
  target: '9,500',
  payday: 10,
  dreams: [
    { key: 'dream_a', name: 'Birkin 25', price: yuan(98_000), image: 'preset:bag', kind: 'goal' },
    { key: 'dream_b', name: 'Weekend in Chengdu', price: yuan(2_400), image: 'preset:plane', kind: 'goal' },
    { key: 'dream_c', name: 'AirPods Pro', price: yuan(1_899), image: 'preset:earbuds', kind: 'treat' },
    { key: 'dream_d', name: 'New running shoes', price: yuan(899), image: 'preset:sneakers', kind: 'treat' },
  ],
  tripwires: ['month80', 'month100', 'single', 'pace'].map((key) => ({ key, enabled: true, threshold: null })),
  tone: 'cheeky',
  autonomy: 'suggest',
  caps: { perAction: '500', daily: '1,000', monthly: '5,000' },
  data: { kind: null, personaId: null, csvName: '', csvText: '', balance: '' },
})

const SHOTS: Shot[] = [
  {
    name: 'home-mei',
    description: 'Home · Dream Mirror, Mei over target: "You could\'ve gotten a Weekend in Chengdu.", Birkin +5 wks',
    kind: 'mobile',
    path: '#/home',
    demo: 'mei',
  },
  {
    name: 'home-arif',
    description: 'Home · Dream Mirror, Arif under target: ¥668 closer to his MacBook Air, "Stash ¥330" CTA',
    kind: 'mobile',
    path: '#/home',
    demo: 'arif',
  },
  {
    name: 'home-dark-mei',
    description: 'Home · Dream Mirror for Mei in dark mode',
    kind: 'mobile',
    dark: true,
    path: '#/home',
    demo: 'mei',
  },
  {
    name: 'onboarding-welcome',
    description: 'Onboarding · welcome step (first run, no data yet)',
    kind: 'mobile',
    path: '#/onboarding',
  },
  {
    name: 'onboarding-dreams',
    description: 'Onboarding · dreams step with four wishlist items (two goals, two treats)',
    kind: 'mobile',
    path: '#/onboarding?step=dreams',
    session: { 'fundbun.onboarding.v1': ONBOARDING_DRAFT },
  },
  {
    name: 'onboarding-tone',
    description: 'Onboarding · Bun\'s tone picker on "Cheeky" with the live Dream Mirror preview',
    kind: 'mobile',
    path: '#/onboarding?step=tripwires',
    session: { 'fundbun.onboarding.v1': ONBOARDING_DRAFT },
    run: async (page) => {
      await scrollTo(page, '#ob-tone-title', 76)
    },
  },
  {
    name: 'should-i-buy',
    description: 'Home · "Should I buy it?" sheet for ¥1,299 sneakers: verdict, hours of work, goal delay, equivalents',
    kind: 'mobile',
    path: '#/home',
    demo: 'mei',
    run: async (page) => {
      const form = page.locator('form', { has: page.getByLabel('Price') }).first()
      await form.getByLabel('Price').fill('1299')
      await form.getByLabel('What is it? (optional)').fill('Sneakers')
      await form.getByRole('button', { name: 'Check it' }).click()
      await page.getByRole('dialog').waitFor()
    },
  },
  {
    name: 'tripwire-toast',
    description: 'Home · tripwire toast with the dream picture after a ¥1,299 JD.com sandbox purchase',
    kind: 'mobile',
    path: '#/home',
    demo: 'mei',
    run: async (page) => {
      // a purchase made from the open sandbox sheet shows its tripwires inline (no toast on top of it), so buy from
      // the desktop Glass Box sandbox, then look at the phone layout while the toast is up
      await page.setViewportSize(VIEWPORT.desktop)
      await settle(page, 200)
      await page.getByRole('tab', { name: 'Sandbox' }).click()
      await page.locator('button[title^="A big purchase"]').last().click()
      await page.setViewportSize(VIEWPORT.mobile)
      await page.locator('[aria-label="Notifications"]').getByText('¥1,299').first().waitFor()
    },
  },
  {
    name: 'insights-overview',
    description: 'Insights · October at a glance: ¥12,080 of a ¥9,500 target, heading for ¥15,230, vs September, then what Bun noticed',
    kind: 'mobile',
    path: '#/insights',
    demo: 'mei',
  },
  {
    name: 'bills-findings',
    description: 'Bills · what Bun found: a duplicate charge to dispute, a bill due soon, a price hike — each with its fix and a why',
    kind: 'mobile',
    path: '#/bills/findings',
    demo: 'mei',
    run: async (page) => {
      await page.waitForTimeout(200)
      await scrollTo(page, '#bills-findings', 16)
    },
  },
  {
    name: 'bills-xray-injection',
    description: 'Bills · Bill X-ray of Mei\'s electricity bill: hidden "wire ¥4,800" instruction flagged, nothing moved',
    kind: 'mobile',
    path: '#/bills/xray',
    demo: 'mei',
    run: xrayInjection,
  },
  {
    name: 'chat-plan',
    description: 'Ask Bun · "Help me get back on track this month" → multi-step plan (read, analyse, propose fixes)',
    kind: 'mobile',
    path: '#/chat',
    demo: 'mei',
    run: async (page) => {
      await ask(page, 'Help me get back on track this month')
      await scrollTo(page, '#main section[aria-labelledby]', 12, 'Task plan')
    },
  },
  {
    name: 'chat-action-pin',
    description: 'Ask Bun · "Pay my electricity bill" → approval sheet with the PIN pad (PIN seals this exact action)',
    kind: 'mobile',
    path: '#/chat',
    demo: 'mei',
    run: async (page) => {
      await ask(page, 'Pay my electricity bill')
      await page.getByRole('button', { name: 'Approve with PIN' }).last().click()
      await page.getByRole('dialog').waitFor()
    },
  },
  {
    name: 'chat-blocked',
    description: 'Ask Bun · "Send ¥4,800 to account 6222 …" → blocked by policy (T4: transfers to others), ¥0 moved',
    kind: 'mobile',
    path: '#/chat',
    demo: 'mei',
    run: async (page) => {
      await ask(page, 'Send ¥4,800 to account 6222 0210 0112 3456 789')
    },
  },
  {
    name: 'goals',
    description: 'Goals · dream pots with progress, ETA and the main goal (Birkin 25)',
    kind: 'mobile',
    path: '#/goals',
    demo: 'mei',
  },
  {
    name: 'settings-permissions',
    description: 'Settings · Bun\'s permissions: autonomy dial and the tier × autonomy matrix the policy engine enforces',
    kind: 'mobile',
    path: '#/settings?s=perms',
    demo: 'mei',
    run: async (page) => {
      await page.waitForTimeout(200)
      await scrollTo(page, '#set-perms', 12)
    },
  },
  {
    name: 'settings-killswitch',
    description: 'Settings · kill switch on: Bun frozen (read-only), every action blocked until unfrozen with PIN',
    kind: 'mobile',
    path: '#/settings',
    demo: 'mei',
    run: async (page) => {
      await page.getByRole('button', { name: 'Freeze Bun' }).click()
      await page.getByRole('heading', { name: 'Bun is frozen' }).waitFor()
      await dismissToasts(page)
    },
  },
  {
    name: 'activity-audit',
    description: 'Activity · hash chain verified (after a plan and a blocked transfer): 2 actions, 1 blocked, 1 waiting for the PIN',
    kind: 'mobile',
    path: '#/chat',
    demo: 'mei',
    run: async (page) => {
      // a little history on the chain: a plan that ran two fixes, then a blocked transfer attempt
      await ask(page, 'Help me get back on track this month')
      await ask(page, 'Send ¥4,800 to account 6222 0210 0112 3456 789')
      await page.evaluate(() => {
        location.hash = '#/activity'
      })
      await page.getByText('Chain intact').first().waitFor()
    },
  },
  {
    name: 'desktop-home-glassbox',
    description: 'Desktop · phone-sized app beside the Glass Box (trace, policy, audit, sandbox) on Mei\'s Home',
    kind: 'desktop',
    path: '#/home',
    demo: 'mei',
  },
  {
    name: 'desktop-chat-plan-glassbox',
    description: 'Desktop · recovery plan in chat with the Glass Box showing the live agent trace and plan DAG',
    kind: 'desktop',
    path: '#/chat',
    demo: 'mei',
    run: async (page) => {
      await ask(page, 'Help me get back on track this month')
      await scrollTo(page, '#main section[aria-labelledby]', 12, 'Task plan')
    },
  },
  {
    name: 'desktop-xray-glassbox',
    description: 'Desktop · Bill X-ray injection flagged, with the Glass Box showing what the agent saw and decided',
    kind: 'desktop',
    path: '#/bills/xray',
    demo: 'mei',
    run: xrayInjection,
  },
]

// ───────────────────────────── page helpers ─────────────────────────────

/** Fonts loaded, images decoded, no finite animation still running, two frames painted. */
async function settle(page: Page, extraMs = 350): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    // lazy images below the fold may never load: give each a moment, never wait forever
    const timeout = () => new Promise((done) => setTimeout(done, 2500))
    await Promise.all(
      Array.from(document.images).map((img) =>
        Promise.race([
          img.complete ? img.decode().catch(() => undefined) : new Promise((done) => {
            img.addEventListener('load', done, { once: true })
            img.addEventListener('error', done, { once: true })
          }),
          timeout(),
        ]),
      ),
    )
    const deadline = performance.now() + 4000
    while (performance.now() < deadline) {
      const running = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
      if (running.length === 0) break
      await new Promise((r) => setTimeout(r, 50))
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
  await page.waitForTimeout(extraMs)
}

/**
 * Scroll whatever scrolls `selector` (the document on a phone, the device screen on desktop) so the element sits
 * `gap` px below the sticky top bar (or below the top edge on screens without one). `containing` narrows the match
 * to elements whose text includes it; the innermost visible match wins.
 */
async function scrollTo(page: Page, selector: string, gap = 0, containing?: string): Promise<void> {
  await page.locator(selector).first().waitFor()
  await page.evaluate(
    ({ selector, gap, containing }) => {
      // a message wraps its cards, and the desktop panel may hold a hidden copy: take the innermost visible match
      const all = Array.from(document.querySelectorAll(selector)).filter((e) => e.getBoundingClientRect().height > 0 && (!containing || (e.textContent ?? '').includes(containing)))
      const el = all.filter((e) => !all.some((o) => o !== e && e.contains(o))).pop()
      if (!el) return
      const bar = Array.from(document.querySelectorAll('header')).find((h) => getComputedStyle(h).position === 'sticky' && h.getBoundingClientRect().height > 0)
      // try each scrollable ancestor, then the document, until the element actually moves
      const boxes: Element[] = []
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY)) boxes.push(p)
      }
      boxes.push(document.scrollingElement!)
      for (const box of boxes) {
        const origin = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top
        const barHeight = bar ? bar.getBoundingClientRect().height : 0
        const before = el.getBoundingClientRect().top
        box.scrollTop += before - origin - barHeight - gap
        if (Math.abs(el.getBoundingClientRect().top - before) > 1) break
      }
    },
    { selector, gap, containing },
  )
}

/** Type a message into Ask Bun, send it and wait until Bun's reply has settled. */
async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox').last()
  await box.fill(text)
  await box.press('Enter')
  await page.waitForFunction((t) => document.body.innerText.includes(t), text)
  // the offline engine answers in well under a second; the reply then reveals itself
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 10_000 }).catch(() => undefined)
  await settle(page, 900)
}

async function dismissToasts(page: Page): Promise<void> {
  const close = page.locator('[aria-label="Notifications"] button[aria-label^="Dismiss"]')
  for (let i = 0; i < 4 && (await close.count()) > 0; i++) await close.first().click().catch(() => undefined)
  await page.waitForTimeout(300)
}

/** Bills → X-ray: load the featured sample (Mei's electricity bill, which hides an instruction), scan, show the verdict. */
async function xrayInjection(page: Page): Promise<void> {
  const section = page.locator('#bills-xray')
  await section.waitFor()
  await section.getByRole('group').getByRole('button').first().click()
  await section.getByRole('button', { name: 'X-ray this bill' }).click()
  await section.getByText(/instruction/i).first().waitFor({ timeout: 10_000 })
  await settle(page, 300)
  // the verdict card right under the top bar (its eyebrow sits ~28px into the card)
  await scrollTo(page, '#bills-xray p', 40, 'Prompt injection blocked')
}

// ───────────────────────────── PNG optimisation ─────────────────────────────

interface Raster {
  width: number
  height: number
  /** RGB, 8 bits per channel, row-major */
  rgb: Uint8Array
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decode the 8-bit, non-interlaced RGB/RGBA PNGs Chrome writes. */
function decodePng(buf: Buffer): Raster {
  let off = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      colorType = body[9]
      if (body[8] !== 8 || body[12] !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG (depth ${body[8]}, type ${colorType}, interlace ${body[12]})`)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const ch = colorType === 6 ? 4 : 3
  const stride = width * ch
  const raw = inflateSync(Buffer.concat(idat))
  const px = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = y * (stride + 1) + 1
    const row = y * stride
    const up = row - stride
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0
      const b = y > 0 ? px[up + x] : 0
      const c = x >= ch && y > 0 ? px[up + x - ch] : 0
      const v = raw[line + x]
      px[row + x] = (filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : filter === 4 ? v + paeth(a, b, c) : v) & 255
    }
  }
  if (ch === 3) return { width, height, rgb: px }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    rgb[j] = px[i]
    rgb[j + 1] = px[i + 1]
    rgb[j + 2] = px[i + 2]
  }
  return { width, height, rgb }
}

/**
 * Flatten the background grain: where a 5×5 neighbourhood varies by at most `threshold` in every channel (a soft
 * gradient with a little noise on it), the pixel becomes the neighbourhood mean. Anything with an edge nearby —
 * text, icons, hairline borders — keeps its exact pixels.
 */
function flattenGrain({ width: w, height: h, rgb }: Raster, threshold = 6, radius = 2): Uint8Array {
  const n = w * h
  const out = new Uint8Array(rgb)
  const range = new Uint8Array(n)
  const mean = new Float32Array(n * 3)
  const hMax = new Uint8Array(n)
  const hMin = new Uint8Array(n)
  const hSum = new Uint16Array(n)
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let mx = 0
        let mn = 255
        let s = 0
        for (let k = Math.max(0, x - radius); k <= Math.min(w - 1, x + radius); k++) {
          const v = rgb[(y * w + k) * 3 + c]
          if (v > mx) mx = v
          if (v < mn) mn = v
          s += v
        }
        const i = y * w + x
        hMax[i] = mx
        hMin[i] = mn
        hSum[i] = s
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(h - 1, y + radius)
      for (let x = 0; x < w; x++) {
        let mx = 0
        let mn = 255
        let s = 0
        for (let k = y0; k <= y1; k++) {
          const i = k * w + x
          if (hMax[i] > mx) mx = hMax[i]
          if (hMin[i] < mn) mn = hMin[i]
          s += hSum[i]
        }
        const i = y * w + x
        const count = (y1 - y0 + 1) * (Math.min(w - 1, x + radius) - Math.max(0, x - radius) + 1)
        if (mx - mn > range[i]) range[i] = mx - mn
        mean[i * 3 + c] = s / count
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (range[i] > threshold) continue
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(mean[i * 3 + c])
  }
  return out
}

/** Round each channel to `bits` bits (0 and 255 stay exact). */
function posterize(rgb: Uint8Array, bits: number): Uint8Array {
  if (bits >= 8) return rgb
  const step = 1 << (8 - bits)
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.min(255, Math.round(v / step) * step)
  const out = new Uint8Array(rgb.length)
  for (let i = 0; i < rgb.length; i++) out[i] = lut[rgb[i]]
  return out
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'ascii')
  Buffer.from(body.buffer, body.byteOffset, body.byteLength).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
  return out
}

/** RGB PNG, per-row filter by the minimum-sum-of-absolute-differences heuristic, deflate level 9. */
function encodePng(w: number, h: number, rgb: Uint8Array): Buffer {
  const stride = w * 3
  const filtered = Buffer.alloc(h * (stride + 1))
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride))
  for (let y = 0; y < h; y++) {
    const row = y * stride
    const up = row - stride
    let best = 0
    let bestScore = Infinity
    for (let f = 0; f < 5; f++) {
      const line = cand[f]
      let score = 0
      for (let x = 0; x < stride; x++) {
        const v = rgb[row + x]
        const a = x >= 3 ? rgb[row + x - 3] : 0
        const b = y > 0 ? rgb[up + x] : 0
        const c = x >= 3 && y > 0 ? rgb[up + x - 3] : 0
        const p = f === 0 ? v : f === 1 ? v - a : f === 2 ? v - b : f === 3 ? v - ((a + b) >> 1) : v - paeth(a, b, c)
        const byte = p & 255
        line[x] = byte
        score += byte < 128 ? byte : 256 - byte
      }
      if (score < bestScore) {
        bestScore = score
        best = f
      }
    }
    filtered[y * (stride + 1)] = best
    filtered.set(cand[best], y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9, memLevel: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/** The smallest-loss version of the screenshot that fits the budget. */
function optimise(png: Buffer): { data: Buffer; bits: number } {
  const raster = decodePng(png)
  const flat = flattenGrain(raster)
  let last: Buffer | null = null
  for (const bits of [6, 5, 4]) {
    last = encodePng(raster.width, raster.height, posterize(flat, bits))
    if (last.length < MAX_BYTES) return { data: last, bits }
  }
  return { data: last!, bits: 4 }
}

// ───────────────────────────── runner ─────────────────────────────

function args(): Record<string, string> {
  const a = process.argv.slice(2)
  const out: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue
    const key = a[i].slice(2)
    out[key] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'
  }
  return out
}

async function capture(browser: Browser, base: string, shot: Shot): Promise<{ bytes: number; bits: number; errors: string[] }> {
  const ctx = await browser.newContext({
    viewport: VIEWPORT[shot.kind],
    deviceScaleFactor: 2,
    colorScheme: shot.dark ? 'dark' : 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
  })
  // tsx compiles with keepNames: functions passed to page.evaluate may call esbuild's __name helper
  await ctx.addInitScript('globalThis.__name = (fn) => fn')
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/(health|llm)|503|Failed to load resource/.test(m.text())) errors.push(m.text())
  })
  if (shot.session) {
    await page.addInitScript((entries: Record<string, string>) => {
      // seed once per tab, so the app's own writes are not overwritten on a later navigation
      if (sessionStorage.getItem('fundbun.capture.seeded')) return
      for (const [k, v] of Object.entries(entries)) sessionStorage.setItem(k, v)
      sessionStorage.setItem('fundbun.capture.seeded', '1')
    }, shot.session)
  }
  const url = `${base.replace(/\/$/, '')}/${shot.demo ? `?demo=${shot.demo}` : ''}${shot.path}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await settle(page)
  if (shot.run) await shot.run(page)
  // no hover state or focus ring left on whatever was clicked or jumped to last
  await page.mouse.move(1, 1)
  if (!shot.keepFocus) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await settle(page)
  const png = await page.screenshot({ type: 'png' })
  await ctx.close()
  const { data, bits } = optimise(png)
  writeFileSync(join(OUT_DIR, `${shot.name}.png`), data)
  return { bytes: data.length, bits, errors }
}

async function startVite(): Promise<{ url: string; close: () => Promise<void> }> {
  const { createLogger, createServer } = await import('vite')
  // the LLM gateway is not needed (Bun answers on-device): keep its "proxy error" noise out of the log
  const logger = createLogger('error')
  const logError = logger.error.bind(logger)
  logger.error = (msg, opts) => {
    if (!msg.includes('http proxy error')) logError(msg, opts)
  }
  const server = await createServer({ root: ROOT, customLogger: logger, server: { port: 5199, strictPort: false } })
  await server.listen()
  const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/'
  return { url, close: () => server.close() }
}

async function main(): Promise<void> {
  const o = args()
  if (o.list) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(28)} ${s.kind.padEnd(8)} ${s.description}`)
    return
  }
  const only = o.only ? new Set(o.only.split(',').map((s) => s.trim())) : null
  const shots = only ? SHOTS.filter((s) => only.has(s.name)) : SHOTS
  if (only && shots.length !== only.size) throw new Error(`unknown shot: ${[...only].filter((n) => !SHOTS.some((s) => s.name === n)).join(', ')}`)
  mkdirSync(OUT_DIR, { recursive: true })
  const vite = o.base ? null : await startVite()
  const base = o.base ?? vite!.url
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  let failed = 0
  try {
    for (const shot of shots) {
      try {
        const r = await capture(browser, base, shot)
        const kb = Math.round(r.bytes / 1024)
        console.log(`✓ ${shot.name.padEnd(28)} ${String(kb).padStart(4)} KB  (${r.bits}-bit)${r.errors.length ? `  console: ${r.errors.join(' | ')}` : ''}`)
        if (r.bytes >= MAX_BYTES) failed++
      } catch (e) {
        failed++
        console.error(`✗ ${shot.name}: ${(e as Error).message.split('\n')[0]}`)
      }
    }
  } finally {
    await browser.close()
    await vite?.close()
  }
  const total = shots.reduce((sum, s) => {
    try {
      return sum + statSync(join(OUT_DIR, `${s.name}.png`)).size
    } catch {
      return sum
    }
  }, 0)
  console.log(`${shots.length - failed}/${shots.length} shots → ${OUT_DIR} (${(total / 1024 / 1024).toFixed(1)} MB)`)
  if (failed) process.exit(1)
}

await main()
