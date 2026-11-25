import { randomUUID } from 'node:crypto'
import type {
  PluginDraftInput,
  PluginDraftRecord,
  PluginIconId,
  PluginManifest,
  PluginOrigin,
  PluginRecord,
  PluginSlot,
  PluginsState,
  PluginValidationIssue,
} from '../../src/core/plugins/types'
import { buildPluginFrameHtml } from './frame'
import { STARTER_PLUGINS } from './starters'
import type { PluginStore } from './store'
import { MAX_INSTALLED_PLUGINS, PLUGIN_ID_RE, slugifyPluginId, validatePluginCode } from './validate'

export interface PluginServiceOptions {
  store: PluginStore
  now?: () => Date
  onCreatorModeChange?: (enabled: boolean) => void
}

export type PluginServiceFailure = {
  ok: false
  status: 400 | 403 | 404 | 409
  error: string
  message: string
  issues?: PluginValidationIssue[]
}

export type PluginServiceResult<T> = ({ ok: true } & T) | PluginServiceFailure

export interface PluginService {
  state(): PluginsState
  isEnabled(): boolean
  setEnabled(enabled: boolean): PluginServiceResult<{ state: PluginsState }>
  get(id: string): PluginServiceResult<{ plugin: PluginRecord }>
  draft(input: unknown): PluginServiceResult<{ draft: PluginDraftRecord }>
  installDraft(draftId: string): PluginServiceResult<{ plugin: PluginManifest; state: PluginsState }>
  discardDraft(draftId: string): PluginServiceResult<{ discarded: boolean }>
  installStarter(starterId: string): PluginServiceResult<{ plugin: PluginManifest; state: PluginsState }>
  updateMeta(id: string, patch: unknown): PluginServiceResult<{ plugin: PluginManifest; state: PluginsState }>
  uninstall(id: string): PluginServiceResult<{ state: PluginsState }>
  renderInstalledFrame(id: string, frameToken: string): PluginServiceResult<{ html: string }>
  renderDraftFrame(draftId: string, frameToken: string): PluginServiceResult<{ html: string }>
}

interface StoredDraft {
  record: PluginDraftRecord
  expiresAtMs: number
}

const MAX_DRAFTS = 24
const DRAFT_TTL_MS = 30 * 60_000
const SLOTS = new Set<PluginSlot>(['dashboard', 'home', 'both'])
const ICONS = new Set<PluginIconId>(['sparkles', 'coffee', 'calendar', 'gauge', 'wallet', 'chart', 'flame', 'target'])
const ORIGINS = new Set<PluginOrigin>(['chat', 'starter', 'user'])

const fail = (
  status: PluginServiceFailure['status'],
  error: string,
  message: string,
  issues?: PluginValidationIssue[],
): PluginServiceFailure => ({ ok: false, status, error, message, ...(issues ? { issues } : {}) })

