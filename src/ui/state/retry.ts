import { createContext, useContext } from 'react'

export const RetryContext = createContext<() => void>(() => {})

/** Re-create the engine after a failed boot (the "Try again" button). */
export function useRetryEngine(): () => void {
  return useContext(RetryContext)
}
