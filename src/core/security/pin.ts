import type { ISODateTime, Mandate } from '../types'

export const PIN_ITERATIONS = 20_000
export const MAX_PIN_ATTEMPTS = 3
export const PIN_LOCK_MINUTES = 5

/** 4–6 digits, not all identical, not a straight run like 1234/4321. */
export function isValidPinFormat(pin: string): boolean {
  throw new Error('TODO isValidPinFormat ' + pin.length)
}

/** PBKDF2-HMAC-SHA256 with a random 16-byte salt. */
export function createPin(pin: string): { pinHash: string; pinSalt: string } {
  throw new Error('TODO createPin ' + pin.length)
}

/**
 * Constant-time compare; increments failedPinAttempts on failure and locks for PIN_LOCK_MINUTES after
 * MAX_PIN_ATTEMPTS failures; resets the counter on success. Returns the updated mandate (never mutates).
 */
export function checkPin(pin: string, mandate: Mandate, now: ISODateTime): { ok: boolean; mandate: Mandate; reason?: string } {
  throw new Error('TODO checkPin ' + pin.length + mandate.autonomy + now)
}
