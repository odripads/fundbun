import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayServer } from '../../../server/app'
import { createPluginService } from '../../../server/plugins/service'
import { createPluginMemoryStore } from '../../../server/plugins/store'
import { fakeHost } from '../../../tests/helpers/fake-host'
import { PluginsClient } from '../plugins/client'
import { runCreatorTool } from './creator-tools'
import { startTurn, taint } from './turn'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()))
})

async function setup(enabled: boolean) {
  const service = createPluginService({ store: createPluginMemoryStore({ enabled }) })
  const server = createGatewayServer({ provider: null, rateLimitRpm: 1000, plugins: service })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  closers.push(() => new Promise<void>((r) => {
    server.closeAllConnections()
    server.close(() => r())
  }))
  const host = fakeHost({ persona: 'mei' })
  host.plugins = new PluginsClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`)
  return { host, service }
}

const DRAFT = { name: 'Coffee count', description: 'Cups this month', code: 'function render(root){ root.textContent = "hi" }' }

describe('Creator tools', () => {
  it('stage a preview card and install nothing', async () => {
    const { host, service } = await setup(true)
    const turn = startTurn(host, 'chat')
    const r = await runCreatorTool(host, turn, 'plugin_draft', DRAFT)
    expect(r.is_error).toBeUndefined()
    expect(JSON.parse(r.content)).toMatchObject({ status: 'pending_install', pluginId: 'coffee-count' })
    expect(turn.cards).toEqual([expect.objectContaining({ type: 'plugin_draft', pluginId: 'coffee-count' })])
    expect(service.state().plugins).toHaveLength(0)
  })

  it('are refused while Creator Mode is off', async () => {
    const { host } = await setup(false)
    const turn = startTurn(host, 'chat')
    const r = await runCreatorTool(host, turn, 'plugin_list', {})
    expect(r.is_error).toBe(true)
    expect(JSON.parse(r.content).status).toBe('denied')
  })

  it('cannot draft or remove on a turn that carries untrusted content', async () => {
    const { host, service } = await setup(true)
    service.installStarter('coffee-tea-tracker')
    for (const [name, args] of [['plugin_draft', DRAFT], ['plugin_remove', { id: 'coffee-tea-tracker', action: 'uninstall' }]] as const) {
      const turn = startTurn(host, 'chat')
      taint(turn, 'pasted bill')
      const r = await runCreatorTool(host, turn, name, args)
      expect(JSON.parse(r.content)).toMatchObject({ status: 'denied' })
      expect(turn.cards.some((c) => c.type === 'plugin_draft' || c.type === 'plugin_action')).toBe(false)
    }
    expect(service.state().plugins).toHaveLength(1)
  })

  it('only propose a removal: the widget stays until the user confirms', async () => {
    const { host, service } = await setup(true)
    service.installStarter('coffee-tea-tracker')
    const turn = startTurn(host, 'chat')
    const r = await runCreatorTool(host, turn, 'plugin_remove', { id: 'coffee-tea-tracker', action: 'uninstall' })
    expect(JSON.parse(r.content).status).toBe('pending_confirmation')
    expect(turn.cards).toEqual([{ type: 'plugin_action', pluginId: 'coffee-tea-tracker', name: expect.any(String), action: 'uninstall' }])
    expect(service.state().plugins).toHaveLength(1)
  })
})
