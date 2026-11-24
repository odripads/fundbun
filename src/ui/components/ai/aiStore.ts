import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { FundBunApp } from '../../../core/app'
import { AI_UNAVAILABLE, type AiState, type ConnectionTest, type NewConnectionInput } from '../../../core/ai/types'
import { useApp } from '../../state'

/**
 * The user's AI connections as the screens see them. The list lives on the FundBun server on this computer
 * (not in the app's own data); this keeps one copy per app instance and refreshes it after every change.
 */
interface Store {
  state: AiState
  loaded: boolean
  listeners: Set<() => void>
  loading: Promise<void> | null
}

const stores = new WeakMap<object, Store>()

function storeOf(app: FundBunApp): Store {
  let s = stores.get(app)
  if (!s) {
    s = { state: AI_UNAVAILABLE, loaded: false, listeners: new Set(), loading: null }
    stores.set(app, s)
  }
  return s
}

function set(store: Store, state: AiState): void {
  store.state = state
  store.loaded = true
  for (const l of store.listeners) l()
}

export interface AiActions {
  refresh(): Promise<void>
  add(input: NewConnectionInput): Promise<{ ok: true; id: string } | { ok: false; error: string }>
  setModel(id: string, model: string): Promise<void>
  remove(id: string): Promise<void>
  /** null = the built-in engine on this device */
  use(id: string | null): Promise<void>
  test(id: string): Promise<ConnectionTest>
  models(id: string): Promise<string[]>
}

export function useAi(): { ai: AiState; loaded: boolean } & AiActions {
  const app = useApp()
  const store = storeOf(app)
  const subscribe = useCallback((l: () => void) => {
    store.listeners.add(l)
    return () => void store.listeners.delete(l)
  }, [store])
  const ai = useSyncExternalStore(subscribe, () => store.state, () => store.state)

  const refresh = useCallback(async () => {
    if (!app.ai) return set(store, AI_UNAVAILABLE)
    store.loading ??= app.ai.state().then((s) => set(store, s)).finally(() => void (store.loading = null))
    await store.loading
  }, [app, store])

  useEffect(() => {
    if (!store.loaded) void refresh()
  }, [refresh, store])

  /** after any change the app asks the server who answers now, so the next message uses it */
  const settle = useCallback(async (next?: AiState) => {
    if (next?.local) set(store, next)
    else await refresh()
    await app.checkLlm()
  }, [app, refresh, store])

  return {
    ai,
    loaded: store.loaded,
    refresh,
    async add(input) {
      if (!app.ai) return { ok: false, error: 'Connecting an AI needs FundBun on your computer.' }
      const r = await app.ai.add(input)
      if (!r.ok) return r
      // connecting is the consent: the screen says what is sent before the button is pressed
      if (!app.getSnapshot().state.profile?.consent.llmProcessing) app.setConsent({ llmProcessing: true })
      if (!app.getSnapshot().state.settings.llmEnabled) app.setSettings({ llmEnabled: true })
      // the newest connection is the one the user wants to use
      const active = await app.ai.setActive(r.connection.id)
      await settle(active.ok ? active.state : r.state)
      return { ok: true, id: r.connection.id }
    },
    async setModel(id, model) {
      const r = await app.ai?.update(id, { model })
      await settle(r?.ok ? r.state : undefined)
    },
    async remove(id) {
      const r = await app.ai?.remove(id)
      await settle(r?.ok ? r.state : undefined)
    },
    async use(id) {
      const r = await app.ai?.setActive(id)
      await settle(r?.ok ? r.state : undefined)
    },
    async test(id) {
      const r = (await app.ai?.test(id)) ?? { ok: false, ms: 0, error: 'Not available here.' }
      await refresh()
      return r
    },
    async models(id) {
      const r = await app.ai?.models(id)
      return r?.ok ? r.models : []
    },
  }
}
