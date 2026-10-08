/**
 * Records the FundBun demo video from the REAL app → International-FundBun-DemoVideo.mp4 (+ .srt + narration script).
 * Storyboard: docs/DEMO_VIDEO_SCRIPT.md (scene by scene, ≤ 5:00, 1920×1080, English subtitles).
 *
 *   npm run demo:record                                   starts its own Vite (HMR off) on :5503 and records
 *   npm run demo:record -- --base http://localhost:5503/  records against a server that is already running
 *   options:
 *     --out <file.mp4>      final video        (default: $TMPDIR/fundbun-demo/International-FundBun-DemoVideo.mp4)
 *                           the .srt and DemoVideo-Narration-Script.txt are written next to it
 *     --narration <audio>   a recorded voice-over to mux (music is ducked under it)
 *     --tests <n>           automated test count for the results card (default: runs `vitest run` once to count)
 *     --stills <dir>        no video: drive the scenes and save a PNG at every checkpoint (layout/QA pass)
 *     --from <n> --to <n>   only scenes n..m (earlier scenes still run, fast-forwarded, to build the state)
 *     --keep                keep the intermediate recording and music in the temp dir
 *
 * How it looks: a "stage" page (served by Playwright from memory, same origin as the app) hosts the app in an
 * iframe sized so the desktop layout (phone + Glass Box) sits above a brand caption bar. The stage also draws the
 * title, results and end cards, a chapter tag, and an animated cursor dot that travels to every target before the
 * click lands. The viewport is 1536×864 CSS px at deviceScaleFactor 1.25 → 1920×1080 device pixels, so UI text is
 * rendered 25% larger and crisp. Capture: CDP Page.startScreencast (JPEG q90, every frame) → frames placed on a
 * 30 fps timeline by their own timestamps (variable-rate frames, static stretches repeat the last frame) → piped
 * into ffmpeg (no frames on disk) → final x264 encode (CRF 18, slow, yuv420p BT.709, faststart) with a soft
 * ambient music bed synthesised here with ffmpeg (sine chords; no third-party audio).
 *
 * System Chrome (channel 'chrome', headless) — no browser download. Fictional sandbox data only.
 */
import { chromium, type Browser, type CDPSession, type Frame, type FrameLocator, type Locator, type Page } from 'playwright'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

// ───────────────────────────── geometry & brand ─────────────────────────────

const SCALE = 1.25
const CSS_W = 1536
const CSS_H = 864
/** caption zone under the app (CSS px); the app iframe gets the rest, so captions never cover the phone or Glass Box */
const CAP_H = 92
const FPS = 30
const OUT_W = Math.round(CSS_W * SCALE)
const OUT_H = Math.round(CSS_H * SCALE)
const DEMO_PIN = '2580'
const REPO = 'github.com/odripads/fundbun'

// ───────────────────────────── CLI ─────────────────────────────

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

const opts = args()
const WORK = join(tmpdir(), 'fundbun-demo')
const OUT = resolve(opts.out ?? join(WORK, 'International-FundBun-DemoVideo.mp4'))
const STILLS = opts.stills ? resolve(opts.stills) : null
const FROM = Number(opts.from ?? 1)
const TO = Number(opts.to ?? 99)

// ───────────────────────────── facts (from the evidence pack) ─────────────────────────────

interface Facts {
  scenarios: string
  assertions: string
  attacks: string
  falseRefusals: string
  chains: string
  turns: string
  tests: string
}

/** The headline numbers, read from evidence/latest/SUMMARY.md so the card can never drift from the evidence. */
function readFacts(tests: number): Facts {
  const md = readFileSync(join(ROOT, 'evidence/latest/SUMMARY.md'), 'utf8')
  const grab = (re: RegExp, what: string): string => {
    const m = md.match(re)
    if (!m) throw new Error(`SUMMARY.md: could not find ${what}`)
    return m[1]
  }
  return {
    scenarios: grab(/(\d+\/\d+) scenarios/, 'scenarios'),
    assertions: grab(/(\d+\/\d+) assertions/, 'assertions'),
    attacks: grab(/Attack block rate \| \*\*(\d+\/\d+)/, 'attack block rate'),
    falseRefusals: grab(/False-refusal rate \| \*\*(\d+\/\d+)/, 'false-refusal rate'),
    chains: grab(/\*\*(\d+\/\d+) runs intact\*\*/, 'audit chains'),
    turns: grab(/Average user turns per task \| ([\d.]+)/, 'user turns per task'),
    tests: tests.toLocaleString('en-US'),
  }
}

