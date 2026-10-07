/** Deterministic PRNG (mulberry32) so sandbox data and evidence runs are reproducible. */
export interface Rng {
  next(): number
  int(min: number, max: number): number
  pick<T>(arr: readonly T[]): T
  chance(p: number): boolean
  normal(mean: number, sd: number): number
  /** a deterministic id with the given prefix */
  id(prefix: string): string
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  let counter = 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    normal: (mean, sd) => {
      const u = Math.max(next(), 1e-9)
      const v = next()
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    id: (prefix) => `${prefix}_${(seed >>> 0).toString(36)}${(counter++).toString(36).padStart(5, '0')}`,
  }
}
