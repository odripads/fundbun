// @vitest-environment jsdom
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import type { ChatCard } from '../../../core/types'
import { AppProvider, type EngineStatus } from '../../state'
import { CreatorSection } from '../../screens/settings/CreatorSection'
import { ChatCardView } from '../agent'
import { BunMascot, Logo } from '../brand'
import { byText, cleanup, click, flush, render } from '../ds/testing'
import { refreshPlugins, resetPluginsStore } from './pluginStore'
import { SHELL_APPEARANCE_KEY, applyShellAppearancePatchNow, getShellAppearance, resetShellAppearanceStore } from './shellAppearance'

function demo(): FundBunApp {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo('mei')
  return app
}

async function mount(app: FundBunApp, card: ChatCard) {
  const status: EngineStatus = { ready: true, app }
  const r = await render(h(AppProvider, { status, children: h(ChatCardView, { card }) }))
  await flush()
  return r
}

const DRAFT: ChatCard = {
  type: 'plugin_draft',
  draftId: 'dr_abc123',
  mode: 'create',
  pluginId: 'coffee-count',
  name: 'Coffee count',
  description: 'Cups this month',
  slot: 'dashboard',
  wide: false,
  icon: 'coffee',
  previewUrl: '/api/plugins/drafts/dr_abc123/frame',
  code: 'function render(root){ root.textContent = "hi" }',
  css: '',
}

afterEach(async () => {
  await cleanup()
  resetPluginsStore()
  localStorage.clear()
  resetShellAppearanceStore()
  vi.restoreAllMocks()
})

const LOOK: ChatCard = {
  type: 'plugin_action',
  action: 'appearance',
  pluginId: 'shell-appearance',
  name: 'Shell appearance',
  proposalId: 'look_abc123',
  patch: { theme: 'midnight', mascotHat: 'kamen_rider', appName: '#ilovemoney' },
  by: 'user',
}

function storedLook(): unknown {
  const raw = localStorage.getItem(SHELL_APPEARANCE_KEY)
  return raw ? JSON.parse(raw) : null
}

describe('plugin chat cards', () => {
  it('shows a sandboxed live preview and installs only when Install is pressed', async () => {
    const app = demo()
    const install = vi.spyOn(app, 'installPlugin').mockResolvedValue({ ok: true })
    const { container } = await mount(app, DRAFT)
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('src')).toMatch(/^\/api\/plugins\/drafts\/dr_abc123\/frame\?token=[a-zA-Z0-9]{8,}$/)
    expect(install).not.toHaveBeenCalled()

    await click(byText(container, 'See code'))
    expect(container.querySelector('pre')?.textContent).toContain('root.textContent')

    await click(byText(container, 'Install'))
    await flush()
    expect(install).toHaveBeenCalledWith('dr_abc123')
    expect(container.textContent).toContain('Installed on Dashboard')
  })

  it('shows why an install failed and keeps the buttons', async () => {
    const app = demo()
    vi.spyOn(app, 'installPlugin').mockResolvedValue({ ok: false, error: 'That preview expired.' })
    const { container } = await mount(app, DRAFT)
    await click(byText(container, 'Install'))
    await flush()
    expect(container.textContent).toContain('That preview expired.')
    expect(byText(container, 'Install')).toBeTruthy()
  })

  it('asks before removing a widget, and Keep it changes nothing', async () => {
    const app = demo()
    const change = vi.spyOn(app, 'changePlugin').mockResolvedValue({ ok: true })
    const card: ChatCard = { type: 'plugin_action', pluginId: 'coffee-count', name: 'Coffee count', action: 'uninstall' }
    const { container } = await mount(app, card)
    expect(container.textContent).toContain('Remove this widget?')
    await click(byText(container, 'Keep it'))
    expect(change).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Kept as it is')
  })

  it('removes the widget once confirmed', async () => {
    const app = demo()
    const change = vi.spyOn(app, 'changePlugin').mockResolvedValue({ ok: true })
    const card: ChatCard = { type: 'plugin_action', pluginId: 'coffee-count', name: 'Coffee count', action: 'uninstall' }
    const { container } = await mount(app, card)
    await click(byText(container, 'Remove'))
    await flush()
    expect(change).toHaveBeenCalledWith('coffee-count', 'uninstall')
    expect(container.textContent).toContain('Removed')
  })
})

