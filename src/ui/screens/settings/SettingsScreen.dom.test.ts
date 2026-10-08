// @vitest-environment jsdom
/** Settings regressions: profile validation (F46), deep links (F64), the sandbox clock (F55), no demo PIN in PIN prompts (F68). */
import { Fragment, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byText, changeValue, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { SettingsScreen, sectionFromQuery } from './SettingsScreen'

function demo(id: 'mei' | 'arif'): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app
}

async function renderSettings(app: FundBunApp, hash = '#/settings') {
  window.history.replaceState(null, '', hash)
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, h(SettingsScreen), h(ToastViewport)) }) }))
  await flush()
  return r
}

const field = (root: ParentNode, label: string) => {
  const l = Array.from(root.querySelectorAll('label')).find((x) => x.textContent?.trim().startsWith(label))
  return document.getElementById(l!.getAttribute('for')!) as HTMLInputElement
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
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

describe('Settings › Profile (F46)', () => {
  it('"abc" as a target shows the error as you type and never "All changes saved"', async () => {
    const { container } = await renderSettings(demo('mei'))
    const profile = container.querySelector('#set-profile')!
    await changeValue(field(profile, 'Spending target'), 'abc')
    expect(profile.textContent).toContain('Enter what you’re happy to spend')
    expect(profile.textContent).not.toContain('All changes saved')
    expect(byText(profile, 'Save changes', 'button')).not.toBeNull()
  })

  it('a target above the income needs the explicit tick, then saves with an Undo in the toast', async () => {
    const app = demo('mei')
    const { container } = await renderSettings(app)
    const profile = container.querySelector('#set-profile')!
    await changeValue(field(profile, 'Spending target'), '20000')
    expect(profile.textContent).toContain('above your ¥18,500 income')
    await click(byText(profile, 'Save changes', 'button'))
    expect(app.getSnapshot().state.profile!.targetSpend).toBe(950_000)
    const tick = Array.from(profile.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((c) => c.closest('label')?.textContent?.includes('spend more than I earn'))!
    await click(tick)
    await click(byText(profile, 'Save changes', 'button'))
    await flush()
    expect(app.getSnapshot().state.profile!.targetSpend).toBe(2_000_000)
    await click(byText(document.body, 'Undo', 'button'))
    await flush()
    expect(app.getSnapshot().state.profile!.targetSpend).toBe(950_000)
  })
})

describe('Settings deep links (F64)', () => {
  it('only known sections are accepted', () => {
    expect(sectionFromQuery({ s: 'tripwires' })).toBe('set-tripwires')
    expect(sectionFromQuery({ s: 'kill' })).toBe('set-kill')
    expect(sectionFromQuery({ s: '../x' })).toBeNull()
    expect(sectionFromQuery({})).toBeNull()
  })

  it('#/settings?s=tripwires opens at the Tripwires section with focus on its heading', async () => {
    await renderSettings(demo('mei'), '#/settings?s=tripwires')
    await flush(10)
    expect(document.activeElement?.id).toBe('set-tripwires-h')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})

describe('Settings dates and PIN prompts (F55, F68)', () => {
  it('tripwire fires are dated on the sandbox clock (Oct 22), not the device’s', async () => {
    const { container } = await renderSettings(demo('mei'))
    const list = container.querySelector('#set-tripwires')!
    const fired = Array.from(list.querySelectorAll('li')).map((li) => li.textContent ?? '').filter((t) => t.includes('Fired'))
    expect(fired.length).toBeGreaterThan(0)
    for (const t of fired) expect(t).toMatch(/last (Sep|Oct) \d+/)
    expect(fired.join(' ')).toContain('last Oct 22')
  })

  it('the Unfreeze PIN sheet doesn’t print the demo PIN; the sandbox controls do', async () => {
    const app = demo('mei')
    const { container } = await renderSettings(app)
    await click(byText(container, 'Freeze Bun', 'button'))
    await click(byText(container, 'Unfreeze with PIN', 'button'))
    await flush()
    const sheet = document.body.querySelector('[role="dialog"]')!
    expect(sheet.textContent).toContain('Enter your PIN')
    expect(sheet.textContent).not.toContain('2580')
    expect(container.querySelector('#set-sandbox')!.textContent).toContain('Demo PIN 2580')
  })
})
