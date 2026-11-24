import { describe, expect, it, vi } from 'vitest'
import { asksFirst } from './runtime'

const claudeModes = {
  currentModeId: 'bypassPermissions',
  availableModes: [
    { id: 'default', name: 'Manual', description: 'Always ask before making changes' },
    { id: 'acceptEdits', name: 'Accept edits', description: 'Automatically accept all file edits' },
    { id: 'bypassPermissions', name: 'Bypass', description: 'Skip all permission prompts' },
  ],
}

function conn(result: 'ok' | 'fail') {
  return { request: vi.fn(() => (result === 'ok' ? Promise.resolve({}) : Promise.reject(new Error('no')))) }
}

describe('asksFirst: an agent must ask before it acts, or FundBun does not use it', () => {
  it('switches a no-questions agent to its ask-first mode', async () => {
    const c = conn('ok')
    expect(await asksFirst(c, 's1', claudeModes)).toBe(true)
    expect(c.request).toHaveBeenCalledWith('session/set_mode', { sessionId: 's1', modeId: 'default' }, 20_000)
  })

  it('refuses when the switch fails', async () => {
    expect(await asksFirst(conn('fail'), 's1', claudeModes)).toBe(false)
  })

  it('refuses when modes are listed but none of them asks first', async () => {
    const c = conn('ok')
    const modes = { currentModeId: 'yolo', availableModes: [{ id: 'yolo', name: 'YOLO', description: 'run everything' }, { id: 'auto', name: 'Auto', description: '' }] }
    expect(await asksFirst(c, 's1', modes)).toBe(false)
    expect(c.request).not.toHaveBeenCalled()
  })

  it('accepts an agent already in an ask-first mode without changing it', async () => {
    const c = conn('ok')
    expect(await asksFirst(c, 's1', { ...claudeModes, currentModeId: 'default' })).toBe(true)
    expect(c.request).not.toHaveBeenCalled()
  })

  it('accepts an agent that reports no modes (ACP default: it asks through request_permission)', async () => {
    expect(await asksFirst(conn('ok'), 's1', undefined)).toBe(true)
    expect(await asksFirst(conn('ok'), 's1', {})).toBe(true)
  })

  it('refuses an agent that reports only an unsafe current mode', async () => {
    expect(await asksFirst(conn('ok'), 's1', { currentModeId: 'bypassPermissions' })).toBe(false)
  })
})
