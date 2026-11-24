// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { App, firstScreenChunks, preloadScreens, SCREENS } from '../../App'
import type { EngineStatus } from '../../state'
import { byLabel, byText, cleanup, click, flush, render } from '../ds/testing'
import { PANEL_OPEN_KEY, VIEW_STORAGE_KEY, setViewPreference } from './useDeskMode'

function demo(id: 'mei' | 'arif'): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app
}

async function renderAt(hash: string, app: FundBunApp) {
  window.history.replaceState(null, '', hash)
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(App, { status }))
  await flush()
  return r
}

/** A window `width` px wide, as far as matchMedia and innerWidth can tell (jsdom has no layout). */
function mockViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return { matches: min ? width >= Number(min[1]) : false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }
  }) as unknown as typeof window.matchMedia
}

const CARDS = ['hero', 'month', 'checkin', 'trip', 'daily', 'cats', 'six', 'bills', 'goals', 'check', 'txns']

// screens (and the desk shell) are code-split; load their chunks once so every render below is synchronous
beforeAll(() => preloadScreens(), 60_000)

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  setViewPreference('desk')
  localStorage.clear()
  mockViewport(1440)
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  delete (window as { matchMedia?: unknown }).matchMedia
  localStorage.clear()
  window.history.replaceState(null, '', '#')
})

