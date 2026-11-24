/**
 * Chart geometry for the dashboard's hand-written SVG charts (pure, unit-tested). Lengths are pixels of the plot
 * the chart measured; amounts are integer minor units.
 */
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, fmt } from '../../../../core/money'
import type { Currency, Minor } from '../../../../core/types'
import { niceTicks, shortAmount } from '../../insights/model'

export interface ValueScale {
  /** top of the axis: a round number at or above `top` */
  max: Minor
  /** round ticks from 0 to max */
  ticks: Minor[]
}

/** A value axis from 0 to a round number at or above `top`, with about `count` steps. */
export function valueScale(top: Minor, count = 3): ValueScale {
  const ticks = niceTicks(Math.max(0, top), count)
  const max = Math.max(1, ticks[ticks.length - 1] ?? 0)
  return { max, ticks: ticks.length > 1 ? ticks : [0, max] }
}

/** Pixel height of `value` in a plot `height` px tall whose axis ends at `max` (clamped to the plot). */
export function barHeight(value: Minor, max: Minor, height: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || height <= 0) return 0
  return Math.max(0, Math.min(height, (value / max) * height))
}

export interface Band {
  /** left edge of the slot */
  x: number
  /** slot width */
  slot: number
  /** bar width: most of the slot, never thicker than `cap` */
  bar: number
  /** left edge of the bar, centred in the slot */
  barX: number
  /** centre of the slot */
  mid: number
}

/** `count` equal slots across `width`, each holding a centred bar no thicker than `cap`. */
export function bands(count: number, width: number, cap = 24, fill = 0.68): Band[] {
  if (count <= 0 || width <= 0) return []
  const slot = width / count
  const bar = Math.max(1, Math.min(cap, slot * fill))
  return Array.from({ length: count }, (_, i) => {
    const x = i * slot
    return { x, slot, bar, barX: x + (slot - bar) / 2, mid: x + slot / 2 }
  })
}

/** The slot under a pointer at `px` (clamped to the first and last slot). */
export function bandAt(px: number, count: number, width: number): number {
  if (count <= 0 || width <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.floor((px / width) * count)))
}

/** A column with a rounded data end and a square foot on the baseline. */
export function columnPath(x: number, baseline: number, width: number, height: number, radius = 4): string {
  if (height <= 0 || width <= 0) return ''
  const r = Math.min(radius, width / 2, height)
  const top = baseline - height
  return `M${x} ${baseline}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + width - r}Q${x + width} ${top} ${x + width} ${top + r}V${baseline}Z`
}

/**
 * Axis labels in one style per axis: whole amounts ("¥500") while the axis stays under 10,000 major units, compact
 * ("¥5k") once it reaches that.
 */
export function axisMoney(value: Minor, axisMax: Minor, currency: Currency): string {
  if (axisMax / MINOR_PER_MAJOR[currency] >= 10_000) return `${CURRENCY_SYMBOL[currency]}${shortAmount(value, currency)}`
  return fmt(value, currency, { decimals: false })
}

/** Which day numbers get a label under a month of daily bars: the 1st, every fifth day, never one touching today's. */
export function dayTicks(daysInMonth: number, today: number | null): number[] {
  const out: number[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    if (d !== 1 && d % 5 !== 0) continue
    if (today !== null && d !== today && Math.abs(d - today) < 2) continue
    out.push(d)
  }
  if (today !== null && today >= 1 && today <= daysInMonth && !out.includes(today)) out.push(today)
  return out.sort((a, b) => a - b)
}
