import { useCallback, useState, type ReactNode } from 'react'
import { getEngine, retryEngine, type EngineStatus } from './appInstance'
import { EngineContext } from './useApp'
import { RetryContext } from './retry'

export interface AppProviderProps {
  children: ReactNode
  /** inject a status (tests, Storybook-style previews); defaults to the browser singleton */
  status?: EngineStatus
}

export function AppProvider({ children, status }: AppProviderProps) {
  const [booted, setBooted] = useState<EngineStatus>(() => status ?? getEngine())
  const retry = useCallback(() => setBooted(status ?? retryEngine()), [status])
  return (
    <EngineContext.Provider value={status ?? booted}>
      <RetryContext.Provider value={retry}>{children}</RetryContext.Provider>
    </EngineContext.Provider>
  )
}
