import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../categories'
import type { BudgetPlan, FinanceContext } from '../types'
import { arifLike, daily, makeCtx, meiLike, monthly, yuan } from './__fixtures__'
import { historyMedians, proposeBudget } from './budget'

const sum = (p: BudgetPlan) => p.categories.reduce((s, c) => s + c.limit, 0)
const limitOf = (p: BudgetPlan, c: string) => p.categories.find((x) => x.category === c)?.limit

function withTarget(ctx: FinanceContext, target: number): FinanceContext {
  return { ...ctx, profile: { ...ctx.profile, targetSpend: target } }
}

describe('proposeBudget — invariants', () => {
  const contexts = [meiLike(), arifLike(), makeCtx({ today: '2026-10-22' })]
  const targets = [yuan(9_500), yuan(3_600), yuan(1_234.56), yuan(25_000), yuan(7), 1]

  it('category limits always sum exactly to the target', () => {
    for (const ctx of contexts) {
      for (const target of targets) {
        for (const method of ['history', 'fifty_thirty_twenty', 'custom'] as const) {
          const plan = proposeBudget(withTarget(ctx, target), method, '2026-11')
          expect(sum(plan)).toBe(target)
          expect(plan.total).toBe(target)
          expect(plan.categories.every((c) => c.limit > 0 && Number.isInteger(c.limit))).toBe(true)
          expect(plan.categories.every((c) => CATEGORIES[c.category].kind === 'need' || CATEGORIES[c.category].kind === 'want')).toBe(true)
          expect(plan.rationale).toBeTruthy()
        }
      }
    }
  })

  it('rounds to whole yuan, and to ¥10 steps from ¥500 (except the one category absorbing the remainder)', () => {
    const plan = proposeBudget(meiLike(), 'history', '2026-11')
    const offGrid = plan.categories.filter((c) => (c.limit >= yuan(500) ? c.limit % yuan(10) !== 0 : c.limit % yuan(1) !== 0))
    expect(offGrid.length).toBeLessThanOrEqual(1)
  })

  it('target 0 → an empty plan', () => {
    const plan = proposeBudget(withTarget(meiLike(), 0), 'history', '2026-11')
    expect(plan).toMatchObject({ total: 0, categories: [] })
  })

  it('stamps month, creator and time (from the sandbox day unless the controller passes now)', () => {
    expect(proposeBudget(meiLike(), 'history', '2026-11')).toMatchObject({ month: '2026-11', createdBy: 'agent', createdAt: '2026-10-22T00:00:00.000Z' })
    expect(proposeBudget(meiLike(), 'history', '2026-11', { now: '2026-10-22T09:30:00.000Z', createdBy: 'user' })).toMatchObject({ createdBy: 'user', createdAt: '2026-10-22T09:30:00.000Z' })
  })
})

describe('proposeBudget — history', () => {
  /** Jul–Sep: rent 4,200 + ¥100/day dining + ¥60/day delivery ≈ ¥9,100/month */
  const heavy = () =>
    makeCtx({
      today: '2026-10-22',
      txns: [
        ...monthly('Landlord', 'housing', 4_200, 1, ['2026-07', '2026-08', '2026-09']),
        ...daily('2026-07-01', '2026-09-30', 'Haidilao', 'dining', 100),
        ...daily('2026-07-01', '2026-09-30', 'Meituan Delivery', 'delivery', 60),
      ],
      profile: { targetSpend: yuan(7_000), monthlyIncome: yuan(12_000) },
    })

  it('uses the median of the last 3 complete months', () => {
    const med = historyMedians(heavy(), '2026-11')
    expect(med.get('housing')).toBe(yuan(4_200))
    expect(med.get('dining')).toBe(yuan(3_100))
    expect(med.get('delivery')).toBe(yuan(1_860))
  })

  it('protects needs and trims wants when history exceeds the target', () => {
    const plan = proposeBudget(heavy(), 'history', '2026-11')
    expect(plan.method).toBe('history')
    expect(limitOf(plan, 'housing')).toBe(yuan(4_200))
    const wants = (limitOf(plan, 'dining') ?? 0) + (limitOf(plan, 'delivery') ?? 0)
    expect(wants).toBe(yuan(2_800))
    expect(limitOf(plan, 'dining')! / limitOf(plan, 'delivery')!).toBeCloseTo(3_100 / 1_860, 1)
    expect(plan.rationale).toMatch(/needs kept at ¥4,200, wants trimmed \d+% to fit your ¥7,000 target/)
  })

  it('keeps bills as they are and shares slack across everyday categories', () => {
    const plan = proposeBudget(withTarget(heavy(), yuan(10_000)), 'history', '2026-11')
    expect(limitOf(plan, 'housing')).toBe(yuan(4_200))
    expect(limitOf(plan, 'dining')! + limitOf(plan, 'delivery')!).toBe(yuan(5_800))
  })

  it('covers needs only when essentials alone exceed the target', () => {
    const plan = proposeBudget(withTarget(heavy(), yuan(3_000)), 'history', '2026-11')
    expect(plan.categories.map((c) => c.category)).toEqual(['housing'])
    expect(plan.rationale).toContain('worth revisiting the target')
  })

  it('falls back to 50/30/20 when there is no history', () => {
    const plan = proposeBudget(makeCtx({ today: '2026-10-22', profile: { targetSpend: yuan(8_000), monthlyIncome: yuan(10_000) } }), 'history', '2026-11')
    expect(plan.method).toBe('fifty_thirty_twenty')
    expect(plan.rationale).toMatch(/^Not enough history yet, so using 50\/30\/20/)
  })

  it('ignores the current, unfinished month', () => {
    const ctx = makeCtx({ today: '2026-10-22', txns: daily('2026-10-01', '2026-10-22', 'Haidilao', 'dining', 100) })
    expect(historyMedians(ctx, '2026-11').size).toBe(0)
  })
})

describe('proposeBudget — 50/30/20 and custom', () => {
  it('splits the target 5:3 between needs and wants with default weights when there is no history', () => {
    const plan = proposeBudget(makeCtx({ today: '2026-10-22', profile: { targetSpend: yuan(8_000), monthlyIncome: yuan(10_000) } }), 'fifty_thirty_twenty', '2026-11')
    const needs = plan.categories.filter((c) => CATEGORIES[c.category].kind === 'need').reduce((s, c) => s + c.limit, 0)
    expect(needs).toBeGreaterThanOrEqual(yuan(4_990))
    expect(needs).toBeLessThanOrEqual(yuan(5_010))
    expect(limitOf(plan, 'housing')).toBeGreaterThan(limitOf(plan, 'groceries')!)
    expect(plan.rationale).toContain('¥2,000 (20%) of your ¥10,000 income stays free for your dreams')
  })

  it('never squeezes needs below their usual level', () => {
    const plan = proposeBudget(meiLike(), 'fifty_thirty_twenty', '2026-11')
    expect(limitOf(plan, 'housing')).toBeGreaterThanOrEqual(yuan(4_200))
  })

  it('custom rescales the existing plan to the target', () => {
    const ctx = meiLike()
    ctx.budget = { month: '2026-10', total: yuan(5_000), categories: [{ category: 'housing', limit: yuan(4_000) }, { category: 'dining', limit: yuan(1_000) }], method: 'custom', createdBy: 'user', createdAt: '2026-10-01T00:00:00Z' }
    const plan = proposeBudget(ctx, 'custom', '2026-11')
    expect(plan.method).toBe('custom')
    expect(limitOf(plan, 'housing')).toBe(yuan(7_600))
    expect(limitOf(plan, 'dining')).toBe(yuan(1_900))
  })
})
