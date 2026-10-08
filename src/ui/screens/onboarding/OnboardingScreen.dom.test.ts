// @vitest-environment jsdom
import { Fragment, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byText, changeValue, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { DRAFT_KEY } from './draft'
import { OnboardingScreen } from './OnboardingScreen'

async function renderOnboarding(app: FundBunApp, hash = '#/onboarding') {
  window.history.replaceState(null, '', hash)
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, h(OnboardingScreen), h(ToastViewport)) }) }))
  await flush()
  return r
}

const h1 = (c: HTMLElement) => c.querySelector('h1')?.textContent ?? ''

beforeEach(() => {
  sessionStorage.clear()
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

describe('OnboardingScreen', () => {
  it('welcomes with the promise, "Set up my own" and both demo personas', async () => {
    const { container } = await renderOnboarding(createTestApp({ storage: memoryStorage() }))
    expect(h1(container)).toBe('See what your spending could have been.')
    expect(byText(container, 'Set up my own', 'button')).not.toBeNull()
    expect(container.querySelector('button[data-status="over"]')!.textContent).toContain('Mei')
    expect(container.querySelector('button[data-status="under"]')!.textContent).toContain('Arif')
  })

  it('consent blocks progress until financial-data processing is switched on', async () => {
    const { container } = await renderOnboarding(createTestApp({ storage: memoryStorage() }))
    await click(byText(container, 'Set up my own', 'button'))
    await flush()
    expect(window.location.hash).toBe('#/onboarding?step=consent')
    expect(h1(container)).toBe('Your data, your call')
    const switches = container.querySelectorAll<HTMLButtonElement>('[role=switch]')
    expect([...switches].map((s) => s.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])

    await click(byText(container, 'Continue', 'button'))
    await flush(20)
    expect(window.location.hash).toBe('#/onboarding?step=consent')
    expect(container.querySelector('[role=alert]')!.textContent).toContain('Bun needs this one')

    await click(switches[0])
    await click(byText(container, 'Continue', 'button'))
    await flush()
    expect(window.location.hash).toBe('#/onboarding?step=money')
    expect(h1(container)).toBe('Your month in numbers')
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).consent).toEqual({ financialData: true, llmProcessing: false, notifications: false })
  })

  it('shows the live income hint and keeps typed values in the draft', async () => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, consent: { financialData: true } }))
    const { container } = await renderOnboarding(createTestApp({ storage: memoryStorage() }), '#/onboarding?step=money')
    await changeValue(container.querySelector<HTMLInputElement>('#ob-income'), '18500')
    await changeValue(container.querySelector<HTMLInputElement>('#ob-target'), '9500')
    expect(container.textContent).toContain('That’s 51% of your income — leaves ¥9,000 to save.')
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).income).toBe('18500')
  })

  it('a deep link cannot skip ahead: it lands on the first step that still needs input', async () => {
    const { container } = await renderOnboarding(createTestApp({ storage: memoryStorage() }), '#/onboarding?step=done')
    await flush()
    expect(window.location.hash).toBe('#/onboarding?step=consent')
    expect(h1(container)).toBe('Your data, your call')
  })

  it('the Arif demo card loads the persona and goes home', async () => {
    const app = createTestApp({ storage: memoryStorage() })
    const { container } = await renderOnboarding(app)
    await click(container.querySelector('button[data-status="under"]'))
    await flush(80)
    expect(app.isOnboarded()).toBe(true)
    expect(app.getSnapshot().state.profile?.personaId).toBe('arif')
    expect(window.location.hash).toBe('#/home')
  })

  it('a failing demo load becomes a toast; the user stays on onboarding', async () => {
    const app = createTestApp({ storage: memoryStorage() })
    vi.spyOn(app, 'loadDemo').mockImplementation(() => {
      throw new Error('persona not ready')
    })
    const { container } = await renderOnboarding(app)
    await click(container.querySelector('button[data-status="over"]'))
    await flush(80)
    expect(document.body.textContent).toContain('persona not ready')
    expect(app.isOnboarded()).toBe(false)
    expect(window.location.hash).toBe('#/onboarding')
    expect(container.querySelector<HTMLButtonElement>('button[data-status="over"]')!.disabled).toBe(false)
  })

  it('finishes: PIN twice, summary edit loops back, then "Show me my mirror" onboards and goes home', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        v: 1,
        consent: { financialData: true },
        name: 'Odri',
        income: '18,500',
        target: '9,500',
        payday: 10,
        dreams: [{ key: 'a', name: 'Birkin', price: 9_800_000, image: 'preset:bag', kind: 'goal' }],
        tone: 'cheeky',
        data: { kind: 'persona', personaId: 'mei' },
      }),
    )
    const app = createTestApp({ storage: memoryStorage() })
    const { container } = await renderOnboarding(app, '#/onboarding?step=done')
    await flush()
    // the PIN is never persisted, so the flow asks for it again
    expect(window.location.hash).toBe('#/onboarding?step=permissions')
    const pin = async () => {
      for (const d of '2580') await click(byText(container, d, 'button'))
      await click(container.querySelector('[aria-label="Confirm PIN"]'))
    }
    await pin()
    await pin()
    expect(container.textContent).toContain('PIN set')
    await click(byText(container, 'Continue', 'button'))
    await flush()
    await click(byText(container, 'Review my setup', 'button'))
    await flush()
    expect(window.location.hash).toBe('#/onboarding?step=done')
    expect(h1(container)).toBe('You’re all set, Odri')

    await click(container.querySelector('[aria-label="Edit Your money"]'))
    await flush()
    expect(window.location.hash).toBe('#/onboarding?step=money')
    await click(byText(container, 'Back to summary', 'button'))
    await flush()
    expect(window.location.hash).toBe('#/onboarding?step=done')

    await click(byText(container, 'Show me my mirror', 'button'))
    await flush(80)
    expect(app.isOnboarded()).toBe(true)
    expect(app.getSnapshot().state.profile).toMatchObject({ name: 'Odri', tone: 'cheeky', targetSpend: 950_000 })
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
    expect(window.location.hash).toBe('#/home')
  })
})
