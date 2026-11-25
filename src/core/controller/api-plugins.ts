import type { AppApi, Result } from '../app-api'
import { appendAudit } from './audit'
import { LOCKED_MSG, NOT_SET_UP_MSG, type Core } from './core'
import { stepUp } from './safety'
import { attempt, fail, OK } from './util'

type PluginApi = Pick<AppApi, 'setCreatorMode' | 'installPlugin' | 'installStarterPlugin' | 'changePlugin'>

const NO_DESKTOP = 'Creator Mode needs the FundBun desktop app.'

/**
 * Desktop Creator Mode, as the user drives it. The plugin files live with the local server; this layer adds the
 * app's own rules on top: the PIN to turn it on (it lets an AI draft widgets), nothing while Bun is paused, and an
 * audit entry for every change.
 */
export function createPluginApi(core: Core): PluginApi {
  const { store } = core
  const ready = (): string | null => {
    if (core.lock.locked) return LOCKED_MSG
    if (!store.get().profile) return NOT_SET_UP_MSG
    if (!core.plugins) return NO_DESKTOP
    return null
  }
  const audit = (type: 'mandate_changed' | 'user_action', summary: string, data: Record<string, unknown>) =>
    attempt(() => store.mutate((draft) => {
      appendAudit(draft, core.now(), 'user', type, summary, data)
      return OK
    }))

  return {
    async setCreatorMode(enabled, pin) {
      const blocked = ready()
      if (blocked || !core.plugins) return fail(blocked ?? NO_DESKTOP)
      if (enabled) {
        if (store.get().mandate.frozen) return fail('Bun is paused. Unfreeze it in Settings first.')
        // a failed PIN still commits, so the failure counter and lockout persist
        const check = attempt(() => store.mutate((draft) => stepUp(draft, pin, 'Turn on Creator Mode', core.now())))
        if (!check.ok) return check
      }
      const r = await core.plugins.setEnabled(enabled)
      if (!r.ok) return fail(r.error)
      audit('mandate_changed', `Creator Mode ${enabled ? 'on' : 'off'}`, { field: 'creatorMode', to: enabled, pinVerified: enabled })
      return OK
    },
    async installPlugin(draftId) {
      const blocked = ready()
      if (blocked || !core.plugins) return fail(blocked ?? NO_DESKTOP)
      if (store.get().mandate.frozen) return fail('Bun is paused. Unfreeze it in Settings first.')
      const r = await core.plugins.installDraft(draftId)
      if (!r.ok) return fail(r.error)
      audit('user_action', `Installed widget ${r.plugin.id}`, { plugin: r.plugin.id, revision: r.plugin.revision, origin: r.plugin.createdBy })
      return OK
    },
    async installStarterPlugin(starterId) {
      const blocked = ready()
      if (blocked || !core.plugins) return fail(blocked ?? NO_DESKTOP)
      const r = await core.plugins.installStarter(starterId)
      if (!r.ok) return fail(r.error)
      audit('user_action', `Installed starter widget ${r.plugin.id}`, { plugin: r.plugin.id, origin: 'starter' })
      return OK
    },
    async changePlugin(id, action) {
      const blocked = ready()
      if (blocked || !core.plugins) return fail(blocked ?? NO_DESKTOP)
      // removing or switching off is always allowed (like the kill switch); switching back on is not while paused
      if (action === 'enable' && store.get().mandate.frozen) return fail('Bun is paused. Unfreeze it in Settings first.')
      const r: Result = action === 'uninstall'
        ? await core.plugins.uninstall(id).then((x) => (x.ok ? OK : fail(x.error)))
        : await core.plugins.updateMeta(id, { enabled: action === 'enable' }).then((x) => (x.ok ? OK : fail(x.error)))
      if (!r.ok) return r
      audit('user_action', `Widget ${id}: ${action}`, { plugin: id, action })
      return OK
    },
  }
}
