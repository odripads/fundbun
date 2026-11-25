import { useEffect, useSyncExternalStore } from 'react'
import type { PluginsClient } from '../../../core/plugins/client'
import { PLUGINS_UNAVAILABLE, type PluginsState } from '../../../core/plugins/types'

/**
 * What the screens know about Desktop Creator Mode: one shared copy of the local server's plugin state, fetched
 * once and again after every change. On the hosted site it stays "unavailable" and nothing shows.
 */
let current: PluginsState = PLUGINS_UNAVAILABLE
let loading: Promise<void> | null = null
let loaded = false
const listeners = new Set<() => void>()

function publish(next: PluginsState): void {
  current = next
  listeners.forEach((l) => l())
}

export function refreshPlugins(client: PluginsClient | null): Promise<void> {
  if (!client) return Promise.resolve()
  loading = client.state().then((st) => {
    loaded = true
    publish(st)
  }).finally(() => {
    loading = null
  })
  return loading
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The plugin state; the first screen that asks starts the fetch. */
export function usePluginsState(client: PluginsClient | null): PluginsState {
  const state = useSyncExternalStore(subscribe, () => current, () => current)
  useEffect(() => {
    if (!loaded && !loading) void refreshPlugins(client)
  }, [client])
  return state
}

/** Tests only: forget what was fetched. */
export function resetPluginsStore(): void {
  current = PLUGINS_UNAVAILABLE
  loaded = false
  loading = null
}
