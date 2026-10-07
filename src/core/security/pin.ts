import type { ISODateTime, Mandate } from '../types'
import { constantTimeEqual, pbkdf2Sha256Hex, randomHex } from './sha256'

export const PIN_ITERATIONS = 20_000
export const MAX_PIN_ATTEMPTS = 3
export const PIN_LOCK_MINUTES = 5
export const PIN_SALT_BYTES = 16

const PIN_SHAPE = /^\d{4,6}$/

/** 4–6 digits, not all identical, not a straight run like 1234/4321. */
export function isValidPinFormat(pin: string): boolean {
  if (typeof pin !== 'string' || !PIN_SHAPE.test(pin)) return false
  const digits = [...pin].map(Number)
  const steps = digits.slice(1).map((d, i) => d - digits[i])
  const allSame = steps.every((s) => s === 0)
  const ascending = steps.every((s) => s === 1)
  const descending = steps.every((s) => s === -1)
  return !allSame && !ascending && !descending
}

/** PBKDF2-HMAC-SHA256 with a random 16-byte salt. Only the hash and salt are ever stored (never the PIN). */
export function createPin(pin: string): { pinHash: string; pinSalt: string } {
  if (!isValidPinFormat(pin)) throw new Error('PIN must be 4–6 digits, not all the same and not a simple run like 1234')
  const pinSalt = randomHex(PIN_SALT_BYTES)
  return { pinHash: pbkdf2Sha256Hex(pin, pinSalt, PIN_ITERATIONS), pinSalt }
}

/** Whole minutes (rounded up) until PIN entry unlocks; 0 when not locked. */
export function pinLockRemainingMinutes(mandate: Mandate, now: ISODateTime): number {
  if (!mandate.pinLockedUntil) return 0
  const until = Date.parse(mandate.pinLockedUntil)
  const at = Date.parse(now)
  if (!Number.isFinite(until)) return 0
  if (!Number.isFinite(at)) return PIN_LOCK_MINUTES
  return until > at ? Math.ceil((until - at) / 60_000) : 0
}

export function isPinLocked(mandate: Mandate, now: ISODateTime): boolean {
  return pinLockRemainingMinutes(mandate, now) > 0
}

/**
 * Constant-time compare; increments failedPinAttempts on failure and locks for PIN_LOCK_MINUTES after
 * MAX_PIN_ATTEMPTS failures; resets the counter on success. Returns the updated mandate (never mutates).
 * Attempts while locked are refused without being counted; an expired lock starts a fresh attempt budget.
 */
export function checkPin(pin: string, mandate: Mandate, now: ISODateTime): { ok: boolean; mandate: Mandate; reason?: string } {
  if (!mandate.pinHash || !mandate.pinSalt) return { ok: false, mandate, reason: 'No PIN has been set up yet.' }
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) return { ok: false, mandate, reason: 'PIN check is unavailable right now (clock error). Please try again.' }

  const remaining = pinLockRemainingMinutes(mandate, now)
  if (remaining > 0) {
    return { ok: false, mandate, reason: `Too many wrong PINs. PIN entry is locked — try again in ${plural(remaining, 'minute')}.` }
  }

  const base: Mandate = mandate.pinLockedUntil ? withoutLock({ ...mandate, failedPinAttempts: 0 }) : mandate
  if (pinMatches(pin, base)) {
    return { ok: true, mandate: withoutLock({ ...base, failedPinAttempts: 0 }) }
  }

  const failed = (base.failedPinAttempts > 0 ? base.failedPinAttempts : 0) + 1
  if (failed >= MAX_PIN_ATTEMPTS) {
    const pinLockedUntil = new Date(nowMs + PIN_LOCK_MINUTES * 60_000).toISOString()
    return {
      ok: false,
      mandate: { ...base, failedPinAttempts: failed, pinLockedUntil },
      reason: `Wrong PIN. That was ${MAX_PIN_ATTEMPTS} wrong tries, so PIN entry is locked for ${PIN_LOCK_MINUTES} minutes.`,
    }
  }
  return {
    ok: false,
    mandate: { ...base, failedPinAttempts: failed },
    reason: `Wrong PIN. ${plural(MAX_PIN_ATTEMPTS - failed, 'try', 'tries')} left before PIN entry locks.`,
  }
}

function pinMatches(pin: string, mandate: Mandate): boolean {
  // malformed input can never match a stored PIN; skipping PBKDF2 also caps the cost of absurd inputs
  if (typeof pin !== 'string' || !PIN_SHAPE.test(pin)) return false
  try {
    return constantTimeEqual(pbkdf2Sha256Hex(pin, mandate.pinSalt as string, PIN_ITERATIONS), mandate.pinHash as string)
  } catch {
    return false
  }
}

function withoutLock(m: Mandate): Mandate {
  const { pinLockedUntil: _dropped, ...rest } = m
  void _dropped
  return rest
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
