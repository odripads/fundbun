import { describe, expect, it } from 'vitest'
import {
  BODY_PATH,
  CUTS,
  FACES,
  PALETTE,
  SMALL_BODY_SCALE,
  SMALL_CUT_MAX,
  bodyStroke,
  browPath,
  closedEyePath,
  crumbPath,
  cutForSize,
  ellipseExtent,
  eyeHighlight,
  scallopPath,
  spiralPath,
  yenPath,
  zPath,
  type Ellipse,
} from './geometry'

type P = [number, number]

/** Samples an absolute M/L/H/V/Q/C/Z path (the only commands these builders emit) into points. */
function samplePath(d: string, steps = 24): P[] {
  const tokens = d.match(/[MLHVQCZ]|-?\d*\.?\d+/g) ?? []
  const out: P[] = []
  let cur: P = [0, 0]
  let start: P = [0, 0]
  let i = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M') {
      cur = [num(), num()]
      start = cur
      out.push(cur)
    } else if (cmd === 'L') {
      while (i < tokens.length && !/[A-Z]/.test(tokens[i])) {
        cur = [num(), num()]
        out.push(cur)
      }
    } else if (cmd === 'H') {
      cur = [num(), cur[1]]
      out.push(cur)
    } else if (cmd === 'V') {
      cur = [cur[0], num()]
      out.push(cur)
    } else if (cmd === 'Q') {
      const c: P = [num(), num()]
      const e: P = [num(), num()]
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const u = 1 - t
        out.push([u * u * cur[0] + 2 * u * t * c[0] + t * t * e[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * e[1]])
      }
      cur = e
    } else if (cmd === 'C') {
      const c1: P = [num(), num()]
      const c2: P = [num(), num()]
      const e: P = [num(), num()]
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const u = 1 - t
        const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
        out.push([b[0] * cur[0] + b[1] * c1[0] + b[2] * c2[0] + b[3] * e[0], b[0] * cur[1] + b[1] * c1[1] + b[2] * c2[1] + b[3] * e[1]])
      }
      cur = e
    } else if (cmd === 'Z') {
      cur = start
    } else {
      throw new Error(`unexpected path token ${cmd}`)
    }
  }
  return out
}

const bounds = (pts: P[]) => ({
  top: Math.min(...pts.map((p) => p[1])),
  bottom: Math.max(...pts.map((p) => p[1])),
  left: Math.min(...pts.map((p) => p[0])),
  right: Math.max(...pts.map((p) => p[0])),
})

/** normalised ellipse radius: <1 inside, 1 on the edge */
const rho = (e: Ellipse, [x, y]: P) => Math.hypot((x - e.cx) / e.rx, (y - e.cy) / e.ry)

/** distance from a point to the ellipse edge along its radial line (≈ px of clearance for points inside) */
const clearance = (e: Ellipse, p: P) => {
  const r = rho(e, p)
  const d = Math.hypot(p[0] - e.cx, p[1] - e.cy)
  return r === 0 ? Math.min(e.rx, e.ry) : (d / r) * (1 - r)
}

describe('cutForSize', () => {
  it('uses the bold small cut up to 56px and the full drawing above', () => {
    expect(cutForSize(16)).toBe('small')
    expect(cutForSize(SMALL_CUT_MAX)).toBe('small')
    expect(cutForSize(SMALL_CUT_MAX + 1)).toBe('full')
    expect(cutForSize(512)).toBe('full')
  })

  it('treats nonsense sizes as small rather than throwing', () => {
    for (const size of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) expect(cutForSize(size)).toBe('small')
  })
})

describe('bodyStroke', () => {
  it('compensates the small cut scale so outlines keep their frame weight', () => {
    expect(bodyStroke('full', 14)).toBe(14)
    expect(bodyStroke('small', 24) * SMALL_BODY_SCALE).toBeCloseTo(24, 0)
  })
})

