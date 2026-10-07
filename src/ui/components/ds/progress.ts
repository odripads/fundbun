/** Shared progress maths (pure, unit-tested). */

export type ProgressTone = 'accent' | 'under' | 'over' | 'warn' | 'info' | 'neutral'

/** value/max as a 0..100 percentage, clamped; non-finite or non-positive max → 0. */
export function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

/** Spending budgets: calm below `warnAt`%, warning up to 100%, over beyond it. */
export function budgetTone(value: number, max: number, warnAt = 80): ProgressTone {
  if (max <= 0) return value > 0 ? 'over' : 'under'
  const pct = (value / max) * 100
  if (pct > 100) return 'over'
  if (pct >= warnAt) return 'warn'
  return 'under'
}

export interface RingGeometry {
  radius: number
  circumference: number
  /** stroke-dashoffset for the filled arc */
  offset: number
}

export function ringGeometry(size: number, thickness: number, pct: number): RingGeometry {
  const radius = Math.max(0, (size - thickness) / 2)
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0))
  return { radius, circumference, offset: circumference * (1 - clamped / 100) }
}