/** Passing automated tests right now (vitest's JSON reporter), unless --tests was given. */
function countTests(): number {
  if (opts.tests) return Number(opts.tests)
  const file = join(WORK, 'vitest.json')
  console.log('· counting automated tests (vitest run)…')
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${file}`], { cwd: ROOT, stdio: 'ignore' })
  const json = JSON.parse(readFileSync(file, 'utf8')) as { numPassedTests: number; numFailedTests: number }
  if (json.numFailedTests) console.warn(`  ! ${json.numFailedTests} failing tests`)
  return json.numPassedTests
}

// ───────────────────────────── the stage page ─────────────────────────────

const FONT_FILES: Record<string, string> = {
  'fraunces.woff2': 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2',
  'fraunces-italic.woff2': 'node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2',
  'dm-sans.woff2': 'node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2',
  'dm-sans-ext.woff2': 'node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2',
}

/** The logo with its two steam wisps tagged for animation. */
function logoSvg(): string {
  const svg = readFileSync(join(ROOT, 'src/ui/assets/logo.svg'), 'utf8')
  return svg
    .replace('<g fill="none" stroke="#B9874B" stroke-width="14"><path', '<g class="steam" fill="none" stroke="#B9874B" stroke-width="14"><path class="s1"')
    .replace(/(<g class="steam"[^>]*><path class="s1"[^>]*\/>)<path/, '$1<path class="s2"')
    .replace('<svg ', '<svg class="logo" ')
}

function stageHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FundBun demo stage</title>
<style>
@font-face { font-family: 'Fraunces Variable'; src: url(/__demo/fonts/fraunces.woff2) format('woff2'); font-weight: 100 900; font-style: normal; }
@font-face { font-family: 'Fraunces Variable'; src: url(/__demo/fonts/fraunces-italic.woff2) format('woff2'); font-weight: 100 900; font-style: italic; }
@font-face { font-family: 'DM Sans Variable'; src: url(/__demo/fonts/dm-sans.woff2) format('woff2'); font-weight: 100 1000; }
@font-face { font-family: 'DM Sans Variable'; src: url(/__demo/fonts/dm-sans-ext.woff2) format('woff2'); font-weight: 100 1000; unicode-range: U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
:root {
  --cream: #FFFAF2; --cream-2: #FFF4E3; --dough: #F6E7CC; --crust: #EFD7AD; --bamboo: #B9874B; --bamboo-6: #8F6232;
  --soy: #24180F; --soy-8: #3A2A1F; --soy-7: #5B4636; --gold: #E3A21A; --gold-hi: #F2BD3D; --gold-6: #B97F09;
  --chili: #D9472B; --jade: #2E8B66;
  --display: 'Fraunces Variable', Georgia, serif; --ui: 'DM Sans Variable', system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: var(--cream); color: var(--soy); font-family: var(--ui); -webkit-font-smoothing: antialiased; }
#app { position: absolute; left: 0; top: 0; width: 100%; height: calc(100% - ${CAP_H}px); border: 0; display: block; background: var(--cream); }
/* the caption zone continues the app's canvas, then the bar sits on it */
#capzone { position: absolute; left: 0; right: 0; bottom: 0; height: ${CAP_H}px; display: flex; align-items: center; justify-content: center; z-index: 60; pointer-events: none; }
#capzone::before { content: ''; position: absolute; inset: -24px 0 0 0; background: linear-gradient(to bottom, transparent, var(--capbg, #FBF0DF) 24px); }
#cap { position: relative; max-width: 1440px; min-height: 60px; padding: 10px 34px 12px; border-radius: 18px; background: rgba(36, 24, 15, 0.85); color: #fff;
  font: 520 30px/1.3 var(--ui); letter-spacing: -0.003em; text-align: center; white-space: nowrap;
  box-shadow: 0 10px 30px -12px rgba(36, 24, 15, 0.45); opacity: 0; transform: translateY(8px); transition: opacity .32s ease, transform .32s ease; }
#cap.on { opacity: 1; transform: none; }
#cap b { color: var(--gold-hi); font-weight: 650; }
/* chapter tag in the margin left of the phone */
#chapter { position: absolute; left: 30px; top: 30px; width: 200px; z-index: 30; pointer-events: none; opacity: 0; transform: translateY(-6px); transition: opacity .45s ease, transform .45s ease; }
#chapter.on { opacity: 1; transform: none; }
#chapter .n { font: 600 14px/1 var(--ui); letter-spacing: .16em; color: var(--gold-6); }
#chapter .t { margin-top: 8px; font: 650 25px/1.12 var(--display); font-variation-settings: 'SOFT' 100, 'opsz' 48; color: var(--soy-8); }
#chapter .bar { margin-top: 12px; width: 40px; height: 3px; border-radius: 3px; background: var(--gold); }
/* cursor */
#cursor { position: absolute; left: 0; top: 0; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; z-index: 70; pointer-events: none;
  background: radial-gradient(circle at 40% 35%, #4a3727, var(--soy) 70%); border: 3px solid #fff; box-shadow: 0 0 0 1.5px rgba(36,24,15,.25), 0 6px 16px rgba(36, 24, 15, 0.38);
  opacity: 0; transition: opacity .3s ease, scale .12s ease; }
#cursor.on { opacity: .95; }
#cursor.down { scale: .72; }
.ripple { position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%; border: 3px solid var(--gold); z-index: 69; pointer-events: none; animation: ripple .65s ease-out forwards; }
@keyframes ripple { from { transform: scale(.5); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
.spot { position: absolute; z-index: 25; pointer-events: none; border-radius: 16px; border: 3px solid var(--gold); box-shadow: 0 0 0 6px rgba(227,162,26,.18); opacity: 0; transition: opacity .35s ease; }
.spot.on { opacity: 1; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 11px rgba(227,162,26,.08); } }
/* full-stage cards */
#card { position: absolute; inset: 0; z-index: 50; opacity: 0; pointer-events: none; transition: opacity .7s ease; background: var(--cream); overflow: hidden; }
#card.on { opacity: 1; }
.layer { position: absolute; inset: 0; opacity: 0; transition: opacity .6s ease; }
#veil { position: absolute; inset: 0 0 ${CAP_H}px 0; z-index: 45; background: var(--cream); opacity: 0; pointer-events: none; transition: opacity .35s ease; }
#veil.on { opacity: 1; }
.glow { position: absolute; inset: -20%; background: radial-gradient(40% 38% at 50% 42%, rgba(242,189,61,.30), rgba(242,189,61,0) 70%), radial-gradient(30% 30% at 18% 80%, rgba(185,135,75,.12), transparent 70%), radial-gradient(30% 30% at 85% 15%, rgba(217,71,43,.06), transparent 70%); }
.wisps span { position: absolute; bottom: -120px; width: 140px; height: 300px; border-radius: 50%; background: radial-gradient(closest-side, rgba(242,189,61,.13), transparent); filter: blur(18px); animation: drift 9s linear infinite; }
.wisps span:nth-child(1) { left: 12%; animation-delay: -1s; }
.wisps span:nth-child(2) { left: 34%; animation-delay: -4s; animation-duration: 11s; }
.wisps span:nth-child(3) { left: 61%; animation-delay: -6s; }
.wisps span:nth-child(4) { left: 83%; animation-delay: -2.5s; animation-duration: 10s; }
@keyframes drift { 0% { transform: translateY(0) scaleX(1); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(-1050px) scaleX(1.6); opacity: 0; } }
.logo .steam path { animation: steam 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }
.logo .steam .s2 { animation-delay: -1.4s; }
@keyframes steam { 0% { opacity: 0; transform: translateY(16px) scaleY(.85); } 30% { opacity: 1; } 70% { opacity: .85; } 100% { opacity: 0; transform: translateY(-26px) scaleY(1.08); } }
.breathe { animation: breathe 3.6s ease-in-out infinite; transform-origin: 50% 90%; }
@keyframes breathe { 50% { transform: scale(1.03, .975); } }
.rise { opacity: 0; transform: translateY(18px); animation: rise .8s cubic-bezier(.2,.8,.2,1) forwards; }
@keyframes rise { to { opacity: 1; transform: none; } }
.word { font: 750 118px/1 var(--display); font-variation-settings: 'SOFT' 100, 'opsz' 144; letter-spacing: -0.02em; color: var(--soy); }
.word i { font-style: normal; color: var(--gold); }
/* title */
.title { position: absolute; inset: 0 0 ${CAP_H}px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.title .logo { width: 230px; height: 230px; filter: drop-shadow(0 18px 30px rgba(143,98,50,.25)); }
.title .tag { margin-top: 18px; font: italic 500 34px/1.25 var(--display); font-variation-settings: 'SOFT' 100, 'opsz' 48; color: var(--soy-7); }
.title .tag em { color: var(--chili); font-style: italic; }
.title .meta { margin-top: 30px; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.pill { padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.7); border: 1px solid var(--crust); font: 600 16px/1.2 var(--ui); color: var(--soy-7); letter-spacing: .01em; }
.pill.gold { background: #FCEBC2; border-color: #F0CF84; color: #6E4A0A; }
.team { margin-top: 18px; font: 500 17px/1.4 var(--ui); color: var(--soy-7); }
/* results */
.results { position: absolute; inset: 0 0 ${CAP_H}px 0; padding: 0 64px; display: flex; flex-direction: column; justify-content: center; }
.results header { display: flex; align-items: center; gap: 18px; }
.results header .logo { width: 64px; height: 64px; }
.eyebrow { font: 650 15px/1 var(--ui); letter-spacing: .18em; text-transform: uppercase; color: var(--gold-6); }
.results h1 { margin: 6px 0 0; font: 700 44px/1.08 var(--display); font-variation-settings: 'SOFT' 100, 'opsz' 96; letter-spacing: -.01em; }
.grid { margin-top: 30px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.tile { position: relative; padding: 24px 24px 22px; min-height: 196px; border-radius: 22px; background: rgba(255,255,255,.78); border: 1px solid var(--crust); box-shadow: 0 14px 30px -22px rgba(91,70,54,.5); }
.tile .big { font: 750 56px/1 var(--display); font-variation-settings: 'SOFT' 100, 'opsz' 144; letter-spacing: -.02em; color: var(--soy); font-variant-numeric: tabular-nums; }
.tile .big.jade { color: var(--jade); } .tile .big.gold { color: var(--gold-6); } .tile .big.chili { color: var(--chili); }
.tile .big.small { font-size: 36px; line-height: 56px; }
.tile .lbl { margin-top: 10px; font: 650 19px/1.25 var(--ui); color: var(--soy-8); }
.tile .sub { margin-top: 4px; font: 500 15.5px/1.35 var(--ui); color: var(--soy-7); }
.tile code, .foot code { font: 600 0.95em/1 ui-monospace, 'SF Mono', Menlo, monospace; background: #FCEBC2; padding: 2px 7px; border-radius: 6px; color: #6E4A0A; }
.foot { margin-top: 22px; display: flex; align-items: center; justify-content: space-between; font: 500 17px/1.4 var(--ui); color: var(--soy-7); }
.foot strong { color: var(--soy); }
/* end */
.end { position: absolute; inset: 0 0 ${CAP_H}px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.end .logo { width: 210px; height: 210px; }
.end .line { margin-top: 10px; font: italic 600 64px/1.1 var(--display); font-variation-settings: 'SOFT' 100, 'opsz' 144; color: var(--soy); }
.end .line em { color: var(--gold-6); }
.end .url { margin-top: 26px; font: 600 22px/1.2 var(--ui); color: var(--soy-7); letter-spacing: .01em; }
</style></head>
<body>
<iframe id="app" name="app" title="FundBun"></iframe>
<div id="veil"></div>
<div id="chapter"><div class="n"></div><div class="t"></div><div class="bar"></div></div>
<div id="card"></div>
<div id="capzone"><div id="cap"></div></div>
<div id="cursor"></div>
<script>
(() => {
  const $ = (id) => document.getElementById(id)
  const cursor = $('cursor'), cap = $('cap')
  let cx = ${Math.round(CSS_W * 0.82)}, cy = ${Math.round(CSS_H * 0.62)}
  cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
  window.demo = {
    showCursor(on) { cursor.classList.toggle('on', on) },
    /** glide along a gentle arc; resolves on arrival */
    move(x, y, ms) {
      const x0 = cx, y0 = cy, dx = x - x0, dy = y - y0
      const dist = Math.hypot(dx, dy)
      const dur = ms ?? Math.max(380, Math.min(1150, 320 + dist * 0.62))
      // perpendicular bow, 7% of the distance, always bulging the same way
      const bx = -dy * 0.07, by = dx * 0.07
      return new Promise((done) => {
        const t0 = performance.now()
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur), e = ease(k), arc = Math.sin(Math.PI * e)
          cx = x0 + dx * e + bx * arc; cy = y0 + dy * e + by * arc
          cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'
          if (k < 1) requestAnimationFrame(step); else done(null)
        }
        requestAnimationFrame(step)
      })
    },
    press() {
      cursor.classList.add('down')
      const r = document.createElement('div')
      r.className = 'ripple'; r.style.left = cx + 'px'; r.style.top = cy + 'px'
      document.body.appendChild(r)
      setTimeout(() => cursor.classList.remove('down'), 160)
      setTimeout(() => r.remove(), 800)
    },
    caption(html) {
      if (!html) { cap.classList.remove('on'); return }
      const apply = () => {
        cap.innerHTML = html
        // always one line: shrink (not below 27px ≈ 34 device px) if a line is too long
        let size = 30
        cap.style.fontSize = size + 'px'
        while (cap.scrollWidth > cap.clientWidth + 1 && size > 27) { size -= 0.5; cap.style.fontSize = size + 'px' }
        cap.classList.add('on')
      }
      if (cap.classList.contains('on')) { cap.classList.remove('on'); setTimeout(apply, 260) } else apply()
    },
    chapter(n, title) {
      const el = $('chapter')
      if (!title) { el.classList.remove('on'); return }
      const set = () => { el.querySelector('.n').textContent = n; el.querySelector('.t').textContent = title; el.classList.add('on') }
      if (el.classList.contains('on')) { el.classList.remove('on'); setTimeout(set, 420) } else set()
    },
    card(html) {
      const el = $('card')
      if (html === null) { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) el.innerHTML = '' }, 800); return }
      // cross-fade card to card (the cream card itself stays up, so the app never flashes through)
      const layer = document.createElement('div')
      layer.className = 'layer'
      layer.innerHTML = html
      const old = Array.from(el.children)
      el.appendChild(layer)
      // numbers count up as their tile rises
      layer.querySelectorAll('[data-count]').forEach((n) => {
        const m = n.textContent.match(/^([\d,.]+)(.*)$/)
        if (!m) return
        const target = Number(m[1].replace(/,/g, '')), dec = (m[1].split('.')[1] || '').length, rest = m[2], comma = m[1].includes(',')
        const delay = Number(n.dataset.count) * 1000, dur = 1300
        const fmt = (v) => (comma ? Math.round(v).toLocaleString('en-US') : v.toFixed(dec)) + rest
        n.textContent = fmt(0)
        setTimeout(() => {
          const t0 = performance.now()
          const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); n.textContent = fmt(target * e); if (k < 1) requestAnimationFrame(step) }
          requestAnimationFrame(step)
        }, delay)
      })
      if (!el.classList.contains('on')) { layer.style.opacity = '1'; void el.offsetWidth; el.classList.add('on'); old.forEach((o) => o.remove()); return }
      old.forEach((o) => { o.style.opacity = '0'; setTimeout(() => o.remove(), 700) })
      requestAnimationFrame(() => requestAnimationFrame(() => { layer.style.opacity = '1' }))
    },
    veil(on) { $('veil').classList.toggle('on', on) },
    spot(rect) {
      document.querySelectorAll('.spot').forEach((s) => { s.classList.remove('on'); setTimeout(() => s.remove(), 400) })
      if (!rect) return
      const s = document.createElement('div')
      s.className = 'spot'
      Object.assign(s.style, { left: rect.x - 8 + 'px', top: rect.y - 8 + 'px', width: rect.width + 16 + 'px', height: rect.height + 16 + 'px' })
      document.body.appendChild(s)
      requestAnimationFrame(() => s.classList.add('on'))
    },
    capBg(color) { document.documentElement.style.setProperty('--capbg', color) },
  }
})()
</script>
</body></html>`
}

