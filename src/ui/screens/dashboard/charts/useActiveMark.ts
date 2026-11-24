import { useCallback, useState, type KeyboardEvent } from 'react'

export interface ActiveMark {
  /** the mark the pointer or the keyboard is on, or null */
  active: number | null
  setActive: (index: number | null) => void
  /** arrow keys step through the marks, Home/End jump, Escape lets go */
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  onBlur: () => void
}

/**
 * One "active mark" shared by hover and the keyboard: a chart is a single tab stop, and the arrow keys read it
 * mark by mark. `selectable(i)` skips marks with nothing to read (days that have not happened yet).
 */
export function useActiveMark(count: number, selectable: (index: number) => boolean = () => true): ActiveMark {
  const [active, setActive] = useState<number | null>(null)

  const step = useCallback(
    (from: number, dir: 1 | -1): number | null => {
      for (let i = from + dir; i >= 0 && i < count; i += dir) if (selectable(i)) return i
      return null
    },
    [count, selectable],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      let next: number | null | undefined
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = active === null ? step(-1, 1) : (step(active, 1) ?? active)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = active === null ? step(count, -1) : (step(active, -1) ?? active)
      else if (e.key === 'Home') next = step(-1, 1)
      else if (e.key === 'End') next = step(count, -1)
      else if (e.key === 'Escape') next = null
      if (next === undefined) return
      e.preventDefault()
      setActive(next)
    },
    [active, count, step],
  )

  const onBlur = useCallback(() => setActive(null), [])
  return { active, setActive, onKeyDown, onBlur }
}
