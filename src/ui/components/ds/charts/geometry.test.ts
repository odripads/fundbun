import { describe, expect, it } from 'vitest'
import { barRows, barSummary } from './BarChart'
import { donutSummary } from './Donut'
import { moneyFormat } from './format'
import {
  areaPath,
  CHART_PALETTE,
  colorFor,
  donutArcs,
  foldOther,
  linePath,
  OTHER_COLOR,
  OTHER_ID,
  pct,
  percentLabel,
  scaleMax,
  sparkPoints,
  sparkY,
  stackSegments,
} from './geometry'
import { sparkSummary } from './Sparkline'
import { stackedSummary } from './StackedBar'

const d = (id: string, value: number, color?: string) => ({ id, label: id.toUpperCase(), value, color })

describe('foldOther', () => {
  it('leaves short series alone (but clamps negatives / NaN)', () => {
    expect(foldOther([d('a', 3), d('b', -2), d('c', Number.NaN)]).map((x) => x.value)).toEqual([3, 0, 0])
  })

  it('keeps the largest max-1 in original order and folds the rest', () => {
    const out = foldOther([d('a', 1), d('b', 9), d('c', 5), d('d', 7), d('e', 2)], 3)
    expect(out.map((x) => x.id)).toEqual(['b', 'd', OTHER_ID])
    expect(out[2]).toMatchObject({ label: 'Other', value: 1 + 5 + 2, color: OTHER_COLOR })
  })

  it('handles max = 1 (everything folds)', () => {
    const out = foldOther([d('a', 1), d('b', 2)], 1)
    expect(out).toEqual([{ id: OTHER_ID, label: 'Other', value: 3, color: OTHER_COLOR }])
  })
})

describe('colorFor', () => {
  it('prefers the datum colour, then the fixed palette, never cycling', () => {
    expect(colorFor(d('a', 1, '#123'), 0)).toBe('#123')
    expect(colorFor(d('a', 1), 1)).toBe(CHART_PALETTE[1])
    expect(colorFor(d('a', 1), 6)).toBe(OTHER_COLOR)
    expect(colorFor({ id: OTHER_ID, label: 'Other', value: 1 }, 0)).toBe(OTHER_COLOR)
  })
})

describe('scales', () => {
  it('scaleMax takes the largest finite value and never returns 0', () => {
    expect(scaleMax([1, 5], [7])).toBe(7)
    expect(scaleMax([])).toBe(1)
    expect(scaleMax([0, -3, Number.NaN, Number.POSITIVE_INFINITY])).toBe(1)
  })

  it('pct clamps', () => {
    expect(pct(5, 10)).toBe(50)
    expect(pct(15, 10)).toBe(100)
    expect(pct(-1, 10)).toBe(0)
    expect(pct(1, 0)).toBe(0)
  })

  it('percentLabel rounds and marks tiny shares', () => {
    expect(percentLabel(0.444)).toBe('44%')
    expect(percentLabel(0.004)).toBe('<1%')
    expect(percentLabel(0)).toBe('0%')
    expect(percentLabel(Number.NaN)).toBe('0%')
  })
})

describe('sparkline geometry', () => {
  it('maps a series into the padded 0..100 box with y downward', () => {
    const pts = sparkPoints([0, 10])
    expect(pts).toEqual([{ x: 0, y: 92 }, { x: 100, y: 8 }])
  })

  it('centres flat and single-point series', () => {
    expect(sparkPoints([5, 5, 5]).every((p) => p.y === 50)).toBe(true)
    expect(sparkPoints([5])).toEqual([{ x: 50, y: 50 }])
    expect(sparkPoints([])).toEqual([])
  })

  it('honours a fixed domain and places a reference on the same scale', () => {
    const values = [0, 10]
    const pts = sparkPoints(values, { min: 0, max: 20 })
    expect(pts[1].y).toBe(50)
    expect(sparkY(20, values, { min: 0, max: 20 })).toBe(8)
    expect(sparkY(5, [5, 5])).toBe(50)
  })

  it('builds line and closed area paths', () => {
    const pts = [{ x: 0, y: 10 }, { x: 100, y: 20 }]
    expect(linePath(pts)).toBe('M0 10 L100 20')
    expect(areaPath(pts)).toBe('M0 10 L100 20 L100 100 L0 100 Z')
    expect(areaPath([])).toBe('')
  })
})

