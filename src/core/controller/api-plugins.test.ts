import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayServer } from '../../../server/app'
import { createPluginService } from '../../../server/plugins/service'
import { STARTER_PLUGINS } from '../../../server/plugins/starters'
import { createPluginMemoryStore } from '../../../server/plugins/store'
import { createTestApp } from '../app'
import { PluginsClient } from '../plugins/client'
import { DEMO_PIN } from './constants'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()))
})

async function setup() {
  const service = createPluginService({ store: createPluginMemoryStore() })
  const server = createGatewayServer({ provider: null, rateLimitRpm: 1000, plugins: service })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  closers.push(() => new Promise<void>((r) => {
    server.closeAllConnections()
    server.close(() => r())
  }))
  const app = createTestApp({ plugins: new PluginsClient(`http://127.0.0.1:${port}/api`) })
  app.loadDemo('mei')
  return { app, service }
}

const audits = (app: ReturnType<typeof createTestApp>, type: string) => app.getSnapshot().state.audit.filter((a) => a.type === type)

describe('Creator Mode in the app', () => {
  it('needs the right PIN to turn on, and none to turn off', async () => {
    const { app, service } = await setup()
    expect((await app.setCreatorMode(true)).ok).toBe(false)
    expect((await app.setCreatorMode(true, '0000')).ok).toBe(false)
    expect(service.isEnabled()).toBe(false)
    expect(audits(app, 'step_up_failed').length).toBeGreaterThanOrEqual(2)

    expect(await app.setCreatorMode(true, DEMO_PIN)).toEqual({ ok: true })
    expect(service.isEnabled()).toBe(true)
    expect(await app.setCreatorMode(false)).toEqual({ ok: true })
    expect(service.isEnabled()).toBe(false)
    expect(audits(app, 'mandate_changed').map((a) => a.summary)).toEqual(expect.arrayContaining(['Creator Mode on', 'Creator Mode off']))
  })

  it('stays off while Bun is paused', async () => {
    const { app, service } = await setup()
    app.freeze()
    expect((await app.setCreatorMode(true, DEMO_PIN)).ok).toBe(false)
    expect(service.isEnabled()).toBe(false)
  })

  it('installs and removes widgets, with an audit entry for each', async () => {
    const { app, service } = await setup()
    await app.setCreatorMode(true, DEMO_PIN)
    const id = STARTER_PLUGINS[0].id
    expect(await app.installStarterPlugin(id)).toEqual({ ok: true })
    expect(await app.changePlugin(id, 'disable')).toEqual({ ok: true })
    expect(service.state().plugins[0].enabled).toBe(false)
    app.freeze()
    // switching back on waits for the unfreeze; removing never does
    expect((await app.changePlugin(id, 'enable')).ok).toBe(false)
    expect(await app.changePlugin(id, 'uninstall')).toEqual({ ok: true })
    expect(service.state().plugins).toHaveLength(0)
    expect(audits(app, 'user_action').map((a) => a.summary)).toEqual(expect.arrayContaining([
      `Installed starter widget ${id}`, `Widget ${id}: disable`, `Widget ${id}: uninstall`,
    ]))
  })

  it('installs a drafted widget only through its draft id', async () => {
    const { app, service } = await setup()
    await app.setCreatorMode(true, DEMO_PIN)
    const d = service.draft({ name: 'Tiny', description: 'A tiny widget', code: 'function render(root){ root.textContent = "hi" }' })
    if (!d.ok) throw new Error(d.message)
    expect((await app.installPlugin('dr_missing')).ok).toBe(false)
    expect(await app.installPlugin(d.draft.draftId)).toEqual({ ok: true })
    expect(service.state().plugins.map((p) => p.id)).toEqual(['tiny'])
  })

  it('says it needs the desktop app when there is no local server', async () => {
    const app = createTestApp()
    app.loadDemo('mei')
    expect(await app.setCreatorMode(true, DEMO_PIN)).toEqual({ ok: false, error: 'Creator Mode needs the FundBun desktop app.' })
  })
})
