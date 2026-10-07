import { useEffect, useState } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'

export type PresenceState = 'open' | 'closing' | 'closed'

/** Keep an element mounted for its exit animation after `open` turns false. */
export function usePresence(open: boolean, exitMs: number): PresenceState {
  const reduced = useReducedMotion()
  const [state, setState] = useState<PresenceState>(open ? 'open' : 'closed')
  useEffect(() => {
    if (open) {
      setState('open')
      return
    }
    setState((s) => (s === 'closed' ? s : 'closing'))
    const t = setTimeout(() => setState('closed'), reduced ? 0 : exitMs)
    return () => clearTimeout(t)
  }, [open, exitMs, reduced])
  return open ? 'open' : state
}
