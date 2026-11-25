import type { AiConnection } from './types'

const raw = (v?: string): string => (v ?? '').trim()

/** Display provider name: legacy saved `'Claude Code'` connections show as `'Claude'`. */
export function displayProvider(provider?: string, presetId?: string): string {
  const p = raw(provider)
  if (presetId === 'claude-code' && (!p || p === 'Claude Code')) return 'Claude'
  return p
}

/**
 * Human label for who is answering (chip, Settings, live attribution).
 * For Claude agent connections, names render as `'Claude Opus 5.5'` instead of `'Claude Code · Opus 5.5'`;
 * `'default'` / `'Default (recommended)'` collapses to `'Claude'`.
 */
export function formatAiLabel(provider?: string, model?: string, presetId?: string): string {
  const p = displayProvider(provider, presetId)
  const m = raw(model)
  if (!p) return m
  if (!m) return p
  if (presetId === 'claude-code' || p.toLowerCase() === 'claude' || p.toLowerCase() === 'claude code') {
    if (/^default\b/i.test(m)) return 'Claude'
    if (/^claude\s+/i.test(m)) return m
    if (/^[A-Z]/.test(m)) return `Claude ${m}`
  }
  return `${p} · ${m}`
}

/** Card title for a saved connection in Your AI. */
export function connectionTitle(c: Pick<AiConnection, 'label' | 'model' | 'modelName' | 'presetId'>): string {
  if (c.presetId === 'claude-code' || raw(c.label) === 'Claude Code') {
    return formatAiLabel(c.label, c.modelName || c.model, c.presetId)
  }
  return c.label
}
