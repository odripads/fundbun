/** Chart geometry (pure, unit-tested). Coordinates are percentages so charts stay fluid without measuring. */

export interface ChartDatum {
  id: string
  label: string
  value: number
  /** CSS colour; category charts pass CATEGORIES[c].color so colour follows the entity */
  color?: string
}

/** Fixed categorical order from global.css (CVD-validated); never cycled — extras fold into "Other". */
export const CHART_PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'] as const
export const OTHER_COLOR = 'var(--text-3)'
export const OTHER_ID = '__other__'

export function colorFor(d: ChartDatum, index: number): string {
  return d.color ?? (d.id === OTHER_ID ? OTHER_COLOR : CHART_PALETTE[index] ?? OTHER_COLOR)
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0)

/** Keep the `max - 1` largest items (in their original order) and sum the rest into "Other". */
export function foldOther(data: ChartDatum[], max = 6, otherLabel = 'Other'): ChartDatum[] {
  const clean = data.map((d) => ({ ...d, value: Math.max(0, finite(d.value)) }))
  if (clean.length <= max) return clean
  const keep = new Set(
    [...clean]
      .sort((a, b) => b.value - a.value)
      .slice(0, Math.max(0, max - 1))
      .map((d) => d.id),
  )
  const rest = clean.filter((d) => !keep.has(d.id)).reduce((s, d) => s + d.value, 0)
  return [...clean.filter((d) => keep.has(d.id)), { id: OTHER_ID, label: otherLabel, value: rest, color: OTHER_COLOR }]
}

/** Largest of all values (never < 1 so empty charts don't divide by zero). */
export function scaleMax(...groups: number[][]): number {
  let m = 0
  for (const g of groups) for (const v of g) if (Number.isFinite(v) && v > m) m = v
  return m > 0 ? m : 1
}

export function pct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

export interface Point {
  x: number
  y: number
}

/** Map a series into a 0..100 box (y grows downward), with a little vertical padding so strokes aren't clipped. */
export function sparkPoints(values: number[], opts: { min?: number; max?: number; pad?: number } = {}): Point[] {
  const vs = values.map(finite)
  if (vs.length === 0) return []
  const lo = opts.min ?? Math.min(...vs)
  const hi = opts.max ?? Math.max(...vs)
  const pad = opts.pad ?? 8
  const span = hi - lo
  const step = vs.length === 1 ? 0 : 100 / (vs.length - 1)
  return vs.map((v, i) => ({
    x: vs.length === 1 ? 50 : round(i * step),
    y: round(span === 0 ? 50 : pad + (1 - (v - lo) / span) * (100 - 2 * pad)),
  }))
}

/** y position (0..100) of a reference value on the same scale as sparkPoints. */
export function sparkY(value: number, values: number[], opts: { min?: number; max?: number; pad?: number } = {}): number {
  const vs = values.map(finite)
  const lo = Math.min(opts.min ?? Infinity, ...vs, value)
  const hi = Math.max(opts.max ?? -Infinity, ...vs, value)
  const pad = opts.pad ?? 8
  const span = hi - lo
  return round(span === 0 ? 50 : pad + (1 - (value - lo) / span) * (100 - 2 * pad))
}

export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}

export function areaPath(points: Point[]): string {
  if (points.length === 0) return ''
  const first = points[0]
  const last = points[points.length - 1]
  return `${linePath(points)} L${last.x} 100 L${first.x} 100 Z`
}

export interface Arc {
  /** dash length along the circumference */
  length: number
  /** stroke-dashoffset (negative start) */
  offset: number
  /** share of the total, 0..1 */
  share: number
}

/** Donut segments as stroke dashes with a fixed surface gap between neighbours. */
export function donutArcs(values: number[], circumference: number, gap = 2): Arc[] {
  const vs = values.map((v) => Math.max(0, finite(v)))
  const total = vs.reduce((s, v) => s + v, 0)
  if (total === 0 || circumference <= 0) return vs.map(() => ({ length: 0, offset: 0, share: 0 }))
  const visible = vs.filter((v) => v > 0).length
  const g = visible > 1 ? gap : 0
  let start = 0
  return vs.map((v) => {
    const share = v / total
    const span = share * circumference
    const arc = { length: v > 0 ? Math.max(0, round(span - g)) : 0, offset: round(-start), share }
    start += span
    return arc
  })
}

export interface Segment {
  start: number
  width: number
  share: number
}

/** Horizontal stacked segments in percent of `total` (defaults to the sum; a larger total leaves a remainder). */
export function stackSegments(values: number[], total?: number): Segment[] {
  const vs = values.map((v) => Math.max(0, finite(v)))
  const sum = vs.reduce((s, v) => s + v, 0)
  const denom = Math.max(sum, total ?? 0)
  if (denom === 0) return vs.map(() => ({ start: 0, width: 0, share: 0 }))
  let start = 0
  return vs.map((v) => {
    const width = round((v / denom) * 100)
    const seg = { start: round(start), width, share: sum === 0 ? 0 : v / sum }
    start += (v / denom) * 100
    return seg
  })
}

export function round(n: number, places = 3): number {
  const k = 10 ** places
  return Math.round(n * k) / k
}

export function percentLabel(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%'
  const p = share * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}
