import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../../core/app'
import { CATEGORIES } from '../../../core/categories'
import type { Transaction } from '../../../core/types'
import { PERSONAS, PRESETS, PURCHASE_CATEGORIES, advanceTotals, checkPurchase } from './logic'

describe('presets', () => {
  it('carries the five demo purchases with exact amounts', () => {
    expect(PRESETS.map((p) => [p.label, p.purchase.amount])).toEqual([
      ['Heytea', 2800],
      ['Meituan', 6800],
      ['JD headphones', 129900],
      ['Taobao', 45900],
      ['DiDi', 3600],
    ])
    expect(PRESETS.every((p) => p.purchase.category && p.purchase.category in CATEGORIES)).toBe(true)
  })

  it('the big JD purchase trips the single-purchase tripwire on the demo persona', () => {
    const app = createTestApp()
    app.loadDemo('mei')
    const jd = PRESETS.find((p) => p.id === 'jd')
    if (!jd) throw new Error('missing preset')
    const out = app.simulatePurchase(jd.purchase)
    expect(out.txn.amount).toBe(-129900)
    expect(out.events.length).toBeGreaterThan(0)
  })

  it('offers spending categories only and both personas', () => {
    expect(PURCHASE_CATEGORIES).toContain('delivery')
    expect(PURCHASE_CATEGORIES).not.toContain('income')
    expect(PURCHASE_CATEGORIES).not.toContain('savings')
    expect(PERSONAS.map((p) => p.id)).toEqual(['mei', 'arif'])
  })
})

describe('checkPurchase', () => {
  it('accepts a clean purchase', () => {
    expect(checkPurchase('  Luckin   Coffee ', '18.5', 'coffee_tea', 'CNY')).toEqual({ ok: true, purchase: { merchant: 'Luckin Coffee', amount: 1850, category: 'coffee_tea' } })
    expect(checkPurchase('Luckin', '¥1,299', '', 'CNY')).toEqual({ ok: true, purchase: { merchant: 'Luckin', amount: 129900 } })
  })

  it('rejects missing, negative, zero and absurd values', () => {
    expect(checkPurchase('', '10', '', 'CNY')).toMatchObject({ ok: false, errors: { merchant: expect.any(String) } })
    expect(checkPurchase('x'.repeat(61), '10', '', 'CNY')).toMatchObject({ ok: false })
    expect(checkPurchase('Shop', '-10', '', 'CNY')).toMatchObject({ ok: false, errors: { amount: expect.any(String) } })
    expect(checkPurchase('Shop', '0', '', 'CNY')).toMatchObject({ ok: false })
    expect(checkPurchase('Shop', 'abc', '', 'CNY')).toMatchObject({ ok: false })
    expect(checkPurchase('Shop', '200000', '', 'CNY')).toMatchObject({ ok: false })
  })
})

describe('advanceTotals', () => {
  it('splits money out and in', () => {
    const t = (amount: number) => ({ amount }) as Transaction
    expect(advanceTotals([t(-1000), t(-250), t(5000)])).toEqual({ out: 1250, in: 5000, count: 3 })
    expect(advanceTotals([])).toEqual({ out: 0, in: 0, count: 0 })
  })
})
