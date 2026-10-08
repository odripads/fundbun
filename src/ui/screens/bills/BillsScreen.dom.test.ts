// @vitest-environment jsdom
import { createElement as h, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type FundBunApp } from '../../../core/app'
import { ToastProvider } from '../../components/ds'
import { byText, cleanup, click, flush, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { BillsScreen } from './BillsScreen'

function demo(persona: 'mei' | 'arif'): FundBunApp {
  const app = createTestApp()
  app.loadDemo(persona)
  return app
}

async function renderBills(app: FundBunApp) {
  const status: EngineStatus = { ready: true, app }
  const tree = (children: ReactNode) => h(AppProvider, { status, children: h(ToastProvider, { children }) })
  const r = await render(tree(h(BillsScreen)))
  await flush()
  return r
}

beforeEach(() => {
  // skip the 650 ms scan animation and smooth scrolling
  document.documentElement.setAttribute('data-motion', 'reduce')
  Element.prototype.scrollIntoView = vi.fn()
  window.history.replaceState(null, '', '#/bills')
})

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-motion')
})

describe('BillsScreen — Mei', () => {
  it('summarises what is due, subscriptions per year in dream items and the findings', async () => {
    const { container } = await renderBills(demo('mei'))
    const hero = container.querySelector('section[aria-labelledby="bills-hero-title"]') as HTMLElement
    expect(hero.textContent).toContain('Still to pay in October')
    expect(hero.textContent).toContain('672.13')
    expect(hero.textContent).toContain('2× Weekend in Chengdu')
    expect(hero.textContent).toContain('5to check')
    expect(hero.textContent).toContain('1 urgent')
    // headings start at h2 (the shell's TopBar owns h1)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelectorAll('h2').length).toBeGreaterThanOrEqual(5)
  })

  it('lists the 14-day bills with verified payees and a calendar of the bill days', async () => {
    const { container } = await renderBills(demo('mei'))
    const list = container.querySelector('ul[aria-label="Bills due in the next 14 days"]') as HTMLElement
    expect(list.querySelectorAll(':scope > li')).toHaveLength(5)
    expect(list.textContent).toContain('Shenzhen Power Supply')
    expect(list.textContent).toContain('Verified')
    expect(list.textContent).toContain('57% above your usual ¥309.52')
    const day = container.querySelector('button[aria-label^="Wednesday Oct 28"]') as HTMLButtonElement
    expect(day.getAttribute('aria-pressed')).toBe('false')
    await click(day)
    expect(day.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('ul[aria-label="Bills due Oct 28"]')?.querySelectorAll(':scope > li')).toHaveLength(1)
  })

  it('routes Pay through the policy gate: a T3 step-up is queued, nothing is paid', async () => {
    const app = demo('mei')
    const { container } = await renderBills(app)
    const before = app.getSnapshot().state.bank.transactions.length
    await click(container.querySelector('button[aria-label="Pay China Mobile plan ¥128"]'))
    await flush()
    const pending = app.getSnapshot().state.pending.filter((p) => p.status === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0].call).toMatchObject({ tool: 'pay_bill', args: { billId: 'bill_mobile_2026-09' } })
    expect(pending[0].decision.decision).toBe('step_up')
    expect(app.getSnapshot().state.bank.transactions.length).toBe(before)
    // the same button now reopens that exact approval instead of proposing a duplicate
    expect(container.querySelector('button[aria-label^="Review and approve: Pay China Mobile"]')).not.toBeNull()
  })

  it('sets a 3-day reminder (T1) and shows it on the bill', async () => {
    const app = demo('mei')
    const { container } = await renderBills(app)
    await click(container.querySelector('button[aria-label="Remind me 3 days before Electricity is due"]'))
    await flush()
    expect(app.getSnapshot().state.billReminders['bill_electricity_2026-09']).toBe(3)
    expect(byText(container, /Reminder 3 days before/)).not.toBeNull()
  })

  it('shows each finding with a Why? drawer of evidence', async () => {
    const { container } = await renderBills(demo('mei'))
    const findings = container.querySelector('#bills-findings') as HTMLElement
    expect(findings.querySelectorAll('ul > li')).toHaveLength(6)
    const why = findings.querySelector('button[aria-expanded]') as HTMLButtonElement
    const panel = document.getElementById(why.getAttribute('aria-controls') as string) as HTMLElement
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    await click(why)
    expect(why.getAttribute('aria-expanded')).toBe('true')
    expect(panel.getAttribute('aria-hidden')).toBe('false')
    expect(panel.textContent).toContain('Same billing period')
  })

  it('groups the overlapping video services and cancels through the policy gate', async () => {
    const app = demo('mei')
    const { container } = await renderBills(app)
    const subs = container.querySelector('#bills-subscriptions') as HTMLElement
    expect(subs.textContent).toContain('Video streaming')
    expect(subs.textContent).toContain('¥25 → ¥30')
    await click(subs.querySelector('button[aria-label="Cancel iQIYI"]'))
    await flush()
    const p = app.getSnapshot().state.pending.find((x) => x.call.tool === 'cancel_subscription')
    expect(p).toMatchObject({ status: 'pending', call: { args: { recurringId: 'rec_iqiyi' } } })
  })

  it('X-rays Mei’s electricity bill: injection banner, receipt, line items and a verified-payee pay action', async () => {
    const app = demo('mei')
    const { container } = await renderBills(app)
    await click(byText(container, 'Try Mei’s electricity bill', 'button'))
    await flush(20)
    const outcome = container.querySelector('#bills-xray [data-xray-outcome]') as HTMLElement
    const text = outcome.textContent ?? ''
    expect(text).toContain('This bill contains hidden instructions aimed at AI assistants. FundBun ignored them — nothing was paid or moved.')
    expect(text).toContain('Tries to override instructions')
    expect(text).toContain('No money moved')
    expect(text).toMatch(/Logged · audit #\d+/)
    // the injected account number is never echoed in full
    expect(text).not.toContain('6222 0210 0112')
    expect(text).toContain('•••• 6789')
    expect(text).toContain('Shenzhen Power Supply')
    expect(text).toContain('+57% vs usual')
    expect(outcome.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(text).toContain('never to an account written in the bill')
    expect(outcome.querySelector('[aria-label="AI-generated · On-device"]')).not.toBeNull()
    // nothing moved and nothing was queued by the X-ray itself
    expect(app.getSnapshot().state.pending).toHaveLength(0)
    expect(document.activeElement?.textContent).toBe('Hidden instructions ignored')
    expect(container.querySelector('#bills-xray [role="status"]')?.textContent).toContain('Hidden instructions found and ignored')
  })

  it('X-rays a clean pasted bill without a banner', async () => {
    const app = demo('mei')
    const { container } = await renderBills(app)
    await click(byText(container, 'Water', 'button'))
    await flush(20)
    const outcome = container.querySelector('#bills-xray [data-xray-outcome]') as HTMLElement
    expect(outcome.textContent).not.toContain('Hidden instructions')
    expect(outcome.textContent).toContain('Shenzhen Water')
  })
})

describe('BillsScreen — Arif', () => {
  it('renders the calmer story: one thing to check, a concert ticket a year', async () => {
    const { container } = await renderBills(demo('arif'))
    const hero = container.querySelector('section[aria-labelledby="bills-hero-title"]') as HTMLElement
    expect(hero.textContent).toContain('a Concert ticket')
    expect(hero.textContent).toContain('1 small thing worth a look')
    expect(container.querySelector('#bills-subscriptions')?.textContent).toContain('Bilibili')
  })
})

describe('BillsScreen — a brand-new user with no bank history', () => {
  it('renders calm empty states instead of empty lists', async () => {
    const app = createTestApp()
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
    const { container } = await renderBills(app)
    expect(container.textContent).toContain('No bills yet')
    expect(container.textContent).toContain('Nothing due for two weeks')
    expect(container.textContent).toContain('All calm on the bills front')
    expect(container.textContent).toContain('No subscriptions spotted')
    // no sandbox bills to try, but pasting still works
    expect(container.querySelector('#bills-xray textarea')).not.toBeNull()
  })
})