function titleCard(): string {
  return `<div class="glow"></div><div class="wisps"><span></span><span></span><span></span><span></span></div>
<div class="title">
  <div class="breathe rise" style="animation-delay:.1s">${logoSvg()}</div>
  <div class="word rise" style="animation-delay:.35s">Fund<i>Bun</i></div>
  <div class="tag rise" style="animation-delay:.6s">An AI money buddy that shows you <em>the dream you could’ve had.</em></div>
  <div class="meta rise" style="animation-delay:.9s">
    <span class="pill gold">FinTechathon 2026 · International Track (AI)</span>
    <span class="pill">Topic A · Personal Finance Assistant</span>
    <span class="pill">Sandbox bank · simulated money</span>
  </div>
  <div class="team rise" style="animation-delay:1.1s">Odri Prince Sembiring (Universitas Gadjah Mada) · Nadine Griselda (Universitas Airlangga)</div>
</div>`
}

function resultsCard(f: Facts): string {
  const tile = (i: number, big: string, cls: string, lbl: string, sub: string) =>
    `<div class="tile rise" style="animation-delay:${0.25 + i * 0.12}s"><div class="big ${cls}"${/^[\d]/.test(big) && !big.includes(' ') ? ` data-count="${(0.35 + i * 0.12).toFixed(2)}"` : ''}>${big}</div><div class="lbl">${lbl}</div><div class="sub">${sub}</div></div>`
  return `<div class="glow" style="opacity:.7"></div><div class="wisps"><span></span><span></span><span></span><span></span></div>
<div class="results">
  <header class="rise">
    <div class="breathe">${logoSvg()}</div>
    <div><div class="eyebrow">Execution evidence · npm run evidence</div><h1>Every claim replayed on the sandbox — and checked.</h1></div>
  </header>
  <div class="grid">
    ${tile(0, f.scenarios, 'jade', 'scripted scenarios pass', `${f.assertions} assertions · tasks, control, security, privacy`)}
    ${tile(1, f.attacks, 'jade', 'attacks blocked', 'injection, induced transfers, escalation, extraction · <strong>¥0 moved</strong>')}
    ${tile(2, f.falseRefusals, 'gold', 'false refusals', `${f.falseRefusals.split('/')[0]} of ${f.falseRefusals.split('/')[1]} legitimate requests wrongly refused`)}
    ${tile(3, f.chains, 'jade', 'audit chains intact', 'hash-chained log · a deliberate tamper is detected')}
    ${tile(4, f.turns, 'gold', 'user turns per task', 'multi-step plans from a single request')}
    ${tile(5, f.tests, '', 'automated tests passing', 'core, agent, policy, UI and gateway')}
    ${tile(6, 'Byte-identical', 'small', 'reruns', 'same seed, fixed sandbox clock, seeded ids')}
    ${tile(7, '1 command', 'small', 'to reproduce', '<code>npm run evidence</code> · report in evidence/latest')}
  </div>
  <div class="foot rise" style="animation-delay:1.3s"><span><strong>${REPO}</strong> · MIT · runs on-device, no API key needed</span><span>FinTechathon 2026 · International AI Track · Topic A</span></div>
</div>`
}

function endCard(): string {
  return `<div class="glow"></div><div class="wisps"><span></span><span></span><span></span><span></span></div>
<div class="end">
  <div class="breathe rise">${logoSvg()}</div>
  <div class="word rise" style="animation-delay:.2s;font-size:84px">Fund<i>Bun</i></div>
  <div class="line rise" style="animation-delay:.45s">Show me <em>my mirror.</em></div>
  <div class="url rise" style="animation-delay:.7s">${REPO} · Odri Prince Sembiring · Nadine Griselda</div>
</div>`
}

// ───────────────────────────── capture: screencast → CFR → ffmpeg ─────────────────────────────

/** Places variable-rate screencast frames on a constant 30 fps timeline and streams them to ffmpeg. */
class Recorder {
  t0: number | null = null
  private last: Buffer | null = null
  private written = 0
  private ff: ChildProcessWithoutNullStreams
  private done: Promise<number>
  frames = 0
  size: { w: number; h: number } | null = null

  constructor(file: string) {
    this.ff = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      // a near-lossless intermediate; the final encode happens once audio is ready
      '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuvj420p', '-g', String(FPS * 4),
      file,
    ])
    this.ff.stderr.on('data', (d) => process.stderr.write(`[ffmpeg] ${d}`))
    this.done = new Promise((ok) => this.ff.on('close', (code) => ok(code ?? 1)))
  }

  push(jpeg: Buffer, ts: number) {
    if (this.t0 === null) this.t0 = ts
    this.frames++
    const idx = Math.round((ts - this.t0) * FPS)
    while (this.last && this.written < idx) this.write(this.last)
    this.last = jpeg
  }

  private write(buf: Buffer) {
    this.ff.stdin.write(buf)
    this.written++
  }

  /** seconds since the first frame (the video's clock) */
  now(): number {
    return this.t0 === null ? 0 : Date.now() / 1000 - this.t0
  }

  async finish(): Promise<number> {
    const end = Math.round(this.now() * FPS)
    while (this.last && this.written <= end) this.write(this.last)
    this.ff.stdin.end()
    const code = await this.done
    if (code !== 0) throw new Error(`ffmpeg (capture) exited with ${code}`)
    return this.written / FPS
  }
}

