/**
 * The single FundBun controller the UI talks to. Creation is guarded: if the engine (or the data it boots
 * from) fails, the UI renders a friendly "engine not ready" state instead of a white screen.
 */
import { createFundBunApp, memoryStorage, type FundBunApp, type StorageLike } from '../../core/app'

export type EngineStatus =
  | { ready: true; app: FundBunApp }
  | { ready: false; error: string }

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (typeof e === 'string') return e
  return 'Unknown error'
}

/** Create the controller and take one snapshot so derived-state failures surface here, not mid-render. */
export function bootEngine(create: () => FundBunApp): EngineStatus {
  try {
    const app = create()
    app.getSnapshot()
    return { ready: true, app }
  } catch (e) {
    return { ready: false, error: errorText(e) }
  }
}

/** localStorage when it is usable (private windows and blocked site data throw), else in-memory. */
export function browserStorage(): StorageLike {
  try {
    const ls = globalThis.localStorage
    if (!ls) return memoryStorage()
    const probe = '__fundbun_ui_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return ls
  } catch {
    return memoryStorage()
  }
}

function isStaticBuild(): boolean {
  return typeof __FUNDBUN_STATIC__ !== 'undefined' && __FUNDBUN_STATIC__
}

export function createBrowserApp(): FundBunApp {
  return createFundBunApp({ storage: browserStorage(), llmBaseUrl: isStaticBuild() ? null : '/api' })
}

let instance: EngineStatus | null = null

/** The lazily-created singleton (lazy so importing this module in tests has no side effects). */
export function getEngine(): EngineStatus {
  instance ??= bootEngine(createBrowserApp)
  return instance
}

/** Drop a failed instance so the next getEngine() retries (the "Try again" button). */
export function retryEngine(): EngineStatus {
  instance = null
  return getEngine()
}
