export interface RateLimitDecision {
  allowed: boolean
  /** whole tokens left after this request */
  remaining: number
  /** seconds until one token is available again (0 when allowed) */
  retryAfterSec: number
}

export interface RateLimiter {
  take(key: string): RateLimitDecision
  /** number of tracked keys (for tests / memory bounds) */
  size(): number
}

export interface RateLimiterOptions {
  /** sustained requests per minute per key; also the burst size. 0 disables limiting. */
  perMinute: number
  /** clock in ms — injected so tests are deterministic */
  now?: () => number
  /** cap on tracked keys so a flood of spoofed/rotating IPs cannot exhaust memory */
  maxKeys?: number
}

interface Bucket {
  tokens: number
  updatedAt: number
}

/** Token bucket per key: capacity = perMinute, refills perMinute/60 tokens per second. */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const now = opts.now ?? Date.now
  const maxKeys = opts.maxKeys ?? 10_000
  const capacity = Math.max(0, Math.floor(opts.perMinute))
  const refillPerMs = capacity / 60_000
  const buckets = new Map<string, Bucket>()

  const refill = (bucket: Bucket, t: number): void => {
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, t - bucket.updatedAt) * refillPerMs)
    bucket.updatedAt = t
  }

  const evict = (t: number): void => {
    for (const [key, bucket] of buckets) {
      refill(bucket, t)
      if (bucket.tokens >= capacity) buckets.delete(key)
    }
    // still full of active keys: drop the least recently touched ones
    for (const key of buckets.keys()) {
      if (buckets.size < maxKeys) break
      buckets.delete(key)
    }
  }

  return {
    take(key) {
      if (capacity === 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterSec: 0 }
      const t = now()
      let bucket = buckets.get(key)
      if (bucket) {
        buckets.delete(key)
        refill(bucket, t)
      } else {
        if (buckets.size >= maxKeys) evict(t)
        bucket = { tokens: capacity, updatedAt: t }
      }
      buckets.set(key, bucket)
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1
        return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 }
      }
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) }
    },
    size: () => buckets.size,
  }
}
