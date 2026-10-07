import { createRng, type Rng } from '../rng'
import type { Minor } from '../types'

/** FNV-1a over "seed|part|part…" — derives independent, stable sub-seeds (per day, per month, per habit). */
export function mixSeed(seed: number, ...parts: (string | number)[]): number {
  const s = `${seed >>> 0}|${parts.join('|')}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function rngFor(seed: number, ...parts: (string | number)[]): Rng {
  return createRng(mixSeed(seed, ...parts))
}

/** Knuth's Poisson sampler — fine for the small daily rates used here (λ ≤ ~5). */
export function poisson(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0
  const limit = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng.next()
  } while (p > limit)
  return k - 1
}

export type PriceSpec =
  /** lognormal around `median`, clamped to [min, max], rounded to `step` minor units (default 1 yuan) */
  | { median: Minor; sigma: number; min: Minor; max: Minor; step?: Minor }
  /** one of a fixed menu of prices */
  | { pick: readonly Minor[] }

export function samplePrice(rng: Rng, spec: PriceSpec): Minor {
  if ('pick' in spec) return rng.pick(spec.pick)
  const step = spec.step ?? 100
  const raw = spec.median * Math.exp(rng.normal(0, spec.sigma))
  const clamped = Math.min(spec.max, Math.max(spec.min, raw))
  const rounded = Math.round(clamped / step) * step
  return Math.min(spec.max, Math.max(spec.min, rounded, step))
}

/** Decimal hours → "HH:MM". Hours ≥ 24 wrap to the early morning of the same calendar date. */
export function hhmm(hours: number): string {
  const total = Math.floor((((hours % 24) + 24) % 24) * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function timeInWindow(rng: Rng, window: readonly [number, number]): string {
  return hhmm(window[0] + rng.next() * (window[1] - window[0]))
}

/** Weighted pick; weights default to 1. */
export function pickWeighted<T extends { weight?: number }>(rng: Rng, items: readonly T[]): T {
  const total = items.reduce((s, it) => s + (it.weight ?? 1), 0)
  let r = rng.next() * total
  for (const it of items) {
    r -= it.weight ?? 1
    if (r < 0) return it
  }
  return items[items.length - 1]
}

/** `count` distinct elements of `pool`, in pool order (Fisher–Yates on a copy). */
export function sampleDistinct<T>(rng: Rng, pool: readonly T[], count: number): T[] {
  const copy = pool.map((v, i) => ({ v, i }))
  const n = Math.min(count, copy.length)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng.next() * (copy.length - i))
    const tmp = copy[i]
    copy[i] = copy[j]
    copy[j] = tmp
  }
  return copy
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.v)
}
