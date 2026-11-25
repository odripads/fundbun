import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { PluginIconId, PluginManifest, PluginOrigin, PluginRecord, PluginSlot } from '../../src/core/plugins/types'
import { PLUGIN_ID_RE } from './validate'

export interface CreatorConfig {
  version: 1
  enabled: boolean
}

export interface PluginStore {
  readonly dir: string
  readConfig(): CreatorConfig
  writeConfig(config: CreatorConfig): void
  listInstalled(): PluginManifest[]
  readPlugin(id: string): PluginRecord | null
  writePlugin(record: PluginRecord): void
  deletePlugin(id: string): boolean
}

const SLOTS = new Set<PluginSlot>(['dashboard', 'home', 'both'])
const ORIGINS = new Set<PluginOrigin>(['chat', 'starter', 'user'])
const ICONS = new Set<PluginIconId>(['sparkles', 'coffee', 'calendar', 'gauge', 'wallet', 'chart', 'flame', 'target'])

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined

export function normaliseManifest(raw: unknown, idHint?: string): PluginManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const id = str(r.id, 40) ?? idHint
  if (!id || !PLUGIN_ID_RE.test(id)) return null
  const name = str(r.name, 80)
  const description = typeof r.description === 'string' ? r.description.slice(0, 200) : ''
  if (!name) return null
  const slot = SLOTS.has(r.slot as PluginSlot) ? (r.slot as PluginSlot) : 'dashboard'
  const icon = ICONS.has(r.icon as PluginIconId) ? (r.icon as PluginIconId) : 'sparkles'
  const createdBy = ORIGINS.has(r.createdBy as PluginOrigin) ? (r.createdBy as PluginOrigin) : 'user'
  const version = typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 1 ? r.version : 1
  const revision = typeof r.revision === 'number' && Number.isInteger(r.revision) && r.revision >= 1 ? r.revision : 1
  return {
    id,
    name,
    description,
    version,
    revision,
    slot,
    wide: r.wide === true,
    icon,
    enabled: r.enabled !== false,
    createdAt: str(r.createdAt, 40) ?? new Date(0).toISOString(),
    updatedAt: str(r.updatedAt, 40) ?? new Date(0).toISOString(),
    createdBy,
  }
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, file)
  try {
    chmodSync(file, 0o600)
  } catch {
    // best effort on filesystems without POSIX permissions
  }
}

export function defaultPluginDir(home: string): string {
  return join(home, 'plugins')
}

export function createPluginFileStore(home: string): PluginStore {
  const dir = defaultPluginDir(home)
  const configPath = join(dir, 'creator.json')
  const ensureDir = (p = dir) => mkdirSync(p, { recursive: true, mode: 0o700 })

  return {
    dir,
    readConfig() {
      try {
        if (!existsSync(configPath)) return { version: 1, enabled: false }
        const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { enabled?: unknown }
        return { version: 1, enabled: parsed?.enabled === true }
      } catch {
        // damaged creator.json fails closed (disabled)
        return { version: 1, enabled: false }
      }
    },
    writeConfig(config) {
      ensureDir()
      writeAtomic(configPath, JSON.stringify({ version: 1, enabled: config.enabled === true }, null, 2))
    },
    listInstalled() {
      if (!existsSync(dir)) return []
      let entries: string[]
      try {
        entries = readdirSync(dir).sort()
      } catch {
        return []
      }
      const out: PluginManifest[] = []
      for (const name of entries) {
        if (!PLUGIN_ID_RE.test(name)) continue
        const manifestFile = join(dir, name, 'manifest.json')
        if (!existsSync(manifestFile)) continue
        try {
          const parsed = normaliseManifest(JSON.parse(readFileSync(manifestFile, 'utf8')), name)
          if (parsed && existsSync(join(dir, name, 'widget.js'))) out.push(parsed)
        } catch {
          // ignore malformed plugin entry rather than crashing the host
        }
      }
      return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    },
    readPlugin(id) {
      if (!PLUGIN_ID_RE.test(id)) return null
      const pluginDir = join(dir, id)
      const manifestFile = join(pluginDir, 'manifest.json')
      const codeFile = join(pluginDir, 'widget.js')
      if (!existsSync(manifestFile) || !existsSync(codeFile)) return null
      try {
        const manifest = normaliseManifest(JSON.parse(readFileSync(manifestFile, 'utf8')), id)
        if (!manifest) return null
        const code = readFileSync(codeFile, 'utf8')
        const cssFile = join(pluginDir, 'style.css')
        const css = existsSync(cssFile) ? readFileSync(cssFile, 'utf8') : ''
        return { ...manifest, code, css }
      } catch {
        return null
      }
    },
    writePlugin(record) {
      if (!PLUGIN_ID_RE.test(record.id)) throw new Error('Invalid plugin id')
      ensureDir()
      const pluginDir = join(dir, record.id)
      ensureDir(pluginDir)
      const { code, css, ...manifest } = record
      writeAtomic(join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      writeAtomic(join(pluginDir, 'widget.js'), code)
      writeAtomic(join(pluginDir, 'style.css'), css ?? '')
    },
    deletePlugin(id) {
      if (!PLUGIN_ID_RE.test(id)) return false
      const pluginDir = join(dir, id)
      if (!existsSync(pluginDir)) return false
      rmSync(pluginDir, { recursive: true, force: true })
      return true
    },
  }
}

export function createPluginMemoryStore(initial: { enabled?: boolean; plugins?: PluginRecord[] } = {}, dir = '/tmp/fundbun-plugins-test'): PluginStore {
  let config: CreatorConfig = { version: 1, enabled: initial.enabled === true }
  const map = new Map<string, PluginRecord>()
  for (const p of initial.plugins ?? []) {
    if (PLUGIN_ID_RE.test(p.id)) map.set(p.id, structuredClone(p))
  }

  return {
    dir,
    readConfig: () => ({ ...config }),
    writeConfig: (next) => void (config = { version: 1, enabled: next.enabled === true }),
    listInstalled: () =>
      [...map.values()]
        .map(({ code: _c, css: _s, ...manifest }) => structuredClone(manifest))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    readPlugin: (id) => {
      if (!PLUGIN_ID_RE.test(id)) return null
      const found = map.get(id)
      return found ? structuredClone(found) : null
    },
    writePlugin: (record) => {
      if (!PLUGIN_ID_RE.test(record.id)) throw new Error('Invalid plugin id')
      map.set(record.id, structuredClone(record))
    },
    deletePlugin: (id) => (PLUGIN_ID_RE.test(id) ? map.delete(id) : false),
  }
}
