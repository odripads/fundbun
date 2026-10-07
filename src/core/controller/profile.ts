import type { AppApi, Result } from '../app-api'
import type { AppSettings, AppState, ISODateTime, Profile, Tone } from '../types'
import { appendAudit } from './audit'
import { OK, fail, isIntIn, isNonEmptyString, isPosInt } from './util'

type ProfilePatch = Parameters<AppApi['setProfile']>[0]
type ConsentPatch = Parameters<AppApi['setConsent']>[0]

const TONES: readonly Tone[] = ['cheeky', 'gentle', 'numbers']
const SETTING_KEYS = ['glassBox', 'llmEnabled', 'notificationsEnabled', 'reducedMotion'] as const

function profilePatchError(p: ProfilePatch): string | null {
  if (p.name !== undefined && !isNonEmptyString(p.name)) return 'Name cannot be empty'
  if (p.monthlyIncome !== undefined && !isPosInt(p.monthlyIncome)) return 'Monthly income must be a positive whole amount'
  if (p.targetSpend !== undefined && !isPosInt(p.targetSpend)) return 'Spending target must be a positive whole amount'
  if (p.payday !== undefined && !isIntIn(p.payday, 1, 28)) return 'Payday must be a day between 1 and 28'
  if (p.workHoursPerMonth !== undefined && !isIntIn(p.workHoursPerMonth, 1, 744)) return 'Work hours per month must be 1–744'
  if (p.tone !== undefined && !TONES.includes(p.tone)) return `Unknown tone "${String(p.tone)}"`
  return null
}

export function setProfileIn(draft: AppState, patch: ProfilePatch, ts: ISODateTime): Result {
  const profile = draft.profile as Profile
  const err = profilePatchError(patch)
  if (err) return fail(err)
  const fields = Object.keys(patch).filter((k) => patch[k as keyof ProfilePatch] !== undefined)
  if (!fields.length) return OK
  for (const k of fields) Object.assign(profile, { [k]: k === 'name' ? (patch.name as string).trim() : patch[k as keyof ProfilePatch] })
  appendAudit(draft, ts, 'user', 'user_action', `Profile updated: ${fields.join(', ')}`, { fields })
  return OK
}

/** Returns true when LLM processing was newly granted (the caller may re-check the gateway). */
export function setConsentIn(draft: AppState, patch: ConsentPatch, ts: ISODateTime): boolean {
  const consent = (draft.profile as Profile).consent
  const changes: Record<string, boolean> = {}
  for (const k of ['llmProcessing', 'notifications'] as const) {
    if (typeof patch[k] === 'boolean' && patch[k] !== consent[k]) changes[k] = patch[k] as boolean
  }
  if (!Object.keys(changes).length) return false
  Object.assign(consent, changes, { grantedAt: ts })
  appendAudit(draft, ts, 'user', 'consent', 'Consent updated', { ...changes, version: consent.version })
  return changes.llmProcessing === true
}

/** `vault` is ignored here — it only changes through enableVault/disableVault (PIN + encryption). */
export function setSettingsIn(draft: AppState, patch: Partial<AppSettings>, ts: ISODateTime): boolean {
  const changes: Partial<AppSettings> = {}
  for (const k of SETTING_KEYS) {
    if (typeof patch[k] === 'boolean' && patch[k] !== draft.settings[k]) changes[k] = patch[k]
  }
  if (!Object.keys(changes).length) return false
  Object.assign(draft.settings, changes)
  appendAudit(draft, ts, 'user', 'user_action', `Settings changed: ${Object.keys(changes).join(', ')}`, { ...changes })
  return changes.llmEnabled === true
}
