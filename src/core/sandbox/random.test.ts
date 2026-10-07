import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import { hhmm, mixSeed, pickWeighted, poisson, rngFor, sampleDistinct, samplePrice, timeInWindow } from './random'

describe('mixSeed / rngFor', () => {
  it('derives stable, distinct 32-bit seeds', () => {
    expect(mixSeed(1, 'a', 2)).toBe(mixSeed(1, 'a', 2))
    expect(mixSeed(1, 'a', 2)).not.toBe(mixSeed(1, 'a', 3))
    expect(mixSeed(1, 'a')).not.toBe(mixSeed(2, 'a'))
    expect(mixSeed(1, 'ab', 'c')).not.toBe(mixSeed(1, 'a', 'bc'))
    const s = mixSeed(-5, 'x')
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true)
  })

  it('gives reproducible independent streams', () => {
    const a = rngFor(7, 'day', '2026-10-01')
    const b = rngFor(7, 'day', '2026-10-01')
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()])
    expect(rngFor(7, 'day', '2026-10-02').next()).not.toBe(rngFor(7, 'day', '2026-10-01').next())
  })
})

describe('poisson', () => {
  it('returns 0 for non-positive rates and averages λ otherwise', () => {
    const rng = createRng(1)
    expect(poisson(rng, 0)).toBe(0)
    expect(poisson(rng, -1)).toBe(0)
    expect(poisson(rng, Number.NaN)).toBe(0)
    let total = 0
    for (let i = 0; i < 4_000; i++) total += poisson(rng, 1.5)
    expect(total / 4_000).toBeGreaterThan(1.4)
    expect(total / 4_000).toBeLessThan(1.6)
  })
})

describe('samplePrice', () => {
  it('stays within bounds and on the rounding step', () => {
    const rng = createRng(3)
    for (let i = 0; i < 500; i++) {
      const p = samplePrice(rng, { median: 3_300, sigma: 0.6, min: 2_200, max: 5_200, step: 10 })
      expect(p).toBeGreaterThanOrEqual(2_200)
      expect(p).toBeLessThanOrEqual(5_200)
      expect(p % 10).toBe(0)
    }
  })

  it('rounds to whole yuan by default and picks from a menu', () => {
    const rng = createRng(4)
    expect(samplePrice(rng, { median: 2_350, sigma: 0.1, min: 1_000, max: 4_000 }) % 100).toBe(0)
    for (let i = 0; i < 50; i++) expect([990, 1_390]).toContain(samplePrice(rng, { pick: [990, 1_390] }))
  })
})

describe('hhmm / timeInWindow', () => {
  it('formats decimal hours and wraps past midnight', () => {
    expect(hhmm(0)).toBe('00:00')
    expect(hhmm(9.5)).toBe('09:30')
    expect(hhmm(23.999)).toBe('23:59')
    expect(hhmm(24.25)).toBe('00:15')
    expect(hhmm(25.5)).toBe('01:30')
  })

  it('draws a time inside a late-night window that crosses midnight', () => {
    const rng = createRng(9)
    for (let i = 0; i < 200; i++) {
      const t = timeInWindow(rng, [23, 25.5])
      expect(t >= '23:00' || t <= '01:30').toBe(true)
    }
  })
})

describe('pickWeighted', () => {
  it('respects weights', () => {
    const rng = createRng(11)
    const items = [{ id: 'a', weight: 9 }, { id: 'b', weight: 1 }, { id: 'c', weight: 0 }]
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 2_000; i++) counts[pickWeighted(rng, items).id]++
    expect(counts.c).toBe(0)
    expect(counts.a / 2_000).toBeGreaterThan(0.85)
    const single: { id: string; weight?: number }[] = [{ id: 'only' }]
    expect(pickWeighted(rng, single).id).toBe('only')
  })
})

describe('sampleDistinct', () => {
  it('returns distinct elements in pool order', () => {
    const rng = createRng(12)
    const pool = Array.from({ length: 31 }, (_, i) => i + 1)
    const picked = sampleDistinct(rng, pool, 10)
    expect(picked).toHaveLength(10)
    expect(new Set(picked).size).toBe(10)
    expect(picked).toEqual([...picked].sort((a, b) => a - b))
    expect(sampleDistinct(rng, [1, 2], 5)).toEqual([1, 2])
    expect(sampleDistinct(rng, [1, 2], 0)).toEqual([])
  })
})