describe('shell appearance plugins', () => {
  it('draws the Kamen Rider helmet on Bun: two compound eyes, faceplate, jaw guards, V-fin antennae, red scarf', async () => {
    const { container } = await render(h(BunMascot, { size: 96, hat: 'kamen_rider' }))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('data-hat')).toBe('kamen_rider')
    expect(container.querySelectorAll('[data-hat-part="eye"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-hat-part="antenna"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-hat-part="jaw"]')).toHaveLength(2)
    expect(container.querySelector('[data-hat-part="faceplate"]')).toBeTruthy()
    expect(container.querySelector('[data-hat-part="shell"]')).toBeTruthy()
    expect(container.querySelector('[data-hat-part="scarf"]')).toBeTruthy()
    // the eyes are crimson with honeycomb facets, and Bun's own face is still drawn under the visor
    const eyeFill = container.querySelector('[data-hat-part="eye"] path')?.getAttribute('fill') ?? ''
    expect(eyeFill).toMatch(/^url\(#.+-hat-eye\)$/)
    expect(container.querySelector('pattern')).toBeTruthy()
    expect(svg?.getAttribute('data-mood')).toBe('calm')
  })

  it('draws the helmet on the small cut too, and nothing extra with no headwear', async () => {
    const small = await render(h(BunMascot, { size: 32, hat: 'kamen_rider' }))
    expect(small.container.querySelector('svg')?.getAttribute('data-cut')).toBe('small')
    expect(small.container.querySelectorAll('[data-hat-part="eye"]')).toHaveLength(2)
    const plain = await render(h(BunMascot, { size: 96 }))
    expect(plain.container.querySelector('svg')?.hasAttribute('data-hat')).toBe(false)
    expect(plain.container.querySelector('[data-hat-part]')).toBeNull()
    for (const hat of ['crown', 'cap', 'halo'] as const) {
      const r = await render(h(BunMascot, { size: 96, hat }))
      expect(r.container.querySelector(`[data-hat-part="${hat}"]`), hat).toBeTruthy()
    }
  })

  it('shows a custom app name on the wordmark and keeps a small FundBun line', async () => {
    const { container } = await render(h(Logo, { size: 32, withWordmark: true, appName: '#ilovemoney' }))
    expect(container.textContent).toContain('#ilovemoney')
    expect(container.textContent).toContain('FundBun')
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('#ilovemoney (FundBun)')
    const plain = await render(h(Logo, { size: 32, withWordmark: true }))
    expect(plain.container.textContent).toBe('FundBun')
    expect(plain.container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('FundBun')
  })

  it('previews the look and changes nothing until Apply is pressed', async () => {
    const { container } = await mount(demo(), LOOK)
    // the preview already wears the result
    expect(container.querySelector('[data-look-theme="midnight"]')).toBeTruthy()
    expect(container.querySelector('[data-look-theme] svg')?.getAttribute('data-hat')).toBe('kamen_rider')
    expect(container.textContent).toContain('#ilovemoney')
    expect(container.textContent).toContain('Kamen Rider helmet')
    expect(container.textContent).toContain('Midnight')
    // the page does not
    expect(document.documentElement.hasAttribute('data-shell-theme')).toBe(false)
    expect(document.title).not.toContain('#ilovemoney')
    expect(storedLook()).toBeNull()
    expect(getShellAppearance().theme).toBe('system')
  })

  it('applies to the page, the wordmark, Bun and storage, then Undo puts it all back', async () => {
    const app = demo()
    const status: EngineStatus = { ready: true, app }
    const { container } = await render(
      h(AppProvider, { status, children: [h(Logo, { key: 'logo', size: 32, withWordmark: true }), h(ChatCardView, { key: 'card', card: LOOK })] }),
    )
    await flush()
    const logo = () => container.querySelector('[role="img"][aria-label]')

    await click(byText(container, 'Apply'))
    const root = document.documentElement
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-shell-theme')).toBe('midnight')
    expect(root.style.getPropertyValue('--bg')).toBe('#0b1020')
    expect(document.title).toBe('#ilovemoney · FundBun')
    expect(logo()?.getAttribute('aria-label')).toBe('#ilovemoney (FundBun)')
    expect(logo()?.querySelector('svg')?.getAttribute('data-hat')).toBe('kamen_rider')
    expect(storedLook()).toEqual({ theme: 'midnight', tokens: {}, mascotHat: 'kamen_rider', appName: '#ilovemoney' })
    expect(container.textContent).toContain('Applied')

    await click(byText(container, 'Undo'))
    expect(root.hasAttribute('data-shell-theme')).toBe(false)
    expect(root.hasAttribute('data-theme')).toBe(false)
    expect(root.style.getPropertyValue('--bg')).toBe('')
    expect(document.title).toBe('FundBun')
    expect(logo()?.getAttribute('aria-label')).toBe('FundBun')
    expect(logo()?.querySelector('svg')?.hasAttribute('data-hat')).toBe(false)
    expect(storedLook()).toBeNull()
    expect(byText(container, 'Apply')).toBeTruthy()
  })

  it('keeps the look after a reload: it is read back from storage', async () => {
    localStorage.setItem(SHELL_APPEARANCE_KEY, JSON.stringify({ theme: 'cyberpunk', tokens: {}, mascotHat: 'kamen_rider', appName: '#ilovemoney' }))
    resetShellAppearanceStore()
    const { container } = await render(h(Logo, { size: 32, withWordmark: true }))
    expect(container.textContent).toContain('#ilovemoney')
    expect(container.querySelector('svg')?.getAttribute('data-hat')).toBe('kamen_rider')
  })

  it('ignores a stored look that was tampered with', async () => {
    localStorage.setItem(SHELL_APPEARANCE_KEY, JSON.stringify({ theme: 'dark', tokens: { '--bg': 'url(https://evil.example/x)' }, mascotHat: 'bomb', appName: 'x'.repeat(200) }))
    resetShellAppearanceStore()
    expect(getShellAppearance()).toEqual({ theme: 'dark', tokens: {}, mascotHat: 'none', appName: null })
  })

  it('cannot be applied when the turn was tainted', async () => {
    const blocked: ChatCard = { ...LOOK, blocked: 'This turn includes untrusted content (a file, a bill or pasted text), so changing the look is blocked.' }
    const { container } = await mount(demo(), blocked)
    expect(container.textContent).toContain('Apply is blocked')
    const apply = byText(container, 'Apply', 'button')
    expect((apply as HTMLButtonElement | null)?.disabled).toBe(true)
    await click(apply)
    expect(document.documentElement.hasAttribute('data-shell-theme')).toBe(false)
    expect(storedLook()).toBeNull()
  })

  it('cannot be applied while Bun is paused by the kill switch', async () => {
    const app = demo()
    app.freeze()
    const { container } = await mount(app, LOOK)
    expect(container.textContent).toContain('kill switch')
    expect((byText(container, 'Apply', 'button') as HTMLButtonElement | null)?.disabled).toBe(true)
  })

  it('refuses a card whose patch is outside the spec', async () => {
    const bad = { ...LOOK, patch: { theme: 'midnight', tokens: { '--bg': 'url(https://evil.example/x)' } } } as unknown
    const { container } = await mount(demo(), bad as ChatCard)
    expect(container.textContent).toContain('cannot be applied')
    expect(byText(container, 'Apply')).toBeNull()
  })

  it('Reset look on the card goes back to FundBun at once', async () => {
    applyShellAppearancePatchNow({ theme: 'sakura', appName: 'Piggy' })
    expect(document.documentElement.getAttribute('data-shell-theme')).toBe('sakura')
    const { container } = await mount(demo(), LOOK)
    await click(byText(container, 'Reset look'))
    expect(document.documentElement.hasAttribute('data-shell-theme')).toBe(false)
    expect(document.title).toBe('FundBun')
    expect(storedLook()).toBeNull()
  })

  it('Settings lists the active customizations and resets them in one tap', async () => {
    const app = demo()
    const state = { local: true, enabled: true, plugins: [], starters: [] }
    const client = { state: async () => state, syncEnabled: async () => true, baseUrl: '/api' }
    Object.defineProperty(app, 'plugins', { value: client, configurable: true })
    await refreshPlugins(app.plugins)
    applyShellAppearancePatchNow({ theme: 'cyberpunk', mascotHat: 'kamen_rider', appName: '#ilovemoney' })
    const status: EngineStatus = { ready: true, app }
    const { container } = await render(h(AppProvider, { status, children: h(CreatorSection) }))
    await flush()
    expect(container.querySelector('[data-shell-row="theme"]')?.textContent).toContain('Cyberpunk')
    expect(container.querySelector('[data-shell-row="mascot"]')?.textContent).toContain('Kamen Rider helmet')
    expect(container.querySelector('[data-shell-row="name"]')?.textContent).toContain('#ilovemoney')

    await click(byText(container, 'Reset Shell Appearance', 'button'))
    expect(container.querySelector('[data-shell-row]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-shell-theme')).toBe(false)
    expect(storedLook()).toBeNull()
    expect((byText(container, 'Reset Shell Appearance', 'button') as HTMLButtonElement | null)?.disabled).toBe(true)
  })
})
