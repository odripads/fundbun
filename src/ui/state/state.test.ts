// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSnapshot } from '../../core/app-api'
import type { FundBunApp } from '../../core/app'
import { ToastProvider, ToastViewport } from '../components/ds/Toast'
import { byText, cleanup, render } from '../components/ds/testing'
import { bootEngine, browserStorage, errorText, type EngineStatus } from './appInstance'
import { AppProvider } from './AppProvider'
import { createSelection, EngineNotReadyError, shallowEqual, useApp, useEngineStatus, useSnapshot } from './useApp'
import { isResult, useSafeAction } from './useSafeAction'

afterEach(async () => {
  await cleanup()
  vi.restoreAllMocks()
})

/** A tiny observable stand-in for the controller: only getSnapshot/subscribe matter to the hooks. */
function fakeApp(initial: { spent: number; name: string }) {
  let snap = { state: { profile: { name: initial.name } }, derived: { spent: initial.spent } } as unknown as AppSnapshot
  const listeners = new Set<() => void>()
  const app = {
    getSnapshot: () => snap,
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  } as unknown as FundBunApp
  const set = (next: { spent?: number; name?: string }) => {
    const cur = snap as unknown as { state: { profile: { name: string } }; derived: { spent: number } }
    snap = {
      state: { profile: { name: next.name ?? cur.state.profile.name } },
      derived: { spent: next.spent ?? cur.derived.spent },
    } as unknown as AppSnapshot
    listeners.forEach((l) => l())
  }
  return { app, set, listeners }
}

describe('errorText', () => {
  it('extracts messages from anything thrown', () => {
    expect(errorText(new Error('boom'))).toBe('boom')
    expect(errorText(new TypeError(''))).toBe('TypeError')
    expect(errorText('plain')).toBe('plain')
    expect(errorText({ weird: true })).toBe('Unknown error')
  })
})

describe('bootEngine', () => {
  it('returns the app when creation and the first snapshot succeed', () => {
    const { app } = fakeApp({ spent: 1, name: 'Mei' })
    const status = bootEngine(() => app)
    expect(status).toEqual({ ready: true, app })
  })

  it('reports a creation failure instead of throwing', () => {
    expect(bootEngine(() => {
      throw new Error('TODO loadPersona')
    })).toEqual({ ready: false, error: 'TODO loadPersona' })
  })

  it('reports a failing first snapshot (broken derived state)', () => {
    const app = { getSnapshot: () => { throw new Error('TODO insights') } } as unknown as FundBunApp
    expect(bootEngine(() => app)).toEqual({ ready: false, error: 'TODO insights' })
  })
})

describe('browserStorage', () => {
  it('uses localStorage when it works', () => {
    expect(browserStorage()).toBe(localStorage)
  })

  it('falls back to memory when storage throws (private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    const s = browserStorage()
    expect(s).not.toBe(localStorage)
    s.setItem('k', 'v')
    expect(s.getItem('k')).toBe('v')
    s.removeItem('k')
    expect(s.getItem('k')).toBeNull()
  })
})

describe('createSelection', () => {
  it('re-runs the selector only for a new snapshot and keeps equal results', () => {
    let snap = { n: 1 } as unknown as AppSnapshot
    const selector = vi.fn((s: AppSnapshot) => ({ double: (s as unknown as { n: number }).n * 2 }))
    const cache = { current: null }
    const get = createSelection(() => snap, selector, shallowEqual, cache)
    const a = get()
    expect(get()).toBe(a)
    expect(selector).toHaveBeenCalledTimes(1)
    snap = { n: 1 } as unknown as AppSnapshot
    expect(get()).toBe(a)
    expect(selector).toHaveBeenCalledTimes(2)
    snap = { n: 2 } as unknown as AppSnapshot
    expect(get()).toEqual({ double: 4 })
  })
})

describe('shallowEqual', () => {
  it('compares one level deep', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false)
    expect(shallowEqual([1, 2], [1, 2])).toBe(true)
    expect(shallowEqual([1], { 0: 1 })).toBe(false)
    expect(shallowEqual(null, null)).toBe(true)
    expect(shallowEqual(null, {})).toBe(false)
    expect(shallowEqual(Number.NaN, Number.NaN)).toBe(true)
  })
})

describe('useSnapshot / useApp', () => {
  it('renders selected slices and re-renders only when they change', async () => {
    const { app, set, listeners } = fakeApp({ spent: 100, name: 'Mei' })
    const status: EngineStatus = { ready: true, app }
    let renders = 0
    function Spent() {
      renders++
      const spent = useSnapshot((s) => (s.derived as unknown as { spent: number }).spent)
      return h('p', null, `spent ${spent}`)
    }
    const r = await render(h(AppProvider, { status, children: h(Spent) }))
    expect(r.container.textContent).toBe('spent 100')
    const before = renders
    await act(async () => set({ name: 'Arif' }))
    expect(renders).toBe(before)
    await act(async () => set({ spent: 250 }))
    expect(r.container.textContent).toBe('spent 250')
    await r.unmount()
    expect(listeners.size).toBe(0)
  })

  it('object selectors stay stable with shallowEqual', async () => {
    const { app, set } = fakeApp({ spent: 1, name: 'Mei' })
    const seen: unknown[] = []
    function Probe() {
      seen.push(useSnapshot((s) => ({ name: (s.state.profile as { name: string }).name }), shallowEqual))
      return null
    }
    await render(h(AppProvider, { status: { ready: true, app }, children: h(Probe) }))
    await act(async () => set({ spent: 9 }))
    expect(seen.length).toBeGreaterThanOrEqual(1)
    expect(new Set(seen).size).toBe(1)
  })

  it('useApp throws a typed error when the engine is not ready', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Probe() {
      useApp()
      return null
    }
    await expect(render(h(AppProvider, { status: { ready: false, error: 'TODO' }, children: h(Probe) }))).rejects.toBeInstanceOf(EngineNotReadyError)
    spy.mockRestore()
  })

  it('useEngineStatus exposes the injected status', async () => {
    let got: EngineStatus | null = null
    function Probe() {
      got = useEngineStatus()
      return null
    }
    await render(h(AppProvider, { status: { ready: false, error: 'nope' }, children: h(Probe) }))
    expect(got).toEqual({ ready: false, error: 'nope' })
  })
})

describe('useSafeAction', () => {
  it('recognises Result objects', () => {
    expect(isResult({ ok: true })).toBe(true)
    expect(isResult({ ok: 'yes' })).toBe(false)
    expect(isResult(null)).toBe(false)
  })

  it('turns failures and throws into toasts and passes values through', async () => {
    let run: ReturnType<typeof useSafeAction> | null = null
    function Probe() {
      run = useSafeAction()
      return null
    }
    await render(h(ToastProvider, null, h(Probe), h(ToastViewport)))
    let out: unknown
    await act(async () => {
      out = await run!(() => ({ ok: false, error: 'PIN required' }), { errorTitle: 'Not moved' })
    })
    expect(out).toEqual({ ok: false, error: 'PIN required' })
    expect(byText(document.body, 'Not moved', 'p')).not.toBeNull()
    await act(async () => {
      out = await run!(async () => {
        throw new Error('engine offline')
      })
    })
    expect(out).toBeUndefined()
    expect(document.body.textContent).toContain('engine offline')
    await act(async () => {
      out = await run!(() => 42, { success: 'Stashed' })
    })
    expect(out).toBe(42)
    expect(byText(document.body, 'Stashed', 'p')).not.toBeNull()
  })
})