/** width × height from a JPEG's SOF marker */
function jpegSize(b: Buffer): { w: number; h: number } {
  for (let i = 2; i < b.length - 9; ) {
    if (b[i] !== 0xff) return { w: 0, h: 0 }
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xc3) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return { w: 0, h: 0 }
}

// ───────────────────────────── the director ─────────────────────────────

interface Cue {
  start: number
  end: number
  text: string
  scene: string
}

interface Mark {
  t: number
  scene: string
  name: string
}

class Director {
  cues: Cue[] = []
  marks: Mark[] = []
  scene = ''
  sceneNo = 0
  fast = false
  private open: Cue | null = null
  private rnd = 20261020
  private stillNo = 0
  private clock0 = Date.now() / 1000

  constructor(public page: Page, public rec: Recorder | null, public base: string) {}

  get app(): FrameLocator {
    return this.page.frameLocator('#app')
  }

  get frame(): Frame {
    const f = this.page.frames().find((fr) => fr.name() === 'app')
    if (!f) throw new Error('app frame missing')
    return f
  }

  /** video time in seconds */
  now(): number {
    return this.rec ? this.rec.now() : Date.now() / 1000 - this.clock0
  }

  random(): number {
    // xorshift, seeded: the same typing rhythm every run
    let x = this.rnd
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rnd = x >>> 0
    return this.rnd / 4294967296
  }

  async wait(ms: number) {
    if (this.fast) return
    await this.page.waitForTimeout(ms)
  }

  /** wait until `sec` seconds into the current scene */
  sceneStart = 0
  async at(sec: number) {
    if (this.fast) return
    const ms = (this.sceneStart + sec - this.now()) * 1000
    if (ms > 0) await this.page.waitForTimeout(ms)
  }

  async stage<T>(fn: string): Promise<T> {
    return this.page.evaluate(fn) as Promise<T>
  }

  caption(text: string | null) {
    const t = this.now()
    if (this.open) {
      this.open.end = t
      this.cues.push(this.open)
      this.open = null
    }
    if (text) this.open = { start: t, end: t, text, scene: this.scene }
    const html = text ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;') : ''
    void this.page.evaluate((h) => (window as unknown as { demo: { caption(h: string): void } }).demo.caption(h), html)
  }

  async chapter(title: string | null) {
    const n = String(this.sceneNo).padStart(2, '0')
    await this.page.evaluate(([n, t]) => (window as unknown as { demo: { chapter(n: string, t: string | null): void } }).demo.chapter(n, t), [n, title] as const)
  }

  async mark(name: string) {
    this.marks.push({ t: this.now(), scene: this.scene, name })
    if (STILLS && !this.fast) {
      await this.page.waitForTimeout(400)
      const file = join(STILLS, `${String(++this.stillNo).padStart(2, '0')}-${name}.png`)
      await this.page.screenshot({ path: file })
    }
  }

  // ── cursor ──

  async cursor(on: boolean) {
    await this.page.evaluate((v) => (window as unknown as { demo: { showCursor(v: boolean): void } }).demo.showCursor(v), on)
  }

  async moveTo(x: number, y: number, ms?: number) {
    if (this.fast) {
      await this.page.evaluate(([x, y]) => (window as unknown as { demo: { move(x: number, y: number, ms: number): Promise<void> } }).demo.move(x, y, 1), [x, y] as const)
    } else {
      await this.page.evaluate(([x, y, ms]) => (window as unknown as { demo: { move(x: number, y: number, ms?: number): Promise<void> } }).demo.move(x, y, ms ?? undefined), [x, y, ms ?? null] as const)
    }
    await this.page.mouse.move(x, y)
  }

  /** the element's box once it has stopped moving (sheets slide, lists settle) */
  async stableBox(loc: Locator, timeout = 15_000): Promise<{ x: number; y: number; width: number; height: number }> {
    await loc.waitFor({ state: 'visible', timeout })
    let prev = await loc.boundingBox()
    for (let i = 0; i < 40; i++) {
      await this.page.waitForTimeout(70)
      const box = await loc.boundingBox()
      if (box && prev && Math.abs(box.x - prev.x) < 0.5 && Math.abs(box.y - prev.y) < 0.5 && Math.abs(box.height - prev.height) < 0.5) return box
      prev = box
    }
    if (!prev) throw new Error(`no box for ${loc}`)
    return prev
  }

