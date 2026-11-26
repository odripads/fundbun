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
import { synthesizeShellTheme } from '../../../core/plugins/appearance'
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

const SAMURAI = '<path d="M120 150C140 70 372 70 392 150Z" fill="#b3202a" stroke="#24180f" stroke-width="10"/><circle cx="256" cy="60" r="18" fill="#f2bd3d"/>'
const HOSTILE = '<path d="M0 0L9 9" onclick="alert(1)"/><script>alert(1)</script><image href="https://evil.example/x.png"/>'

function customLook(patch: Record<string, unknown>): ChatCard {
  return { type: 'plugin_action', action: 'appearance', pluginId: 'shell-appearance', name: 'Shell appearance', proposalId: 'look_custom', patch, by: 'ai' } as ChatCard
}

describe('adaptive shell: built-in wardrobe, custom costumes and ergonomics', () => {
  it('draws each new built-in item on Bun', async () => {
    for (const [hat, part, count] of [
      ['wizard', '[data-hat-part="wizard"] path', 5],
      ['sunglasses', '[data-hat-part="lens"]', 2],
      ['headphones', '[data-hat-part="cup"]', 2],
      ['cat_ears', '[data-hat-part="ear"]', 2],
      ['chef', '[data-hat-part="chef"] path', 4],
    ] as const) {
      const { container } = await render(h(BunMascot, { size: 96, hat }))
      expect(container.querySelector('svg')?.getAttribute('data-hat'), hat).toBe(hat)
      expect(container.querySelector(`[data-hat-part="${hat}"]`), hat).toBeTruthy()
      expect(container.querySelectorAll(part), hat).toHaveLength(count)
      // Bun's own face is still there under every item
      expect(container.querySelector('svg')?.getAttribute('data-mood'), hat).toBe('calm')
    }
  })

  it('draws a custom costume as plain SVG elements, clipped to Bun', async () => {
    const { container } = await render(h(BunMascot, { size: 96, costumeSvg: SAMURAI }))
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('data-hat')).toBe('custom')
    const costume = container.querySelector('[data-hat-part="custom"]')
    expect(costume).toBeTruthy()
    const path = costume?.querySelector('path')
    expect(path?.getAttribute('d')).toBe('M120 150C140 70 372 70 392 150Z')
    expect(path?.getAttribute('fill')).toBe('#b3202a')
    expect(path?.getAttribute('stroke-width')).toBe('10')
    expect(costume?.querySelector('circle')?.getAttribute('r')).toBe('18')
    // every drawn node is a real SVG element built by React
    expect(path?.namespaceURI).toBe('http://www.w3.org/2000/svg')
    // the costume cannot paint outside Bun's own box
    const clip = costume?.getAttribute('clip-path') ?? ''
    expect(clip).toMatch(/^url\(#.+-frame\)$/)
    const frame = container.querySelector(`clipPath[id="${clip.slice(5, -1)}"] rect`)
    expect(frame?.getAttribute('width')).toBe('512')
    expect(frame?.getAttribute('height')).toBe('512')
    // worn with a built-in item, both are drawn
    const both = await render(h(BunMascot, { size: 96, hat: 'sunglasses', costumeSvg: SAMURAI }))
    expect(both.container.querySelector('[data-hat-part="sunglasses"]')).toBeTruthy()
    expect(both.container.querySelector('[data-hat-part="custom"]')).toBeTruthy()
    // and the small cut draws it too
    const small = await render(h(BunMascot, { size: 32, costumeSvg: SAMURAI }))
    expect(small.container.querySelector('[data-hat-part="custom"] path')).toBeTruthy()
  })

  it('draws nothing at all from hostile SVG: no script, no handler, no image', async () => {
    for (const bad of [HOSTILE, '<script>alert(1)</script>', '<circle r="5" onclick="alert(1)"/>', '<rect width="9" height="9" fill="url(#x)"/>', '<foreignObject><iframe src="https://evil.example"/></foreignObject>', `${SAMURAI}<script>alert(1)</script>`]) {
      const { container } = await render(h(BunMascot, { size: 96, costumeSvg: bad }))
      expect(container.querySelector('[data-hat-part="custom"]'), bad).toBeNull()
      expect(container.querySelector('svg')?.hasAttribute('data-hat'), bad).toBe(false)
      expect(container.querySelectorAll('script, image, foreignObject, iframe, style'), bad).toHaveLength(0)
      // Bun's own body is the only thing that uses <use>, and only to point at its own outline
      for (const use of Array.from(container.querySelectorAll('use'))) expect(use.getAttribute('href'), bad).toMatch(/^#fb[\w-]+-body$/)
      expect(container.innerHTML, bad).not.toMatch(/onclick|javascript:|evil\.example|url\(#x\)/)
      for (const el of Array.from(container.querySelectorAll('*'))) {
        for (const name of el.getAttributeNames()) expect(name.startsWith('on'), `${bad} ${name}`).toBe(false)
      }
    }
  })

  it('previews a custom costume, a named palette and ergonomics, and changes nothing until Apply', async () => {
    const matcha = synthesizeShellTheme('matcha')
    const card = customLook({ ...matcha, mascotSvg: SAMURAI, mascotLabel: 'Samurai helmet', fontStyle: 'mono', fontScale: 'large', radius: 'round', density: 'cozy' })
    const { container } = await mount(demo(), card)
    const preview = container.querySelector<HTMLElement>('[data-look-theme]')
    expect(preview?.getAttribute('data-look-theme')).toBe('light')
    expect(preview?.getAttribute('data-look-font')).toBe('mono')
    expect(preview?.getAttribute('data-look-scale')).toBe('large')
    expect(preview?.getAttribute('data-look-radius')).toBe('round')
    expect(preview?.getAttribute('data-look-density')).toBe('cozy')
    // the costume is drawn live on Bun inside the preview banner
    expect(preview?.querySelector('svg')?.getAttribute('data-hat')).toBe('custom')
    expect(preview?.querySelector('[data-hat-part="custom"] path')?.getAttribute('fill')).toBe('#b3202a')
    expect(preview?.querySelector('script')).toBeNull()
    // the preview wears the proposed colours, type, corners and text size
    expect(preview?.style.getPropertyValue('--bg')).toBe(matcha?.tokens['--bg'])
    expect(preview?.style.getPropertyValue('--font-ui')).toContain('ui-monospace')
    expect(preview?.style.getPropertyValue('--r-md')).toBe('20px')
    expect(preview?.style.getPropertyValue('--s-4')).toBe('18px')
    expect(preview?.style.getPropertyValue('--look-scale')).toBe('1.125')
    expect(preview?.getAttribute('aria-label')).toContain('Matcha theme')
    expect(preview?.getAttribute('aria-label')).toContain('samurai helmet')
    expect(Array.from(container.querySelectorAll('[data-look-chip]')).map((c) => c.textContent)).toEqual(['Typeface: Monospace', 'Text size: Large', 'Corners: Round', 'Spacing: Cozy'])
    expect(container.textContent).toContain('Matcha (15 custom colours)')
    expect(container.textContent).toContain('Samurai helmet')
    expect(container.textContent).toContain('It cannot run code')
    expect(container.textContent).toContain('proposed by your AI')
    for (const kind of ['theme', 'tokens', 'mascot', 'font', 'scale', 'radius', 'density']) expect(container.querySelector(`[data-change="${kind}"]`), kind).toBeTruthy()
    // the page is untouched
    const root = document.documentElement
    for (const name of ['data-shell-theme', 'data-shell-hat', 'data-shell-font', 'data-shell-scale', 'data-shell-radius', 'data-shell-density']) expect(root.hasAttribute(name), name).toBe(false)
    expect(root.style.getPropertyValue('--font-ui')).toBe('')
    expect(root.style.getPropertyValue('font-size')).toBe('')
    expect(storedLook()).toBeNull()
  })

  it('applies ergonomics and the costume to the page, keeps them after a reload, and Undo removes every trace', async () => {
    const matcha = synthesizeShellTheme('matcha')
    const card = customLook({ ...matcha, mascotSvg: SAMURAI, mascotLabel: 'Samurai helmet', fontStyle: 'mono', fontScale: 'large', radius: 'round', density: 'cozy' })
    const app = demo()
    const status: EngineStatus = { ready: true, app }
    const { container } = await render(h(AppProvider, { status, children: [h(Logo, { key: 'logo', size: 32, withWordmark: true }), h(ChatCardView, { key: 'card', card })] }))
    await flush()
    const root = document.documentElement
    const logoBun = () => container.querySelector('[role="img"][aria-label] svg')

    await click(byText(container, 'Apply'))
    expect(root.getAttribute('data-theme')).toBe('light')
    expect(root.getAttribute('data-shell-theme')).toBe('light')
    expect(root.getAttribute('data-shell-hat')).toBe('custom')
    expect(root.getAttribute('data-shell-font')).toBe('mono')
    expect(root.getAttribute('data-shell-scale')).toBe('large')
    expect(root.getAttribute('data-shell-radius')).toBe('round')
    expect(root.getAttribute('data-shell-density')).toBe('cozy')
    expect(root.style.getPropertyValue('--bg')).toBe(matcha?.tokens['--bg'])
    expect(root.style.getPropertyValue('--font-ui')).toContain('ui-monospace')
    expect(root.style.getPropertyValue('--font-display')).toContain('monospace')
    expect(root.style.getPropertyValue('--r-sm')).toBe('12px')
    expect(root.style.getPropertyValue('--r-md')).toBe('20px')
    expect(root.style.getPropertyValue('--r-lg')).toBe('28px')
    expect(root.style.getPropertyValue('--s-4')).toBe('18px')
    expect(root.style.getPropertyValue('font-size')).toBe('112.5%')
    // every Bun in the app wears the costume, drawn as elements
    expect(logoBun()?.getAttribute('data-hat')).toBe('custom')
    expect(logoBun()?.querySelector('[data-hat-part="custom"] path')).toBeTruthy()
    expect(storedLook()).toMatchObject({ theme: 'light', themeLabel: 'Matcha', mascotHat: 'none', mascotSvg: SAMURAI, mascotLabel: 'Samurai helmet', fontStyle: 'mono', fontScale: 'large', radius: 'round', density: 'cozy' })

    // a reload reads the same look back through the sanitizer
    resetShellAppearanceStore()
    expect(getShellAppearance()).toMatchObject({ mascotSvg: SAMURAI, fontStyle: 'mono', fontScale: 'large', radius: 'round', density: 'cozy', themeLabel: 'Matcha' })
    applyShellAppearancePatchNow({ appName: 'Kabuto' })
    expect(root.getAttribute('data-shell-font')).toBe('mono')
    applyShellAppearancePatchNow({ reset: true })
    for (const name of ['data-theme', 'data-shell-theme', 'data-shell-hat', 'data-shell-font', 'data-shell-scale', 'data-shell-radius', 'data-shell-density', 'data-shell-name']) expect(root.hasAttribute(name), name).toBe(false)
    for (const name of ['--bg', '--font-ui', '--font-display', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--s-1', '--s-4', '--s-12', 'font-size']) expect(root.style.getPropertyValue(name), name).toBe('')
    expect(document.title).toBe('FundBun')
    expect(storedLook()).toBeNull()
  })

  it('Undo on the card puts the ergonomics back exactly as they were', async () => {
    applyShellAppearancePatchNow({ fontScale: 'xlarge', radius: 'sharp' })
    const root = document.documentElement
    expect(root.style.getPropertyValue('font-size')).toBe('125%')
    const { container } = await mount(demo(), customLook({ fontScale: 'compact', fontStyle: 'serif', density: 'compact' }))
    // the preview shows the size relative to what is on now
    expect(container.querySelector<HTMLElement>('[data-look-theme]')?.style.getPropertyValue('--look-scale')).toBe('0.75')
    expect(container.querySelector('[data-look-radius]')?.getAttribute('data-look-radius')).toBe('sharp')
    await click(byText(container, 'Apply'))
    expect(root.style.getPropertyValue('font-size')).toBe('93.75%')
    expect(root.getAttribute('data-shell-scale')).toBe('compact')
    expect(root.style.getPropertyValue('--font-ui')).toContain('Iowan Old Style')
    expect(root.style.getPropertyValue('--s-4')).toBe('14px')
    expect(root.style.getPropertyValue('--r-md')).toBe('3px')
    await click(byText(container, 'Undo'))
    expect(root.style.getPropertyValue('font-size')).toBe('125%')
    expect(root.getAttribute('data-shell-scale')).toBe('xlarge')
    expect(root.style.getPropertyValue('--font-ui')).toBe('')
    expect(root.style.getPropertyValue('--s-4')).toBe('')
    expect(root.style.getPropertyValue('--r-md')).toBe('3px')
    expect(root.hasAttribute('data-shell-font')).toBe(false)
    expect(root.hasAttribute('data-shell-density')).toBe(false)
  })

  it('a preview that resets the typeface shows FundBun type even while the page wears another', async () => {
    applyShellAppearancePatchNow({ fontStyle: 'mono', radius: 'pill' })
    const { container } = await mount(demo(), customLook({ fontStyle: 'default', radius: 'default' }))
    const preview = container.querySelector<HTMLElement>('[data-look-theme]')
    expect(preview?.style.getPropertyValue('--font-ui')).toContain('DM Sans')
    expect(preview?.style.getPropertyValue('--r-md')).toBe('14px')
    expect(container.querySelector('[data-look-chip]')).toBeNull()
  })

  it('refuses a card whose costume is hostile, and ignores a stored one', async () => {
    const { container } = await mount(demo(), customLook({ mascotSvg: HOSTILE }))
    expect(container.textContent).toContain('cannot be applied')
    expect(byText(container, 'Apply')).toBeNull()
    expect(container.querySelector('script, image')).toBeNull()

    localStorage.setItem(SHELL_APPEARANCE_KEY, JSON.stringify({ theme: 'dark', tokens: {}, mascotHat: 'none', appName: null, mascotSvg: HOSTILE, mascotLabel: 'x', fontStyle: "mono; background: url('//evil')", fontScale: '900%', radius: 'blob', density: 7 }))
    resetShellAppearanceStore()
    expect(getShellAppearance()).toEqual({ theme: 'dark', tokens: {}, mascotHat: 'none', appName: null })
    const bun = await render(h(BunMascot, { size: 96 }))
    expect(bun.container.querySelector('[data-hat-part]')).toBeNull()
    expect(applyShellAppearancePatchNow({ mascotSvg: '<circle r="5" onclick="alert(1)"/>' }).ok).toBe(false)
    expect(applyShellAppearancePatchNow({ fontScale: 'gigantic' } as never).ok).toBe(false)
  })

  it('refuses colours that would be unreadable on the theme that is on now', async () => {
    applyShellAppearancePatchNow({ theme: 'midnight' })
    // near-black text passes on its own (FundBun light) but not laid over midnight
    const r = applyShellAppearancePatchNow({ tokens: { '--text': '#0b1020' } })
    expect(r.ok).toBe(false)
    expect(getShellAppearance()).toEqual({ theme: 'midnight', tokens: {}, mascotHat: 'none', appName: null })
  })

  it('Settings lists every active adaptation, the custom ones included, with one Reset', async () => {
    const app = demo()
    const state = { local: true, enabled: true, plugins: [], starters: [] }
    const client = { state: async () => state, syncEnabled: async () => true, baseUrl: '/api' }
    Object.defineProperty(app, 'plugins', { value: client, configurable: true })
    await refreshPlugins(app.plugins)
    const lavender = synthesizeShellTheme('lavender')
    expect(applyShellAppearancePatchNow({ ...lavender, mascotSvg: SAMURAI, mascotLabel: 'Samurai helmet', appName: 'Kabuto', fontStyle: 'rounded', fontScale: 'xlarge', radius: 'pill', density: 'compact' }).ok).toBe(true)
    const status: EngineStatus = { ready: true, app }
    const { container } = await render(h(AppProvider, { status, children: h(CreatorSection) }))
    await flush()
    const row = (kind: string) => container.querySelector(`[data-shell-row="${kind}"]`)
    expect(container.querySelector('[data-shell-appearance]')?.getAttribute('data-shell-appearance')).toBe('custom')
    expect(row('theme')?.textContent).toContain('Light')
    expect(row('tokens')?.textContent).toContain('Lavender (15 custom colours)')
    expect(row('mascot')?.textContent).toContain('Samurai helmet')
    expect(row('mascot')?.querySelector('svg')?.getAttribute('data-hat')).toBe('custom')
    expect(row('name')?.textContent).toContain('Kabuto')
    expect(row('font')?.textContent).toContain('Rounded')
    expect(row('scale')?.textContent).toContain('Extra large')
    expect(row('radius')?.textContent).toContain('Extra round')
    expect(row('density')?.textContent).toContain('Compact')
    expect(container.querySelectorAll('[data-shell-row]')).toHaveLength(8)

    await click(byText(container, 'Reset Shell Appearance', 'button'))
    expect(container.querySelector('[data-shell-row]')).toBeNull()
    const root = document.documentElement
    expect(root.style.getPropertyValue('font-size')).toBe('')
    expect(root.style.getPropertyValue('--font-ui')).toBe('')
    expect(root.hasAttribute('data-shell-hat')).toBe(false)
    expect(storedLook()).toBeNull()
    expect(container.querySelector('[data-shell-appearance]')?.getAttribute('data-shell-appearance')).toBe('default')
  })
})
