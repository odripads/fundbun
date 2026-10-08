// @vitest-environment jsdom
import { Fragment, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byLabel, byText, changeValue, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { InsightsScreen } from './InsightsScreen'

function demo(id: 'mei' | 'arif'): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app
}

async function renderAt(hash: string, app: FundBunApp) {
  window.history.replaceState(null, '', hash)
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, h(InsightsScreen), h(ToastViewport)) }) }))
  await flush()
  return r
}

const radio = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) => el.textContent?.trim().startsWith(label)) ?? null

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '#')
})

describe('InsightsScreen', () => {
  it('leads with the month: big spend, target, stats and the most useful insight first', async () => {
    const { container } = await renderAt('#/insights', demo('mei'))
    const hero = container.querySelector('section[data-status="over"]')!
    expect(hero).not.toBeNull()
    expect(hero.textContent).toContain('October · day 22 of 31')
    expect(hero.textContent).toContain('¥12,080.24 spent')
    expect(hero.textContent).toContain('Over target')
    expect(hero.textContent).toContain('vs Sep 1–22')
    expect(hero.textContent).toContain('Per day')
    const first = container.querySelector('article')!
    expect(first.textContent).toContain('Heads-up')
    expect(first.textContent).toContain('over — ouch')
    expect(first.querySelector('[aria-label^="AI-generated"]')).not.toBeNull()
    // headings start at h2 (the shell's TopBar owns h1)
    expect(container.querySelector('h1')).toBeNull()
  })

  it('expands "Why?" with the rule and the numbers behind it', async () => {
    const { container } = await renderAt('#/insights', demo('mei'))
    const first = container.querySelector('article')!
    const why = first.querySelector<HTMLButtonElement>('button[aria-label="Why am I seeing this?"]')!
    expect(why.textContent).toContain('Why?')
    expect(why.getAttribute('aria-expanded')).toBe('false')
    await click(why)
    expect(why.getAttribute('aria-expanded')).toBe('true')
    const panel = document.getElementById(why.getAttribute('aria-controls')!)!
    expect(panel.hidden).toBe(false)
    expect(panel.querySelector('table')!.textContent).toContain('Target')
    expect(panel.textContent).toContain('¥9,500')
  })

  it('routes an insight’s suggested action through the policy engine', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'runSuggestedAction')
    const { container } = await renderAt('#/insights', app)
    const first = container.querySelector('article')!
    await click(byText(first, 'Alert me on days over ¥300', 'button'))
    await flush()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].tool).toBe('create_tripwire')
    // copilot runs T1 on its own: the button turns into a "Done" status so it can't be stacked twice
    expect(first.querySelector('[role="status"]')?.textContent).toContain('Done')
    expect(byText(first, 'Alert me on days over ¥300', 'button')).toBeNull()
  })

  it('“Ask Bun” sends an engine-friendly question and opens the chat', async () => {
    const app = demo('mei')
    const send = vi.spyOn(app, 'sendMessage').mockResolvedValue(undefined as never)
    const { container } = await renderAt('#/insights', app)
    const second = container.querySelectorAll('article')[1]
    await click(second.querySelector('button[aria-label="Ask Bun about this"]'))
    await flush()
    expect(send).toHaveBeenCalledWith('How much did I spend on shopping in October?')
    expect(window.location.hash).toBe('#/chat')
  })

  it('switches month from the selector and keeps it in the URL', async () => {
    const { container } = await renderAt('#/insights', demo('mei'))
    await click(radio(container, 'Sep'))
    await flush()
    expect(window.location.hash).toBe('#/insights?month=2026-09')
    expect(container.querySelector('section[data-status]')!.textContent).toContain('September · final')
    // past months don't offer actions that would act on the present
    expect(container.querySelector('article')!.textContent).not.toContain('Alert me on days over')
  })

  it('opens a category sheet and saves a new limit as a user action', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'setCategoryBudget')
    const { container } = await renderAt('#/insights', app)
    const shopping = Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.startsWith('Shopping:'))!
    await click(shopping)
    await flush()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Shopping')
    expect(dialog.textContent).toContain('Purchases')
    const input = dialog.querySelector<HTMLInputElement>('input')!
    expect(input.value).toBe('520')
    await changeValue(input, '900')
    await click(byText(dialog, 'Save', 'button'))
    await flush()
    expect(spy).toHaveBeenCalledWith('shopping', 90000)
    expect(app.getSnapshot().state.budget?.categories.find((c) => c.category === 'shopping')?.limit).toBe(90000)
  })

  it('rejects a junk limit without calling the app', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'setCategoryBudget')
    const { container } = await renderAt('#/insights', app)
    await click(Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label')?.startsWith('Shopping:'))!)
    await flush()
    const dialog = document.querySelector('[role="dialog"]')!
    await changeValue(dialog.querySelector<HTMLInputElement>('input')!, 'lots')
    await click(byText(dialog, 'Save', 'button'))
    expect(spy).not.toHaveBeenCalled()
    expect(dialog.querySelector('[aria-invalid="true"]')).not.toBeNull()
  })

  it('shows the late-night band and top places on Patterns', async () => {
    const { container } = await renderAt('#/insights?tab=patterns', demo('mei'))
    expect(container.textContent).toContain('After 10pm in October')
    const grid = container.querySelector('[role="img"][aria-label^="When you spend in October"]')!
    expect(grid.getAttribute('aria-label')).toMatch(/Late night \(22:00–04:00\)/)
    expect(byLabel(container, 'Filter by category')).toBeNull()
    const top = container.querySelector('ol button')!
    expect(top.getAttribute('aria-label')).toMatch(/^Taobao: /)
    await click(top)
    await flush()
    expect(window.location.hash).toBe('#/insights?tab=transactions&q=Taobao')
  })

  it('searches, filters and re-files a transaction (Bun learns the merchant)', async () => {
    const app = demo('mei')
    const { container } = await renderAt('#/insights?tab=transactions', app)
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    await changeValue(search, 'Heytea')
    await flush()
    expect(window.location.hash).toContain('q=Heytea')
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('li button')).filter((b) => b.getAttribute('aria-label')?.startsWith('Heytea'))
    expect(rows.length).toBeGreaterThan(0)
    const before = app.getSnapshot().state.bank.transactions.find((t) => t.merchant === 'Heytea' && t.date.startsWith('2026-10'))!
    await click(rows[0])
    await flush()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Heytea')
    const groceries = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((r) => r.value === 'groceries')!
    await click(groceries)
    await click(byText(dialog, 'Move to Groceries', 'button'))
    await flush()
    const after = app.getSnapshot().state
    const moved = after.bank.transactions.filter((t) => t.merchant === 'Heytea' && t.category === 'groceries')
    expect(moved).toHaveLength(1)
    expect(moved[0].categorySource).toBe('user')
    expect(Object.values(after.categoryRules)).toContain('groceries')
    expect(before.category).toBe('coffee_tea')
    expect(document.body.textContent).toContain('Bun will remember Heytea')
  })

  it('celebrates an under month for Arif and renders empty data without crashing', async () => {
    const { container } = await renderAt('#/insights', demo('arif'))
    expect(container.querySelector('section[data-status="under"]')).not.toBeNull()
    expect(container.querySelector('article')!.textContent).toContain('Nice one')
    await cleanup()
    const empty = createTestApp({ storage: memoryStorage() })
    const res = empty.completeOnboarding({
      name: 'Test',
      currency: 'CNY',
      monthlyIncome: 1_000_000,
      targetSpend: 500_000,
      payday: 1,
      tone: 'gentle',
      consent: { financialData: true, llmProcessing: false, notifications: false },
      dreams: [{ name: 'Bike', price: 200_000, image: 'preset:gift', kind: 'goal' }],
      autonomy: 'suggest',
      pin: '4826',
      dataSource: { kind: 'empty', startingBalance: 100_000 },
    })
    expect(res.ok).toBe(true)
    const r = await renderAt('#/insights?tab=patterns', empty)
    expect(r.container.textContent).toContain('No timed purchases')
  })
})
