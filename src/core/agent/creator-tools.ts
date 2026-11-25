import { CREATOR_TOOL_NAMES, isCreatorTool, type CreatorToolName } from '../plugins/tools'
import type { HostPluginResult } from '../plugins/client'
import type { PluginIconId, PluginSlot } from '../plugins/types'
import type { AgentHost } from './host'
import { addCard, addNotice, trace, type Turn } from './turn'

const ACTIONS = new Set(['uninstall', 'disable', 'enable'])
const SLOTS = new Set<PluginSlot>(['dashboard', 'home', 'both'])
const ICONS = new Set<PluginIconId>(['sparkles', 'coffee', 'calendar', 'gauge', 'wallet', 'chart', 'flame', 'target'])

function deny(
  host: AgentHost,
  turn: Turn,
  name: CreatorToolName,
  ruleId: string,
  reason: string,
  audit = false,
): { content: string; is_error: true } {
  trace(turn, 'policy', `DENY · ${name}`, {
    tool: name,
    decision: 'deny',
    reasons: [reason],
    ruleIds: [ruleId],
    tainted: turn.tainted,
  })
  if (audit) {
    host.audit('policy', 'policy_decision', `DENY ${name} (${ruleId})`, {
      tool: name,
      decision: 'deny',
      ruleIds: [ruleId],
      tainted: turn.tainted,
    })
  }
  return { content: JSON.stringify({ status: 'denied', reason }), is_error: true }
}

/**
 * Executes a Desktop Creator Mode tool requested by an LLM or ACP agent.
 * Never installs, edits, or removes a plugin silently: plugin_draft creates an in-memory staged preview
 * and plugin_remove adds an explicit confirmation card for the user.
 */
