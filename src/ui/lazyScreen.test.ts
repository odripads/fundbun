// @vitest-environment jsdom
import { createElement as h, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, render } from './components/ds/testing'
import { lazyScreen, whenIdle } from './lazyScreen'

afterEach(async () => {
  await cleanup()
  vi.useRealTimers()
})

function Hello({ who }: { who: string }) {
  return h('p', null, `Hello ${who}`)
}

const inSuspense = (el: ReturnType<typeof h>) => h(Suspense, { fallback: h('i', null, 'loading') }, el)

describe('lazyScreen (route code splitting)', () => {
  it('suspends on the first render, then renders the loaded screen with its props', async () => {
    let release!: () => void
    const load = vi.fn(() => new Promise<typeof Hello>((r) => (release = () => r(Hello))))
    const Screen = lazyScreen(load)
    expect(Screen.loaded).toBe(false)
    const { container } = await render(inSuspense(h(Screen, { who: 'Jing' })))
    expect(container.textContent).toBe('loading')
    release()
    await flush()
    expect(container.textContent).toBe('Hello Jing')
    expect(Screen.loaded).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('renders synchronously (no fallback) once preloaded, and loads the chunk only once', async () => {
    const load = vi.fn(async () => Hello)
    const Screen = lazyScreen(load)
    await Promise.all([Screen.preload(), Screen.preload()])
    const { container } = await render(inSuspense(h(Screen, { who: 'Arif' })))
    expect(container.textContent).toBe('Hello Arif')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed chunk load: the next attempt retries', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('chunk 404')).mockResolvedValue(Hello)
    const Screen = lazyScreen<{ who: string }>(load)
    await expect(Screen.preload()).rejects.toThrow('chunk 404')
    expect(Screen.loaded).toBe(false)
    await expect(Screen.preload()).resolves.toBe(Hello)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('a render that hit a failed load retries on the next render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Hello)
    const Screen = lazyScreen<{ who: string }>(load)
    const caught: unknown[] = []
    window.addEventListener('error', (e) => {
      caught.push(e.error)
      e.preventDefault()
    })
    // first render: the chunk fails, the boundary-less tree errors out
    const first = await render(inSuspense(h(Screen, { who: 'Jing' })))
    await flush(10)
    await first.unmount()
    // second render: a fresh attempt succeeds
    const { container } = await render(inSuspense(h(Screen, { who: 'Jing' })))
    await flush(10)
    expect(container.textContent).toBe('Hello Jing')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('whenIdle falls back to a timer where requestIdleCallback is missing', () => {
    vi.useFakeTimers()
    const task = vi.fn()
    const g = globalThis as { requestIdleCallback?: unknown }
    const saved = g.requestIdleCallback
    delete g.requestIdleCallback
    try {
      whenIdle(task, 500)
      vi.advanceTimersByTime(499)
      expect(task).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(task).toHaveBeenCalledTimes(1)
    } finally {
      if (saved) g.requestIdleCallback = saved
    }
  })
})
