// @vitest-environment jsdom
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { byLabel, byText, cleanup, click, render } from '../ds/testing'
import { AppFrame } from './AppFrame'
import { EngineNotReady } from './EngineNotReady'
import { ErrorBoundary } from './ErrorBoundary'
import { GlassBoxSlot } from './GlassBoxSlot'
import { ScreenTopBar } from './ScreenTopBar'
import { agentStatus } from './ShellActions'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
})

describe('agentStatus', () => {
  it('distinguishes on, paused and breaker-tripped', () => {
    expect(agentStatus(false)).toBe('active')
    expect(agentStatus(false, '2026-10-22T10:00:00Z')).toBe('active')
    expect(agentStatus(true)).toBe('paused')
    expect(agentStatus(true, '2026-10-22T10:00:00Z')).toBe('breaker')
  })
})

describe('TabBar', () => {
  it('renders five slots in order with the current page marked', async () => {
    const { container } = await render(h(TabBar, { active: 'insights', badges: { chat: 2, bills: true } }))
    const nav = container.querySelector('nav[aria-label="Primary"]')!
    const links = Array.from(nav.querySelectorAll('a'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/home', '#/insights', '#/chat', '#/bills', '#/goals'])
    expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href'))).toEqual(['#/insights'])
    expect(links[2].getAttribute('aria-label')).toBe('Ask Bun, your AI money buddy, 2 new')
    expect(links[3].getAttribute('aria-label')).toBe('Bills, new')
    expect(links[0].getAttribute('aria-label')).toBe('Home')
  })

  it('marks nothing current on non-tab pages', async () => {
    const { container } = await render(h(TabBar, { active: null }))
    expect(container.querySelector('[aria-current]')).toBeNull()
  })
})

describe('TopBar', () => {
  it('renders the title as the page h1 and a back button', async () => {
    const onBack = vi.fn()
    const { container } = await render(h(TopBar, { title: 'Settings', onBack, actions: h('button', null, 'x') }))
    expect(container.querySelector('h1')!.textContent).toBe('Settings')
    await click(byLabel(container, 'Back'))
    expect(onBack).toHaveBeenCalled()
  })

  it('brand mode shows the logo and keeps the h1 for screen readers', async () => {
    const { container } = await render(h(TopBar, { title: 'Home', brand: true }))
    const h1 = container.querySelector('h1')!
    expect(h1.textContent).toBe('Home')
    expect(h1.className).toBe('sr-only')
  })
})

describe('GlassBoxSlot', () => {
  it('is a labelled complementary region that shows a working state', async () => {
    const { container } = await render(h(GlassBoxSlot, { busy: true, children: h('p', null, 'trace') }))
    const aside = container.querySelector('aside')!
    expect(document.getElementById(aside.getAttribute('aria-labelledby')!)!.textContent).toBe('Glass box')
    expect(aside.textContent).toContain('Working')
    expect(aside.textContent).toContain('trace')
    expect(aside.textContent).toContain('Sandbox bank')
  })
})

describe('AppFrame', () => {
  it('renders main, bars, overlay root and the glass box only when given', async () => {
    const { container } = await render(
      h(AppFrame, { chrome: 'app', topBar: h('header', { id: 'tb' }, 'top'), tabBar: h('nav', { id: 'nav' }), glassBox: h('p', null, 'glass'), children: h('p', null, 'page') }),
    )
    const main = container.querySelector('main#main')!
    expect(main.textContent).toBe('page')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(container.querySelector('#tb')!.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('#nav')).not.toBeNull()
    expect(container.querySelector('aside')).not.toBeNull()
    expect(container.querySelector('[data-tabbar]')).not.toBeNull()
  })

  it('omits the glass box on wide pages and without content', async () => {
    const a = await render(h(AppFrame, { chrome: 'wide', glassBox: h('p', null, 'x'), children: 'page' }))
    expect(a.container.querySelector('aside')).toBeNull()
    const b = await render(h(AppFrame, { chrome: 'app', children: 'page' }))
    expect(b.container.querySelector('aside')).toBeNull()
  })

  it('ScreenTopBar lands in the slot above <main>', async () => {
    const { container } = await render(h(AppFrame, { chrome: 'app', children: h(ScreenTopBar, { title: 'Ask Bun' }) }))
    const header = container.querySelector('header')!
    const main = container.querySelector('main')!
    expect(main.contains(header)).toBe(false)
    expect(header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('moves focus to main when the page changes (not on first render)', async () => {
    const r = await render(h(AppFrame, { chrome: 'app', pageKey: 'home', children: 'home' }))
    expect(document.activeElement).not.toBe(r.container.querySelector('main'))
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    await r.rerender(h(AppFrame, { chrome: 'app', pageKey: 'bills', children: 'bills' }))
    expect(document.activeElement).toBe(r.container.querySelector('main'))
  })

  it('the skip link focuses main without touching the hash', async () => {
    window.history.replaceState(null, '', '#/home')
    const { container } = await render(h(AppFrame, { chrome: 'app', children: 'page' }))
    await click(byText(container, 'Skip to content', 'a'))
    expect(document.activeElement).toBe(container.querySelector('main'))
    expect(window.location.hash).toBe('#/home')
  })
})

describe('EngineNotReady and ErrorBoundary', () => {
  it('offers a retry and shows technical details', async () => {
    const onRetry = vi.fn()
    const { container } = await render(h(EngineNotReady, { error: 'TODO loadPersona', onRetry }))
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('code')!.textContent).toBe('TODO loadPersona')
    await click(byText(container, 'Try again', 'button'))
    expect(onRetry).toHaveBeenCalled()
  })

  it('catches a crashing child and resets when the key changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('kaboom')
    }
    const fallback = (e: Error) => h('p', null, `caught ${e.message}`)
    const r = await render(h(ErrorBoundary, { fallback, resetKey: 'a', children: h(Boom) }))
    expect(r.container.textContent).toBe('caught kaboom')
    await r.rerender(h(ErrorBoundary, { fallback, resetKey: 'b', children: h('p', null, 'fine') }))
    expect(r.container.textContent).toBe('fine')
  })
})
