// @vitest-environment jsdom
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import type { ChatCard } from '../../../core/types'
import { AppProvider, type EngineStatus } from '../../state'
import { ChatCardView } from '../agent'
import { byText, cleanup, click, flush, render } from '../ds/testing'
import { resetPluginsStore } from './pluginStore'

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
  vi.restoreAllMocks()
})

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