describe('yenPath', () => {
  const spec = { cx: 100, vy: 100, armWidth: 80, armHeight: 30, stemLength: 60, bars: [10, 40] as const, barWidth: 70 }

  it('draws arms meeting at the V, a stem and two bars', () => {
    expect(yenPath(spec)).toBe('M60 70L100 100L140 70M100 100V160M65 110H135M65 140H135')
  })

  it('keeps the bars apart by more than the stroke in both cuts (they must never merge)', () => {
    for (const cut of ['full', 'small'] as const) {
      const g = CUTS[cut]
      expect(g.yen.bars[1] - g.yen.bars[0]).toBeGreaterThan(g.yenWidth + 8)
    }
  })
})

describe('scallopPath', () => {
  const e = { cx: 0, cy: 0, rx: 100, ry: 50 }

  it('builds a closed ring of cubic scallops starting at the top valley', () => {
    const d = scallopPath(e, 8, 0.1)
    expect(d.startsWith('M0 -50C')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(8)
  })

  it('keeps valleys on the ellipse and bulges every bump outward by about the requested amount', () => {
    const pts = samplePath(scallopPath(e, 6, 0.12), 40)
    const radii = pts.map((p) => rho(e, p))
    expect(Math.min(...radii)).toBeGreaterThan(0.999)
    expect(Math.max(...radii)).toBeGreaterThan(1.1)
    expect(Math.max(...radii)).toBeLessThan(1.14)
  })

  it('rejects degenerate counts', () => {
    expect(() => scallopPath(e, 2, 0.1)).toThrow()
    expect(() => scallopPath(e, 4.5, 0.1)).toThrow()
  })

  it('cycles the wobble weights across bumps', () => {
    expect(scallopPath(e, 4, 0.1, [1, 0])).not.toBe(scallopPath(e, 4, 0.1, [1, 1]))
    expect(scallopPath(e, 4, 0.1, [])).toBe(scallopPath(e, 4, 0.1, [1]))
  })
})

describe('the full mark (judge refinements)', () => {
  const g = CUTS.full
  const crumb = g.crumb as Ellipse
  const crumbBounds = bounds(samplePath(crumbPath(crumb)))
  const body = bounds(samplePath(BODY_PATH))

  it('leaves at least 40px of plain dough between the smile and the torn rim', () => {
    const smileBottom = bounds(samplePath(g.smile)).bottom + g.mouthWidth / 2
    expect(crumbBounds.top - g.crumbWidth / 2 - smileBottom).toBeGreaterThanOrEqual(39.5)
  })

  it('keeps the eyes above the rim and clear of the pleat ends', () => {
    const eyeTop = g.eyes.cy - g.eyes.ry
    for (const d of g.pleats) {
      const end = samplePath(d).at(-1) as P
      const nearestEye = Math.min(...[g.eyes.left, g.eyes.right].map((x) => Math.hypot(end[0] - x, end[1] - g.eyes.cy) - g.eyes.rx))
      expect(nearestEye).toBeGreaterThan(8)
    }
    expect(g.eyes.cy + g.eyes.ry).toBeLessThan(crumbBounds.top)
    expect(eyeTop).toBeGreaterThan(body.top)
  })

  it('simplifies the torn rim to eight soft scallops', () => {
    expect(crumbPath(crumb).match(/C/g)).toHaveLength(8)
  })

  it('nests pocket inside crumb inside body with room to breathe', () => {
    const pocket = ellipseExtent(g.pocket)
    expect(pocket.top).toBeGreaterThan(crumbBounds.top + 8)
    expect(pocket.bottom).toBeLessThan(crumbBounds.bottom - 8)
    expect(crumbBounds.bottom + g.crumbWidth / 2).toBeLessThan(body.bottom - g.outline / 2 - 8)
    expect(crumbBounds.left).toBeGreaterThan(body.left + 30)
    expect(crumbBounds.right).toBeLessThan(body.right - 30)
  })

  it('draws a bigger ¥ (stroke 26, ~84px arms) on a 1.5× soy underlay that stays inside the pocket', () => {
    expect(g.yenWidth).toBe(26)
    expect(g.yen.armWidth).toBe(84)
    expect(g.yenUnderlay / g.yenWidth).toBeCloseTo(1.5, 1)
    for (const p of samplePath(yenPath(g.yen))) expect(clearance(g.pocket, p)).toBeGreaterThan(g.yenWidth / 2 + 4)
  })

  it('puts the steam above the knot without touching the frame edge', () => {
    for (const d of g.steam) {
      const b = bounds(samplePath(d))
      expect(b.top - g.steamWidth / 2).toBeGreaterThan(0)
      expect(b.bottom).toBeLessThan(body.top + 10)
    }
  })
})

describe('the small cut (≤56px)', () => {
  const g = CUTS.small

  it('pulls the eyes in and uses the big gold-rimmed pocket', () => {
    expect([g.eyes.left, g.eyes.right]).toEqual([190, 322])
    expect(g.pocket).toMatchObject({ rx: 100, ry: 86 })
    expect(g.rimWidth).toBeGreaterThan(0)
    expect(g.crumb).toBeUndefined()
    expect(g.steam).toHaveLength(0)
  })

  it('keeps the bold ¥ inside the pocket with a soy margin', () => {
    for (const p of samplePath(yenPath(g.yen))) expect(clearance(g.pocket, p)).toBeGreaterThan(g.yenWidth / 2 + 2)
  })

  it('separates the smile from the pocket rim', () => {
    const smileBottom = bounds(samplePath(g.smile)).bottom + g.mouthWidth / 2
    expect(g.pocket.cy - g.pocket.ry - g.rimWidth / 2 - smileBottom).toBeGreaterThan(20)
  })
})

describe('face helpers', () => {
  it('places the eye glint up and right of centre', () => {
    const h = eyeHighlight(100, 100, 20)
    expect(h.cx).toBeGreaterThan(100)
    expect(h.cy).toBeLessThan(100)
    expect(h.r).toBeGreaterThan(0)
  })

  it('raises the inner end of each worried brow', () => {
    const [left, right] = [browPath(180, 200, 16, 20, 0.5), browPath(332, 200, 16, 20, 0.5)].map((d) => samplePath(d))
    expect(left[1][0]).toBeGreaterThan(left[0][0])
    expect(left[1][1]).toBeLessThan(left[0][1])
    expect(right[1][0]).toBeLessThan(right[0][0])
    expect(right[1][1]).toBeLessThan(right[0][1])
  })

  it('curves closed eyes downward', () => {
    const pts = samplePath(closedEyePath(100, 100, 10, 10))
    expect(bounds(pts).bottom).toBeGreaterThan(100)
    expect(pts[0][1]).toBe(100)
  })

  it('spirals out from the centre to the radius', () => {
    const pts = samplePath(spiralPath(50, 50, 20))
    expect(pts[0]).toEqual([50, 50])
    const last = pts.at(-1) as P
    expect(Math.hypot(last[0] - 50, last[1] - 50)).toBeCloseTo(20, 0)
  })

  it('draws a z as top bar, diagonal, bottom bar', () => {
    expect(zPath(10, 20, 30)).toBe('M10 20H40L10 50H40')
  })

  it('keeps every accessory inside the 512 frame', () => {
    for (const cut of ['full', 'small'] as const) {
      const f = FACES[cut]
      for (const [x, y, s] of f.sparkles) {
        expect(x - 6 * s).toBeGreaterThan(0)
        expect(x + 6 * s).toBeLessThan(512)
        expect(y - 6 * s).toBeGreaterThan(0)
      }
      for (const [x, y, s] of f.zzz) {
        expect(y).toBeGreaterThan(0)
        expect(x + s).toBeLessThan(512)
      }
      const [sx, sy, ss] = f.sweat
      expect(sx + 13 * ss).toBeLessThan(512)
      expect(sy - 20 * ss).toBeGreaterThan(0)
    }
  })
})

describe('palette', () => {
  it('locks the gold roles to the mascot scheme', () => {
    expect(PALETTE.yen).toBe('#F2BD3D')
    expect(PALETTE.rim).toBe('#E3A21A')
    expect(PALETTE.ink).toBe('#3A2A1F')
  })
})