const cleanText = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function createPluginService(opts: PluginServiceOptions): PluginService {
  const { store } = opts
  const nowDate = () => opts.now?.() ?? new Date()
  const nowIso = () => nowDate().toISOString()
  const drafts = new Map<string, StoredDraft>()

  const pruneDrafts = () => {
    const t = nowDate().getTime()
    for (const [id, entry] of drafts) {
      if (entry.expiresAtMs <= t) drafts.delete(id)
    }
    while (drafts.size >= MAX_DRAFTS) {
      const oldest = drafts.keys().next().value
      if (!oldest) break
      drafts.delete(oldest)
    }
  }

  const readState = (): PluginsState => {
    const cfg = store.readConfig()
    return {
      local: true,
      enabled: cfg.enabled,
      plugins: store.listInstalled(),
      starters: STARTER_PLUGINS.map((s) => ({ ...s })),
      pluginDir: store.dir,
    }
  }

  const checkId = (raw: unknown): string | null => {
    const id = typeof raw === 'string' ? raw.trim() : ''
    return PLUGIN_ID_RE.test(id) ? id : null
  }

  const checkEnabledGate = (): PluginServiceFailure | null =>
    store.readConfig().enabled
      ? null
      : fail(403, 'creator_disabled', 'Desktop Creator Mode is currently turned off.')

  const buildDraft = (input: PluginDraftInput, ts: string): PluginServiceResult<{ draft: PluginDraftRecord }> => {
    const name = cleanText(input.name, 50)
    if (name.length < 2) return fail(400, 'invalid_plugin', 'Give the plugin a short name (at least 2 characters).')
    const description = cleanText(input.description, 140) || `Custom widget: ${name}`
    const requestedId = input.id !== undefined ? cleanText(input.id, 40) : slugifyPluginId(name)
    if (!PLUGIN_ID_RE.test(requestedId)) {
      return fail(400, 'invalid_plugin_id', 'Plugin id must use 2 to 40 lowercase letters, digits, or hyphens.')
    }
    const css = typeof input.css === 'string' ? input.css : ''
    const check = validatePluginCode(input.code, css)
    if (!check.ok) {
      return fail(400, 'plugin_validation_failed', check.issues[0]?.message ?? 'Plugin code did not pass sandbox validation.', check.issues)
    }

    const existing = store.readPlugin(requestedId)
    if (!existing && store.listInstalled().length >= MAX_INSTALLED_PLUGINS) {
      return fail(409, 'plugin_limit', `At most ${MAX_INSTALLED_PLUGINS} plugins can be installed. Remove one first.`)
    }

    const slot: PluginSlot = SLOTS.has(input.slot as PluginSlot) ? (input.slot as PluginSlot) : existing?.slot ?? 'dashboard'
    const icon: PluginIconId = ICONS.has(input.icon as PluginIconId) ? (input.icon as PluginIconId) : existing?.icon ?? 'sparkles'
    const wide = typeof input.wide === 'boolean' ? input.wide : existing?.wide ?? false
    const createdBy: PluginOrigin = ORIGINS.has(input.createdBy as PluginOrigin) ? (input.createdBy as PluginOrigin) : existing?.createdBy ?? 'chat'

    const manifest: PluginManifest = {
      id: requestedId,
      name,
      description,
      version: 1,
      revision: existing ? existing.revision + 1 : 1,
      slot,
      wide,
      icon,
      enabled: true,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      createdBy,
    }
    const draftId = `dr_${randomUUID().slice(0, 12)}`
    const record: PluginDraftRecord = {
      draftId,
      mode: existing ? 'update' : 'create',
      manifest,
      code: input.code,
      css,
      previewUrl: `/api/plugins/drafts/${encodeURIComponent(draftId)}/frame`,
      createdAt: ts,
    }
    pruneDrafts()
    drafts.set(draftId, { record, expiresAtMs: nowDate().getTime() + DRAFT_TTL_MS })
    return { ok: true, draft: record }
  }

  return {
    state: readState,
    isEnabled: () => store.readConfig().enabled,
    setEnabled(enabled) {
      const prev = store.readConfig().enabled
      const next = enabled === true
      store.writeConfig({ version: 1, enabled: next })
      if (!next) drafts.clear()
      if (prev !== next) opts.onCreatorModeChange?.(next)
      return { ok: true, state: readState() }
    },
    get(id) {
      const valid = checkId(id)
      if (!valid) return fail(400, 'invalid_plugin_id', 'Invalid plugin id.')
      const plugin = store.readPlugin(valid)
      if (!plugin) return fail(404, 'not_found', 'Plugin not found.')
      return { ok: true, plugin }
    },
    draft(raw) {
      const blocked = checkEnabledGate()
      if (blocked) return blocked
      const body = asObj(raw)
      return buildDraft(
        {
          ...(typeof body.id === 'string' ? { id: body.id } : {}),
          name: typeof body.name === 'string' ? body.name : '',
          description: typeof body.description === 'string' ? body.description : '',
          ...(typeof body.slot === 'string' ? { slot: body.slot as PluginSlot } : {}),
          ...(typeof body.wide === 'boolean' ? { wide: body.wide } : {}),
          ...(typeof body.icon === 'string' ? { icon: body.icon as PluginIconId } : {}),
          code: typeof body.code === 'string' ? body.code : '',
          ...(typeof body.css === 'string' ? { css: body.css } : {}),
          ...(typeof body.createdBy === 'string' ? { createdBy: body.createdBy as PluginOrigin } : {}),
        },
        nowIso(),
      )
    },
    installDraft(draftId) {
      const blocked = checkEnabledGate()
      if (blocked) return blocked
      pruneDrafts()
      const stored = drafts.get(draftId)
      if (!stored) return fail(404, 'draft_not_found', 'That preview expired or was discarded. Ask Bun to draft it again.')
      const check = validatePluginCode(stored.record.code, stored.record.css)
      if (!check.ok) return fail(400, 'plugin_validation_failed', check.issues[0]?.message ?? 'Plugin failed validation.', check.issues)

      const existing = store.readPlugin(stored.record.manifest.id)
      if (!existing && store.listInstalled().length >= MAX_INSTALLED_PLUGINS) {
        return fail(409, 'plugin_limit', `At most ${MAX_INSTALLED_PLUGINS} plugins can be installed. Remove one first.`)
      }
      const ts = nowIso()
      const manifest: PluginManifest = {
        ...stored.record.manifest,
        revision: existing ? existing.revision + 1 : 1,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        enabled: true,
      }
      store.writePlugin({ ...manifest, code: stored.record.code, css: stored.record.css })
      drafts.delete(draftId)
      return { ok: true, plugin: manifest, state: readState() }
    },
    discardDraft(draftId) {
      return { ok: true, discarded: drafts.delete(draftId) }
    },
    installStarter(starterId) {
      const blocked = checkEnabledGate()
      if (blocked) return blocked
      const starter = STARTER_PLUGINS.find((s) => s.id === starterId)
      if (!starter) return fail(404, 'not_found', 'Unknown starter plugin.')
      const check = validatePluginCode(starter.code, starter.css)
      if (!check.ok) return fail(400, 'plugin_validation_failed', 'Starter failed validation.', check.issues)

      const existing = store.readPlugin(starter.id)
      if (!existing && store.listInstalled().length >= MAX_INSTALLED_PLUGINS) {
        return fail(409, 'plugin_limit', `At most ${MAX_INSTALLED_PLUGINS} plugins can be installed. Remove one first.`)
      }
      const ts = nowIso()
      const manifest: PluginManifest = {
        id: starter.id,
        name: starter.name,
        description: starter.description,
        version: 1,
        revision: existing ? existing.revision + 1 : 1,
        slot: existing?.slot ?? starter.slot,
        wide: existing?.wide ?? starter.wide,
        icon: starter.icon,
        enabled: true,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
        createdBy: 'starter',
      }
      store.writePlugin({ ...manifest, code: starter.code, css: starter.css })
      return { ok: true, plugin: manifest, state: readState() }
    },
    updateMeta(id, patchRaw) {
      const blocked = checkEnabledGate()
      if (blocked) return blocked
      const valid = checkId(id)
      if (!valid) return fail(400, 'invalid_plugin_id', 'Invalid plugin id.')
      const current = store.readPlugin(valid)
      if (!current) return fail(404, 'not_found', 'Plugin not found.')
      const patch = asObj(patchRaw)
      const next: PluginRecord = {
        ...current,
        ...(typeof patch.name === 'string' && patch.name.trim().length >= 2 ? { name: patch.name.trim().slice(0, 50) } : {}),
        ...(typeof patch.description === 'string' && patch.description.trim() ? { description: patch.description.trim().slice(0, 140) } : {}),
        ...(SLOTS.has(patch.slot as PluginSlot) ? { slot: patch.slot as PluginSlot } : {}),
        ...(typeof patch.wide === 'boolean' ? { wide: patch.wide } : {}),
        ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
        updatedAt: nowIso(),
      }
      store.writePlugin(next)
      const { code: _c, css: _s, ...manifest } = next
      return { ok: true, plugin: manifest, state: readState() }
    },
    uninstall(id) {
      const valid = checkId(id)
      if (!valid) return fail(400, 'invalid_plugin_id', 'Invalid plugin id.')
      const removed = store.deletePlugin(valid)
      if (!removed) return fail(404, 'not_found', 'Plugin not found.')
      return { ok: true, state: readState() }
    },
    renderInstalledFrame(id, frameToken) {
      const blocked = checkEnabledGate()
      if (blocked) return blocked
      const valid = checkId(id)
      if (!valid) return fail(400, 'invalid_plugin_id', 'Invalid plugin id.')
      const plugin = store.readPlugin(valid)
      if (!plugin) return fail(404, 'not_found', 'Plugin not found.')
      if (!plugin.enabled) return fail(403, 'plugin_disabled', 'This plugin is currently disabled.')
      const check = validatePluginCode(plugin.code, plugin.css)
      if (!check.ok) return fail(400, 'plugin_validation_failed', check.issues[0]?.message ?? 'Plugin failed sandbox validation.', check.issues)
      return { ok: true, html: buildPluginFrameHtml(plugin, frameToken) }
    },
    renderDraftFrame(draftId, frameToken) {
      const blocked = checkEnabledGate()
      if (blocked) return blocked
      pruneDrafts()
      const stored = drafts.get(draftId)
      if (!stored) return fail(404, 'draft_not_found', 'Preview draft not found.')
      const check = validatePluginCode(stored.record.code, stored.record.css)
      if (!check.ok) return fail(400, 'plugin_validation_failed', check.issues[0]?.message ?? 'Plugin failed sandbox validation.', check.issues)
      return {
        ok: true,
        html: buildPluginFrameHtml(
          {
            id: stored.record.manifest.id,
            name: stored.record.manifest.name,
            code: stored.record.code,
            css: stored.record.css,
          },
          frameToken,
        ),
      }
    },
  }
}
