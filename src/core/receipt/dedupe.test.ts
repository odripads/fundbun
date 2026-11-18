import { describe, expect, it } from 'vitest'
import type { SpendingCandidate, Transaction } from '../types'
import { DUPLICATE_WINDOW_DAYS, looksDuplicate, similarSpend } from './dedupe'

function candidate(over: Partial<SpendingCandidate> = {}): SpendingCandidate {
  return {
    id: 'receipt_x',
    merchant: 'Luckin Coffee',
    amount: 3490,
    currency: 'CNY',
    date: '2026-11-03',
    category: 'coffee_tea',
    description: '瑞幸咖啡',
    source: 'receipt',
    ...over,
  }
}

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn_x',
    accountId: 'chk_main',
    date: '2026-11-03',
    amount: -3490,
    currency: 'CNY',
    merchant: 'Luckin Coffee',
    description: '瑞幸咖啡',
    category: 'coffee_tea',
    categorySource: 'import',
    categoryConfidence: 1,
    ...over,
  }
}

describe('looksDuplicate', () => {
  it('matches the same merchant, amount and date', () => {
    expect(looksDuplicate(candidate(), [txn()])).toBe(true)
  })

  it('is case- and whitespace-insensitive on the merchant', () => {
    expect(looksDuplicate(candidate({ merchant: '  luckin coffee ' }), [txn({ merchant: 'Luckin Coffee' })])).toBe(true)
  })

  it('stays true within the date window, false beyond it', () => {
    expect(looksDuplicate(candidate({ date: '2026-11-05' }), [txn({ date: '2026-11-03' })])).toBe(true)
    const far = DUPLICATE_WINDOW_DAYS + 1
    expect(looksDuplicate(candidate({ date: '2026-11-08' }), [txn({ date: `2026-11-${String(8 - far).padStart(2, '0')}` })])).toBe(false)
  })

  it('ignores a different amount or merchant', () => {
    expect(looksDuplicate(candidate({ amount: 3400 }), [txn()])).toBe(false)
    expect(looksDuplicate(candidate({ merchant: 'Other' }), [txn()])).toBe(false)
  })

  it('never counts a refund (inflow) as a duplicate spend', () => {
    expect(looksDuplicate(candidate(), [txn({ amount: 3490 })])).toBe(false)
  })

  it('handles empty inputs', () => {
    expect(looksDuplicate(candidate(), [])).toBe(false)
    expect(looksDuplicate(candidate({ merchant: '' }), [txn()])).toBe(false)
    expect(looksDuplicate(candidate({ amount: 0 }), [txn()])).toBe(false)
  })
})

describe('similarSpend — warn before a typed-in purchase repeats one on the ledger', () => {
  const row = (id: string, date: string, amount: number, merchant: string) =>
    ({ id, accountId: 'a', date, amount, currency: 'CNY', merchant, description: merchant, category: 'other', categorySource: 'import', categoryConfidence: 1 }) as Parameters<typeof similarSpend>[2][number]
  const ledger = [row('csv_1', '2026-10-20', -2500, 'Luckin Coffee SZ'), row('csv_2', '2026-10-22', -2500, 'Manner'), row('csv_3', '2026-10-21', 2500, 'Refund')]

  it('finds the same amount a day or two away, whatever the shop is called, and prefers the nearest day', () => {
    expect(similarSpend(2500, '2026-10-22', ledger)?.id).toBe('csv_2')
    expect(similarSpend(2500, '2026-10-19', ledger)?.id).toBe('csv_1')
  })
  it('ignores other amounts, income, and anything outside the window', () => {
    expect(similarSpend(2600, '2026-10-21', ledger)).toBeUndefined()
    expect(similarSpend(2500, '2026-10-26', ledger)).toBeUndefined()
    expect(similarSpend(2500, '2026-10-21', [ledger[2]])).toBeUndefined()
    expect(similarSpend(0, '2026-10-21', ledger)).toBeUndefined()
  })
})
