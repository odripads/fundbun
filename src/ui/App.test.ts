// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../core/app'
import type { OnboardingInput } from '../core/app-api'
import { App, SCREENS } from './App'
import { agentPillName } from './components/layout/ShellActions'
import type { EngineStatus } from './state'
import { byLabel, byText, cleanup, click, flush, key, render } from './components/ds/testing'

const ONBOARDING: OnboardingInput = {
  name: 'Mei',
  currency: 'CNY',
  monthlyIncome: 1_850_000,
  targetSpend: 950_000,
  payday: 10,
  tone: 'gentle',
  consent: { financialData: true, llmProcessing: false, notifications: false },
  dreams: [{ name: 'Birkin 25', price: 9_800_000, image: 'preset:bag', kind: 'goal' }],
  autonomy: 'copilot',
  pin: '2580',
  dataSource: { kind: 'empty', startingBalance: 600_000 },
}

function onboardedApp(storage = memoryStorage()): FundBunApp {
  const app = createTestApp({ storage })
  const res = app.completeOnboarding(ONBOARDING)
  if (!res.ok) throw new Error(res.error)
  return app
}

async function renderAt(hash: string, app: FundBunApp) {
  window.history.replaceState(null, '', hash)
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(App, { status }))
  await flush()
  return r
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#')
})

describe('App shell — before onboarding', () => {
  it('sends an empty hash to onboarding, without bars', async () => {
    const { container } = await renderAt('#', createTestApp())
    expect(window.location.hash).toBe('#/onboarding')
    expect(byText(container, 'Meet Bun')).not.toBeNull()
    expect(container.querySelector('nav[aria-label="Primary"]')).toBeNull()
    // no top bar in the phone (the glass-box panel beside it has its own header)
    expect([...container.querySelectorAll('header')].filter((el) => !el.closest('aside'))).toEqual([])
  })

  it('beside onboarding, the glass box explains privacy and permissions (nothing to trace yet)', async () => {
    const { container } = await renderAt('#/onboarding', createTestApp())
    const panel = container.querySelector('aside')!
    expect(panel.textContent).toContain('Glass box')
    expect(panel.textContent).toContain('Two consents, nothing pre-ticked')
    expect(panel.textContent).not.toContain('Red-team')
    await click(byText(panel, 'Permissions', 'button'))
    expect(panel.querySelectorAll('[data-tier]')).toHaveLength(5)
  })

  it('guards app routes', async () => {
    const { container } = await renderAt('#/bills', createTestApp())
    expect(window.location.hash).toBe('#/onboarding')
    expect(byText(container, 'Meet Bun')).not.toBeNull()
  })

  it('integration: Mei’s demo card loads the sandbox persona and lands on home', async () => {
    const app = createTestApp()
    const { container } = await renderAt('#/onboarding', app)
    await click(container.querySelector('button[data-status="over"]'))
    await flush(80)
    expect(app.isOnboarded()).toBe(true)
    expect(window.location.hash).toBe('#/home')
    expect(container.querySelector('h1')!.textContent).toBe('Home')
    expect(container.querySelector('nav[aria-label="Primary"] [aria-current="page"]')!.getAttribute('href')).toBe('#/home')
  })

  it('surfaces a failing demo load as a toast instead of crashing', async () => {
    const app = createTestApp()
    vi.spyOn(app, 'loadDemo').mockImplementation(() => {
      throw new Error('persona not ready')
    })
    const { container } = await renderAt('#/onboarding', app)
    await click(container.querySelector('button[data-status="over"]'))
    await flush(80)
    expect(document.body.textContent).toContain('persona not ready')
    expect(window.location.hash).toBe('#/onboarding')
  })
})

