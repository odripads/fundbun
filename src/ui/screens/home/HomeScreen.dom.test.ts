// @vitest-environment jsdom
import { Fragment, act, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { toMinor } from '../../../core/money'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byLabel, byText, changeValue, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { HomeScreen } from './HomeScreen'
import { resetHomeLayout } from './layoutPrefs'

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
  localStorage.clear()
  resetHomeLayout()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#')
})

describe('HomeScreen — the Dream Mirror', () => {
  it('Jing (over): headline, evidence tiles, AI label and h2-first outline', async () => {
    const { container } = await renderHome(demo('mei'))
    const hero = container.querySelector('section[data-status="over"]')!
    expect(hero).not.toBeNull()
    // Bun is furious (27% past the target): the words are shouted, the mirror is broken
    expect(hero.querySelector('h2')!.textContent).toBe("You could've gotten a Weekend in Chengdu!!!")
    expect(hero.getAttribute('data-mood')).toBe('furious')
    expect(hero.querySelectorAll('svg[viewBox="0 0 100 114"] path').length).toBeGreaterThan(10)
    expect(hero.textContent).toContain('Dream Mirror · October')
    expect(hero.textContent).toContain('Over budget')
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

  it('Jing (over): "Make a plan with Bun" opens chat with the get-back-on-track request', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'sendMessage')
    const { container } = await renderHome(app)
    await click(byText(container, 'Make a plan with Bun', 'button'))
    await flush()
    expect(spy).toHaveBeenCalledWith('Help me get back on track this month')
    expect(window.location.hash).toBe('#/chat')
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

  it('"Add spending" takes an amount and a few words, and the purchase lands on the month', async () => {
    const app = demo('mei')
    const spent = app.getSnapshot().derived.summary!.spent
    const { container } = await renderHome(app)
    await click(byText(container, 'Add spending', 'button'))
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Type it in. It stays on this device.')
    const [amount, what] = Array.from(sheet.querySelectorAll('input')) as HTMLInputElement[]
    // an empty amount is refused in plain words
    await click(byText(sheet, 'Add it', 'button'))
    expect(sheet.textContent).toContain('Type an amount, like 25')
    await changeValue(amount, '25')
    await changeValue(what, 'Luckin coffee')
    expect(sheet.querySelector('select')!.textContent).toContain('Coffee & milk tea')
    await click(byText(sheet, 'Add it', 'button'))
    await flush()
    const after = app.getSnapshot()
    expect(after.derived.summary!.spent).toBe(spent + toMinor(25, 'CNY'))
    expect(after.state.bank.transactions.find((t) => t.id.startsWith('manual_'))).toMatchObject({ merchant: 'Luckin coffee', category: 'coffee_tea' })
    expect(document.body.textContent).toContain('Added ¥25')
  })

  it('shows the two alerts the demo primes at load, and clears them on "Clear all"', async () => {
    const app = demo('mei')
    expect(app.getSnapshot().derived.unseenEvents).toHaveLength(2)
    const { container } = await renderHome(app)
    const deck = Array.from(container.querySelectorAll('section')).find((s) => s.textContent?.includes('Tripwires'))!
    expect(deck).toBeDefined()
    expect(deck.textContent).toContain('1 more behind this one')
    await click(byText(deck, 'Clear all', 'button'))
    await flush()
    expect(app.getSnapshot().derived.unseenEvents).toHaveLength(0)
    // the demo persona still has tripwires on: an empty deck must not read as "no tripwires"
    expect(container.textContent).toContain('No alerts right now')
    expect(container.textContent).toMatch(/\d+ tripwires are watching your spending/)
    expect(container.textContent).not.toContain('No tripwires yet')
  })

  it('toasts a new tripwire with its dream picture and stacks it until "Got it"', async () => {
    const app = demo('mei')
    // start from a clean deck: the demo's two primed alerts are covered by the test above
    app.markEventsSeen()
    const { container } = await renderHome(app)
    expect(container.textContent).toContain('No alerts right now')
    await click(byText(container, 'Bank demo · Oct 22', 'button'))
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('No real money moves')
    await click(byText(sheet, 'Done', 'button'))
    await flush(400)
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

  it('the sandbox sheet stays open after a purchase to show the result, and closes on Done', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    await click(byText(container, 'Bank demo · Oct 22', 'button'))
    const sheet = () => document.querySelector('[role="dialog"]')
    await click(sheet()!.querySelector('button[title^="A big purchase"]'))
    await flush()
    expect(sheet()).not.toBeNull()
    expect(sheet()!.textContent).toContain('JD.com')
    expect(sheet()!.textContent).toContain('Tripwire')
    // shown inline, so no toast covers it (it still lands in the Tripwires deck)
    expect(document.querySelector('[aria-label="Notifications"]')?.textContent ?? '').not.toContain('JD.com')
    expect(app.getSnapshot().derived.unseenEvents.some((e) => e.title.includes('JD.com'))).toBe(true)
    // the late-night preset carries its time onto the transaction
    await click(sheet()!.querySelector('button[title^="A late-night"]'))
    await flush()
    expect(app.getSnapshot().state.bank.transactions.at(-1)).toMatchObject({ merchant: 'Meituan', time: '01:10' })
    await click(byText(sheet()!, 'Done', 'button'))
    await flush(400)
    expect(sheet()).toBeNull()
  })

  it('each "Bun noticed" card links to that insight on Insights', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    const section = Array.from(container.querySelectorAll('section')).find((s) => s.querySelector('h2')?.textContent === 'Bun noticed')!
    const links = Array.from(section.querySelectorAll<HTMLAnchorElement>('ul a'))
    expect(links.length).toBe(2)
    const ids = app.getSnapshot().derived.insights.map((i) => i.id)
    for (const a of links) {
      const m = a.getAttribute('href')!.match(/^#\/insights\/(.+)$/)
      expect(m).not.toBeNull()
      expect(ids).toContain(decodeURIComponent(m![1]))
    }
  })

  it('shows the six-month could’ve strip with captions per month', async () => {
    const { container } = await renderHome(demo('mei'))
    const strip = container.querySelector('[aria-label="Over budget or money left over, by month"]')!
    const cols = strip.querySelectorAll('button')
    expect(cols.length).toBe(6)
    expect(cols[5].getAttribute('aria-pressed')).toBe('true')
    await click(cols[3])
    expect(cols[3].getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('August:')
  })
})

describe('Home regressions', () => {
  const deckOf = (container: HTMLElement) => Array.from(container.querySelectorAll('section')).find((s) => s.querySelector('h2')?.textContent?.startsWith('Tripwires'))

  it('F64: "Got it" moves focus to the next card; dismissing the last one lands on the next section', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    const deck = deckOf(container)!
    const first = deck.querySelector('article h3')!.textContent
    await click(byText(deck, 'Got it', 'button'))
    await flush()
    const now = deckOf(container)!
    expect(now.querySelector('article h3')!.textContent).not.toBe(first)
    expect(document.activeElement).toBe(now.querySelector('article h3'))
    await click(byText(now, 'Got it', 'button'))
    await flush()
    expect(deckOf(container)!.querySelector('article')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.tagName).toMatch(/^H[23]$/)
  })

  it('F64: "Edit tripwires" deep-links to the Tripwires section of Settings', async () => {
    const { container } = await renderHome(demo('mei'))
    await click(byText(deckOf(container)!, 'Edit tripwires', 'button'))
    expect(window.location.hash).toBe('#/settings?s=tripwires')
  })

  it('F55: the deck’s time sits on the sandbox calendar', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    const time = deckOf(container)!.querySelector('time')!
    expect(time.getAttribute('dateTime')).toMatch(/^2026-10-(0\d|1\d|2[0-2])$/)
    expect(time.textContent).not.toMatch(/Oct 8\b/)
  })

  it('F41: a hero action that ran shows what ran, not the next re-derived suggestion', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    const cta = app.getSnapshot().derived.mirror!.cta!
    await click(byText(container, cta.label, 'button'))
    await flush()
    const ran = app.getSnapshot().state.pending.at(-1)!
    expect(ran.status).toBe('executed')
    const hero = container.querySelector('section[data-status]')!
    expect(hero.querySelector('[role="status"]')!.textContent).toBe(`Done · ${ran.preview.title}`)
  })

  it('F67: a brand-new user with no bills reads "No bills yet", not "every bill is paid"', async () => {
    const app = createTestApp({ storage: memoryStorage() })
    const res = app.completeOnboarding({
      name: 'Lin',
      currency: 'CNY',
      monthlyIncome: 1_000_000,
      targetSpend: 600_000,
      payday: 10,
      tone: 'gentle',
      consent: { financialData: true, llmProcessing: false, notifications: false },
      dreams: [{ name: 'Camera', price: 500_000, image: 'preset:camera', kind: 'goal' }],
      autonomy: 'copilot',
      pin: '2580',
      dataSource: { kind: 'empty', startingBalance: 300_000 },
    })
    expect(res.ok).toBe(true)
    const { container } = await renderHome(app)
    expect(container.textContent).toContain('No bills yet')
    expect(container.textContent).not.toContain('every bill is paid')
  })
})

describe('Home mode toggle, easy goals, and customizable layout', () => {
  it('switches to Daily tracking (hiding Dream Mirror), lets user add a goal, and switches back to Goal & Mirror', async () => {
    const app = demo('mei')
    const { container } = await renderHome(app)
    expect(container.querySelector('section[data-status]')).not.toBeNull()
    expect(container.textContent).toContain('Dream Mirror')

    await click(byText(container, 'Daily tracking', '[role="radio"]'))
    await flush()
    expect(app.getSnapshot().state.profile?.mode).toBe('tracking')
    expect(container.querySelector('section[data-status]')).toBeNull()
    expect(container.textContent).not.toContain('Dream Mirror')
    expect(container.textContent).not.toContain('Your could’ve collection')

    // Adding a goal works directly in tracking mode
    await click(byText(container, 'Add goal', 'button'))
    await flush()
    const sheet = document.querySelector('[role="dialog"]')!
    const [nameInput, priceInput] = Array.from(sheet.querySelectorAll('input')) as HTMLInputElement[]
    await changeValue(nameInput, 'Trip to Kyoto')
    await changeValue(priceInput, '5000')
    await click(byText(sheet, 'Add to my goals', 'button'))
    await flush()
    expect(app.getSnapshot().state.dreams.some((d) => d.name === 'Trip to Kyoto')).toBe(true)

    // Toggle back to Goal & Mirror
    await click(byText(container, 'Goal & Mirror', '[role="radio"]'))
    await flush()
    expect(app.getSnapshot().state.profile?.mode).toBe('target')
    expect(container.querySelector('section[data-status]')).not.toBeNull()
  })

  it('customizes block order (moves Daily check-in below Month card) and persists across renders', async () => {
    const app = demo('mei')
    const { container, unmount } = await renderHome(app)
    await click(byText(container, 'Customize', 'button'))
    await flush()
    await click(byLabel(container, 'Move Daily check-in down'))
    await flush()
    const order = [...container.querySelectorAll('[data-home-block]')].map((b) => b.getAttribute('data-home-block'))
    expect(order.slice(0, 3)).toEqual(['trip', 'checkin', 'month'])
    unmount()

    // Re-renders with persisted order
    const { container: c2 } = await renderHome(app)
    await click(byText(c2, 'Customize', 'button'))
    await flush()
    const order2 = [...c2.querySelectorAll('[data-home-block]')].map((b) => b.getAttribute('data-home-block'))
    expect(order2.slice(0, 3)).toEqual(['trip', 'checkin', 'month'])
  })
})