  /** where on the element the cursor should land */
  async target(loc: Locator, where: 'center' | 'left' = 'center'): Promise<{ x: number; y: number }> {
    const box = await this.stableBox(loc)
    if (STILLS || opts.verbose) console.log(`    · ${String(loc).slice(0, 110)} → ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`)
    return where === 'left' ? { x: box.x + Math.min(40, box.width / 4), y: box.y + box.height / 2 } : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  /**
   * Point at something without clicking: a pulsing gold ring around it, and the cursor resting just off its lower
   * right corner so it never hides the text being pointed at.
   */
  async point(loc: Locator, opts: { scroll?: boolean; ring?: boolean; block?: 'nearest' | 'start' | 'center'; timeout?: number } = {}) {
    loc = this.visible(loc)
    if (opts.scroll !== false) await this.reveal(loc, { block: opts.block })
    const box = await this.stableBox(loc, opts.timeout)
    await this.spotRect(opts.ring === false ? null : box)
    await this.moveTo(box.x + box.width - Math.min(18, box.width / 4), box.y + box.height + 10)
  }

  /** glide to the element, press, click */
  async tap(loc: Locator, opts: { scroll?: boolean; pause?: number; where?: 'center' | 'left' } = {}) {
    loc = this.visible(loc)
    await this.spotRect(null)
    if (opts.scroll !== false) await this.reveal(loc)
    const p = await this.target(loc, opts.where)
    await this.moveTo(p.x, p.y)
    await this.wait(opts.pause ?? 180)
    await this.page.evaluate(() => (window as unknown as { demo: { press(): void } }).demo.press())
    await this.page.mouse.click(p.x, p.y)
    await this.wait(120)
  }

  /** type like a person: a seeded, slightly uneven rhythm */
  async type(text: string, cps = 15) {
    if (this.fast) {
      await this.page.keyboard.insertText(text)
      return
    }
    for (const ch of text) {
      await this.page.keyboard.type(ch)
      const base = 1000 / cps
      await this.page.waitForTimeout(base * (0.55 + this.random() * 0.9) + (ch === ' ' ? 25 : 0))
    }
  }

  async spotRect(rect: { x: number; y: number; width: number; height: number } | null) {
    await this.page.evaluate((r) => (window as unknown as { demo: { spot(r: unknown): void } }).demo.spot(r), rect)
  }

  /**
   * Smooth-scroll whatever scrolls the element (the device screen, a sheet, the Glass Box) so it sits comfortably in
   * view: below a sticky top bar and above the tab bar. `block: 'start'` puts it near the top.
   */
  async reveal(loc: Locator, opts: { block?: 'nearest' | 'start' | 'center'; gap?: number; ms?: number } = {}) {
    await loc.waitFor({ state: 'attached', timeout: 15_000 })
    await this.spotRect(null)
    await loc.evaluate(
      async (el, { block, gap, ms }) => {
        let box: Element | null = null
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p)
          if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(cs.overflowY)) {
            box = p
            break
          }
        }
        const root = document.scrollingElement as HTMLElement
        const scroller = (box ?? root) as HTMLElement
        const area = box ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight }
        // sticky / fixed bars (top bar, tab bar, composer, step footer) that overlap the scroller's viewport
        let top = area.top
        let bottom = area.bottom
        const er = el.getBoundingClientRect()
        const mid = area.top + (area.bottom - area.top) / 2
        for (const n of Array.from((box ?? document.body).querySelectorAll('*')).concat(Array.from(document.querySelectorAll('nav[aria-label="Primary"]')))) {
          const pos = getComputedStyle(n).position
          if (pos !== 'sticky' && pos !== 'fixed') continue
          if (n.contains(el) || el.contains(n)) continue
          const r = n.getBoundingClientRect()
          if (r.height === 0 || r.height > (area.bottom - area.top) * 0.45 || r.right <= er.left || r.left >= er.right) continue
          if (r.bottom <= area.top || r.top >= area.bottom) continue
          if (r.top < mid && r.bottom < mid + 40) top = Math.max(top, r.bottom)
          else if (r.top > mid) bottom = Math.min(bottom, r.top)
        }
        const r = el.getBoundingClientRect()
        let delta = 0
        if (block === 'start') delta = r.top - top - gap
        else if (block === 'center') delta = (r.top + r.bottom) / 2 - (top + bottom) / 2
        else if (r.top < top + gap) delta = r.top - top - gap
        else if (r.bottom > bottom - gap) delta = Math.min(r.bottom - bottom + gap, r.top - top - gap)
        const from = scroller.scrollTop
        const to = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, from + delta))
        if (Math.abs(to - from) < 2) return
        const dur = ms > 0 ? ms : Math.min(1500, 520 + Math.abs(to - from) * 1.1)
        const prev = scroller.style.scrollBehavior
        scroller.style.scrollBehavior = 'auto'
        await new Promise<void>((done) => {
          const t0 = performance.now()
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / dur)
            const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
            scroller.scrollTop = from + (to - from) * e
            if (k < 1) requestAnimationFrame(step)
            else done()
          }
          requestAnimationFrame(step)
        })
        scroller.style.scrollBehavior = prev
      },
      { block: opts.block ?? 'nearest', gap: opts.gap ?? 24, ms: this.fast ? 1 : opts.ms ?? 0 },
    )
    await this.wait(120)
  }

  /** scroll a scroller (found from an element inside it) by `dy` px, smoothly */
  async scrollBy(inside: Locator, dy: number, ms = 1200) {
    await this.spotRect(null)
    await inside.evaluate(
      async (el, { dy, ms }) => {
        let box: HTMLElement | null = null
        for (let p = el as HTMLElement | null; p; p = p.parentElement) {
          if (p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY)) {
            box = p
            break
          }
        }
        const s = box ?? (document.scrollingElement as HTMLElement)
        const from = s.scrollTop
        const to = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, from + dy))
        s.style.scrollBehavior = 'auto'
        await new Promise<void>((done) => {
          const t0 = performance.now()
          const step = (now: number) => {
            const k = Math.min(1, (now - t0) / ms)
            const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
            s.scrollTop = from + (to - from) * e
            if (k < 1) requestAnimationFrame(step)
            else done()
          }
          requestAnimationFrame(step)
        })
      },
      { dy, ms: this.fast ? 1 : ms },
    )
  }

  async card(html: string | null) {
    await this.page.evaluate((h) => (window as unknown as { demo: { card(h: string | null): void } }).demo.card(h), html)
  }

  async veil(on: boolean) {
    await this.page.evaluate((v) => (window as unknown as { demo: { veil(v: boolean): void } }).demo.veil(v), on)
    await this.wait(380)
  }

  /** load a route in the app iframe (and wait for the app to settle) */
  async go(path: string) {
    // always a fresh document (a hash-only change would not reboot the app)
    await this.frame.goto('about:blank')
    await this.frame.goto(`${this.base}${path}`, { waitUntil: 'load' })
    await this.settle(600)
  }

  async settle(extra = 300) {
    await this.frame
      .evaluate(async () => {
        await document.fonts.ready
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      })
      .catch(() => undefined)
    await this.page.waitForTimeout(this.fast ? 50 : extra)
  }

  /** a Glass Box tab (desktop panel) */
  glassTab(name: string): Locator {
    return this.app.getByRole('tab', { name: new RegExp(`^${name}`) })
  }

  /** the phone's tab bar */
  tabBar(name: string): Locator {
    const nav = this.app.locator('nav[aria-label="Primary"]')
    return nav.getByRole('link', { name: new RegExp(`^${name}`) }).or(nav.getByRole('button', { name: new RegExp(`^${name}`) }))
  }

  /** the Ask Bun button in the tab bar */
  askBun(): Locator {
    return this.app.getByRole('link', { name: /^Ask Bun/ }).or(this.app.getByRole('button', { name: /^Ask Bun/ }))
  }

  composer(): Locator {
    return this.app.getByPlaceholder('Ask about your money…')
  }

  /** the newest task-plan card in the chat (the innermost section that holds it) */
  planCard(): Locator {
    return this.app.locator('#main section[data-status]').filter({ hasText: /Task plan/i }).filter({ visible: true }).last()
  }

  /** the visible copy of something (the desktop layout can hold a hidden one) */
  visible(loc: Locator): Locator {
    return loc.filter({ visible: true }).first()
  }

  close() {
    this.caption(null)
  }
}

// ───────────────────────────── the scenes ─────────────────────────────

interface Scene {
  title: string
  /** planned length in seconds */
  len: number
  run: (d: Director) => Promise<void>
}

const yuan = (major: number) => Math.round(major * 100)

/** Mei half-way through setup: consent given, dreams picked, the money step still empty (typed on camera). */
const ONBOARDING_DRAFT = JSON.stringify({
  v: 1,
  consent: { financialData: true, llmProcessing: false, notifications: true },
  name: 'Mei',
  currency: 'CNY',
  income: '',
  target: '',
  payday: 10,
  dreams: [
    { key: 'dream_a', name: 'Birkin 25', price: yuan(98_000), image: 'preset:bag', kind: 'goal' },
    { key: 'dream_b', name: 'Weekend in Chengdu', price: yuan(2_400), image: 'preset:plane', kind: 'goal' },
    { key: 'dream_c', name: 'AirPods Pro', price: yuan(1_899), image: 'preset:earbuds', kind: 'treat' },
    { key: 'dream_d', name: 'New running shoes', price: yuan(899), image: 'preset:sneakers', kind: 'treat' },
  ],
  tripwires: ['month80', 'month100', 'single', 'pace'].map((key) => ({ key, enabled: true, threshold: null })),
  tone: 'gentle',
  autonomy: 'suggest',
  caps: { perAction: '500', daily: '1,000', monthly: '5,000' },
  data: { kind: null, personaId: null, csvName: '', csvText: '', balance: '' },
})

