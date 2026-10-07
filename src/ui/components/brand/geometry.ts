/**
 * Bun's geometry — the single source for the React mascot and the static logo files (logo.svg, favicon, PNGs).
 * Everything lives in a 512×512 frame. Two cuts share one silhouette:
 *   full  — steam, five pleats, a face, a scalloped crumb rim around a lit soy pocket holding a double-stroke ¥
 *   small — the ≤56px/icon cut: no steam, the body scaled to fill the frame, four bold pleats, eyes pulled in,
 *           a big solid pocket with a gold rim (so the oval reads as filling, not as a snout)
 */

export const VIEW = 512

export type Cut = 'full' | 'small'

/** Below this rendered size (px) the bold small cut replaces the full drawing. */
export const SMALL_CUT_MAX = 56

export function cutForSize(size: number): Cut {
  return Number.isFinite(size) && size > SMALL_CUT_MAX ? 'full' : 'small'
}

/** Static palette (the mascot's colour roles). The React mascot maps the same roles onto tokens.css variables. */
export const PALETTE = {
  dough: '#F6E7CC',
  doughShade: '#EFD7AD',
  crumb: '#FFF4E3',
  highlight: '#FFFAF2',
  bamboo: '#B9874B',
  bambooDeep: '#8F6232',
  ink: '#3A2A1F',
  inkDeep: '#24180F',
  /** the ¥ — never placed directly on a rim-gold field */
  yen: '#F2BD3D',
  /** the pocket rim / glow */
  rim: '#E3A21A',
  rimDeep: '#B97F09',
  blush: '#EE6A4D',
} as const

/** Pocket fill = a warm core fading to soy, plus a tight gold glow just inside the rim ("lit from inside"). */
export const POCKET_STOPS = {
  core: [
    [0, '#7A5330', 1],
    [0.6, PALETTE.ink, 1],
    [1, PALETTE.ink, 1],
  ],
  glow: [
    [0, PALETTE.rim, 0],
    [0.74, PALETTE.rim, 0],
    [1, PALETTE.rim, 0.8],
  ],
} as const satisfies Record<string, readonly (readonly [number, string, number])[]>

/** How much wider than the soy outline the dark-UI cream keyline is drawn (frame units). */
export const KEYLINE_EXTRA = 16

const round = (n: number) => Math.round(n * 10) / 10
const pt = (x: number, y: number) => `${round(x)} ${round(y)}`

/**
 * The dome with a pinched, twisted top knot (leaning right — the "baozi, not dinner roll" cue).
 * Drawn once; the small cut scales it with SMALL_BODY_TRANSFORM.
 */
export const BODY_PATH =
  'M226 136C128 148 54 224 48 324C42 412 84 460 154 466C214 471 298 471 358 466C428 460 470 412 464 324C458 224 384 148 290 136C288 124 284 110 276 98C272 92 270 86 272 78C258 84 246 94 238 106C232 116 228 126 226 136Z'

/** The twist line that spirals into the knot tip. */
export const KNOT_TWIST = 'M270 86C262 98 254 112 252 132'

/** Small cut: the body scaled 1.12× about the frame centre and nudged up to fill the square (no steam). */
export const SMALL_BODY_SCALE = 1.12
export const SMALL_BODY_TRANSFORM = `matrix(${SMALL_BODY_SCALE} 0 0 ${SMALL_BODY_SCALE} ${round(256 - 256 * SMALL_BODY_SCALE)} -42)`

/** Body-space strokes sit inside the small cut's scale transform; divide so they keep their frame-space weight. */
export function bodyStroke(cut: Cut, width: number): number {
  return cut === 'small' ? round(width / SMALL_BODY_SCALE) : width
}

