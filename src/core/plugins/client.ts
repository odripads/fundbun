import {
  PLUGINS_UNAVAILABLE,
  type PluginDraftInput,
  type PluginDraftRecord,
  type PluginManifest,
  type PluginRecord,
  type PluginSlot,
  type PluginsState,
  type PluginValidationIssue,
} from './types'

export type PluginApiResult<T> = ({ ok: true } & T) | { ok: false; error: string; issues?: PluginValidationIssue[] }

export type HostPluginResult<K extends 'get' | 'draft'> =
  K extends 'get'
    ? PluginApiResult<{ plugin: PluginRecord }>
    : PluginApiResult<{ draft: PluginDraftRecord }>

/**
 * Browser client for Desktop Creator Mode (/api/plugins/*).
 * On the hosted web app those routes do not exist and state() answers `local: false` (PLUGINS_UNAVAILABLE).
 */
export class PluginsClient {
  private _enabled: boolean | null = null

  constructor(public baseUrl = '/api', private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  get enabled(): boolean | null {
    return this._enabled
  }

  async state(timeoutMs = 4000): Promise<PluginsState> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/plugins/state`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) {
        this._enabled = false
        return PLUGINS_UNAVAILABLE
      }
      const body = (await res.json()) as Partial<PluginsState>
      if (body?.local !== true || !Array.isArray(body.plugins) || !Array.isArray(body.starters)) {
        this._enabled = false
        return PLUGINS_UNAVAILABLE
      }
      const enabled = body.enabled === true
      this._enabled = enabled
      return {
        local: true,
        enabled,
        plugins: body.plugins,
        starters: body.starters,
        ...(typeof body.pluginDir === 'string' ? { pluginDir: body.pluginDir } : {}),
      }
    } catch {
      // hosted build or local server unavailable: fail closed as unavailable
      this._enabled = false
      return PLUGINS_UNAVAILABLE
    }
  }

  async syncEnabled(timeoutMs = 1500): Promise<boolean> {
    const st = await this.state(timeoutMs)
    return st.local && st.enabled
  }

  setEnabled(enabled: boolean): Promise<PluginApiResult<{ state: PluginsState }>> {
    return this.send<{ state: PluginsState }>('POST', '/plugins/mode', { enabled }).then((res) => {
      if (res.ok) this._enabled = res.state.enabled
      return res
    })
  }

  get(id: string): Promise<PluginApiResult<{ plugin: PluginRecord }>> {
    return this.send<{ plugin: PluginRecord }>('GET', `/plugins/installed/${encodeURIComponent(id)}`)
  }

  draft(input: PluginDraftInput): Promise<PluginApiResult<{ draft: PluginDraftRecord }>> {
    return this.send<{ draft: PluginDraftRecord }>('POST', '/plugins/drafts', input)
  }

  installDraft(draftId: string): Promise<PluginApiResult<{ plugin: PluginManifest; state: PluginsState }>> {
    return this.send<{ plugin: PluginManifest; state: PluginsState }>('POST', `/plugins/drafts/${encodeURIComponent(draftId)}/install`, {})
  }

  discardDraft(draftId: string): Promise<PluginApiResult<{ discarded: boolean }>> {
    return this.send<{ discarded: boolean }>('DELETE', `/plugins/drafts/${encodeURIComponent(draftId)}`)
  }

  installStarter(starterId: string): Promise<PluginApiResult<{ plugin: PluginManifest; state: PluginsState }>> {
    return this.send<{ plugin: PluginManifest; state: PluginsState }>('POST', `/plugins/starters/${encodeURIComponent(starterId)}/install`, {})
  }

  updateMeta(
    id: string,
    patch: { enabled?: boolean; slot?: PluginSlot; wide?: boolean; name?: string; description?: string },
  ): Promise<PluginApiResult<{ plugin: PluginManifest; state: PluginsState }>> {
    return this.send<{ plugin: PluginManifest; state: PluginsState }>('PATCH', `/plugins/installed/${encodeURIComponent(id)}`, patch)
  }

  uninstall(id: string): Promise<PluginApiResult<{ state: PluginsState }>> {
    return this.send<{ state: PluginsState }>('DELETE', `/plugins/installed/${encodeURIComponent(id)}`)
  }

  private async send<T extends object>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<PluginApiResult<T>> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const json = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & { message?: unknown; issues?: PluginValidationIssue[] })
        | null
      if (!res.ok || !json) {
        return {
          ok: false,
          error: typeof json?.message === 'string' ? json.message.slice(0, 300) : `FundBun answered HTTP ${res.status}.`,
          ...(Array.isArray(json?.issues) ? { issues: json.issues } : {}),
        }
      }
      if ('state' in json && json.state && typeof json.state === 'object') {
        const st = json.state as Partial<PluginsState>
        if (typeof st.enabled === 'boolean') this._enabled = st.enabled
      }
      return { ok: true, ...(json as T) }
    } catch {
      // network error on loopback: return safe generic error
      return { ok: false, error: 'FundBun on this computer is not answering.' }
    }
  }
}
