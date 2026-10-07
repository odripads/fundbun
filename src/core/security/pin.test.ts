import { pbkdf2Sync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Mandate } from '../types'
import { MAX_PIN_ATTEMPTS, PIN_ITERATIONS, PIN_LOCK_MINUTES, checkPin, createPin, isPinLocked, isValidPinFormat, pinLockRemainingMinutes } from './pin'
import { defaultMandate } from './policy'

const NOW = '2026-10-22T10:00:00.000Z'
const at = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()

// one PBKDF2 derivation shared by the suite keeps it fast
const DEMO = createPin('2580')
const withPin = (over: Partial<Mandate> = {}): Mandate => ({ ...defaultMandate(), ...DEMO, ...over })

describe('isValidPinFormat', () => {
  it.each([
    ['2580', true],
    ['1357', true],
    ['0852', true],
    ['90210', true],
    ['482915', true],
    ['1235', true],
    ['7890', true],
    ['123', false],
    ['1234567', false],
    ['', false],
    ['1111', false],
    ['000000', false],
    ['1234', false],
    ['4321', false],
    ['0123', false],
    ['56789', false],
    ['987654', false],
    ['12a4', false],
    [' 2580', false],
    ['2580\n', false],
    ['２５８０', false],
    ['٢٥٨٠', false],
  ])('%j → %s', (pin, ok) => {
    expect(isValidPinFormat(pin)).toBe(ok)
  })

  it('rejects non-strings', () => {
    expect(isValidPinFormat(2580 as unknown as string)).toBe(false)
  })
})

describe('createPin', () => {
  it('stores a PBKDF2-HMAC-SHA256 hash with a random 16-byte salt — never the PIN', () => {
    expect(DEMO.pinSalt).toMatch(/^[0-9a-f]{32}$/)
    expect(DEMO.pinHash).toMatch(/^[0-9a-f]{64}$/)
    expect(DEMO.pinHash).not.toContain('2580')
    const expected = pbkdf2Sync('2580', Buffer.from(DEMO.pinSalt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex')
    expect(DEMO.pinHash).toBe(expected)
  })

  it('uses a fresh salt each time', () => {
    const again = createPin('2580')
    expect(again.pinSalt).not.toBe(DEMO.pinSalt)
    expect(again.pinHash).not.toBe(DEMO.pinHash)
  })

  it('refuses weak or malformed PINs', () => {
    expect(() => createPin('1234')).toThrow()
    expect(() => createPin('abc')).toThrow()
  })
})

describe('checkPin', () => {
  it('accepts the right PIN and resets the failure counter', () => {
    const m = withPin({ failedPinAttempts: 2 })
    const r = checkPin('2580', m, NOW)
    expect(r.ok).toBe(true)
    expect(r.reason).toBeUndefined()
    expect(r.mandate.failedPinAttempts).toBe(0)
    expect(r.mandate.pinLockedUntil).toBeUndefined()
  })

  it('counts a wrong PIN and says how many tries are left', () => {
    const r = checkPin('2581', withPin(), NOW)
    expect(r.ok).toBe(false)
    expect(r.mandate.failedPinAttempts).toBe(1)
    expect(r.reason).toMatch(/Wrong PIN\. 2 tries left/)
  })

  it(`locks for ${PIN_LOCK_MINUTES} minutes after ${MAX_PIN_ATTEMPTS} failures`, () => {
    let m = withPin()
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) m = checkPin('0000', m, NOW).mandate
    expect(m.failedPinAttempts).toBe(MAX_PIN_ATTEMPTS)
    expect(m.pinLockedUntil).toBe(at(PIN_LOCK_MINUTES))
    expect(isPinLocked(m, NOW)).toBe(true)
    expect(pinLockRemainingMinutes(m, at(1))).toBe(4)
  })

  it('refuses even the correct PIN while locked, without extending the lock', () => {
    const locked = withPin({ failedPinAttempts: 3, pinLockedUntil: at(5) })
    const r = checkPin('2580', locked, at(2))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/locked — try again in 3 minutes/)
    expect(r.mandate).toBe(locked)
  })

  it('gives a fresh set of tries once the lock expires', () => {
    const expired = withPin({ failedPinAttempts: 3, pinLockedUntil: at(5) })
    const wrong = checkPin('9999', expired, at(6))
    expect(wrong.ok).toBe(false)
    expect(wrong.mandate.failedPinAttempts).toBe(1)
    expect(wrong.mandate.pinLockedUntil).toBeUndefined()
    const right = checkPin('2580', expired, at(6))
    expect(right.ok).toBe(true)
    expect(right.mandate.failedPinAttempts).toBe(0)
    expect('pinLockedUntil' in right.mandate).toBe(false)
  })

  it('never mutates the mandate it was given', () => {
    const m = withPin()
    const snapshot = JSON.stringify(m)
    checkPin('0000', m, NOW)
    checkPin('2580', m, NOW)
    expect(JSON.stringify(m)).toBe(snapshot)
  })

  it('counts malformed or absurd input as a wrong attempt', () => {
    for (const bad of ['', '25800000', 'abcd', '2580 ', '1'.repeat(1_000_000)]) {
      const r = checkPin(bad, withPin(), NOW)
      expect(r.ok).toBe(false)
      expect(r.mandate.failedPinAttempts).toBe(1)
    }
  })

  it('fails when no PIN was ever set', () => {
    const r = checkPin('2580', defaultMandate(), NOW)
    expect(r).toMatchObject({ ok: false, reason: 'No PIN has been set up yet.' })
  })

  it('fails closed on an unreadable clock', () => {
    const r = checkPin('2580', withPin(), 'not a date')
    expect(r.ok).toBe(false)
    expect(r.mandate.failedPinAttempts).toBe(0)
  })

  it('fails safely on a corrupted stored salt', () => {
    const r = checkPin('2580', withPin({ pinSalt: 'zz' }), NOW)
    expect(r.ok).toBe(false)
  })
})
