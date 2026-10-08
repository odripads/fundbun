// @vitest-environment jsdom
import { Fragment, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import type { ChatCard, SuggestedAction } from '../../../core/types'
import { AppProvider, type EngineStatus } from '../../state'
import { ToastProvider, ToastViewport } from '../ds'
import { byText, cleanup, click, flush, render } from '../ds/testing'
import { ActionCard, ApprovalHost, ChatCardView, closeApproval, useProposeAction } from './index'

const TEST_NOW = Date.parse('2026-10-22T10:00:00+08:00')

function demo(): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo('mei')
  return app
}

function Proposer({ action }: { action: SuggestedAction }) {
  const propose = useProposeAction()
  return h('button', { type: 'button', onClick: () => void propose(action) }, 'Go')
}

async function mount(app: FundBunApp, child: ReturnType<typeof h>) {
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, child, h(ApprovalHost), h(ToastViewport)) }) }))
  await flush()
  return r
}

const dialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1) ?? null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TEST_NOW)
})

afterEach(async () => {
  closeApproval()
  await cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useProposeAction', () => {
  it('opens the approval sheet when the policy wants a tap, and "Not now" rejects it', async () => {
    const app = demo()
    const { container } = await mount(app, h(Proposer, { action: { tool: 'pay_bill', args: { billId: app.getSnapshot().derived.upcomingBills.find((b) => b.name === 'Electricity')!.id }, label: 'Pay electricity' } }))
    await click(byText(container, 'Go', 'button'))
    await flush()
    const sheet = dialog()!
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('Enter your PIN to approve')
    await click(byText(sheet, 'Not now', 'button'))
    await flush()
    expect(app.getSnapshot().state.pending.at(-1)!.status).toBe('rejected')
    expect(document.body.textContent).toContain('Okay — nothing ran')
  })

  it('toasts an action that ran on its own, with a working Undo', async () => {
    const app = demo()
    const { container } = await mount(app, h(Proposer, { action: { tool: 'create_tripwire', args: { kind: 'daily_over', threshold: 30_000 }, label: 'Alert me on days over ¥300' } }))
    await click(byText(container, 'Go', 'button'))
    await flush()
    const p = app.getSnapshot().state.pending.at(-1)!
    expect(p.status).toBe('executed')
    const toast = byText(document.body, 'Done', 'p')!.closest('li')!
    await click(byText(toast, 'Undo', 'button'))
    await flush()
    expect(app.getSnapshot().state.pending.find((x) => x.id === p.id)!.status).toBe('undone')
    expect(document.body.textContent).toContain('Undone')
  })

  it('explains a denial with the policy’s own reason', async () => {
    const app = demo()
    const { container } = await mount(app, h(Proposer, { action: { tool: 'transfer_external', args: { amount: 480_000, to: '6222021001123456789' }, label: 'Send it' } }))
    await click(byText(container, 'Go', 'button'))
    await flush()
    expect(document.body.textContent).toContain('Bun can’t do that')
    expect(dialog()).toBeNull()
  })

  it('points read-only buttons at the chat', async () => {
    const app = demo()
    const { container } = await mount(app, h(Proposer, { action: { tool: 'analyze_bills', args: {}, label: 'Check bills' } }))
    await click(byText(container, 'Go', 'button'))
    await flush()
    expect(document.body.textContent).toContain('Bun has the answer')
    expect(byText(document.body, 'Open chat', 'button')).not.toBeNull()
  })
})

describe('ActionCard', () => {
  it('builds the card from the preview and decision only, and renders a one-line receipt', async () => {
    const app = demo()
    await app.sendMessage('Move ¥300 to my Chengdu fund')
    const p = app.getSnapshot().state.pending.at(-1)!
    const { container } = await mount(app, h(Fragment, null, h(ActionCard, { pendingId: p.id }), h(ActionCard, { pendingId: p.id, compact: true })))
    const card = container.querySelector('article')!
    expect(card.dataset.tier).toBe('2')
    expect(card.textContent).toContain(p.preview.title)
    for (const e of p.preview.effects) expect(card.textContent).toContain(e)
    expect(card.textContent).toContain(`Signed · ${p.bindingHash.slice(0, 6)}…`)
    // the seal explains itself
    await click(byText(card, /Signed ·/, 'button'))
    expect(card.textContent).toContain('what you approve is exactly what runs')
    expect(card.textContent).toContain(p.bindingHash)
    // why it needs approval: reasons + rule ids
    await click(byText(card, /Why does this need approval\?/, 'button'))
    expect(card.textContent).toContain('P-TIER-MATRIX')
    const receipt = container.querySelector('[data-phase="pending"]:not(article)')!
    expect(receipt.textContent).toContain('Waiting for your OK')
    expect(byText(receipt as HTMLElement, 'Review', 'button')).not.toBeNull()
  })

  it('renders nothing for an unknown pending id', async () => {
    const { container } = await mount(demo(), h(ActionCard, { pendingId: 'pa_missing' }))
    expect(container.querySelector('article')).toBeNull()
  })
})

describe('ChatCardView', () => {
  it('renders every card type from structured data', async () => {
    const app = demo()
    const cards: ChatCard[] = []
    for (const q of ['How am I doing this month?', 'Where did my money go?', 'Show my Taobao transactions', 'Check my bills', 'List my subscriptions', 'Any insights for me?', 'Can I afford ¥1,299 sneakers?', 'Show my goals', 'Make me a budget plan', 'Explain my electricity bill', 'Help me get back on track', 'Move ¥200 to my fund']) {
      const m = await app.sendMessage(q)
      cards.push(...(m.cards ?? []))
    }
    cards.push({ type: 'notice', level: 'block', title: 'Blocked: test', text: 'Never allowed.' })
    const types = new Set(cards.map((c) => c.type))
    expect([...types].sort()).toEqual(['action', 'affordability', 'breakdown', 'budget', 'clarify', 'findings', 'goals', 'insights', 'mirror', 'notice', 'plan', 'recurring', 'transactions', 'xray'])
    const { container } = await mount(app, h(Fragment, null, ...cards.map((card, i) => h(ChatCardView, { key: i, card }))))
    expect(container.textContent).toContain('Where October went')
    expect(container.textContent).toContain('Bill check')
    expect(container.textContent).toContain('Subscriptions & regulars')
    expect(container.textContent).toContain('What Bun noticed')
    expect(container.textContent).toContain('Not this month')
    expect(container.textContent).toContain('Your dreams')
    expect(container.textContent).toContain('Budget · October')
    expect(container.textContent).toContain('Hidden instructions found — ignored')
    expect(container.textContent).toContain('Task plan')
    expect(Array.from(container.querySelectorAll('[role="alert"]')).some((a) => a.textContent?.includes('Blocked: test'))).toBe(true)
    // an untrusted merchant memo is shown as quoted text, never as markup
    expect(container.textContent).toContain('Note from the merchant (not checked)')
    expect(container.querySelector('script')).toBeNull()
  })
})