describe('donutArcs', () => {
  it('splits the circumference by share with a gap between visible segments', () => {
    const arcs = donutArcs([1, 1], 100, 2)
    expect(arcs).toEqual([
      { length: 48, offset: -0, share: 0.5 },
      { length: 48, offset: -50, share: 0.5 },
    ])
  })

  it('draws a single segment without a gap and skips zeros', () => {
    expect(donutArcs([0, 5], 100)).toEqual([
      { length: 0, offset: -0, share: 0 },
      { length: 100, offset: -0, share: 1 },
    ])
  })

  it('returns empty arcs for an all-zero or invalid series', () => {
    expect(donutArcs([0, 0], 100).every((a) => a.length === 0)).toBe(true)
    expect(donutArcs([1], 0)[0].length).toBe(0)
    expect(donutArcs([-5, Number.NaN], 100).every((a) => a.length === 0)).toBe(true)
  })
})

describe('stackSegments', () => {
  it('lays segments end to end', () => {
    expect(stackSegments([1, 3])).toEqual([
      { start: 0, width: 25, share: 0.25 },
      { start: 25, width: 75, share: 0.75 },
    ])
  })

  it('leaves a remainder when total exceeds the sum', () => {
    const s = stackSegments([1, 1], 4)
    expect(s.map((x) => x.width)).toEqual([25, 25])
    expect(s[1].share).toBe(0.5)
  })

  it('ignores a total smaller than the sum and handles zeros', () => {
    expect(stackSegments([2, 2], 1).map((x) => x.width)).toEqual([50, 50])
    expect(stackSegments([0, 0])).toEqual([{ start: 0, width: 0, share: 0 }, { start: 0, width: 0, share: 0 }])
  })
})

describe('chart rows and summaries', () => {
  const f = moneyFormat('CNY')

  it('barRows share one scale and mark overflow', () => {
    const rows = barRows([
      { id: 'dining', label: 'Dining', value: 124000, limit: 90000 },
      { id: 'coffee', label: 'Coffee', value: 41800, limit: 45000 },
      { id: 'misc', label: 'Misc', value: 10000 },
    ])
    expect(rows[0]).toMatchObject({ valuePct: 100, over: true, overBy: 34000 })
    expect(rows[0].limitPct).toBeCloseTo(72.58, 1)
    expect(rows[1].over).toBe(false)
    expect(rows[2].limitPct).toBeNull()
  })

  it('barRows honours a fixed max', () => {
    expect(barRows([{ id: 'a', label: 'A', value: 50 }], 200)[0].valuePct).toBe(25)
  })

  it('barSummary names the largest row and every overrun', () => {
    const rows = barRows([
      { id: 'dining', label: 'Dining', value: 124000, limit: 90000 },
      { id: 'coffee', label: 'Coffee', value: 41800, limit: 45000 },
    ])
    expect(barSummary('October', rows, f)).toBe('October. 2 categories; largest Dining at ¥1,240; over limit: Dining by ¥340.')
    expect(barSummary('October', barRows([{ id: 'a', label: 'A', value: 1, limit: 2 }]), f)).toContain('all within limits')
    expect(barSummary('Empty', [], f)).toBe('Empty: no data')
  })

  it('sparkSummary describes direction and range', () => {
    expect(sparkSummary('Spend', [100, 300, 200], f)).toBe('Spend: 3 points, up from ¥1 to ¥2; high ¥3, low ¥1.')
    expect(sparkSummary('Spend', [], f)).toBe('Spend: no data')
  })

  it('donut and stacked summaries list parts with shares', () => {
    const data = [d('needs', 300), d('wants', 100)]
    expect(donutSummary('Split', data, f)).toBe('Split, total ¥4: NEEDS ¥3 (75%), WANTS ¥1 (25%).')
    expect(stackedSummary('Split', data, f, 800)).toBe('Split, ¥4 of ¥8: NEEDS ¥3 (75%), WANTS ¥1 (25%).')
    expect(donutSummary('Split', [d('a', 0)], f)).toBe('Split: no data')
  })
})
