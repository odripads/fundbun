import { useEffect, useRef, useState } from 'react'

/** Ease-out cubic: fast start, gentle landing. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - (1 - c) ** 3
}

/** The value shown at time `t` (0..1) of a count from `from` to `to`, in whole minor-unit steps of 100. */
export function countFrame(from: number, to: number, t: number): number {
  return Math.round((from + (to - from) * easeOut(t)) / 100) * 100
}

/**
 * Animate a money figure: it rolls up from zero on first show and from the previous value on change
 * (month switches feel like an odometer). Off under reduced motion: the final value renders immediately.
 */
export function useCountUp(value: number, enabled: boolean, ms = 650): number {
  const [shown, setShown] = useState(enabled ? 0 : value)
  const from = useRef(enabled ? 0 : value)

  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame === 'undefined') {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const origin = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = (now - start) / ms
      if (t >= 1) {
        from.current = value
        setShown(value)
        return
      }
      const v = countFrame(origin, value, t)
      from.current = v
      setShown(v)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, enabled, ms])

  return enabled ? shown : value
}
