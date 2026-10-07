import type { Result } from '../app-api'
import type { ISODate } from '../types'

export const OK: Result = Object.freeze({ ok: true })

export function fail(error: string): Result {
  return { ok: false, error }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return typeof e === 'string' ? e : 'Unknown error'
}

/** Run fn; any thrown error becomes a failed Result (Result-returning API methods never throw). */
export function attempt(fn: () => Result): Result {
  try {
    return fn()
  } catch (e) {
    return fail(errorMessage(e))
  }
}

/** Run fn, log + return the fallback when it throws (other modules must never crash the controller). */
export function safely<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch (e) {
    console.error(`[fundbun] ${label} failed:`, e)
    return fallback
  }
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function isPosInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x > 0
}

export function isNonNegInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
}

export function isIntIn(x: unknown, min: number, max: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max
}

export function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

/** The device's local calendar date (not UTC) — used as "today" for real (non-sandbox) data. */
export function localISODate(d: Date): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addMinutesISO(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString()
}
