/**
 * Route-level code splitting. A lazy screen is a normal component whose code arrives in its own chunk:
 * the first render suspends (the shell shows a spinner) and every render after the chunk has landed is
 * synchronous — so a screen that was prefetched during idle time never flashes a fallback.
 *
 * A chunk that fails to load (flaky network, or a tab left open across a deploy) is not cached as a failure:
 * the next render or preload() tries again, and the shell's error boundary offers "Try again" meanwhile.
 */
import { createElement, lazy, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react'

export interface LazyScreen<P extends object = object> {
  (props: P): ReactElement
  /** start (or join) loading the chunk; resolves once the component renders synchronously */
  preload(): Promise<ComponentType<P>>
  /** whether the chunk has landed */
  readonly loaded: boolean
}

export function lazyScreen<P extends object = object>(load: () => Promise<ComponentType<P>>): LazyScreen<P> {
  let component: ComponentType<P> | null = null
  let pending: Promise<ComponentType<P>> | null = null

  const preload = (): Promise<ComponentType<P>> => {
    pending ??= load().then(
      (c) => (component = c),
      (error: unknown) => {
        pending = null
        throw error
      },
    )
    return pending
  }

  const makeLazy = (): LazyExoticComponent<ComponentType<P>> =>
    lazy(() =>
      preload().then(
        (c) => ({ default: c }),
        (error: unknown) => {
          // React.lazy remembers a rejection forever — swap in a fresh one so the next render retries
          suspended = makeLazy()
          throw error
        },
      ),
    )
  let suspended = makeLazy()

  function Screen(props: P): ReactElement {
    // loaded: render the screen directly (no Suspense round-trip); otherwise suspend on the chunk
    const target = (component ?? suspended) as ComponentType<P>
    return createElement(target, props)
  }
  return Object.defineProperties(Screen, {
    preload: { value: preload },
    loaded: { get: () => component !== null },
  }) as LazyScreen<P>
}

/** Run `task` when the browser is idle (or after `fallbackMs` where requestIdleCallback is missing, e.g. Safari). */
export function whenIdle(task: () => void, fallbackMs = 1200): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
  if (typeof ric === 'function') ric(task, { timeout: 4000 })
  else setTimeout(task, fallbackMs)
}