export interface Ellipse {
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface CutGeometry {
  outline: number
  pleats: readonly string[]
  pleatWidth: number
  eyes: { left: number; right: number; cy: number; rx: number; ry: number }
  smile: string
  /** where the mood mouths sit: centre + scale of the 0,0-centred MOUTHS shapes */
  mouth: { x: number; y: number; scale: number }
  mouthWidth: number
  blush: { left: number; right: number; cy: number; rx: number; ry: number }
  /** scalloped crumb (torn dough) around the pocket; absent in the small cut */
  crumb?: Ellipse
  crumbWidth: number
  pocket: Ellipse
  rimWidth: number
  yen: YenSpec
  yenWidth: number
  /** soy underlay under the gold ¥ (1.5×) — crisp edges against the pocket glow; 0 on a solid pocket */
  yenUnderlay: number
  steam: readonly string[]
  steamWidth: number
  /** specular streak along the left shoulder (full cut only) */
  shine?: string
}

export interface YenSpec {
  cx: number
  /** y of the V where the arms meet */
  vy: number
  armWidth: number
  armHeight: number
  stemLength: number
  bars: readonly [number, number]
  barWidth: number
}

export const CUTS: Record<Cut, CutGeometry> = {
  full: {
    outline: 14,
    pleats: [
      'M252 146C250 156 252 166 250 176',
      'M240 144C226 152 216 162 212 176',
      'M230 142C196 150 162 162 140 184',
      'M266 144C280 152 292 162 298 176',
      'M280 142C316 150 350 162 372 184',
    ],
    pleatWidth: 9,
    eyes: { left: 180, right: 332, cy: 198, rx: 16, ry: 20 },
    smile: 'M245 211Q256 220 267 211',
    mouth: { x: 256, y: 214, scale: 1 },
    mouthWidth: 9,
    blush: { left: 134, right: 378, cy: 230, rx: 24, ry: 13 },
    crumb: { cx: 256, cy: 356, rx: 122, ry: 88 },
    crumbWidth: 8,
    pocket: { cx: 256, cy: 356, rx: 102, ry: 72 },
    rimWidth: 8,
    yen: { cx: 256, vy: 346, armWidth: 84, armHeight: 36, stemLength: 62, bars: [12, 50], barWidth: 80 },
    yenWidth: 26,
    yenUnderlay: 39,
    steam: ['M206 84C190 70 214 58 200 42C192 32 198 22 204 16', 'M318 84C302 70 326 58 312 42C304 32 310 22 316 16'],
    steamWidth: 14,
    shine: 'M90 270C92 232 112 198 146 174',
  },
  small: {
    outline: 24,
    pleats: ['M244 108C230 122 222 136 218 152', 'M268 108C282 122 290 136 294 152', 'M230 106C196 114 170 128 152 152', 'M282 106C316 114 342 128 360 152'],
    pleatWidth: 20,
    eyes: { left: 190, right: 322, cy: 198, rx: 25, ry: 28 },
    smile: 'M243 216Q256 227 269 216',
    mouth: { x: 256, y: 219.5, scale: 1.2 },
    mouthWidth: 14,
    blush: { left: 124, right: 388, cy: 234, rx: 30, ry: 16 },
    crumbWidth: 0,
    pocket: { cx: 256, cy: 356, rx: 100, ry: 86 },
    rimWidth: 14,
    yen: { cx: 256, vy: 344, armWidth: 88, armHeight: 42, stemLength: 72, bars: [16, 60], barWidth: 88 },
    yenWidth: 30,
    yenUnderlay: 0,
    steam: [],
    steamWidth: 0,
  },
}

/** The ¥ as one multi-subpath stroke: arms, stem, two bars. */
export function yenPath(y: YenSpec): string {
  const half = y.armWidth / 2
  const barHalf = y.barWidth / 2
  const top = y.vy - y.armHeight
  return [
    `M${pt(y.cx - half, top)}L${pt(y.cx, y.vy)}L${pt(y.cx + half, top)}`,
    `M${pt(y.cx, y.vy)}V${round(y.vy + y.stemLength)}`,
    ...y.bars.map((b) => `M${pt(y.cx - barHalf, y.vy + b)}H${round(y.cx + barHalf)}`),
  ].join('')
}

/** Default bump weights: a little irregular so the crumb reads as torn, yet mirror-symmetric for a clean mark. */
export const CRUMB_WOBBLE = [1, 0.8, 1.1, 0.85, 1, 0.85, 1.1, 0.8] as const

/**
 * A closed ring of `count` soft scallops around an ellipse: valleys sit on the ellipse, each bump bulges out by
 * `bulge` (a fraction of the radius, scaled per bump by `wobble`). The first valley sits at the top centre.
 */
export function scallopPath(e: Ellipse, count: number, bulge: number, wobble: readonly number[] = []): string {
  if (!Number.isInteger(count) || count < 3) throw new Error('scallopPath: count must be an integer ≥ 3')
  const step = (Math.PI * 2) / count
  const at = (angle: number, scale: number) => pt(e.cx + e.rx * scale * Math.cos(angle), e.cy + e.ry * scale * Math.sin(angle))
  const start = -Math.PI / 2
  const near = 0.15
  // place the controls so the bump's midpoint lands exactly at 1 + bulge, net of the chord sag between valleys
  const lift = (target: number) => (8 * target - 2 * Math.cos(step / 2)) / (6 * Math.cos((0.5 - near) * step))
  const segments = Array.from({ length: count }, (_, i) => {
    const a = start + i * step
    const k = lift(1 + bulge * (wobble.length ? wobble[i % wobble.length] : 1))
    return `C${at(a + step * near, k)} ${at(a + step * (1 - near), k)} ${at(a + step, 1)}`
  })
  return `M${at(start, 1)}${segments.join('')}Z`
}

export function crumbPath(e: Ellipse): string {
  return scallopPath(e, 8, 0.05, CRUMB_WOBBLE)
}

/** Four-point sparkle centred on 0,0 with radius 6 (the same star the dream-item illustrations use). */
export const SPARKLE = 'M0-6Q1-1 6 0Q1 1 0 6Q-1 1-6 0Q-1-1 0-6Z'

/** Archimedean spiral (dizzy eye) around a centre, `turns` turns out to `radius`. */
export function spiralPath(cx: number, cy: number, radius: number, turns = 2.25, steps = 36): string {
  const total = turns * Math.PI * 2
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const a = t * total
    return pt(cx + radius * t * Math.cos(a), cy + radius * t * Math.sin(a))
  })
  return `M${points[0]}L${points.slice(1).join(' ')}`
}

