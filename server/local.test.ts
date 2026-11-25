import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startLocal, type LocalServer } from './local'

const open: LocalServer[] = []
const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(open.splice(0).map((l) => l.close()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function local(): Promise<LocalServer> {
  const home = mkdtempSync(join(tmpdir(), 'fundbun-local-'))
  dirs.push(home)
  // port 0: any free port, never the desktop app's own
  const l = await startLocal({ port: 0, home, distDir: null, env: {} })
  open.push(l)
  return l
}

describe('startLocal: the connections and the agents are wired to each other', () => {
  it('an agent’s model list and test come from the agent runtime (no agent is started here)', async () => {
    const l = await local()
    const probe = vi.spyOn(l.agents, 'probe').mockResolvedValue({ ok: true, ms: 5, currentModel: 'default', currentModelName: 'Default', options: [{ id: 'default', name: 'Default' }, { id: 'opus', name: 'Opus' }] })
    const added = await l.ai.add({ presetId: 'claude-code' })
    if (!added.ok) throw new Error('expected an agent connection')
    expect(await l.ai.models(added.value.id)).toMatchObject({ ok: true, value: ['default', 'opus'] })
    expect(probe).toHaveBeenCalledWith(added.value.id, { useCache: true })
    expect(await l.ai.test(added.value.id)).toMatchObject({ ok: true, kind: 'agent', modelCount: 2 })
    expect(probe).toHaveBeenLastCalledWith(added.value.id, { useCache: false })
  })

  it('a new model for an agent, or removing it, ends its sessions in the runtime', async () => {
    const l = await local()
    const closeByConnection = vi.spyOn(l.agents, 'closeByConnection')
    const added = await l.ai.add({ presetId: 'claude-code' })
    if (!added.ok) throw new Error('expected an agent connection')
    l.ai.update(added.value.id, { model: 'opus', modelName: 'Opus' })
    expect(closeByConnection).toHaveBeenCalledWith(added.value.id)
    l.ai.remove(added.value.id)
    expect(closeByConnection).toHaveBeenCalledTimes(2)
  })
})
