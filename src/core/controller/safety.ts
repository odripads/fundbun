import type { Result } from '../app-api'
import { TOOL_SPECS, isToolName } from '../agent/specs'
import { fmt } from '../money'
import { checkPin, createPin, isValidPinFormat } from '../security/pin'
import type { AppState, Autonomy, ISODateTime, Mandate, ToolName } from '../types'
import { appendAudit } from './audit'
import { AUTONOMY_ORDER } from './constants'
import { OK, fail, isPosInt, safely } from './util'

export type Caps = Partial<Pick<Mandate, 'perActionCap' | 'dailyCap' | 'monthlyCap'>>
const CAP_KEYS = ['perActionCap', 'dailyCap', 'monthlyCap'] as const

export function autonomyRank(a: Autonomy): number {
  return AUTONOMY_ORDER.indexOf(a)
}

export function pinFormatOk(pin: unknown): boolean {
  return typeof pin === 'string' && safely('isValidPinFormat', () => isValidPinFormat(pin), false)
}

/**
 * PIN step-up on the draft mandate. The updated failure counter / lockout is written to the draft whether or not
 * the PIN was right, so the caller must COMMIT (return, not throw) on failure.
 */
export function stepUp(draft: AppState, pin: string | undefined, action: string, now: ISODateTime): Result {
  if (!pin) {
    appendAudit(draft, now, 'user', 'step_up_failed', `${action}: refused, PIN required`, { action, reason: 'pin_required' })
    return fail('Enter your PIN to confirm this change')
  }
  if (!draft.mandate.pinHash) return fail('No PIN is set up yet')
  const r = checkPin(pin, draft.mandate, now)
  draft.mandate = r.mandate
  if (r.ok) return OK
  appendAudit(draft, now, 'user', 'step_up_failed', `${action}: PIN check failed`, {
    action,
    reason: r.reason ?? 'wrong_pin',
    failedPinAttempts: r.mandate.failedPinAttempts,
    pinLockedUntil: r.mandate.pinLockedUntil,
  })
  return fail(r.reason ?? 'Wrong PIN')
}

export function setAutonomyIn(draft: AppState, next: Autonomy, pin: string | undefined, now: ISODateTime): Result {
  if (!AUTONOMY_ORDER.includes(next)) return fail(`Unknown autonomy level "${String(next)}"`)
  const prev = draft.mandate.autonomy
  if (prev === next) return OK
  const raising = autonomyRank(next) > autonomyRank(prev)
  if (raising) {
    const s = stepUp(draft, pin, `Raise autonomy to ${next}`, now)
    if (!s.ok) return s
  }
  draft.mandate.autonomy = next
  appendAudit(draft, now, 'user', 'mandate_changed', `Autonomy ${prev} → ${next}`, {
    field: 'autonomy', from: prev, to: next, pinVerified: raising,
  })
  return OK
}

export function setCapsIn(draft: AppState, caps: Caps, pin: string | undefined, now: ISODateTime): Result {
  const m = draft.mandate
  const changed = CAP_KEYS.filter((k) => caps[k] !== undefined && caps[k] !== m[k])
  for (const k of changed) if (!isPosInt(caps[k])) return fail(`${k} must be a positive whole amount`)
  if (!changed.length) return OK
  const raising = changed.some((k) => (caps[k] as number) > m[k])
  if (raising) {
    const s = stepUp(draft, pin, 'Raise spending limits', now)
    if (!s.ok) return s
  }
  const from: Record<string, number> = {}
  const to: Record<string, number> = {}
  for (const k of changed) {
    from[k] = m[k]
    to[k] = caps[k] as number
    draft.mandate[k] = caps[k] as number
  }
  const currency = draft.profile?.currency ?? 'CNY'
  const desc = changed.map((k) => `${k} ${fmt(from[k], currency)} → ${fmt(to[k], currency)}`).join(', ')
  appendAudit(draft, now, 'user', 'mandate_changed', `Limits changed: ${desc}`, { field: 'caps', from, to, pinVerified: raising })
  return OK
}

export function setToolEnabledIn(draft: AppState, tool: ToolName, enabled: boolean, pin: string | undefined, now: ISODateTime): Result {
  if (!isToolName(tool)) return fail(`Unknown tool "${String(tool)}"`)
  const disabled = draft.mandate.disabledTools.includes(tool)
  if (enabled !== disabled) return OK
  const label = TOOL_SPECS[tool].label
  if (!enabled) {
    draft.mandate.disabledTools = [...draft.mandate.disabledTools, tool]
    appendAudit(draft, now, 'user', 'mandate_changed', `Tool switched off: ${label}`, { field: 'disabledTools', tool, enabled: false })
    return OK
  }
  const needsPin = TOOL_SPECS[tool].tier >= 2
  if (needsPin) {
    const s = stepUp(draft, pin, `Switch on ${label}`, now)
    if (!s.ok) return s
  }
  draft.mandate.disabledTools = draft.mandate.disabledTools.filter((t) => t !== tool)
  appendAudit(draft, now, 'user', 'mandate_changed', `Tool switched on: ${label}`, {
    field: 'disabledTools', tool, enabled: true, pinVerified: needsPin,
  })
  return OK
}

/** Kill switch: instant, no PIN. Pending actions are left to the policy re-check (P-FROZEN) at approval. */
export function freezeIn(draft: AppState, now: ISODateTime): void {
  if (draft.mandate.frozen) return
  draft.mandate.frozen = true
  appendAudit(draft, now, 'user', 'kill_switch', 'Kill switch on: the agent is read-only', { frozen: true })
}

export function unfreezeIn(draft: AppState, pin: string, now: ISODateTime): Result {
  const m = draft.mandate
  if (!m.frozen && !m.breakerTrippedAt) return OK
  const s = stepUp(draft, pin, 'Unfreeze the agent', now)
  if (!s.ok) return s
  const breakerReason = draft.mandate.breakerReason
  draft.mandate.frozen = false
  delete draft.mandate.breakerTrippedAt
  delete draft.mandate.breakerReason
  appendAudit(draft, now, 'user', 'kill_switch', 'Kill switch off: agent resumed (PIN verified)', { frozen: false, clearedBreaker: breakerReason })
  return OK
}

export function changePinIn(draft: AppState, oldPin: string, newPin: string, now: ISODateTime): Result {
  if (!pinFormatOk(newPin)) return fail('New PIN must be 4–6 digits and not easy to guess (no 1111 or 1234)')
  if (oldPin === newPin) return fail('The new PIN must be different from the current one')
  const s = stepUp(draft, oldPin, 'Change PIN', now)
  if (!s.ok) return s
  const { pinHash, pinSalt } = createPin(newPin)
  draft.mandate.pinHash = pinHash
  draft.mandate.pinSalt = pinSalt
  draft.mandate.failedPinAttempts = 0
  delete draft.mandate.pinLockedUntil
  appendAudit(draft, now, 'user', 'mandate_changed', 'PIN changed', { field: 'pin' })
  return OK
}
