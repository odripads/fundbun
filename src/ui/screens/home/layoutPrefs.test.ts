// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  DASH_LAYOUT_KEY,
  DEFAULT_DASH_ORDER,
  DEFAULT_HOME_ORDER,
  HOME_LAYOUT_KEY,
  isDashDefault,
  isHomeDefault,
  moveBlock,
  readDashLayout,
  readHomeLayout,
  reorderBlock,
  resetDashLayout,
  resetHomeLayout,
  sanitizeDashLayout,
  sanitizeHomeLayout,
  toggleHidden,
  toggleWide,
  writeDashLayout,
  writeHomeLayout,
} from './layoutPrefs'

afterEach(() => {
  localStorage.clear()
  resetDashLayout()
  resetHomeLayout()
})

describe('layoutPrefs', () => {
  it('returns default orders when storage is empty or malformed', () => {
    expect(readDashLayout().order).toEqual(DEFAULT_DASH_ORDER)
    expect(readHomeLayout().order).toEqual(DEFAULT_HOME_ORDER)
    expect(isDashDefault(readDashLayout())).toBe(true)
    expect(isHomeDefault(readHomeLayout())).toBe(true)

    localStorage.setItem(DASH_LAYOUT_KEY, '{not-json')
    localStorage.setItem(HOME_LAYOUT_KEY, '["bogus"]')
    expect(readDashLayout().order).toEqual(DEFAULT_DASH_ORDER)
    expect(readHomeLayout().order).toEqual(DEFAULT_HOME_ORDER)
  })

  it('sanitizes unknown, duplicate, or missing ids and preserves valid ones', () => {
    const dash = sanitizeDashLayout({
      order: ['checkin', 'unknown', 'checkin', 'hero'],
      hidden: ['bills', 'nope', 'bills'],
      wide: ['hero', 'txns', 'cats', 'nope'],
    })
    expect(dash.order.slice(0, 2)).toEqual(['checkin', 'hero'])
    expect(dash.order).toHaveLength(DEFAULT_DASH_ORDER.length)
    expect(dash.hidden).toEqual(['bills'])
    expect(dash.wide).toEqual(['cats'])

    const home = sanitizeHomeLayout({
      order: ['month', 'bad', 'checkin'],
      hidden: ['couldve', 'bad'],
    })
    expect(home.order.slice(0, 2)).toEqual(['month', 'checkin'])
    expect(home.order).toHaveLength(DEFAULT_HOME_ORDER.length)
    expect(home.hidden).toEqual(['couldve'])
  })

  it('moves blocks among visible neighbours and reorders on drag-drop', () => {
    const moved = moveBlock(DEFAULT_DASH_ORDER, 'checkin', -1)
    expect(moved.slice(0, 3)).toEqual(['hero', 'checkin', 'month'])

    // skips hidden neighbour between two visible ones
    const skipping = moveBlock(['hero', 'month', 'checkin', 'trip'], 'checkin', -1, ['month'])
    expect(skipping).toEqual(['checkin', 'month', 'hero', 'trip'])

    const reordered = reorderBlock(DEFAULT_HOME_ORDER, 'checkin', 'month')
    expect(reordered.slice(0, 3)).toEqual(['trip', 'month', 'checkin'])
  })

  it('toggles hidden and wide flags and persists across reads until reset', () => {
    expect(toggleHidden([], 'bills')).toEqual(['bills'])
    expect(toggleHidden(['bills'], 'bills')).toEqual([])
    expect(toggleWide([], 'cats')).toEqual(['cats'])
    expect(toggleWide(['cats'], 'cats')).toEqual([])
    expect(toggleWide([], 'hero')).toEqual([])

    writeDashLayout({ order: moveBlock(DEFAULT_DASH_ORDER, 'checkin', -1), hidden: ['six'], wide: ['cats'] })
    expect(readDashLayout().order[1]).toBe('checkin')
    expect(readDashLayout().hidden).toEqual(['six'])
    expect(readDashLayout().wide).toEqual(['cats'])
    expect(isDashDefault(readDashLayout())).toBe(false)

    writeHomeLayout({ order: moveBlock(DEFAULT_HOME_ORDER, 'month', -1), hidden: ['insights'] })
    expect(readHomeLayout().hidden).toEqual(['insights'])
    expect(isHomeDefault(readHomeLayout())).toBe(false)

    resetDashLayout()
    resetHomeLayout()
    expect(isDashDefault(readDashLayout())).toBe(true)
    expect(isHomeDefault(readHomeLayout())).toBe(true)
  })
})
