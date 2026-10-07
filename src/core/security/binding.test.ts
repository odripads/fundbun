import { describe, expect, it } from 'vitest'
import { canonicalJSON } from './audit'
import { computeBindingHash, signApproval, verifyApproval, verifyBindingHash } from './binding'
import { sha256Hex } from './sha256'

const base = { id: 'pa_1', tool: 'pay_bill', args: { billId: 'bill_power_2026_09' }, amount: 48_620, to: 'Shenzhen Power Supply' }

describe('computeBindingHash', () => {
  it('is sha256 of the canonical JSON of {id, tool, args, amount, to}', () => {
    expect(computeBindingHash(base)).toBe(sha256Hex(canonicalJSON(base)))
    expect(computeBindingHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not depend on key order', () => {
    const reordered = { to: base.to, amount: base.amount, args: { billId: 'bill_power_2026_09' }, tool: base.tool, id: base.id }
    expect(computeBindingHash(reordered)).toBe(computeBindingHash(base))
  })

  it('changes when anything the user saw changes', () => {
    const h = computeBindingHash(base)
    expect(computeBindingHash({ ...base, amount: 48_621 })).not.toBe(h)
    expect(computeBindingHash({ ...base, to: 'Unknown Holdings' })).not.toBe(h)
    expect(computeBindingHash({ ...base, tool: 'transfer_external' })).not.toBe(h)
    expect(computeBindingHash({ ...base, id: 'pa_2' })).not.toBe(h)
    expect(computeBindingHash({ ...base, args: { billId: 'bill_other' } })).not.toBe(h)
    expect(computeBindingHash({ ...base, args: { billId: 'bill_power_2026_09', date: '2026-10-25' } })).not.toBe(h)
  })

  it('treats an absent and an undefined destination the same', () => {
    const { to: _to, ...noTo } = base
    void _to
    expect(computeBindingHash({ ...noTo, to: undefined })).toBe(computeBindingHash(noTo))
  })

  it('verifies with verifyBindingHash', () => {
    const h = computeBindingHash(base)
    expect(verifyBindingHash(base, h)).toBe(true)
    expect(verifyBindingHash({ ...base, amount: 1 }, h)).toBe(false)
    expect(verifyBindingHash(base, h.toUpperCase())).toBe(false)
  })
})

describe('PIN-bound approval', () => {
  const pinHash = sha256Hex('stored pbkdf2 hash stand-in')
  const binding = computeBindingHash(base)

  it('verifies only for the same binding and PIN hash', () => {
    const token = signApproval(binding, pinHash)
    expect(verifyApproval(token, binding, pinHash)).toBe(true)
    expect(verifyApproval(token, computeBindingHash({ ...base, amount: 99_999 }), pinHash)).toBe(false)
    expect(verifyApproval(token, binding, sha256Hex('other pin'))).toBe(false)
    expect(verifyApproval('', binding, pinHash)).toBe(false)
  })
})
