/**
 * Builds the FundBun pitch deck from deck/slides.html (+ deck.css, notes.json).
 *
 *   npm run deck                       → ../submission/InternationalAI-FundBun-Deck.{pdf,pptx}
 *   npx tsx deck/build.ts --out /tmp/x --png /tmp/fundbun-deck-png --only pdf|pptx|png
 *
 * 1. Serves the repo over a throw-away local HTTP server (fonts and images load by relative URL).
 * 2. System Chrome (Playwright, channel 'chrome') renders every <section class="slide"> to a 1920×1080 PNG at
 *    deviceScaleFactor 1.5 (2880×1620). The PNGs stay in a scratch folder.
 * 3. page.pdf() prints the same page as a vector PDF, one 1920×1080 px page per slide.
 * 4. pptxgenjs writes a 16:9 (LAYOUT_WIDE) PPTX: each slide = its PNG full-bleed, with the speaker notes and
 *    the slide title + key points as the image's alt text.
 * Layout checks run before export, twice: on the 1920×1080 canvas and again scaled to a 1280×720 projector
 * (the room's likely resolution). Anything poking outside its slide, clipped text, text too small to read at
 * 1280×720, or a font that failed to load stops the build. So does copy that breaks a house rule: an em dash,
 * "under target" or "under budget" for the good state, or a prize claim (the team is a finalist).
 * The final round deck is 14 slides; notes.json carries one entry per slide, in order.
 */