export async function runCreatorTool(
  host: AgentHost,
  turn: Turn,
  name: CreatorToolName,
  args: Record<string, unknown>,
): Promise<{ content: string; is_error?: boolean }> {
  const client = host.plugins
  if (!client || !(await client.syncEnabled())) {
    return deny(
      host,
      turn,
      name,
      'P-CREATOR-OFF',
      'Desktop Creator Mode is turned off. Turn it on in Creator Studio or Settings first.',
    )
  }

  const state = host.state()
  if (state.mandate.frozen) {
    return deny(
      host,
      turn,
      name,
      'P-FROZEN',
      'FundBun is paused by the kill switch, so Creator tools cannot run.',
      true,
    )
  }

  if ((name === 'plugin_draft' || name === 'plugin_remove') && turn.tainted) {
    addNotice(
      turn,
      'block',
      'Creator action blocked',
      'This turn included untrusted content (like a bill or pasted text), so drafting or changing plugins was blocked.',
    )
    return deny(
      host,
      turn,
      name,
      'P-TAINT-CREATOR',
      'This turn includes untrusted data, so creating, updating, or removing plugins is blocked.',
      true,
    )
  }

  if (name === 'plugin_list') {
    trace(turn, 'tool_call', 'llm → plugin_list', { tool: name, availableTools: [...CREATOR_TOOL_NAMES] })
    const st = await client.state()
    trace(turn, 'tool_result', `Found ${st.plugins.length} plugin(s)`, { count: st.plugins.length })
    return {
      content: JSON.stringify({
        enabled: st.enabled,
        plugins: st.plugins.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          slot: p.slot,
          wide: p.wide,
          enabled: p.enabled,
          revision: p.revision,
        })),
        starters: st.starters.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          slot: s.slot,
          wide: s.wide,
        })),
      }),
    }
  }

  if (name === 'plugin_read') {
    const id = typeof args.id === 'string' ? args.id.trim() : ''
    trace(turn, 'tool_call', `llm → plugin_read (${id || 'missing'})`, { tool: name, id })
    if (!id) return { content: JSON.stringify({ status: 'invalid', error: 'Pass the plugin id to read.' }), is_error: true }
    const res: HostPluginResult<'get'> = await client.get(id)
    if (!res.ok) return { content: JSON.stringify({ status: 'failed', error: res.error }), is_error: true }
    trace(turn, 'tool_result', `Read ${res.plugin.id}`, { ok: true, id: res.plugin.id })
    return {
      content: JSON.stringify({
        id: res.plugin.id,
        name: res.plugin.name,
        description: res.plugin.description,
        slot: res.plugin.slot,
        wide: res.plugin.wide,
        icon: res.plugin.icon,
        enabled: res.plugin.enabled,
        code: res.plugin.code,
        css: res.plugin.css,
      }),
    }
  }

  if (name === 'plugin_draft') {
    const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : undefined
    const pluginName = typeof args.name === 'string' ? args.name.trim() : ''
    const description = typeof args.description === 'string' ? args.description.trim() : ''
    const code = typeof args.code === 'string' ? args.code : ''
    const css = typeof args.css === 'string' ? args.css : ''
    const slot = SLOTS.has(args.slot as PluginSlot) ? (args.slot as PluginSlot) : undefined
    const icon = ICONS.has(args.icon as PluginIconId) ? (args.icon as PluginIconId) : undefined
    const wide = typeof args.wide === 'boolean' ? args.wide : undefined

    trace(turn, 'tool_call', `llm → plugin_draft (${id ?? pluginName})`, { tool: name, id, name: pluginName, slot })
    const res: HostPluginResult<'draft'> = await client.draft({
      ...(id ? { id } : {}),
      name: pluginName,
      description,
      ...(slot ? { slot } : {}),
      ...(wide !== undefined ? { wide } : {}),
      ...(icon ? { icon } : {}),
      code,
      ...(css ? { css } : {}),
      createdBy: 'chat',
    })
    if (!res.ok) {
      trace(turn, 'tool_result', 'plugin_draft failed validation', { ok: false, error: res.error, issues: res.issues ?? [] })
      return {
        content: JSON.stringify({
          status: 'invalid',
          error: res.error,
          issues: res.issues ?? [],
        }),
        is_error: true,
      }
    }

    const d = res.draft
    addCard(turn, {
      type: 'plugin_draft',
      draftId: d.draftId,
      mode: d.mode,
      pluginId: d.manifest.id,
      name: d.manifest.name,
      description: d.manifest.description,
      slot: d.manifest.slot,
      wide: d.manifest.wide,
      icon: d.manifest.icon,
      previewUrl: d.previewUrl,
      code: d.code,
      css: d.css,
    })
    host.audit('agent', 'tool_call', `Staged plugin draft ${d.manifest.id} (${d.mode})`, {
      tool: name,
      pluginId: d.manifest.id,
      draftId: d.draftId,
      mode: d.mode,
    })
    trace(turn, 'tool_result', `Staged ${d.mode} preview for ${d.manifest.name}`, { ok: true, id: d.manifest.id, draftId: d.draftId })
    return {
      content: JSON.stringify({
        status: 'pending_install',
        draftId: d.draftId,
        mode: d.mode,
        pluginId: d.manifest.id,
        name: d.manifest.name,
        slot: d.manifest.slot,
        message: 'Live sandboxed preview card is shown in chat. Nothing is installed until the user clicks Install.',
      }),
    }
  }

  if (isCreatorTool(name)) {
    const id = typeof args.id === 'string' ? args.id.trim() : ''
    const actionRaw = typeof args.action === 'string' ? args.action.trim() : ''
    trace(turn, 'tool_call', `llm → plugin_remove (${actionRaw} ${id})`, { tool: name, id, action: actionRaw })
    if (!id || !ACTIONS.has(actionRaw)) {
      return { content: JSON.stringify({ status: 'invalid', error: 'Specify plugin id and action (uninstall, disable, or enable).' }), is_error: true }
    }
    const action = actionRaw as 'uninstall' | 'disable' | 'enable'
    const st = await client.state()
    const target = st.plugins.find((p) => p.id === id)
    if (!target) {
      return { content: JSON.stringify({ status: 'failed', error: `No installed plugin named "${id}".` }), is_error: true }
    }
    addCard(turn, {
      type: 'plugin_action',
      pluginId: target.id,
      name: target.name,
      action,
    })
    host.audit('agent', 'tool_call', `Proposed plugin ${action} for ${target.id}`, {
      tool: name,
      pluginId: target.id,
      action,
    })
    trace(turn, 'tool_result', `Confirmation card shown to ${action} ${target.name}`, { ok: true, id: target.id, action })
    return {
      content: JSON.stringify({
        status: 'pending_confirmation',
        pluginId: target.id,
        name: target.name,
        action,
        message: 'Confirmation card shown in chat. Nothing changes until the user confirms.',
      }),
    }
  }

  return { content: JSON.stringify({ status: 'failed', error: 'Unknown creator tool.' }), is_error: true }
}