describe('desk shell: a wide window', () => {
  it('Jing: sidebar navigation, the dashboard as the page, and Bun on the side', async () => {
    const { container } = await renderAt('#/home', demo('mei'))
    // landmarks: one primary nav, one main, the side panel
    const nav = container.querySelector('nav[aria-label="Primary"]')!
    expect(nav).not.toBeNull()
    expect([...nav.querySelectorAll('a')].map((a) => `${a.querySelector('span')?.textContent}→${a.getAttribute('href')}`)).toEqual([
      'Dashboard→#/home',
      'Insights→#/insights',
      'Bills→#/bills',
      'Goals→#/goals',
      'Activity→#/activity',
    ])
    expect(nav.querySelector('a[href="#/activity"]')?.getAttribute('aria-label')).toBe('Activity, 2 new')
    expect(nav.querySelector('[aria-current="page"]')!.textContent).toBe('Dashboard')
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelector('h1')!.textContent).toBe('Dashboard')
    expect(container.querySelector('time')!.textContent).toBe('Thu, Oct 22, 2026')
    // no phone chrome: no device status bar, no tab bar with a raised "Ask Bun"
    expect(container.querySelector('a[aria-label^="Ask Bun, your AI money buddy"]')).toBeNull()

    const panel = container.querySelector('aside')!
    expect(panel.getAttribute('aria-label')).toBe('Bun: chat and glass box')
    expect([...panel.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Ask Bun', 'Glass box'])
    expect(panel.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Ask Bun')
    // the chat in its panel layout: a message box, no page header with a back button
    expect(panel.querySelector('textarea')).not.toBeNull()
    expect(byLabel(panel, 'Back')).toBeNull()
    expect(panel.textContent).toContain('On-device rules engine')

    // the sidebar's other controls
    expect(byText(container, 'Add spending', 'button')).not.toBeNull()
    expect(container.querySelector('[data-slot="sidebar-footer"]')!.textContent).toContain('On-device rules engine')
    expect(byText(container, 'Phone view', 'button')).not.toBeNull()
    expect(container.querySelector('a[href="#/settings"]')!.textContent).toBe('Settings')
  })

  it('Jing: every dashboard card is there, with the broken mirror and her real numbers', async () => {
    const app = demo('mei')
    const { container } = await renderAt('#/home', app)
    const main = container.querySelector('main')!
    expect([...main.querySelectorAll('[data-card]')].map((c) => c.getAttribute('data-card'))).toEqual(CARDS)

    // the Dream Mirror keeps its furious, shattered state
    const hero = main.querySelector('[data-card="hero"] section[data-status="over"]')!
    expect(hero.getAttribute('data-mood')).toBe('furious')
    expect(hero.querySelector('h2')!.textContent).toBe("You could've gotten a Weekend in Chengdu!!!")
    expect(hero.querySelectorAll('svg[viewBox="0 0 100 114"] path').length).toBeGreaterThan(10)

    const month = main.querySelector('[data-card="month"]')!
    expect(month.querySelector('h2')!.textContent).toBe('October so far')
    expect(month.textContent).toContain('Over budget')
    expect(month.textContent).toContain('27% past your ¥9,500 target')
    expect(month.querySelector('[data-amount="258024"]')).not.toBeNull()
    expect(month.querySelector('[data-amount="1208024"]')).not.toBeNull()

    // each chart ships its numbers as a hidden table too
    const daily = main.querySelector('[data-card="daily"]')!
    expect(daily.querySelector('table caption')!.textContent).toBe('Day-to-day spending for each day of October')
    expect(daily.querySelectorAll('table tbody tr')).toHaveLength(22)
    expect(daily.querySelector('[role="group"]')!.getAttribute('aria-label')).toMatch(/^Daily spending in October/)
    expect(daily.textContent).toContain('Day limit ¥128')
    expect(main.querySelector('[data-card="cats"] table')!.textContent).toContain('Rent & housing')
    expect(main.querySelectorAll('[data-card="six"] table tbody tr')).toHaveLength(6)
    expect(main.querySelector('[data-card="six"] table')!.textContent).toContain('¥2,580.24 over budget')

    const bills = main.querySelector('[data-card="bills"]')!
    expect([...bills.querySelectorAll('li p:first-child')].map((p) => p.textContent)).toEqual(['China Mobile plan', 'Electricity', 'Water', 'Rent', 'Broadband'])
    // a demo persona has a (simulated) bank: Pay, behind the policy gate
    expect(bills.querySelectorAll('button').length).toBe(5)
    expect(byLabel(bills, 'Pay China Mobile plan ¥128, due in 3 days')).not.toBeNull()

    const goals = main.querySelector('[data-card="goals"]')!
    expect(goals.textContent).toContain('Birkin 25')
    expect(goals.textContent).toContain('By Dec 2028')

    expect(main.querySelector('[data-card="checkin"] h2')!.textContent).toBe('Daily check-in')

    const txns = main.querySelector('[data-card="txns"]')!
    expect([...txns.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Date', 'Merchant', 'Category', 'Amount'])
    expect(txns.querySelectorAll('tbody tr')).toHaveLength(50)
    expect(txns.querySelector('tbody tr')!.textContent).toContain('Oct 22')
    expect(byText(txns, 'Show 50 more', 'button')).not.toBeNull()
    expect(main.textContent).not.toMatch(/under (target|budget)/i)
  })

  it('Arif: on target, with money left over', async () => {
    const { container } = await renderAt('#/home', demo('arif'))
    const main = container.querySelector('main')!
    expect(main.querySelector('[data-card="hero"] section[data-status="under"]')).not.toBeNull()
    const month = main.querySelector('[data-card="month"]')!
    expect(month.textContent).toContain('Left over')
    expect(month.querySelector('[data-amount="133468"]')).not.toBeNull()
    expect(main.querySelector('[data-card="six"] table')!.textContent).toContain('¥1,334.68 left before the ¥3,600 target')
    expect(main.textContent).not.toMatch(/under (target|budget)/i)
  })

  it('the transactions table filters by search and by category', async () => {
    const { container } = await renderAt('#/home', demo('mei'))
    const txns = container.querySelector('[data-card="txns"]')!
    const select = txns.querySelector('select')!
    await act(async () => {
      select.value = 'coffee_tea'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const rows = [...txns.querySelectorAll('tbody tr')]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.textContent!.includes('Coffee & milk tea'))).toBe(true)
    expect(txns.querySelector('[role="status"]')!.textContent).toMatch(/of 856 transactions$/)
  })

  it('the sidebar’s Add spending opens the same sheet Home uses', async () => {
    const { container } = await renderAt('#/home', demo('mei'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click(byText(container.querySelector('nav')!.parentElement!, 'Add spending', 'button'))
    await flush()
    const sheet = document.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Add spending')
    expect(sheet.textContent).toContain('Add it')
    // sheets render inside the shell's overlay root, not on <body>
    expect(container.contains(sheet)).toBe(true)
  })

  it('other routes keep their own screen, in the work area', async () => {
    const { container } = await renderAt('#/bills', demo('mei'))
    expect(container.querySelector('h1')!.textContent).toBe('Bills')
    expect(container.querySelector('nav[aria-label="Primary"] [aria-current="page"]')!.textContent).toBe('Bills')
    expect(container.querySelector('main')!.textContent).toContain('Coming up')
    expect(container.querySelector('main [data-card]')).toBeNull()
    await act(async () => {
      window.location.hash = '#/goals'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(container.querySelector('h1')!.textContent).toBe('Goals')
    expect(container.querySelector('main')!.textContent).toContain('Birkin 25')
  })

  it('the chat route opens the side panel and gives the address back to the screen in view', async () => {
    localStorage.setItem(PANEL_OPEN_KEY, 'closed')
    const { container } = await renderAt('#/insights', demo('mei'))
    expect(container.querySelector('aside')).toBeNull()
    // shut, the panel leaves an "Ask Bun" button in the top bar
    expect(byLabel(container, 'Open the side panel: Ask Bun')).not.toBeNull()
    await act(async () => {
      window.location.hash = '#/chat'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await flush(120)
    expect(window.location.hash).toBe('#/insights')
    expect(container.querySelector('h1')!.textContent).toBe('Insights')
    const panel = container.querySelector('aside')!
    expect(panel.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Ask Bun')
    expect(document.activeElement).toBe(panel.querySelector('textarea'))
    expect(localStorage.getItem(PANEL_OPEN_KEY)).toBe('open')
  })

  it('the side panel switches to the glass box and can be hidden; both are remembered', async () => {
    const { container } = await renderAt('#/home', demo('mei'))
    const panel = container.querySelector('aside')!
    await click(byText(panel, 'Glass box', '[role="tab"]'))
    await flush()
    expect(panel.querySelector('[role="tabpanel"]')!.textContent).toContain('What the agent sees, decides and records, live.')
    expect(panel.querySelector('[role="tablist"][aria-label="Glass box views"]')).not.toBeNull()
    expect(localStorage.getItem('fundbun.desk.panelTab')).toBe('glass')
    await click(byLabel(panel, 'Hide the side panel'))
    expect(container.querySelector('aside')).toBeNull()
    expect(localStorage.getItem(PANEL_OPEN_KEY)).toBe('closed')
  })

  it('a pending approval is counted on the Ask Bun tab', async () => {
    const app = demo('mei')
    const { container } = await renderAt('#/home', app)
    await act(async () => {
      await app.runSuggestedAction({ tool: 'pay_bill', args: { billId: app.getSnapshot().derived.upcomingBills[0].id }, label: 'Pay' })
    })
    await flush()
    const awaiting = app.getSnapshot().derived.awaiting.length
    expect(awaiting).toBeGreaterThan(0)
    const tab = container.querySelector('aside [role="tab"]')!
    expect(tab.getAttribute('aria-label')).toBe(`Ask Bun, ${awaiting} waiting for your OK`)
    expect(tab.textContent).toBe(`Ask Bun${awaiting}`)
  })

  it('"Phone view" brings back the phone frame, with a way back to the desk', async () => {
    const { container } = await renderAt('#/home', demo('mei'))
    await click(byText(container, 'Phone view', 'button'))
    await flush()
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('phone')
    // the phone layout: tab bar, the Home screen, no dashboard cards
    expect(container.querySelector('nav[aria-label="Primary"] a[aria-label^="Ask Bun, your AI money buddy"]')).not.toBeNull()
    expect(container.querySelector('[data-card]')).toBeNull()
    expect(container.querySelector('h1')!.textContent).toBe('Home')
    await click(byLabel(container, 'Switch to the desktop view'))
    await flush()
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('desk')
    expect(container.querySelector('h1')!.textContent).toBe('Dashboard')
  })

  it('onboarding keeps the phone frame on a wide window', async () => {
    const { container } = await renderAt('#/onboarding', createTestApp())
    expect(byText(container, 'Meet Bun')).not.toBeNull()
    expect(container.querySelector('nav[aria-label="Primary"]')).toBeNull()
    expect(byLabel(container, 'Switch to the desktop view')).toBeNull()
  })

  it('loads the desk chunks with the first screen', () => {
    const status: EngineStatus = { ready: true, app: demo('mei') }
    const first = firstScreenChunks(status, '#/home')
    expect(first).toHaveLength(2)
    expect(first).not.toContain(SCREENS.home)
    expect(firstScreenChunks(status, '#/bills')[1]).toBe(SCREENS.bills)
    // a narrow window keeps the phone's single chunk
    mockViewport(390)
    expect(firstScreenChunks(status, '#/home')).toEqual([SCREENS.home])
  })
})

describe('desk shell: drawer and narrow widths', () => {
  it('uses desk layout with a closed drawer between 900 and 1279px, opened by Ask Bun', async () => {
    mockViewport(1024)
    const { container } = await renderAt('#/home', demo('mei'))
    expect(container.querySelector('h1')!.textContent).toBe('Dashboard')
    expect(container.querySelector('[data-card="hero"]')).not.toBeNull()
    // drawer starts closed
    expect(container.querySelector('aside')).toBeNull()
    const openBtn = byLabel(container, 'Open the side panel: Ask Bun')!
    expect(openBtn).not.toBeNull()
    await click(openBtn)
    await flush()
    const drawer = container.querySelector('aside')!
    expect(drawer).not.toBeNull()
    expect(drawer.getAttribute('data-mode')).toBe('drawer')
    // Escape closes the drawer
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('aside')).toBeNull()
  })

  it('keeps the old phone layout below 900px', async () => {
    mockViewport(899)
    const { container } = await renderAt('#/home', demo('mei'))
    expect(container.querySelector('[data-card]')).toBeNull()
    expect(container.querySelector('h1')!.textContent).toBe('Home')
    expect(byLabel(container, 'Switch to the desktop view')).toBeNull()
  })
})
