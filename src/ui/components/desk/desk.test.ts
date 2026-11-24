// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESK_NAV, DESK_ROOTS, chatTabName, defaultPanelOpen, deskParent, deskTitle, longDate } from './deskModel'
import {
  DESK_MIN_WIDTH,
  DESK_QUERY,
  PANEL_DOCK_QUERY,
  PANEL_DOCK_WIDTH,
  PANEL_OPEN_KEY,
  VIEW_STORAGE_KEY,
  isDeskModeNow,
  isViewPreference,
  readPanelOpen,
  readPanelTab,
  readViewPreference,
  setViewPreference,
  writePanelOpen,
  writePanelTab,
} from './useDeskMode'

function mockViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return { matches: min ? width >= Number(min[1]) : false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  localStorage.clear()
  setViewPreference('desk')
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as { matchMedia?: unknown }).matchMedia
  localStorage.clear()
})

describe('desk mode', () => {
  it('needs a window at least 900px wide and docks the panel from 1280px', () => {
    expect(DESK_MIN_WIDTH).toBe(900)
    expect(DESK_QUERY).toBe('(min-width: 900px)')
    expect(PANEL_DOCK_WIDTH).toBe(1280)
    expect(PANEL_DOCK_QUERY).toBe('(min-width: 1280px)')
    mockViewport(899)
    expect(isDeskModeNow()).toBe(false)
    mockViewport(900)
    expect(isDeskModeNow()).toBe(true)
  })

  it('is off where matchMedia is missing, so jsdom tests keep the phone layout', () => {
    expect(typeof window.matchMedia).toBe('undefined')
    expect(isDeskModeNow()).toBe(false)
  })

  it('defaults to the desk view and remembers the phone view in fundbun.view', () => {
    mockViewport(1440)
    expect(readViewPreference()).toBe('desk')
    setViewPreference('phone')
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe('phone')
    expect(VIEW_STORAGE_KEY).toBe('fundbun.view')
    expect(readViewPreference()).toBe('phone')
    expect(isDeskModeNow()).toBe(false)
    setViewPreference('desk')
    expect(isDeskModeNow()).toBe(true)
  })

  it('ignores a stored value it does not know', () => {
    localStorage.setItem(VIEW_STORAGE_KEY, 'tablet')
    expect(readViewPreference()).toBe('desk')
    expect(isViewPreference('phone')).toBe(true)
    expect(isViewPreference('tablet')).toBe(false)
  })

  it('still works for the session when storage throws', () => {
    mockViewport(1440)
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readViewPreference()).toBe('desk')
    expect(() => setViewPreference('phone')).not.toThrow()
    expect(readViewPreference()).toBe('phone')
    expect(isDeskModeNow()).toBe(false)
    expect(readPanelOpen()).toBeNull()
    expect(() => writePanelOpen(false)).not.toThrow()
    expect(readPanelTab()).toBe('chat')
    expect(() => writePanelTab('glass')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })

  it('tells listeners when the view changes', () => {
    const heard = vi.fn()
    window.addEventListener('fundbun:view', heard)
    setViewPreference('phone')
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('fundbun:view', heard)
  })
})

describe('side panel preferences', () => {
  it('remembers whether the panel is open, and which tab', () => {
    expect(readPanelOpen()).toBeNull()
    writePanelOpen(false)
    expect(localStorage.getItem(PANEL_OPEN_KEY)).toBe('closed')
    expect(readPanelOpen()).toBe(false)
    writePanelOpen(true)
    expect(readPanelOpen()).toBe(true)
    expect(readPanelTab()).toBe('chat')
    writePanelTab('glass')
    expect(readPanelTab()).toBe('glass')
  })

  it('starts open from 1280px and closed in drawer widths (900 to 1279px)', () => {
    expect(defaultPanelOpen(1440)).toBe(true)
    expect(defaultPanelOpen(1280)).toBe(true)
    expect(defaultPanelOpen(1279)).toBe(false)
    expect(defaultPanelOpen(1024)).toBe(false)
    expect(defaultPanelOpen(undefined)).toBe(true)
  })
})

describe('desk shell copy', () => {
  it('lists the sidebar navigation in order', () => {
    expect(DESK_NAV.map((n) => `${n.route}:${n.label}`)).toEqual(['home:Dashboard', 'insights:Insights', 'bills:Bills', 'goals:Goals', 'activity:Activity'])
    expect(DESK_ROOTS.has('settings')).toBe(true)
    expect(DESK_ROOTS.has('receipt')).toBe(false)
  })

  it('names the page: Home is the Dashboard on the desk', () => {
    expect(deskTitle('home')).toBe('Dashboard')
    expect(deskTitle('bills')).toBe('Bills')
    expect(deskTitle('receipt')).toBe('Scan receipt')
  })

  it('gives a back button only to routes the sidebar does not list', () => {
    expect(deskParent('home')).toBeUndefined()
    expect(deskParent('settings')).toBeUndefined()
    expect(deskParent('activity')).toBeUndefined()
    expect(deskParent('receipt')).toBe('home')
  })

  it('formats the app date', () => {
    expect(longDate('2026-10-22')).toBe('Thu, Oct 22, 2026')
    expect(longDate('2026-01-01')).toBe('Thu, Jan 1, 2026')
  })

  it('names the chat tab with what is waiting', () => {
    expect(chatTabName(0)).toBe('Ask Bun')
    expect(chatTabName(2)).toBe('Ask Bun, 2 waiting for your OK')
  })
})
