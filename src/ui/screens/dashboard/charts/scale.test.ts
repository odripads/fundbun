import { describe, expect, it } from 'vitest'
import { axisMoney, bandAt, bands, barHeight, columnPath, dayTicks, valueScale } from './scale'

describe('chart scale', () => {
  it('ends the value axis on a round number at or above the data', () => {
    const s = valueScale(166400)
    expect(s.ticks[0]).toBe(0)
    expect(s.max).toBeGreaterThanOrEqual(166400)
    expect(s.max).toBe(s.ticks[s.ticks.length - 1])
    expect(s.max % 50000).toBe(0)
    // nothing to plot still gives a usable axis
    expect(valueScale(0)).toEqual({ max: 1, ticks: [0, 1] })
  })

  it('maps amounts to pixel heights inside the plot', () => {
    expect(barHeight(50, 100, 200)).toBe(100)
    expect(barHeight(150, 100, 200)).toBe(200)
    expect(barHeight(-5, 100, 200)).toBe(0)
    expect(barHeight(10, 0, 200)).toBe(0)
    expect(barHeight(Number.NaN, 100, 200)).toBe(0)
  })

  it('lays out equal slots with a centred bar that never gets thicker than the cap', () => {
    const b = bands(31, 310, 18)
    expect(b).toHaveLength(31)
    expect(b[0].slot).toBe(10)
    expect(b[0].bar).toBeCloseTo(6.8)
    expect(b[3].x).toBe(30)
    expect(b[3].mid).toBe(35)
    expect(b[3].barX + b[3].bar / 2).toBeCloseTo(35)
    expect(bands(6, 600)[0].bar).toBe(24)
    expect(bands(0, 600)).toEqual([])
    expect(bands(6, 0)).toEqual([])
  })

  it('finds the slot under a pointer, clamped to the ends', () => {
    expect(bandAt(35, 31, 310)).toBe(3)
    expect(bandAt(-20, 31, 310)).toBe(0)
    expect(bandAt(9999, 31, 310)).toBe(30)
    expect(bandAt(10, 0, 310)).toBe(0)
  })

  it('draws a column with a rounded top and a square foot', () => {
    expect(columnPath(10, 100, 8, 40, 3)).toBe('M10 100V63Q10 60 13 60H15Q18 60 18 63V100Z')
    // a stub shorter than the radius keeps its shape
    expect(columnPath(0, 100, 8, 2, 4)).toBe('M0 100V100Q0 98 2 98H6Q8 98 8 100V100Z')
    expect(columnPath(0, 100, 8, 0)).toBe('')
  })

  it('keeps one label style per axis: whole amounts, or compact once the axis reaches 10,000', () => {
    expect(axisMoney(50000, 200000, 'CNY')).toBe('¥500')
    expect(axisMoney(0, 200000, 'CNY')).toBe('¥0')
    expect(axisMoney(500000, 1500000, 'CNY')).toBe('¥5k')
    expect(axisMoney(1208024, 1500000, 'CNY')).toBe('¥12.1k')
  })

  it('labels the 1st and every fifth day, and makes room for today', () => {
    expect(dayTicks(31, null)).toEqual([1, 5, 10, 15, 20, 25, 30])
    expect(dayTicks(31, 22)).toEqual([1, 5, 10, 15, 20, 22, 25, 30])
    // the 21st would crowd the 20th: today wins
    expect(dayTicks(31, 21)).toEqual([1, 5, 10, 15, 21, 25, 30])
    expect(dayTicks(28, 1)).toEqual([1, 5, 10, 15, 20, 25])
    expect(dayTicks(30, 30)).toEqual([1, 5, 10, 15, 20, 25, 30])
  })
})
