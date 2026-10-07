import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './ratelimit'

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

describe('createRateLimiter', () => {
  it('allows a burst up to the per-minute capacity, then denies with a retry hint', () => {
    const c = clock()
    const rl = createRateLimiter({ perMinute: 3, now: c.now })
    expect([rl.take('a'), rl.take('a'), rl.take('a')].map((d) => d.allowed)).toEqual([true, true, true])
    const denied = rl.take('a')
    expect(denied).toEqual({ allowed: false, remaining: 0, retryAfterSec: 20 })
  })

  it('reports remaining tokens', () => {
    const rl = createRateLimiter({ perMinute: 3, now: clock().now })
    expect(rl.take('a').remaining).toBe(2)
    expect(rl.take('a').remaining).toBe(1)
  })

  it('refills continuously at perMinute/60 per second', () => {
    const c = clock()
    const rl = createRateLimiter({ perMinute: 60, now: c.now })
    for (let i = 0; i < 60; i++) rl.take('a')
    expect(rl.take('a').allowed).toBe(false)
    c.advance(999)
    expect(rl.take('a').allowed).toBe(false)
    c.advance(1)
    expect(rl.take('a').allowed).toBe(true)
  })

  it('never refills beyond capacity after a long idle period', () => {
    const c = clock()
    const rl = createRateLimiter({ perMinute: 2, now: c.now })
    rl.take('a')
    c.advance(60 * 60_000)
    expect([rl.take('a'), rl.take('a'), rl.take('a')].map((d) => d.allowed)).toEqual([true, true, false])
  })

  it('keeps buckets independent per key', () => {
    const rl = createRateLimiter({ perMinute: 1, now: clock().now })
    expect(rl.take('a').allowed).toBe(true)
    expect(rl.take('a').allowed).toBe(false)
    expect(rl.take('b').allowed).toBe(true)
  })

  it('treats perMinute 0 as disabled', () => {
    const rl = createRateLimiter({ perMinute: 0, now: clock().now })
    for (let i = 0; i < 100; i++) expect(rl.take('a').allowed).toBe(true)
    expect(rl.size()).toBe(0)
  })

  it('is robust to a clock that goes backwards', () => {
    const c = clock()
    const rl = createRateLimiter({ perMinute: 1, now: c.now })
    rl.take('a')
    c.advance(-10_000)
    expect(rl.take('a').allowed).toBe(false)
  })

  it('bounds memory: refilled buckets are evicted first, then the least recently used', () => {
    const c = clock()
    const rl = createRateLimiter({ perMinute: 2, now: c.now, maxKeys: 3 })
    rl.take('a')
    rl.take('b')
    rl.take('c')
    expect(rl.size()).toBe(3)
    rl.take('d')
    expect(rl.size()).toBeLessThanOrEqual(3)
    c.advance(60_000)
    rl.take('e')
    expect(rl.size()).toBeLessThanOrEqual(3)
  })

  it('a flood of distinct keys cannot grow the map past maxKeys', () => {
    const rl = createRateLimiter({ perMinute: 5, now: clock().now, maxKeys: 100 })
    for (let i = 0; i < 5000; i++) rl.take(`ip-${i}`)
    expect(rl.size()).toBeLessThanOrEqual(100)
  })
})