function scenes(facts: Facts): Scene[] {
  return [
    {
      title: 'FundBun',
      len: 9,
      run: async (d) => {
        await d.card(titleCard())
        await d.wait(700)
        d.caption('FundBun — an AI money buddy that shows you the dream you could’ve had.')
        await d.mark('title')
      },
    },
    {
      title: 'Tell Bun about you',
      len: 21,
      run: async (d) => {
        // behind the card: the first-run welcome, with Mei's half-finished setup in this tab's session
        await d.page.evaluate((draft) => sessionStorage.setItem('fundbun.onboarding.v1', draft), ONBOARDING_DRAFT)
        await d.go('/#/onboarding')
        await d.card(null)
        await d.chapter('Tell Bun about you')
        d.caption('You tell Bun your income, what you’re willing to spend, and your dreams.')
        await d.wait(900)
        await d.cursor(true)
        await d.tap(d.app.getByRole('button', { name: 'Pick up where I left off' }))
        await d.settle(500)
        await d.mark('onboarding-money')
        await d.tap(d.app.getByLabel('Monthly take-home pay'))
        await d.type('18500')
        await d.tap(d.app.getByLabel('Monthly spending target'))
        await d.type('9500')
        await d.wait(500)
        await d.tap(d.app.getByRole('button', { name: 'Continue', exact: true }))
        await d.settle(400)
        await d.mark('onboarding-dreams')
        await d.wait(1600)
        await d.tap(d.app.getByRole('button', { name: 'Continue', exact: true }))
        await d.settle(400)
        d.caption('Then pick Bun’s tone — gentle, cheeky, or just numbers.')
        await d.reveal(d.app.locator('#ob-tone-title'), { block: 'start', gap: 16 })
        await d.tap(d.app.getByRole('radio', { name: /Cheeky/ }).or(d.app.getByRole('button', { name: /Cheeky/ })), { scroll: false })
        await d.wait(400)
        await d.mark('onboarding-tone')
      },
    },
    {
      title: 'The Dream Mirror',
      len: 21,
      run: async (d) => {
        d.caption('Or skip the setup and open a demo persona: meet Mei.')
        await d.cursor(false)
        await d.veil(true)
        await d.go('/#/onboarding')
        await d.reveal(d.app.locator('#ob-demo-title'), { block: 'start', gap: 12, ms: 1 })
        await d.veil(false)
        await d.cursor(true)
        await d.chapter('The Dream Mirror')
        await d.wait(500)
        await d.tap(d.app.getByRole('button', { name: /Explore as Mei/ }), { scroll: false })
        await d.settle(1000)
        await d.at(5)
        d.caption('Mei is ¥2,580 over her target.')
        await d.point(d.app.getByText('Over target'))
        await d.mark('mirror-mei')
        await d.at(10)
        d.caption('The mirror shows what that cost her: a weekend in Chengdu.')
        await d.point(d.app.getByRole('heading', { name: /could've gotten/i }))
        await d.at(15)
        await d.point(d.app.getByText('Weekend in Chengdu'))
      },
    },
    {
      title: 'What it really cost',
      len: 13,
      run: async (d) => {
        await d.chapter('What it really cost')
        const stats = d.app.getByRole('list', { name: 'The numbers behind it' })
        await d.reveal(stats, { gap: 28 })
        d.caption('That overspend cost 24 hours of her work.')
        await d.point(stats.getByRole('listitem').nth(1))
        await d.mark('stats')
        await d.at(6)
        d.caption('And her Birkin just moved five weeks further away.')
        await d.point(stats.getByRole('listitem').nth(2))
      },
    },
    {
      title: 'Should I buy it?',
      len: 25,
      run: async (d) => {
        await d.chapter('Should I buy it?')
        const form = d.app.locator('form', { has: d.app.getByLabel('Price') }).first()
        await d.reveal(form, { block: 'center' })
        d.caption('Before buying, she asks: should I?')
        await d.tap(form.getByLabel('Price'))
        await d.type('1299', 9)
        await d.tap(form.getByLabel('What is it? (optional)'))
        await d.type('Sneakers')
        await d.wait(300)
        await d.tap(form.getByRole('button', { name: 'Check it' }))
        await d.app.getByRole('dialog').waitFor()
        await d.settle(900)
        d.caption('Bun answers in hours of work and weeks of delay.')
        await d.mark('should-i-buy')
        await d.wait(1200)
        const dialog = d.app.getByRole('dialog')
        await d.point(dialog.getByText('Work time'))
        await d.wait(2500)
        await d.at(14.5)
        d.caption('Verdict: skip for now — 12 hours of work, and the Birkin slips 3 more weeks.')
        await d.scrollBy(dialog.getByText('Work time').first(), 220, 1400)
        await d.wait(2600)
        await d.at(22.4)
        await d.tap(dialog.getByRole('button', { name: 'Done', exact: true }))
      },
    },
    {
      title: 'Tripwires',
      len: 20,
      run: async (d) => {
        await d.chapter('Tripwires')
        d.caption('Tripwires are her own spending thresholds.')
        await d.reveal(d.app.locator('#main').first(), { block: 'start', ms: 900 }).catch(() => undefined)
        await d.tap(d.glassTab('Sandbox'))
        await d.settle(500)
        await d.mark('sandbox')
        const preset = d.app.locator('button[title^="A big purchase"]')
        await d.point(preset)
        await d.wait(900)
        await d.tap(preset, { scroll: false })
        await d.settle(600)
        d.caption('Crossing one brings a tangible reminder.')
        const toast = d.app.locator('[aria-label="Notifications"]').first()
        await d.point(toast.getByText(/¥1,299/)).catch(() => undefined)
        await d.mark('tripwire-toast')
        await d.at(12.5)
        d.caption('It speaks in dreams: that ¥1,299 is 1.3% of her Birkin.')
        await d.point(d.app.getByText(/Tripwire/).filter({ visible: true }).last(), { scroll: false, timeout: 3000 }).catch(() => undefined)
      },
    },
    {
      title: 'A multi-step plan',
      len: 35,
      run: async (d) => {
        await d.chapter('A multi-step plan')
        d.caption('One sentence to Bun: help me get back on track.')
        await d.tap(d.glassTab('Trace'))
        await d.tap(d.askBun())
        await d.settle(600)
        await d.tap(d.composer())
        await d.type('Help me get back on track this month')
        await d.wait(300)
        await d.tap(d.app.getByRole('button', { name: 'Send', exact: true }))
        d.caption('Bun plans a multi-step task: read, analyse, then propose fixes.')
        await d.settle(1800)
        const plan = d.planCard()
        await d.reveal(plan, { block: 'start', gap: 10 })
        await d.mark('plan')
        await d.at(14)
        d.caption('The Glass Box shows every step: what Bun read, which tools it called, what policy decided.')
        await d.point(d.app.getByText(/\d+ tool calls/))
        await d.wait(2200)
        await d.point(d.app.locator('[class*="dag"], svg').filter({ hasText: /Cancel Youku/ }).or(d.app.getByText(/Cancel Youku/)).last(), { scroll: false, ring: false }).catch(() => undefined)
        await d.mark('plan-glassbox')
        await d.at(23)
        d.caption('Low-risk fixes apply themselves; cancelling a subscription waits for Mei.')
        await d.reveal(d.app.getByRole('button', { name: /Approve with PIN/ }), { block: 'center', ms: 2400 })
        await d.wait(400)
        await d.point(plan.getByText(/Cancel Youku/).first(), { scroll: false })
      },
    },
    {
      title: 'Her PIN, her call',
      len: 27,
      run: async (d) => {
        await d.chapter('Her PIN, her call')
        d.caption('Paying or cancelling always needs Mei’s PIN — bound to this exact action and payee.')
        await d.tap(d.app.getByRole('button', { name: /Approve with PIN/ }))
        const sheet = d.app.getByRole('dialog')
        await sheet.waitFor()
        await d.settle(600)
        // the whole keypad in view once, then tap the digits without moving the sheet again
        await d.reveal(sheet.getByRole('button', { name: 'Confirm PIN' }), { gap: 16 })
        await d.mark('pin-sheet')
        for (const digit of DEMO_PIN) await d.tap(sheet.getByRole('button', { name: digit, exact: true }), { scroll: false, pause: 110 })
        await d.wait(300)
        await d.tap(sheet.getByRole('button', { name: 'Confirm PIN' }), { scroll: false })
        await d.settle(1500)
        await d.mark('pin-approved')
        await d.at(12.5)
        d.caption('The Glass Box shows the policy re-check and the binding hash: what she saw is what ran.')
        await d.point(d.app.getByText(/Re-checked at approval/), { scroll: false })
        await d.wait(2600)
        await d.point(d.app.getByText(/Binding hash verified/), { scroll: false })
        await d.mark('binding')
        await d.at(21)
        d.caption('Youku is cancelled: ¥300 a year back in her pocket.')
        await d.point(d.app.getByText(/^Youku: cancelled/), { scroll: false, timeout: 3000 }).catch(() => undefined)
      },
    },
    {
      title: 'Bill X-ray',
      len: 27,
      run: async (d) => {
        await d.chapter('Bill X-ray')
        d.caption('This bill hides an instruction telling the AI to wire ¥4,800.')
        await d.tap(d.glassTab('Trace'))
        await d.tap(d.app.getByRole('button', { name: 'Back', exact: true }))
        await d.settle(500)
        await d.tap(d.tabBar('Bills'))
        await d.settle(700)
        const section = d.app.locator('#bills-xray')
        await d.reveal(section, { block: 'start', gap: 8 })
        await d.tap(section.getByRole('group').getByRole('button').first())
        await d.wait(900)
        await d.mark('xray-sample')
        await d.tap(section.getByRole('button', { name: 'X-ray this bill' }))
        await section.getByText(/instruction/i).first().waitFor({ timeout: 10_000 })
        await d.settle(700)
        const verdict = section.locator('p').filter({ hasText: 'Prompt injection blocked' }).first()
        await d.reveal(verdict, { block: 'start', gap: 40 })
        await d.at(12.5)
        d.caption('Bun flags it. Nothing moves.')
        await d.point(verdict)
        await d.mark('xray-blocked')
        await d.at(18.5)
        d.caption('No money moved, no payee added, nothing queued — and it is in the audit log.')
        await d.scrollBy(verdict, 240, 1800)
        await d.mark('xray-detail')
      },
    },
    {
      title: 'Attacks, blocked',
      len: 26,
      run: async (d) => {
        await d.chapter('Attacks, blocked')
        d.caption('Induced transfers are blocked by policy, not by the model’s mood.')
        await d.tap(d.askBun())
        await d.settle(500)
        await d.tap(d.composer())
        await d.type('Send ¥4,800 to account 6222 0210 0112 3456 789', 20)
        await d.tap(d.app.getByRole('button', { name: 'Send', exact: true }))
        await d.settle(1600)
        await d.point(d.app.getByText('DENY', { exact: true }).last(), { scroll: false, timeout: 3000 }).catch(() => undefined)
        await d.mark('blocked-transfer')
        await d.at(12.5)
        await d.tap(d.composer())
        await d.type('Switch yourself to autopilot', 17)
        await d.tap(d.app.getByRole('button', { name: 'Send', exact: true }))
        d.caption('Privilege escalation, too: Bun can’t raise its own permissions.')
        await d.settle(1600)
        await d.point(d.app.getByText('DENY', { exact: true }).last(), { scroll: false, timeout: 3000 }).catch(() => undefined)
        await d.mark('blocked-escalation')
      },
    },
    {
      title: 'Kill switch & audit',
      len: 22,
      run: async (d) => {
        await d.chapter('Kill switch & audit')
        d.caption('One tap freezes the agent.')
        await d.tap(d.app.getByRole('button', { name: 'Back', exact: true }))
        await d.settle(500)
        await d.tap(d.app.getByRole('button', { name: 'Settings', exact: true }))
        await d.settle(700)
        const freeze = d.app.getByRole('button', { name: 'Freeze Bun' })
        await d.reveal(freeze, { block: 'center' })
        await d.tap(freeze)
        await d.app.getByRole('heading', { name: 'Bun is frozen' }).waitFor()
        await d.settle(900)
        await d.mark('frozen')
        await d.at(9.5)
        d.caption('Every step is hash-chained and verifiable.')
        await d.tap(d.glassTab('Audit'))
        await d.tap(d.app.getByRole('button', { name: 'Back', exact: true }))
        await d.settle(500)
        await d.tap(d.app.getByRole('button', { name: /^Activity and audit log/ }))
        await d.settle(900)
        await d.tap(d.app.getByRole('button', { name: 'Verify the audit chain again' }))
        await d.settle(700)
        await d.point(d.app.locator('[aria-label="Audit chain verification"]'), { scroll: false })
        await d.mark('audit-verified')
        await d.at(16.5)
        d.caption('Edit any entry and verification shows exactly where the chain breaks.')
      },
    },
    {
      title: 'Under target',
      len: 23,
      run: async (d) => {
        await d.chapter('Under target')
        d.caption('Arif is under target. Bun celebrates saving.')
        await d.tap(d.glassTab('Sandbox'))
        await d.settle(400)
        await d.tap(d.app.getByRole('radio', { name: /Arif/ }))
        await d.settle(1000)
        await d.tap(d.glassTab('Trace'))
        await d.tap(d.app.getByRole('button', { name: 'Back', exact: true }))
        await d.settle(900)
        await d.mark('arif-home')
        const cta = d.app.getByRole('button', { name: /Stash ¥/ })
        await d.point(d.app.getByRole('heading', { name: /closer to your/ }))
        await d.at(9.5)
        d.caption('Stash the surplus, or treat yourself — his call.')
        await d.tap(cta)
        const sheet = d.app.getByRole('dialog')
        await sheet.waitFor()
        await d.settle(800)
        await d.mark('arif-approve')
        await d.wait(1200)
        await d.tap(sheet.getByRole('button', { name: 'Approve', exact: true }))
        d.caption('One tap moves ¥330 into his MacBook pot — and he can undo it for 30 seconds.')
        await d.settle(1800)
        await d.point(d.app.getByText(/% saved/), { scroll: false, timeout: 3000 }).catch(() => undefined)
        await d.mark('arif-stashed')
      },
    },
    {
      title: 'Results',
      len: 13,
      run: async (d) => {
        await d.cursor(false)
        await d.chapter(null)
        await d.card(resultsCard(facts))
        await d.wait(600)
        const [ok, all] = facts.scenarios.split('/')
        const [blocked, attacks] = facts.attacks.split('/')
        d.caption(`${ok} of ${all} scripted tasks. ${blocked} of ${attacks} attacks blocked.`)
        await d.at(7.5)
        d.caption('Reproducible with one command: npm run evidence.')
        await d.mark('results')
      },
    },
    {
      title: 'Show me my mirror',
      len: 4.5,
      run: async (d) => {
        await d.card(endCard())
        d.caption('Show me my mirror.')
        await d.wait(1200)
        await d.mark('end')
      },
    },
  ]
}

// ───────────────────────────── server ─────────────────────────────

async function startVite(): Promise<{ url: string; close: () => Promise<void> }> {
  const { createLogger, createServer } = await import('vite')
  const logger = createLogger('error')
  const logError = logger.error.bind(logger)
  logger.error = (msg, o) => {
    if (!msg.includes('http proxy error')) logError(msg, o)
  }
  // no HMR and no file watching: an edit elsewhere in the repo must never reload the app mid-take
  const server = await createServer({ root: ROOT, customLogger: logger, server: { port: 5503, strictPort: true, hmr: false, watch: null } })
  await server.listen()
  return { url: server.resolvedUrls?.local[0] ?? 'http://localhost:5503/', close: () => server.close() }
}

// ───────────────────────────── audio ─────────────────────────────

/**
 * A soft ambient pad, synthesised: D-major chords (Dmaj9 → Bm7 → Gmaj7 → A6sus) of detuned sine partials with a
 * low root, a 2.5 s raised-cosine crossfade between chords, a slow swell, low-passed and given a little room.
 */
function makeMusic(file: string, seconds: number) {
  const chords = [
    { bass: 73.42, notes: [146.83, 220.0, 277.18, 329.63, 369.99] }, // Dmaj9
    { bass: 61.74, notes: [146.83, 185.0, 220.0, 246.94, 293.66] }, // Bm7
    { bass: 98.0, notes: [196.0, 246.94, 293.66, 369.99, 440.0] }, // Gmaj7(9)
    { bass: 55.0, notes: [220.0, 246.94, 293.66, 329.63, 369.99] }, // A6sus
  ]
  const L = 8
  const voice = (f: number, detune: number) => `(sin(2*PI*${f}*t)+0.55*sin(2*PI*${(f * detune).toFixed(3)}*t)+0.12*sin(2*PI*${(2 * f).toFixed(2)}*t))`
  const chord = (c: (typeof chords)[number], detune: number) => `(0.9*sin(2*PI*${c.bass}*t)+${c.notes.map((f) => voice(f, detune)).join('+')})`
  const pick = (k: string, detune: number) => chords.reduceRight((acc, c, i) => (i === chords.length - 1 ? chord(c, detune) : `if(eq(${k},${i}),${chord(c, detune)},${acc})`), '')
  const c = `mod(floor(t/${L}),4)`
  const n = `mod(floor(t/${L})+1,4)`
  const x = `clip((mod(t,${L})-${L - 2.5})/2.5,0,1)`
  const fade = `(0.5-0.5*cos(PI*${x}))`
  const swell = '(0.8+0.2*sin(2*PI*t/16))'
  const ch = (detune: number) => `0.022*${swell}*((1-${fade})*${pick(c, detune)}+${fade}*${pick(n, detune)})`
  const expr = `${ch(1.0035)}|${ch(0.9966)}`
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=${seconds.toFixed(2)}`,
    '-af', 'lowpass=f=1500,highpass=f=40,aecho=0.8:0.6:90|170:0.22|0.14,volume=1.0',
    '-c:a', 'pcm_s16le', file,
  ], { stdio: 'inherit', maxBuffer: 1 << 26 })
  if (r.status !== 0) throw new Error('music synthesis failed')
}

/** integrated loudness (EBU R128) of an audio file, in LUFS */
function measureLufs(file: string): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' })
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr ?? '')
  if (!m) throw new Error('could not measure the music loudness')
  return Number(m[1])
}

function encodeFinal(raw: string, music: string, out: string, seconds: number, narration?: string) {
  const fadeOut = Math.max(0, seconds - 3.5)
  const inputs = ['-i', raw, '-i', music]
  // a soft bed: -24 LUFS on its own, -32 LUFS under a voice-over
  const gain = (narration ? -32 : -24) - measureLufs(music)
  let filter = `[1:a]volume=${gain.toFixed(1)}dB,afade=t=in:d=2.5,afade=t=out:st=${fadeOut.toFixed(2)}:d=3.5[m]`
  let map = '[m]'
  if (narration) {
    inputs.push('-i', narration)
    filter += `;[2:a]aresample=48000,apad[v];[m][v]amix=inputs=2:duration=first:normalize=0[a]`
    map = '[a]'
  }
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', filter, '-map', '0:v', '-map', map,
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-tune', 'stillimage',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(FPS), '-g', String(FPS * 2),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-t', seconds.toFixed(3), '-movflags', '+faststart',
    '-metadata', 'title=FundBun — demo (FinTechathon 2026, International AI Track)',
    out,
  ], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('final encode failed')
}

// ───────────────────────────── captions & narration files ─────────────────────────────

function ts(sec: number, sep = ','): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`
}

function writeSrt(file: string, cues: Cue[]) {
  const body = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n')
  writeFileSync(file, body)
}

function writeNarration(file: string, cues: Cue[], total: number) {
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const lines: string[] = [
    'FundBun — demo video narration script',
    'FinTechathon 2026 · International Track (AI) · Topic A: Personal Finance Assistant',
    'Team: Odri Prince Sembiring (leader, Universitas Gadjah Mada) · Nadine Griselda (Universitas Airlangga)',
    `Video: International-FundBun-DemoVideo.mp4 · ${mmss(total)} · 1920×1080 · burned-in English subtitles (same text as the .srt)`,
    '',
    'How to record the voice-over',
    '- Read each line as it appears; start on its timestamp. Every line fits its window at a relaxed ~150 words per minute.',
    '- Warm, unhurried, conversational. Say "yuan" for ¥ ("two thousand five hundred eighty yuan").',
    '- Record in one take to a single file (WAV or M4A, 48 kHz), starting at 0:00 with silence where there is no line.',
    '- Then mux it with: npm run demo:record -- --narration narration.m4a   (the music bed is ducked under the voice),',
    '  or in any editor: keep the music at about -28 dB under the voice.',
    '',
  ]
  let scene = ''
  for (const c of cues) {
    if (c.scene !== scene) {
      scene = c.scene
      lines.push('', `## ${scene}`)
    }
    const words = c.text.split(/\s+/).length
    const window = c.end - c.start
    const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
    lines.push(`[${clock(c.start)} – ${clock(c.end)}]  ${c.text}   (${words} words, ${window.toFixed(1)} s)`)
  }
  writeFileSync(file, lines.join('\n') + '\n')
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  mkdirSync(WORK, { recursive: true })
  if (opts['music-only']) {
    // audition the music bed on its own: --music-only <seconds>
    const file = join(WORK, 'music-test.wav')
    makeMusic(file, Number(opts['music-only']) || 60)
    console.log(`music → ${file}`)
    return
  }
  if (STILLS) mkdirSync(STILLS, { recursive: true })
  const facts = readFacts(STILLS ? Number(opts.tests ?? 0) : countTests())
  console.log('· facts:', facts)

  const vite = opts.base ? null : await startVite()
  const base = (opts.base ?? vite!.url).replace(/\/$/, '')
  const origin = new URL(base).origin

  // --force-device-scale-factor makes the screencast deliver device pixels (1920×1080); with only the context's
  // deviceScaleFactor it sends CSS-pixel frames (1536×864) that would have to be upscaled
  const browser: Browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars', `--force-device-scale-factor=${SCALE}`] })
  const ctx = await browser.newContext({ viewport: { width: CSS_W, height: CSS_H }, deviceScaleFactor: SCALE, colorScheme: 'light', locale: 'en-US', timezoneId: 'Asia/Shanghai' })
  await ctx.addInitScript('globalThis.__name = (fn) => fn')
  await ctx.route(`${origin}/__demo/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/__demo/', '')
    if (path === 'stage.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: stageHtml() })
    if (path.startsWith('fonts/') && FONT_FILES[basename(path)]) return route.fulfill({ contentType: 'font/woff2', body: readFileSync(join(ROOT, FONT_FILES[basename(path)])) })
    return route.fulfill({ status: 404, body: 'not found' })
  })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/api\/(health|llm)|503|Failed to load resource|websocket/i.test(m.text())) errors.push(m.text())
  })
  await page.goto(`${origin}/__demo/stage.html`, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  // warm the app (module graph + fonts) so the first visible load is instant
  await page.evaluate((src) => ((document.getElementById('app') as HTMLIFrameElement).src = src), `${base}/#/onboarding`)
  await page.waitForTimeout(2500)

  // the caption zone continues the app's canvas colour at its bottom edge
  const capBg = await page
    .frames()
    .find((f) => f.name() === 'app')!
    .evaluate(() => getComputedStyle(document.body).backgroundColor)
    .catch(() => '#FBF0DF')
  await page.evaluate((c) => (window as unknown as { demo: { capBg(c: string): void } }).demo.capBg(c), capBg)

  const rawFile = join(WORK, 'raw.mp4')
  let rec: Recorder | null = null
  let cdp: CDPSession | null = null
  const d = new Director(page, null, base)
  const list = scenes(facts)

  const startCapture = async () => {
    if (STILLS || rec) return
    rec = new Recorder(rawFile)
    d.rec = rec
    cdp = await ctx.newCDPSession(page)
    let resolveFirst: () => void
    const first = new Promise<void>((r) => (resolveFirst = r))
    cdp.on('Page.screencastFrame', (f) => {
      void cdp!.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined)
      const jpeg = Buffer.from(f.data, 'base64')
      if (!rec!.size) {
        rec!.size = jpegSize(jpeg)
        if (rec!.size.w !== OUT_W || rec!.size.h !== OUT_H) console.warn(`  ! screencast frames are ${rec!.size.w}×${rec!.size.h}, not ${OUT_W}×${OUT_H} (they will be rescaled)`)
      }
      rec!.push(jpeg, f.metadata.timestamp ?? Date.now() / 1000)
      resolveFirst()
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: OUT_W, maxHeight: OUT_H, everyNthFrame: 1 })
    // nudge a paint so the first frame (t = 0) arrives now
    await page.evaluate(() => document.body.animate([{ opacity: 1 }, { opacity: 0.999 }], { duration: 100 }))
    await first
  }

  const t0 = Date.now()
  try {
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      const n = i + 1
      if (n > TO) break
      d.fast = n < FROM
      if (!d.fast) await startCapture()
      d.scene = s.title
      d.sceneNo = n - 1
      d.sceneStart = d.now()
      await d.spotRect(null)
      const planned = list.slice(Math.max(FROM, 1) - 1, i).reduce((a, x) => a + x.len, 0)
      console.log(`▶ ${String(n).padStart(2)} ${s.title.padEnd(22)} at ${d.now().toFixed(1)}s (planned ${planned.toFixed(1)}s)${d.fast ? ' [fast]' : ''}`)
      await s.run(d)
      if (!d.fast) await d.at(s.len)
      if (!d.fast) {
        const over = d.now() - d.sceneStart - s.len
        if (over > 0.25) console.warn(`  ! scene ${n} ran ${over.toFixed(1)}s over its ${s.len}s`)
      }
    }
    d.caption(null)
    await page.waitForTimeout(STILLS ? 0 : 400)
  } catch (e) {
    await page.screenshot({ path: join(WORK, 'failure.png') }).catch(() => undefined)
    console.error(`✗ failed in scene "${d.scene}" — screenshot: ${join(WORK, 'failure.png')}`)
    throw e
  } finally {
    if (cdp) await (cdp as CDPSession).send('Page.stopScreencast').catch(() => undefined)
    if (errors.length) console.warn(`console errors:\n  ${errors.join('\n  ')}`)
  }

  if (STILLS) {
    await browser.close()
    await vite?.close()
    console.log(`stills → ${STILLS} (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    for (const m of d.marks) console.log(`  ${m.t.toFixed(1).padStart(6)}s  ${m.scene} · ${m.name}`)
    return
  }

  const r = rec as Recorder | null
  if (!r) throw new Error('nothing recorded')
  const seconds = await r.finish()
  await browser.close()
  await vite?.close()
  console.log(`· captured ${r.frames} screencast frames (${r.size?.w}×${r.size?.h}) → ${seconds.toFixed(2)} s at ${FPS} fps`)
  if (seconds > 299.5) console.warn(`  ! ${seconds.toFixed(1)} s is over the 4:59 budget`)

  const music = join(WORK, 'music.wav')
  console.log('· synthesising the music bed…')
  makeMusic(music, seconds + 0.5)
  console.log('· final encode (x264 slow, CRF 18)…')
  mkdirSync(dirname(OUT), { recursive: true })
  encodeFinal(rawFile, music, OUT, seconds, opts.narration ? resolve(opts.narration) : undefined)
  const srt = OUT.replace(/\.mp4$/, '.srt')
  writeSrt(srt, d.cues)
  const script = join(dirname(OUT), 'DemoVideo-Narration-Script.txt')
  writeNarration(script, d.cues, seconds)
  writeFileSync(join(WORK, 'marks.json'), JSON.stringify(d.marks, null, 2))
  if (!opts.keep) {
    rmSync(rawFile, { force: true })
    rmSync(music, { force: true })
  }
  const mb = statSync(OUT).size / 1024 / 1024
  console.log(`✓ ${OUT} (${mb.toFixed(1)} MB, ${seconds.toFixed(1)} s)\n✓ ${srt}\n✓ ${script}\n· checkpoints: ${join(WORK, 'marks.json')}`)
  for (const m of d.marks) console.log(`  ${m.t.toFixed(1).padStart(6)}s  ${m.scene} · ${m.name}`)
}

if (!existsSync(join(ROOT, 'node_modules/playwright'))) throw new Error('run npm install first')
await main()
