import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * The pixel width of a chart's container, so the SVG is drawn at its real size (crisp text, no stretched strokes).
 * Follows the container with a ResizeObserver; `fallback` is used before the first measure and where there is no
 * layout (jsdom).
 */
export function useChartWidth<T extends HTMLElement>(fallback = 520): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = Math.floor(el.clientWidth)
      if (w > 0) setWidth((prev) => (prev === w ? prev : w))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}
