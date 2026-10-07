/** Small numeric helpers shared by the finance engine (internal — not re-exported from finance/index). */

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median absolute deviation (unscaled). */
export function mad(xs: number[], med = median(xs)): number {
  return median(xs.map((x) => Math.abs(x - med)))
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function meanAbsDeviation(xs: number[], center: number): number {
  return mean(xs.map((x) => Math.abs(x - center)))
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100
}

/** FNV-1a 32-bit hash → base36; deterministic ids for non-ASCII keys. */
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** ASCII slug, or a hash when the text has no ASCII letters (e.g. Chinese merchant names). */
export function slugOrHash(s: string): string {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug && !/[^\x00-\x7f]/.test(s) ? slug : `${slug ? slug + '_' : ''}${hashString(s)}`
}

export function groupBy<T, K>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>()
  for (const it of items) {
    const k = key(it)
    const arr = out.get(k)
    if (arr) arr.push(it)
    else out.set(k, [it])
  }
  return out
}
