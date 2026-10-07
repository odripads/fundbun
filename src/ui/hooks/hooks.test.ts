// @vitest-environment jsdom
import { act, createElement as h, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, key, render } from '../components/ds/testing'
import { nextTrapTarget, tabbables } from './focus'
import { useFocusTrap } from './useFocusTrap'
import { useIsDesktop, useMediaQuery } from './useMediaQuery'
import { MOTION_ATTR, useMotionPreference, useReducedMotion } from './useReducedMotion'
import { acquireScrollLock, SCROLL_LOCK_ATTR } from './useScrollLock'
import { applyThemePreference, isThemePreference, readThemePreference, THEME_STORAGE_KEY, useThemePreference, writeThemePreference } from './useTheme'

afterEach(async () => {
  await cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute(MOTION_ATTR)
  localStorage.clear()
  vi.restoreAllMocks()
})

function dom(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  document.body.append(div)
  return div
}

describe('focus helpers', () => {
  it('tabbables keeps DOM order and skips disabled, hidden, inert and negative tabindex', () => {
    const root = dom(`
      <button id="a">a</button>
      <button id="b" disabled>b</button>
      <a id="c" href="#">c</a>
      <a id="d">no href</a>
      <input id="e" type="hidden" />
      <div id="f" tabindex="-1">f</div>
      <div id="g" tabindex="0">g</div>
      <div hidden><button id="h">h</button></div>
      <div inert><button id="i">i</button></div>
      <div aria-hidden="true"><button id="j">j</button></div>
      <button id="k" style="visibility:hidden">k</button>
      <textarea id="l"></textarea>
    `)
    expect(tabbables(root).map((e) => e.id)).toEqual(['a', 'c', 'g', 'l'])
  })

  it('nextTrapTarget wraps both ways and pulls stray focus in', () => {
    const root = dom('<button id="a">a</button><button id="b">b</button>')
    const outside = dom('<button id="z">z</button>').querySelector('button')!
    const [a, b] = tabbables(root)
    expect(nextTrapTarget([a, b], b, false, root)).toBe(a)
    expect(nextTrapTarget([a, b], a, true, root)).toBe(b)
    expect(nextTrapTarget([a, b], a, false, root)).toBeNull()
    expect(nextTrapTarget([a, b], outside, false, root)).toBe(a)
    expect(nextTrapTarget([a, b], outside, true, root)).toBe(b)
    expect(nextTrapTarget([a, b], root, true, root)).toBe(b)
    expect(nextTrapTarget([], null, false, root)).toBe(root)
  })
})

describe('useFocusTrap', () => {
  function Trap({ active }: { active: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useFocusTrap(ref, active)
    return h('div', { ref, tabIndex: -1 }, h('button', { id: 'one' }, '1'), h('button', { id: 'two' }, '2'))
  }

  it('focuses the first tabbable, traps Tab and restores focus on release', async () => {
    const opener = dom('<button id="opener">open</button>').querySelector('button')!
    opener.focus()
    const r = await render(h(Trap, { active: true }))
    expect(document.activeElement?.id).toBe('one')
    const two = document.getElementById('two')!
    two.focus()
    await key(two, 'Tab')
    expect(document.activeElement?.id).toBe('one')
    await r.rerender(h(Trap, { active: false }))
    expect(document.activeElement).toBe(opener)
  })
})

describe('scroll lock', () => {
  it('is ref-counted and idempotent per release', () => {
    const r1 = acquireScrollLock()
    const r2 = acquireScrollLock()
    expect(document.documentElement.hasAttribute(SCROLL_LOCK_ATTR)).toBe(true)
    r1()
    r1()
    expect(document.documentElement.hasAttribute(SCROLL_LOCK_ATTR)).toBe(true)
    r2()
    expect(document.documentElement.hasAttribute(SCROLL_LOCK_ATTR)).toBe(false)
  })
})

describe('media queries', () => {
  it('fall back where matchMedia is missing (jsdom)', async () => {
    let seen: boolean[] = []
    function Probe() {
      seen = [useMediaQuery('(min-width: 1px)', true), useIsDesktop(), useReducedMotion()]
      return null
    }
    await render(h(Probe))
    expect(seen).toEqual([true, false, false])
  })

  it('track a live matchMedia', async () => {
    const listeners = new Set<() => void>()
    let matches = false
    vi.stubGlobal('matchMedia', (q: string) => ({
      media: q,
      get matches() {
        return matches
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }))
    let value: boolean | null = null
    function Probe() {
      value = useIsDesktop()
      return null
    }
    const r = await render(h(Probe))
    expect(value).toBe(false)
    matches = true
    await act(async () => listeners.forEach((l) => l()))
    expect(value).toBe(true)
    await r.unmount()
    expect(listeners.size).toBe(0)
    vi.unstubAllGlobals()
  })
})

describe('reduced motion', () => {
  it('mirrors the in-app setting onto <html> and reads it back', async () => {
    let reduced: boolean | null = null
    function Probe({ on }: { on: boolean }) {
      useMotionPreference(on)
      reduced = useReducedMotion()
      return null
    }
    const r = await render(h(Probe, { on: true }))
    await flush()
    expect(document.documentElement.getAttribute(MOTION_ATTR)).toBe('reduce')
    expect(reduced).toBe(true)
    await r.rerender(h(Probe, { on: false }))
    await flush()
    expect(document.documentElement.hasAttribute(MOTION_ATTR)).toBe(false)
    expect(reduced).toBe(false)
  })
})

describe('theme preference', () => {
  beforeEach(() => localStorage.clear())

  it('validates values', () => {
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })

  it('reads garbage as system and applies data-theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(readThemePreference()).toBe('system')
    applyThemePreference('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyThemePreference('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('persists, survives a throwing storage and notifies hook users', async () => {
    let pref: string | null = null
    function Probe() {
      pref = useThemePreference()[0]
      return null
    }
    await render(h(Probe))
    expect(pref).toBe('system')
    await act(async () => writeThemePreference('light'))
    expect(pref).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    // storage now throws: the session keeps the last choice and new choices still apply
    expect(readThemePreference()).toBe('light')
    await act(async () => expect(() => writeThemePreference('dark')).not.toThrow())
    expect(readThemePreference()).toBe('dark')
    expect(pref).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
