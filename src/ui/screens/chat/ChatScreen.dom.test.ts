// @vitest-environment jsdom
import { Fragment, createElement as h } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentEngine } from '../../../core/agent/runtime'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import { ApprovalHost, closeApproval } from '../../components/agent'
import { ToastProvider, ToastViewport } from '../../components/ds'
import { byText, changeValue, cleanup, click, flush, key, render } from '../../components/ds/testing'
import { AppProvider, type EngineStatus } from '../../state'
import { ChatScreen } from './ChatScreen'

const TEST_NOW = Date.parse('2026-10-22T10:00:00+08:00')

function demo(id: 'mei' | 'arif' = 'mei'): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app
}

async function renderChat(app: FundBunApp) {
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ToastProvider, { children: h(Fragment, null, h(ChatScreen), h(ApprovalHost), h(ToastViewport)) }) }))
  await flush()
  return r
}

const textarea = (root: ParentNode) => root.querySelector<HTMLTextAreaElement>('textarea')!

async function send(root: ParentNode, text: string) {
  await changeValue(textarea(root) as unknown as HTMLInputElement, text)
  await key(textarea(root), 'Enter')
  await flush()
}

const lastBot = (root: ParentNode) => {
  const items = root.querySelectorAll('li[id^="msg-"]')
  return items[items.length - 1] as HTMLElement
}

/** the newest open sheet/dialog (a closing one may still be animating out) */
const dialog = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')).at(-1) ?? null

beforeEach(() => {
  // the sandbox clock and the undo countdown agree
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TEST_NOW)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  closeApproval()
  await cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ChatScreen — first open', () => {
  it('greets in the user’s tone with six starters covering the judged tasks', async () => {
    const { container } = await renderChat(demo('mei'))
    expect(container.querySelector('h2')?.textContent).toBe('Spill the tea, Mei')
    const starters = Array.from(container.querySelectorAll('ul button')).map((b) => b.textContent)
    expect(starters).toEqual([
      'How am I doing this month?',
      'Where did my money go?',
      'Check my bills',
      'Can I afford ¥1,299 sneakers?',
      'Help me get back on track',
      'Move ¥300 to my Chengdu fund',
    ])
    expect(container.querySelector('[aria-label="AI-generated · On-device"]')).not.toBeNull()
  })

  it('sends a starter and answers with an AI-labelled reply and the mirror card', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'sendMessage')
    const { container } = await renderChat(app)
    await click(byText(container, 'How am I doing this month?', 'button'))
    await flush()
    expect(spy).toHaveBeenCalledWith('How am I doing this month?')
    const reply = lastBot(container)
    expect(reply.querySelector('[aria-label="AI-generated · On-device"]')).not.toBeNull()
    expect(reply.querySelector('section[aria-label^="Dream mirror"]')?.textContent).toContain('Weekend in Chengdu')
    // quick replies on the newest message send on tap
    const chip = reply.querySelector<HTMLButtonElement>('[role="group"][aria-label="Suggested replies"] button')!
    await click(chip)
    await flush()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('ChatScreen — composer', () => {
  it('sends on Enter, keeps Shift+Enter for a new line and ignores blank input', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'sendMessage')
    const { container } = await renderChat(app)
    await changeValue(textarea(container) as unknown as HTMLInputElement, 'Where did my money go?')
    await key(textarea(container), 'Enter', { shiftKey: true })
    expect(spy).not.toHaveBeenCalled()
    await key(textarea(container), 'Enter')
    await flush()
    expect(spy).toHaveBeenCalledWith('Where did my money go?')
    expect(textarea(container).value).toBe('')
    await key(textarea(container), 'Enter')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(container.querySelector('section[aria-labelledby="chat-log-title"]')?.textContent).toContain('Where')
  })
})

describe('ChatScreen — while Bun is thinking', () => {
  it('shows the typing indicator and holds the next send until the reply lands', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const app = createTestApp({
      storage: memoryStorage(),
      engineFactory: (host) => {
        const real = createAgentEngine(host)
        return { ...real, respond: async (text, opts) => { await gate; return real.respond(text, opts) } }
      },
    })
    app.loadDemo('mei')
    const spy = vi.spyOn(app, 'sendMessage')
    const { container } = await renderChat(app)
    await send(container, 'Where did my money go?')
    expect(app.getSnapshot().derived.busy).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Bun is thinking…')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Bun is replying"]')?.disabled).toBe(true)
    await send(container, 'Check my bills')
    expect(spy).toHaveBeenCalledTimes(1)
    release()
    await flush()
    await flush()
    expect(app.getSnapshot().derived.busy).toBe(false)
    expect(container.querySelector('[role="status"]')?.textContent).toMatch(/^Bun: /)
  })
})