/** A sleepy "z" with its top-left at x,y. */
export function zPath(x: number, y: number, s: number): string {
  return `M${pt(x, y)}H${round(x + s)}L${pt(x, y + s)}H${round(x + s)}`
}

/** The glint on an eye: up and to the right of its centre. */
export function eyeHighlight(cx: number, cy: number, rx: number) {
  return { cx: round(cx + rx * 0.32), cy: round(cy - rx * 0.45), r: round(rx * 0.36) }
}

export function ellipseExtent(e: Ellipse) {
  return { top: e.cy - e.ry, bottom: e.cy + e.ry, left: e.cx - e.rx, right: e.cx + e.rx }
}

/** Mood mouths, centred on 0,0 in full-cut units; each cut places them with CUTS[cut].mouth. */
export const MOUTHS = {
  smile: 'M-11 -3Q0 6 11 -3',
  grin: 'M-21 -8Q0 26 21 -8Q0 -2 -21 -8Z',
  wobble: 'M-14 0Q-7 -6 0 0T14 0',
  omega: 'M-12 -3Q-6 5 0 -1Q6 5 12 -3',
} as const
export const GRIN_TONGUE: Ellipse = { cx: 0, cy: 4.5, rx: 8.5, ry: 4.5 }
export const SNORE: Ellipse = { cx: 0, cy: 2, rx: 7.5, ry: 9.5 }

/** Sweat drop centred on 0,0 (≈26 wide, 33 tall). */
export const SWEAT_DROP = 'M0-20C7-9 13-1 13 7A13 13 0 0 1-13 7C-13-1-7-9 0-20Z'

type Placement = readonly [x: number, y: number, scale: number]

export interface FaceGeometry {
  /** worried brows: inner ends raised */
  browLift: number
  sparkles: readonly Placement[]
  sweat: Placement
  /** z's: x, y, size */
  zzz: readonly Placement[]
  smoke: readonly string[]
  /** toasted patches on a burnt bun (body space) */
  toastSpots: readonly Ellipse[]
}

const TOAST_SPOTS: readonly Ellipse[] = [
  { cx: 112, cy: 340, rx: 24, ry: 12 },
  { cx: 404, cy: 298, rx: 18, ry: 10 },
  { cx: 398, cy: 424, rx: 22, ry: 9 },
  { cx: 146, cy: 424, rx: 16, ry: 8 },
]

export const FACES: Record<Cut, FaceGeometry> = {
  full: {
    browLift: 0.55,
    sparkles: [
      [86, 136, 2.6],
      [432, 104, 3.2],
      [474, 214, 1.8],
    ],
    sweat: [406, 182, 1],
    zzz: [
      [350, 76, 26],
      [396, 34, 18],
    ],
    smoke: ['M318 88C302 74 326 62 312 46C304 36 310 26 316 20', 'M350 70C340 60 354 50 346 40'],
    toastSpots: TOAST_SPOTS,
  },
  small: {
    browLift: 0.5,
    sparkles: [
      [56, 92, 3.6],
      [458, 66, 4.4],
    ],
    sweat: [442, 176, 1.6],
    zzz: [
      [370, 54, 38],
      [434, 16, 24],
    ],
    smoke: ['M384 98C368 82 396 68 380 50'],
    toastSpots: TOAST_SPOTS,
  },
}

/** Worried brow over an eye: a short stroke whose inner end (towards the face centre) sits higher. */
export function browPath(cx: number, cy: number, rx: number, ry: number, lift: number): string {
  const inner = cx < VIEW / 2 ? 1 : -1
  const y = cy - ry * 1.5
  return `M${pt(cx - inner * rx, y)}L${pt(cx + inner * rx, y - ry * lift)}`
}

/** Closed, content eye: a downward-curving lash line. */
export function closedEyePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${pt(cx - rx * 1.1, cy)}Q${pt(cx, cy + ry * 0.8)} ${pt(cx + rx * 1.1, cy)}`
}
