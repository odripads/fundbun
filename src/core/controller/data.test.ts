import { describe, expect, it } from 'vitest'
import type { Transaction } from '../types'
import { RECONCILE_WINDOW_DAYS, mergeTransactions } from './data'
import { emptyState } from './state'

let n = 0
/** a purchase (outflow) unless `amount` is positive */
function txn(id: string, date: string, amount: number, merchant: string): Transaction {
  return {
    id,
    accountId: 'acc_checking',
    date,
    time: `10:${String(n++ % 60).padStart(2, '0')}`,
    amount: -Math.abs(amount) * (amount > 0 ? 1 : -1),
    currency: 'CNY',
    merchant,
    description: merchant,
    category: 'other',
    categorySource: 'import',
    categoryConfidence: 1,
  }
}
const ledger = (rows: Transaction[] = []) => {
  const s = emptyState('2026-10-22')
  s.bank.transactions = rows
  return s
}
const sum = (s: ReturnType<typeof ledger>) => s.bank.transactions.reduce((a, t) => a + t.amount, 0)

describe('mergeTransactions — several statements and typed-in spending in one month', () => {
  it('two different files for the same month both land in full', () => {
    const s = ledger()
    const a = mergeTransactions(s, [txn('csv_a1', '2026-10-03', 2300, 'Heytea'), txn('csv_a2', '2026-10-08', 45900, 'JD.com')])
    const b = mergeTransactions(s, [txn('csv_b1', '2026-10-04', 1850, 'Luckin Coffee'), txn('csv_b2', '2026-10-09', 6200, 'Meituan')])
    expect([a.added.length, a.duplicates, b.added.length, b.duplicates, b.matched]).toEqual([2, 0, 2, 0, 0])
    expect(s.bank.transactions).toHaveLength(4)
  })

  it('the same file again adds nothing, and an overlapping export adds only its new rows', () => {
    const file = () => [txn('csv_a1', '2026-10-03', 2300, 'Heytea'), txn('csv_a2', '2026-10-08', 45900, 'JD.com')]
    const s = ledger()
    mergeTransactions(s, file())
    expect(mergeTransactions(s, file())).toMatchObject({ added: [], duplicates: 2 })
    // a later export that repeats one row under a different id, plus one new row
    const overlap = mergeTransactions(s, [txn('csv_zz', '2026-10-08', 45900, 'JD.com'), txn('csv_c1', '2026-10-15', 3500, 'Didi')])
    expect(overlap.added.map((t) => t.merchant)).toEqual(['Didi'])
    expect(overlap.duplicates).toBe(1)
    expect(s.bank.transactions).toHaveLength(3)
  })

  it('two identical coffees in one file are two purchases, and stay two after a re-import', () => {
    const file = () => [txn('csv_k', '2026-10-05', 1850, 'Luckin Coffee'), txn('csv_k_2', '2026-10-05', 1850, 'Luckin Coffee')]
    const s = ledger()
    expect(mergeTransactions(s, file()).added).toHaveLength(2)
    expect(mergeTransactions(s, file())).toMatchObject({ added: [], duplicates: 2 })
    expect(s.bank.transactions).toHaveLength(2)
  })

  it('order numbers decide: the same number is one transaction, two numbers are two purchases even when everything else matches', () => {
    const s = ledger()
    mergeTransactions(s, [txn('wx_4200001234567890', '2026-10-05', 3000, 'Starbucks')])
    // an overlapping WeChat export repeats the order → skipped
    expect(mergeTransactions(s, [txn('wx_4200001234567890', '2026-10-05', 3000, 'Starbucks')])).toMatchObject({ added: [], duplicates: 1 })
    // another real order with the same shop, day and amount (paid from another account) → kept
    expect(mergeTransactions(s, [txn('ali_2026100522001234', '2026-10-05', 3000, 'Starbucks')]).added).toHaveLength(1)
    expect(s.bank.transactions).toHaveLength(2)
    // a plain bank row with the same shop, day and amount pairs with one of them, once
    expect(mergeTransactions(s, [txn('csv_p', '2026-10-05', 3000, 'Starbucks')])).toMatchObject({ added: [], duplicates: 1 })
  })

  it('a purchase typed in by hand and then found on a statement is counted once, in the user\'s own words', () => {
    const s = ledger([txn('manual_1', '2026-10-20', 2500, 'coffee')])
    const r = mergeTransactions(s, [txn('csv_s1', '2026-10-21', 2500, 'Luckin Coffee SZ'), txn('csv_s2', '2026-10-21', 4800, 'Hema')])
    expect(r).toMatchObject({ matched: 1, duplicates: 0 })
    expect(r.added.map((t) => t.merchant)).toEqual(['Hema'])
    expect(s.bank.transactions.map((t) => t.merchant).sort()).toEqual(['Hema', 'coffee'])
    expect(sum(s)).toBe(-7300)
    // importing that statement again changes nothing
    const again = mergeTransactions(s, [txn('csv_s1', '2026-10-21', 2500, 'Luckin Coffee SZ'), txn('csv_s2', '2026-10-21', 4800, 'Hema')])
    expect(again).toMatchObject({ added: [], matched: 1, duplicates: 1 })
    expect(sum(s)).toBe(-7300)
  })

  it('pairs one typed-in purchase with one statement row only: a second row of the same amount is a second purchase', () => {
    const s = ledger([txn('manual_1', '2026-10-20', 2500, 'coffee')])
    const r = mergeTransactions(s, [txn('csv_x1', '2026-10-20', 2500, 'Luckin Coffee'), txn('csv_x2', '2026-10-21', 2500, 'Manner Coffee')])
    expect([r.matched, r.added.length]).toEqual([1, 1])
    expect(r.added[0].merchant).toBe('Manner Coffee')
  })

  it('only reconciles within the window, never across amounts or with income, and prefers the nearest day', () => {
    const far = ledger([txn('manual_1', '2026-10-10', 2500, 'coffee')])
    const late = `2026-10-${10 + RECONCILE_WINDOW_DAYS + 1}`
    expect(mergeTransactions(far, [txn('csv_f', late, 2500, 'Luckin')])).toMatchObject({ matched: 0 })
    expect(far.bank.transactions).toHaveLength(2)

    const amounts = ledger([txn('manual_1', '2026-10-10', 2500, 'coffee')])
    expect(mergeTransactions(amounts, [txn('csv_g', '2026-10-10', 2600, 'Luckin')]).matched).toBe(0)

    const refund = ledger([txn('manual_1', '2026-10-10', 2500, 'coffee')])
    expect(mergeTransactions(refund, [txn('csv_h', '2026-10-10', -2500, 'Refund')]).matched).toBe(0)

    const near = ledger([txn('manual_a', '2026-10-09', 2500, 'tea'), txn('manual_b', '2026-10-11', 2500, 'coffee')])
    mergeTransactions(near, [txn('csv_n', '2026-10-11', 2500, 'Luckin'), txn('csv_m', '2026-10-13', 9900, 'Shoes')])
    // the row dated the 11th pairs with the entry of the 11th, so the entry of the 9th can still meet its own row later
    expect(mergeTransactions(near, [txn('csv_o', '2026-10-09', 2500, 'Heytea')])).toMatchObject({ matched: 1, added: [] })
  })

  it('never drops what the user types in: the same thing typed twice is two purchases', () => {
    const s = ledger([txn('csv_a', '2026-10-05', 2500, 'Luckin Coffee')])
    expect(mergeTransactions(s, [txn('manual_1', '2026-10-05', 2500, 'Luckin Coffee')]).added).toHaveLength(1)
    expect(mergeTransactions(s, [txn('manual_2', '2026-10-05', 2500, 'Luckin Coffee')]).added).toHaveLength(1)
    expect(s.bank.transactions).toHaveLength(3)
    // the very same entry sent twice (a double tap) is one purchase
    expect(mergeTransactions(s, [txn('manual_2', '2026-10-05', 2500, 'Luckin Coffee')])).toMatchObject({ added: [], duplicates: 1 })
    expect(s.bank.transactions).toHaveLength(3)
  })

  it('a re-scanned receipt or re-read email is still one purchase, and a clashing id never overwrites a row', () => {
    const s = ledger([txn('receipt_abc', '2026-10-05', 5200, 'Hema')])
    expect(mergeTransactions(s, [txn('receipt_abc', '2026-10-05', 5200, 'Hema')])).toMatchObject({ added: [], duplicates: 1 })
    // same id, different purchase → kept under a fresh id
    const r = mergeTransactions(s, [txn('receipt_abc', '2026-10-06', 990, 'Bakery')])
    expect(r.added).toHaveLength(1)
    expect(new Set(s.bank.transactions.map((t) => t.id)).size).toBe(2)
  })

  it('keeps the ledger sorted by date', () => {
    const s = ledger()
    mergeTransactions(s, [txn('csv_2', '2026-10-09', 100, 'B'), txn('csv_1', '2026-10-02', 100, 'A')])
    mergeTransactions(s, [txn('csv_3', '2026-10-05', 100, 'C')])
    expect(s.bank.transactions.map((t) => t.date)).toEqual(['2026-10-02', '2026-10-05', '2026-10-09'])
  })
})
