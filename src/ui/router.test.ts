// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildHash, href, isRouteName, navigate, parseHash, resolveRoute, ROUTE_META, ROUTES, setHash, subscribeHash, TABS } from './router'

describe('parseHash', () => {
  it('parses a plain route with or without the leading #', () => {
    expect(parseHash('#/home')).toEqual({ route: 'home', params: [], query: {} })
    expect(parseHash('/insights')).toEqual({ route: 'insights', params: [], query: {} })
  })

  it('parses params and query', () => {
    expect(parseHash('#/goals/dream_birkin?tab=pots&x=1')).toEqual({
      route: 'goals',
      params: ['dream_birkin'],
      query: { tab: 'pots', x: '1' },
    })
  })

  it('decodes params and tolerates malformed escapes', () => {
    expect(parseHash('#/goals/Birkin%2025').params).toEqual(['Birkin 25'])
    expect(parseHash('#/goals/%E0%A4%A').params).toEqual(['%E0%A4%A'])
  })

  it('is case-insensitive for the route and ignores empty / dot segments', () => {
    expect(parseHash('#/HOME').route).toBe('home')
    expect(parseHash('#//home//').route).toBe('home')
    expect(parseHash('#/../settings').route).toBe('settings')
    expect(parseHash('#/./bills/./x').params).toEqual(['x'])
  })

  it('returns route null for empty or unknown hashes', () => {
    expect(parseHash('').route).toBeNull()
    expect(parseHash('#').route).toBeNull()
    expect(parseHash('#/nope').route).toBeNull()
    expect(parseHash('#main').route).toBeNull()
  })

  it('never matches prototype keys as routes', () => {
    for (const evil of ['#/constructor', '#/__proto__', '#/toString', '#/hasOwnProperty']) {
      expect(parseHash(evil).route).toBeNull()
    }
  })

  it('keeps a __proto__ query key as plain data', () => {
    const q = parseHash('#/home?__proto__=x&a=b').query
    expect(Object.getPrototypeOf(q)).toBe(Object.prototype)
    expect(q.a).toBe('b')
  })
})

describe('buildHash / href', () => {
  it('round-trips through parseHash', () => {
    const h = buildHash('goals', ['dream birkin/25'], { tab: 'a&b' })
    expect(h).toBe('#/goals/dream%20birkin%2F25?tab=a%26b')
    expect(parseHash(h)).toEqual({ route: 'goals', params: ['dream birkin/25'], query: { tab: 'a&b' } })
  })

  it('omits an empty query', () => {
    expect(href('home')).toBe('#/home')
  })
})

describe('route tables', () => {
  it('has metadata for every route and only known tabs', () => {
    for (const r of ROUTES) {
      expect(ROUTE_META[r].title.length).toBeGreaterThan(0)
      const tab = ROUTE_META[r].tab
      if (tab !== null) expect(TABS).toContain(tab)
      const parent = ROUTE_META[r].parent
      if (parent) expect(isRouteName(parent)).toBe(true)
    }
  })

  it('lists the five tab slots with chat in the centre', () => {
    expect(TABS).toEqual(['home', 'insights', 'chat', 'bills', 'goals'])
  })

  it('keeps onboarding and the gallery reachable before onboarding', () => {
    expect(ROUTE_META.onboarding.requiresOnboarding).toBe(false)
    expect(ROUTE_META.gallery.requiresOnboarding).toBe(false)
    expect(ROUTE_META.gallery.chrome).toBe('wide')
  })
})

describe('resolveRoute', () => {
  it('sends an empty hash to home or onboarding', () => {
    expect(resolveRoute(parseHash(''), { onboarded: true })).toEqual({ route: 'home', redirectTo: '#/home' })
    expect(resolveRoute(parseHash(''), { onboarded: false })).toEqual({ route: 'onboarding', redirectTo: '#/onboarding' })
  })

  it('redirects unknown routes to the fallback', () => {
    expect(resolveRoute(parseHash('#/wat'), { onboarded: true }).route).toBe('home')
  })

  it('guards app routes until onboarded', () => {
    expect(resolveRoute(parseHash('#/bills'), { onboarded: false })).toEqual({ route: 'onboarding', redirectTo: '#/onboarding' })
    expect(resolveRoute(parseHash('#/settings'), { onboarded: false }).route).toBe('onboarding')
  })

  it('lets onboarded users through and allows explicit onboarding / gallery', () => {
    expect(resolveRoute(parseHash('#/bills'), { onboarded: true })).toEqual({ route: 'bills', redirectTo: null })
    expect(resolveRoute(parseHash('#/onboarding'), { onboarded: true })).toEqual({ route: 'onboarding', redirectTo: null })
    expect(resolveRoute(parseHash('#/gallery'), { onboarded: false })).toEqual({ route: 'gallery', redirectTo: null })
  })
})

describe('browser bindings', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '#')
  })

  it('navigate pushes a hash and notifies subscribers', async () => {
    const seen: string[] = []
    const off = subscribeHash(() => seen.push(window.location.hash))
    navigate('goals', { params: ['dream_birkin'] })
    await new Promise((r) => setTimeout(r, 0))
    expect(window.location.hash).toBe('#/goals/dream_birkin')
    expect(seen).toContain('#/goals/dream_birkin')
    off()
  })

  it('setHash with replace swaps the entry and still fires hashchange', () => {
    const listener = vi.fn()
    const off = subscribeHash(listener)
    const before = window.history.length
    setHash('#/bills', true)
    expect(window.location.hash).toBe('#/bills')
    expect(window.history.length).toBe(before)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })

  it('setHash is a no-op when the hash is unchanged', () => {
    setHash('#/home', true)
    const listener = vi.fn()
    const off = subscribeHash(listener)
    setHash('#/home', true)
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('unsubscribes cleanly', () => {
    const listener = vi.fn()
    subscribeHash(listener)()
    setHash('#/insights', true)
    expect(listener).not.toHaveBeenCalled()
  })
})
