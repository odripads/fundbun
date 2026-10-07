/**
 * Screenshot helper for visual checks (uses the system Chrome — no browser download).
 *
 *   npx tsx scripts/shot.ts --url http://localhost:5173/#/home --out /tmp/home.png
 *   npx tsx scripts/shot.ts --file src/ui/assets/logo.svg --out /tmp/logo.png --width 512 --height 512
 *   options: --width 390 --height 844 --dark --full --wait 600 --click "text=Try the demo" (repeatable)
 *            --eval "localStorage.clear()" (runs before navigation completes, repeatable) --scale 2
 *            --step 'click:text=Try the demo' --step 'fill:textarea=>How am I doing?' --step 'press:Enter'
 *            --step 'wait:800' --step 'shot:/tmp/mid.png'   (steps run in order, after --click)
 */
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function args() {
  const a = process.argv.slice(2)
  const out: Record<string, string[]> = {}
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue
    const k = a[i].slice(2)
    const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true'
    ;(out[k] ??= []).push(v)
  }
  return out
}

const o = args()
const width = Number(o.width?.[0] ?? 390)
const height = Number(o.height?.[0] ?? 844)
const url = o.file ? pathToFileURL(resolve(o.file[0])).href : o.url?.[0]
if (!url) throw new Error('need --url or --file')
const outPath = o.out?.[0] ?? '/tmp/fundbun-shot.png'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: Number(o.scale?.[0] ?? 2),
  colorScheme: o.dark ? 'dark' : 'light',
  reducedMotion: 'reduce',
})
const page = await ctx.newPage()
const errors: string[] = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
for (const js of o.eval ?? []) await page.addInitScript(js)
await page.goto(url, { waitUntil: 'networkidle' })
for (const sel of o.click ?? []) {
  await page.locator(sel).first().click({ timeout: 5000 })
  await page.waitForTimeout(300)
}
for (const step of o.step ?? []) {
  const i = step.indexOf(':')
  const kind = step.slice(0, i)
  const arg = step.slice(i + 1)
  if (kind === 'click') await page.locator(arg).first().click({ timeout: 8000 })
  else if (kind === 'fill') {
    const [sel, text] = arg.split('=>')
    await page.locator(sel).first().fill(text, { timeout: 8000 })
  } else if (kind === 'press') await page.keyboard.press(arg)
  else if (kind === 'wait') await page.waitForTimeout(Number(arg))
  else if (kind === 'shot') await page.screenshot({ path: arg, fullPage: Boolean(o.full) })
  else if (kind === 'eval') await page.evaluate(arg)
  await page.waitForTimeout(250)
}
await page.waitForTimeout(Number(o.wait?.[0] ?? 500))
await page.screenshot({ path: outPath, fullPage: Boolean(o.full) })
await browser.close()
console.log(`saved ${outPath}${errors.length ? `\nconsole errors:\n${errors.join('\n')}` : ''}`)
