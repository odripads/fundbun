// @vitest-environment jsdom
import { Fragment, act, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { toMinor } from '../../../core/money'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byText, changeValue, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { HomeScreen } from './HomeScreen'

function demo(id: 'mei' | 'arif'): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app
}

async function renderHome(app: FundBunApp) {
  window.history.replaceState(null, '', '#/home')
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, h(HomeScreen), h(ToastViewport)) }) }))
  await flush()
  return r
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#')
})

describe('HomeScreen — the Dream Mirror', () => {
  it('Mei (over): headline, evidence tiles, AI label and h2-first outline', async () => {
    const { container } = await renderHome(demo('mei'))
    const hero = container.querySelector('section[data-status="over"]')!
    expect(hero).not.toBeNull()
    expect(hero.querySelector('h2')!.textContent).toBe("You could've gotten a Weekend in Chengdu.")
    expect(hero.textContent).toContain('Dream Mirror · October')
    expect(hero.textContent).toContain('Over target')
    expect(hero.querySelector('[aria-label="The numbers behind it"]')!.textContent).toContain('Birkin 25 delay')
    expect(hero.querySelector('[aria-label^="AI-generated"]')).not.toBeNull()
    expect(hero.querySelector('img[alt="Weekend in Chengdu"]')).not.toBeNull()
    expect(container.querySelector('h1')).toBeNull()
  })

  it('routes the mirror CTA through the policy engine', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'runSuggestedAction')
    const { container } = await renderHome(app)
    const cta = app.getSnapshot().derived.mirror!.cta!
    await click(byText(container, cta.label, 'button'))
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toEqual(cta)
  })

  it('Arif (under): shows the goal and offers to stash, never to spend', async () => {
    const app = demo('arif')
    const { container } = await renderHome(app)
    const hero = container.querySelector('section[data-status="under"]')!
    expect(hero.querySelector('figcaption')!.textContent).toBe('MacBook Air·46% saved')
    const cta = app.getSnapshot().derived.mirror!.cta!
    expect(cta.label).toMatch(/^Stash /)
    expect(byText(hero, cta.label, 'button')).not.toBeNull()
    expect(hero.textContent).not.toMatch(/buy now/i)
  })

  it('opens "Why am I seeing this?" with the numbers behind the mirror', async () => {
    const { container } = await renderHome(demo('mei'))
    await click(byText(container, 'Why am I seeing this?', 'button'))
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Spent so far')
    expect(sheet.textContent).toContain('¥9,500')
    expect(sheet.textContent).toContain('biggest dream on your list')
  })

  it('checks a purchase locally and shows the verdict with dream equivalents', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'sendMessage')
    const { container } = await renderHome(app)
    const form = container.querySelector('form')!
    const [price, what] = Array.from(form.querySelectorAll('input'))
    await changeValue(price, '1299')
    await changeValue(what, 'Winter coat')
    await click(byText(form, 'Check it', 'button'))
    await flush()
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Skip for now')
    expect(sheet.textContent).toContain('Winter coat')
    expect(sheet.textContent).toContain('Same money as')
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects an empty price with a message instead of a verdict', async () => {
    const { container } = await renderHome(demo('mei'))
    const form = container.querySelector('form')!
    await click(byText(form, 'Check it', 'button'))
    expect(form.textContent).toContain('Type a price')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('pays a bill through the policy gate (T3 → approval)', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'runSuggestedAction')
    const { container } = await renderHome(app)
    await click(container.querySelector('[aria-label^="Pay Electricity"]'))
    await flush()
    expect(spy.mock.calls[0][0]).toMatchObject({ tool: 'pay_bill', args: { billId: expect.stringContaining('electricity') } })
  })

  it('toasts a new tripwire with its dream picture and stacks it until "Got it"', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    expect(container.textContent).not.toContain('Tripwires')
    await click(byText(container, 'Sandbox', 'button'))
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('No real money moves')
    // drive the sandbox bank directly — the same AppApi call the panel's presets make
    let out!: ReturnType<FundBunApp['simulatePurchase']>
    await act(async () => {
      out = app.simulatePurchase({ merchant: 'JD.com', amount: toMinor(1299), category: 'shopping' })
    })
    await flush()
    expect(out.events.length).toBeGreaterThan(0)
    const toast = document.querySelector('[aria-label="Notifications"]')!
    expect(toast.textContent).toContain('¥1,299')
    expect(toast.querySelector('img')).not.toBeNull()
    expect(container.textContent).toContain('Tripwires')
    const deck = Array.from(container.querySelectorAll('section')).find((s) => s.textContent?.includes('Tripwires'))!
    await click(byText(deck, 'Clear all', 'button') ?? byText(deck, 'Got it', 'button'))
    await flush()
    expect(app.getSnapshot().derived.unseenEvents.length).toBeLessThan(out.events.length)
  })

  it('shows the six-month could’ve strip with captions per month', async () => {
    const { container } = await renderHome(demo('mei'))
    const strip = container.querySelector('[aria-label="Over and under target by month"]')!
    const cols = strip.querySelectorAll('button')
    expect(cols.length).toBe(6)
    expect(cols[5].getAttribute('aria-pressed')).toBe('true')
    await click(cols[3])
    expect(cols[3].getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('August:')
  })
})