import { createServer, type Server } from 'node:http'
import { mkdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import PptxGenJS from 'pptxgenjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const outDir = resolve(arg('out', resolve(root, '../submission')))
const pngDir = resolve(arg('png', '/tmp/fundbun-deck-png'))
const only = arg('only', 'all') // all | png | pdf | pptx
const baseName = 'InternationalAI-FundBun-Deck'
const SCALE = 1.5

interface SlideNote {
  id: string
  title: string
  alt: string
  notes: string
}
const notesFile = JSON.parse(readFileSync(join(here, 'notes.json'), 'utf8')) as { talk: string; slides: SlideNote[] }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

function serve(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      const file = resolve(root, `.${path}`)
      if (file !== root && !file.startsWith(root + sep)) throw new Error('outside root')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    ok({ server, origin: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` })
  }))
}

/** iCloud-synced output folder: never rewrite in place. Remove, then write once. */
function freshPath(file: string): string {
  if (existsSync(file)) rmSync(file)
  return file
}

const kb = (file: string) => `${(statSync(file).size / 1024 / 1024).toFixed(2)} MB`

const { server, origin } = await serve()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`failed request: ${r.url()}`))
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`) })

  await page.goto(`${origin}/deck/slides.html`, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((img) => (img.complete ? img.decode().catch(() => {}) : new Promise((ok) => { img.onload = img.onerror = ok }))))
  })

  // ── layout checks ──────────────────────────────────────────────────────────
  /** Everything that pokes out of its slide, clips its text or runs into the footer, at the page's current zoom. */
  const layoutProblems = (zoom: number, label: string) =>
    page.evaluate(
      ({ zoom, label }) => {
        const out: string[] = []
        // getBoundingClientRect rounds differently once the page is zoomed: allow one more pixel there
        const pad = zoom === 1 ? 0.5 : 1
        const slides = [...document.querySelectorAll<HTMLElement>('section.slide')]
        slides.forEach((s, i) => {
          const box = s.getBoundingClientRect()
          for (const el of s.querySelectorAll<HTMLElement>('*')) {
            // an inline drawing (a Bun, a crack) is checked by its own box; what is drawn inside it is not
            const drawing = el.closest('svg')
            if ((drawing && drawing !== el) || el.closest('.glow, .peek, .sprite, .phone .sb') || el.matches('.crop img')) continue
            const r = el.getBoundingClientRect()
            if (!r.width || !r.height) continue
            // inside a mock-up screen, content is clipped by the screen on purpose (a card that peeks in)
            const outside = r.left < box.left - pad || r.right > box.right + pad || r.top < box.top - pad || r.bottom > box.bottom + pad
            if (outside && !el.closest('.mock .scr')) out.push(`${label} slide ${i + 1}: <${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}"> leaves the slide`)
            if (drawing) continue
            const cs = getComputedStyle(el)
            if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible' && !el.matches('.crop, .glass, .scr'))
              out.push(`${label} slide ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> clips its content horizontally`)
            // readable from the back of the room: slide text stays at 9px or more once projected (mock-up screens are pictures)
            const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0)
            if (ownText && !el.closest('.mock, .phone, svg, .dag, style, script') && parseFloat(cs.fontSize) * zoom < 9)
              out.push(`${label} slide ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> text is only ${(parseFloat(cs.fontSize) * zoom).toFixed(1)}px`)
          }
          // text blocks that run into the footer
          const foot = s.querySelector('.foot')?.getBoundingClientRect()
          if (foot) for (const el of s.querySelectorAll<HTMLElement>('p, h2, h3, .cap, .chips, .stats, .grid, .rows, .fit, .road, .card, .phone, .cmd, .note, .items, .mock, .call, .why, .loop, .ev'))
            if (!el.closest('.foot, .mock .scr') && el.getBoundingClientRect().bottom > foot.top - 8 * zoom) out.push(`${label} slide ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> runs into the footer`)
        })
        return out
      },
      { zoom, label },
    )

  const report = await page.evaluate(() => {
    const out: string[] = []
    const PRIZE = /\b(winner|winning team|champion|first prize|grand prize|1st place|first place|runner[- ]up|gold medal)\b/i
    const fonts = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.style}`)
    for (const need of ['Fraunces Variable normal', 'DM Sans Variable normal']) if (!fonts.includes(need)) out.push(`font not loaded: ${need}`)
    for (const img of document.images) if (!img.naturalWidth) out.push(`image failed: ${img.getAttribute('src')}`)
    const slides = [...document.querySelectorAll<HTMLElement>('section.slide')]
    // body copy budget: about 40 words a slide (headline, kicker, footer, mock-ups and diagrams excluded)
    const words = slides.map((s) => {
      const clone = s.cloneNode(true) as HTMLElement
      clone.querySelectorAll('style, .kicker, .title, .display, .foot, .phone, .phone-label, .crop, .dag, .zoom, .mirror, .lockup, .meta, .team, .ch, .step > b, .cap > b, .mock, .tag, .cap1').forEach((e) => e.remove())
      return (clone.textContent ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
    })
    // house rules for copy: no em dash on a slide, and the good state is never "under target" or "under budget"
    slides.forEach((s, i) => {
      const clone = s.cloneNode(true) as HTMLElement
      clone.querySelectorAll('style').forEach((e) => e.remove())
      const text = clone.textContent ?? ''
      if (text.includes(String.fromCharCode(0x2014))) out.push(`slide ${i + 1}: contains an em dash`)
      if (/\bunder\s+(target|budget)\b/i.test(text)) out.push(`slide ${i + 1}: says "under target" or "under budget"`)
      // the team is a finalist: no slide may claim a prize or a placing
      if (PRIZE.test(text)) out.push(`slide ${i + 1}: claims a prize or a placing`)
    })
    return { out, count: slides.length, titles: slides.map((s) => s.dataset.title ?? ''), words }
  })
  problems.push(...report.out)
  problems.push(...(await layoutProblems(1, '1920x1080')))
  // the same slides on a 1280×720 projector: the whole page zoomed to two thirds, checked again
  const PROJECTOR = { width: 1280, height: 720 }
  const projectorZoom = PROJECTOR.width / 1920
  await page.setViewportSize(PROJECTOR)
  const zoomStyle = await page.addStyleTag({ content: `html { zoom: ${projectorZoom}; }` })
  problems.push(...(await layoutProblems(projectorZoom, '1280x720')))
  await zoomStyle.evaluate((el) => el.remove())
  await page.setViewportSize({ width: 1920, height: 1080 })
  if (report.count !== notesFile.slides.length) problems.push(`slides.html has ${report.count} slides, notes.json ${notesFile.slides.length}`)
  notesFile.slides.forEach((n, i) => {
    if (n.id !== `s${String(i + 1).padStart(2, '0')}`) problems.push(`notes.json entry ${i + 1} has id ${n.id}`)
    const said = `${n.title} ${n.alt} ${n.notes}`
    if (said.includes(String.fromCharCode(0x2014))) problems.push(`notes.json ${n.id}: contains an em dash`)
    if (/\bunder\s+(target|budget)\b/i.test(said)) problems.push(`notes.json ${n.id}: says "under target" or "under budget"`)
    if (/\b(winner|winning team|champion|first prize|grand prize|1st place|first place|runner[- ]up|gold medal)\b/i.test(said)) problems.push(`notes.json ${n.id}: claims a prize or a placing`)
  })
  if (problems.length) {
    console.error(problems.map((p) => `  ✗ ${p}`).join('\n'))
    throw new Error(`${problems.length} layout/asset problem(s)`)
  }
  console.log(`✓ ${report.count} slides, fonts and images loaded, 0 overflows at 1920×1080 and 0 overflows at 1280×720`)
  console.log(`  body words per slide: ${report.words.map((w, i) => `${i + 1}:${w}`).join(' ')}`)

  // ── PNGs ───────────────────────────────────────────────────────────────────
  rmSync(pngDir, { recursive: true, force: true })
  mkdirSync(pngDir, { recursive: true })
  const pngs: string[] = []
  const sections = await page.$$('section.slide')
  for (const [i, s] of sections.entries()) {
    const file = join(pngDir, `slide-${String(i + 1).padStart(2, '0')}.png`)
    await s.screenshot({ path: file, animations: 'disabled' })
    pngs.push(file)
  }
  console.log(`✓ ${pngs.length} PNGs (${1920 * SCALE}×${1080 * SCALE}) → ${pngDir}`)
  if (only === 'png') process.exit(0)

  mkdirSync(outDir, { recursive: true })

  // ── PDF (vector) ───────────────────────────────────────────────────────────
  if (only === 'all' || only === 'pdf') {
    const pdf = freshPath(join(outDir, `${baseName}.pdf`))
    await page.emulateMedia({ media: 'print' })
    await page.pdf({ path: pdf, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    await page.emulateMedia({ media: 'screen' })
    console.log(`✓ PDF  ${pdf} (${kb(pdf)})`)
  }

  // ── PPTX ───────────────────────────────────────────────────────────────────
  if (only === 'all' || only === 'pptx') {
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_WIDE' // 13.333 × 7.5 in, 16:9
    pptx.title = 'Introducing FundBun.'
    pptx.subject = '2026 FinTechathon Finalist · International AI Track · Topic A Personal Finance Assistant · final round'
    pptx.author = 'Odri Prince Sembiring · Nadine Griselda'
    pptx.company = 'Team FundBun · Universitas Gadjah Mada · Universitas Airlangga'
    notesFile.slides.forEach((n, i) => {
      const slide = pptx.addSlide()
      slide.background = { color: i === 0 || i === notesFile.slides.length - 1 ? '24180F' : 'FFFAF2' }
      slide.addImage({ path: pngs[i], x: 0, y: 0, w: 13.333, h: 7.5, altText: `${n.title}. ${n.alt}` })
      slide.addNotes(n.notes)
    })
    const file = freshPath(join(outDir, `${baseName}.pptx`))
    await pptx.writeFile({ fileName: file, compression: true })
    console.log(`✓ PPTX ${file} (${kb(file)})`)
  }
} finally {
  await browser.close()
  server.close()
}