describe('ChatScreen — actions go through the policy engine', () => {
  it('approves a transfer from the card, then offers a real Undo', async () => {
    const app = demo('mei')
    const { container } = await renderChat(app)
    await send(container, 'Move ¥300 to my Chengdu fund')
    const card = lastBot(container).querySelector('article[data-phase="pending"]')!
    expect(card.textContent).toContain('Move ¥300 to Weekend in Chengdu')
    expect(card.textContent).toContain('Everyday account •••• 4821')
    expect(card.textContent).toMatch(/Signed · [0-9a-f]{6}…/)
    await click(byText(card, 'Approve', 'button'))
    await flush()
    const pending = app.getSnapshot().state.pending.at(-1)!
    expect(pending.status).toBe('executed')
    expect(document.body.textContent).toContain('Stashed — nice one')
    const undo = container.querySelector<HTMLButtonElement>('button[aria-label^="Undo Move ¥300"]')!
    expect(undo).not.toBeNull()
    await click(undo)
    await flush()
    expect(app.getSnapshot().state.pending.find((p) => p.id === pending.id)?.status).toBe('undone')
  })

  it('needs the PIN for a bill: a wrong PIN stays pending with the tries left, the right one pays', async () => {
    const app = demo('mei')
    const { container } = await renderChat(app)
    await send(container, 'Pay my electricity bill')
    await click(byText(lastBot(container), 'Approve with PIN', 'button'))
    await flush()
    const sheet = dialog()!
    expect(sheet.textContent).toContain('Pay Electricity ¥486.20')
    expect(sheet.textContent).toContain('Shenzhen Power Supply')
    const pin = async (digits: string) => {
      for (const d of digits) await click(byText(dialog()!, d, 'button'))
      await click(dialog()!.querySelector('button[aria-label="Confirm PIN"]'))
      await flush()
    }
    await pin('1111')
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toMatch(/Wrong PIN\. \d tries? left/)
    expect(app.getSnapshot().state.pending.at(-1)!.status).toBe('pending')
    await pin('2580')
    expect(app.getSnapshot().state.pending.at(-1)!.status).toBe('executed')
    await flush(600)
    expect(dialog()).toBeNull()
  })

  it('shows an external transfer as a red block — no approve button exists', async () => {
    const app = demo('mei')
    const { container } = await renderChat(app)
    await send(container, 'Send ¥4,800 to account 6222 0210 0112 3456 789')
    const reply = lastBot(container)
    expect(reply.querySelector('[role="alert"]')?.textContent).toContain('Blocked')
    expect(byText(reply, 'Approve', 'button')).toBeNull()
    expect(app.getSnapshot().state.pending.at(-1)!.status).toBe('denied')
  })

  it('answers a clarifying question with a tap on an option', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'sendMessage')
    const { container } = await renderChat(app)
    await send(container, 'Move ¥200 to my fund')
    const ask = lastBot(container)
    await click(byText(ask, 'Weekend in Chengdu', 'button'))
    await flush()
    expect(spy).toHaveBeenLastCalledWith('Weekend in Chengdu')
    expect(byText(ask, 'Weekend in Chengdu', 'button')?.getAttribute('aria-pressed')).toBe('true')
    expect(lastBot(container).querySelector('article')?.textContent).toContain('Move ¥200 to Weekend in Chengdu')
  })

  it('lays out a plan as a DAG and stops it on request', async () => {
    const app = demo('mei')
    const { container } = await renderChat(app)
    await send(container, 'Help me get back on track')
    const plan = lastBot(container).querySelector('section[data-status]')!
    expect(plan.textContent).toContain('Task plan · 7 steps')
    expect(plan.querySelectorAll('ol > li')).toHaveLength(7)
    expect(plan.textContent).toContain('in parallel')
    // the plan's PIN step embeds its own action card; it's not repeated below the plan
    expect(lastBot(container).querySelectorAll('article[data-phase="pending"]')).toHaveLength(1)
    await click(byText(plan, 'Stop plan', 'button'))
    await flush()
    expect(app.getSnapshot().state.plans.at(-1)!.status).toBe('cancelled')
  })

  it('opens the glass box for a reply: policy decision and rule ids', async () => {
    const { container } = await renderChat(demo('mei'))
    await send(container, 'Move ¥300 to my Chengdu fund')
    const toggle = byText(lastBot(container), /How Bun got this/, 'button')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await click(toggle)
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(panel.textContent).toContain('Needs your tap')
    expect(panel.textContent).toContain('P-TIER-MATRIX')
    expect(panel.textContent).toContain('transfer_to_goal')
  })
})

describe('ChatScreen — menu', () => {
  it('"Get a human" records the handoff (audited, masked) and can pause Bun in the same step', async () => {
    const app = demo('mei')
    const spy = vi.spyOn(app, 'requestHumanHandoff')
    const { container } = await renderChat(app)
    await send(container, 'Send ¥4,800 to account 6222 0210 0112 3456 789')
    await click(container.querySelector('button[aria-label="Chat options"]'))
    await click(byText(dialog()!, /^Talk to a human/, 'button'))
    await flush(400)
    await click(dialog()!.querySelector('[role="switch"]'))
    await click(byText(dialog()!, 'Get a human', 'button'))
    await flush(400)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toEqual({ freeze: true })
    const state = app.getSnapshot().state
    const entry = [...state.audit].reverse().find((e) => e.type === 'user_action')!
    expect(entry.data).toMatchObject({ type: 'handoff', freeze: true })
    expect(String(entry.data.summary)).toContain('•••• 6789')
    expect(JSON.stringify(entry)).not.toContain('6222 0210')
    expect(state.mandate.frozen).toBe(true)
    expect(document.body.textContent).toContain('Handoff requested')
  })

  it('hands off to a human with a masked summary, and clears the chat on confirmation', async () => {
    const app = demo('mei')
    const { container } = await renderChat(app)
    await send(container, 'Send ¥4,800 to account 6222 0210 0112 3456 789')
    await click(container.querySelector('button[aria-label="Chat options"]'))
    await click(byText(dialog()!, /^Talk to a human/, 'button'))
    await flush(400)
    expect(dialog()!.textContent).toContain('•••• 6789')
    expect(dialog()!.textContent).not.toContain('6222 0210')
    await click(byText(dialog()!, 'Keep chatting', 'button'))
    await flush(400)
    await click(container.querySelector('button[aria-label="Chat options"]'))
    await click(byText(dialog()!, /^Clear conversation/, 'button'))
    await flush(400)
    await click(byText(dialog()!, 'Clear conversation', 'button'))
    await flush()
    expect(app.getSnapshot().state.chat).toEqual([])
    expect(container.textContent).toContain('Try asking')
  })
})