describe('App shell — onboarded', () => {
  it('renders the route with its top bar, tab bar and current tab', async () => {
    const { container } = await renderAt('#/insights', onboardedApp())
    expect(container.querySelector('h1')!.textContent).toBe('Insights')
    const current = container.querySelector('nav[aria-label="Primary"] [aria-current="page"]')!
    expect(current.getAttribute('href')).toBe('#/insights')
    expect(byLabel(container, 'Settings')).not.toBeNull()
  })

  it('redirects the empty hash home and follows hash changes', async () => {
    const { container } = await renderAt('#', onboardedApp())
    expect(window.location.hash).toBe('#/home')
    await act(async () => {
      window.location.hash = '#/goals'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(container.querySelector('h1')!.textContent).toBe('Goals')
  })

  it('the kill switch pauses the agent instantly and points to Settings', async () => {
    const app = onboardedApp()
    const { container } = await renderAt('#/home', app)
    const pill = byLabel(container, agentPillName('active'))!
    // F49: a switch, not a status badge — the visible word is the action, and the spoken name starts with it
    expect(pill.textContent).toBe('Pause')
    expect(pill.getAttribute('aria-label')!.startsWith(pill.textContent!)).toBe(true)
    await click(pill)
    expect(app.getSnapshot().state.mandate.frozen).toBe(true)
    expect(document.body.textContent).toContain('Agent paused')
    const paused = byLabel(container, agentPillName('paused'))!
    expect(paused.textContent).toBe('Paused')
    expect(paused.getAttribute('aria-label')!.startsWith('Paused')).toBe(true)
    await click(paused)
    await flush()
    // straight to the kill switch (and its Unfreeze with PIN), not just the top of Settings
    expect(window.location.hash).toBe('#/settings?s=kill')
  })

  it('settings has a back button and compact actions', async () => {
    const { container } = await renderAt('#/settings', onboardedApp())
    expect(byLabel(container, 'Back')).not.toBeNull()
    expect(byLabel(container, 'Settings')).toBeNull()
    expect(container.querySelector('nav[aria-label="Primary"]')).toBeNull()
    await click(byLabel(container, 'Back'))
    await flush()
    expect(window.location.hash).toBe('#/home')
  })

  it('chat hides the tab bar and renders its own top bar above main', async () => {
    const { container } = await renderAt('#/chat', onboardedApp())
    expect(container.querySelector('nav[aria-label="Primary"]')).toBeNull()
    const header = container.querySelector('header')!
    expect(header.textContent).toContain('Ask Bun')
    expect(container.querySelector('main')!.contains(header)).toBe(false)
  })

  it('shows the glass box unless the user switched it off', async () => {
    const app = onboardedApp()
    const { container } = await renderAt('#/home', app)
    expect(container.querySelector('aside')).not.toBeNull()
    await act(async () => app.setSettings({ glassBox: false }))
    expect(container.querySelector('aside')).toBeNull()
  })

  it('mirrors the reduce-motion setting onto <html>', async () => {
    const app = onboardedApp()
    await renderAt('#/home', app)
    await act(async () => app.setSettings({ reducedMotion: true }))
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduce')
    await act(async () => app.setSettings({ reducedMotion: false }))
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)
  })

  it('a crashing screen is contained by the error boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = SCREENS.bills
    SCREENS.bills = () => {
      throw new Error('bills exploded')
    }
    try {
      const { container } = await renderAt('#/bills', onboardedApp())
      expect(byText(container, 'This screen hit a snag')).not.toBeNull()
      expect(container.querySelector('nav[aria-label="Primary"]')).not.toBeNull()
    } finally {
      SCREENS.bills = original
    }
  })

  it('reset sends the user back to onboarding', async () => {
    const app = onboardedApp()
    await renderAt('#/home', app)
    await act(async () => app.resetAll())
    await flush()
    expect(window.location.hash).toBe('#/onboarding')
  })
})

describe('App shell — engine states', () => {
  it('shows the engine-not-ready screen instead of crashing', async () => {
    window.history.replaceState(null, '', '#/home')
    const status: EngineStatus = { ready: false, error: 'TODO loadPersona mei' }
    const { container } = await render(h(App, { status }))
    expect(byText(container, 'Bun is still warming up')).not.toBeNull()
    expect(container.querySelector('code')!.textContent).toBe('TODO loadPersona mei')
  })

  it('the gallery renders without the engine', async () => {
    window.history.replaceState(null, '', '#/gallery')
    const status: EngineStatus = { ready: false, error: 'stub' }
    const { container } = await render(h(App, { status }))
    for (let i = 0; i < 20 && !container.querySelector('h1'); i++) await flush(25)
    expect(container.querySelector('h1')!.textContent).toBe('Design system')
    expect(container.querySelector('[data-theme="light"]')).not.toBeNull()
    expect(container.querySelector('[data-theme="dark"]')).not.toBeNull()
  })

  it('a vault-locked device shows the PIN gate and unlocks', async () => {
    const storage = memoryStorage()
    const first = onboardedApp(storage)
    const enabled = await first.enableVault('2580')
    expect(enabled.ok).toBe(true)
    await first.flush()
    const locked = createTestApp({ storage })
    expect(locked.isLocked()).toBe(true)
    const { container } = await renderAt('#/home', locked)
    expect(byText(container, 'Welcome back')).not.toBeNull()
    const pad = container.querySelector('[role="group"]')!
    for (const d of '1111') await key(pad, d)
    await key(pad, 'Enter')
    for (let i = 0; i < 40 && !container.querySelector('[role="alert"]')?.textContent; i++) await flush(25)
    expect(container.querySelector('[role="alert"]')!.textContent).not.toBe('')
    for (const d of '2580') await key(pad, d)
    await key(pad, 'Enter')
    for (let i = 0; i < 80 && locked.isLocked(); i++) await flush(25)
    expect(locked.isLocked()).toBe(false)
    await flush()
    expect(container.querySelector('h1')!.textContent).toBe('Home')
  })
})
