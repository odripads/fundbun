// @vitest-environment jsdom
import { Fragment, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byLabel, byText, changeValue, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { GoalsScreen } from './GoalsScreen'

function demo(id: 'mei' | 'arif'): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app
}

async function renderGoals(app: FundBunApp) {
  window.history.replaceState(null, '', '#/goals')
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, h(GoalsScreen), h(ToastViewport)) }) }))
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

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]')

describe('GoalsScreen', () => {
  it('sums the pots and lists goals then treats, each with progress, pace and ETA', async () => {
    const { container } = await renderGoals(demo('arif'))
    expect(container.textContent).toContain('Saved across your pots')
    expect(container.textContent).toContain('¥4,150')
    const names = Array.from(container.querySelectorAll('article h3')).map((n) => n.textContent)
    expect(names).toEqual(['MacBook Air', 'Flight home to Medan', 'Concert ticket', 'New sneakers'])
    const mac = container.querySelector('article')!
    expect(mac.querySelector('[role="progressbar"]')!.getAttribute('aria-valuetext')).toBe('46% saved')
    expect(mac.textContent).toContain('¥433/mo')
    expect(mac.textContent).toContain('at your pace')
    expect(container.querySelector('h1')).toBeNull()
  })

  it('adds money from checking as the user’s own action and confirms with a toast', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'contributeToGoal')
    const { container } = await renderGoals(app)
    await click(byText(container, 'Add money', 'button'))
    const sheet = dialog()!
    await changeValue(sheet.querySelector('input'), '300')
    await click(byText(document.body, 'Stash ¥300', 'button'))
    await flush()
    expect(spy).toHaveBeenCalledWith('dream_birkin', 30_000)
    expect(document.querySelector('[aria-label="Notifications"]')!.textContent).toContain('¥300 stashed in Birkin 25')
  })

  it('blocks a stash bigger than the checking balance', async () => {
    const app = demo('arif')
    const spy = vi.spyOn(app, 'contributeToGoal')
    const { container } = await renderGoals(app)
    await click(byText(container, 'Add money', 'button'))
    await changeValue(dialog()!.querySelector('input'), '999999')
    await click(byText(document.body, 'Stash it', 'button'))
    expect(spy).not.toHaveBeenCalled()
    expect(dialog()!.textContent).toContain('more than your checking balance')
  })

  it('F59: "-50" is refused with a message, never turned into "Stash ¥50"', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'contributeToGoal')
    const { container } = await renderGoals(app)
    await click(byText(container, 'Add money', 'button'))
    await changeValue(dialog()!.querySelector('input'), '-50')
    expect(dialog()!.textContent).toContain('Amounts go into the pot')
    expect(byText(document.body, 'Stash ¥50', 'button')).toBeNull()
    const stash = byText(document.body, 'Stash it', 'button') as HTMLButtonElement
    expect(stash.disabled).toBe(true)
    expect(dialog()!.textContent).not.toContain('→')
    expect(spy).not.toHaveBeenCalled()
  })

  it('marks a treat as enjoyed after a confirm, then celebrates', async () => {
    const app = demo('arif')
    const { container } = await renderGoals(app)
    await click(byLabel(container, 'Mark Concert ticket as enjoyed'))
    await click(byText(document.body, 'Mark enjoyed', 'button'))
    await flush()
    expect(app.getSnapshot().state.dreams.find((d) => d.id === 'dream_concert')!.achievedAt).toBeTruthy()
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    expect(dialogs.some((d) => d.textContent?.includes('Concert ticket — enjoyed, guilt-free'))).toBe(true)
    expect(container.textContent).toContain('Achieved')
  })

  it('removes a goal only after a confirm that says where its pot goes', async () => {
    const app = demo('arif')
    const { container } = await renderGoals(app)
    await click(byLabel(container, 'Edit Flight home to Medan'))
    await click(byText(document.body, 'Remove from my dreams', 'button'))
    const confirm = document.querySelector('[role="alertdialog"]')!
    expect(confirm.textContent).toContain('¥450')
    expect(confirm.textContent).toContain('checking')
    await click(byText(confirm as HTMLElement, 'Remove dream', 'button'))
    await flush()
    expect(app.getSnapshot().state.dreams.some((d) => d.id === 'dream_flight')).toBe(false)
  })

  it('invites a first dream when the list is empty', async () => {
    const app = demo('arif')
    for (const d of app.getSnapshot().state.dreams) app.removeDream(d.id)
    const { container } = await renderGoals(app)
    expect(container.textContent).toContain('What are you dreaming of?')
    expect(byText(container, 'Add your first dream', 'button')).not.toBeNull()
  })
})
