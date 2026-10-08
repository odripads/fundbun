import { describe, expect, it } from 'vitest'
import { addDays, isWeekend } from '../dates'
import type { BudgetPlan, CategoryId, FinanceContext, Insight, Transaction } from '../types'
import { arifLike, daily, makeCtx, MEI_DREAMS, meiLike, spend, yuan } from './__fixtures__'
import { generateInsights } from './insights'

const byKind = (xs: Insight[], kind: Insight['kind']) => xs.find((x) => x.kind === kind)

function expectWellFormed(xs: Insight[]) {
  expect(xs.length).toBeLessThanOrEqual(8)
  expect(new Set(xs.map((x) => x.id)).size).toBe(xs.length)
  for (const x of xs) {
    expect(x.title.length).toBeGreaterThan(3)
    expect(x.why.length).toBeGreaterThan(10)
    expect(Object.keys(x.evidence).length).toBeGreaterThan(0)
    expect(`${x.title} ${x.body} ${x.why}`).not.toMatch(/undefined|NaN|\[object/)
    if (x.suggestedAction) expect(['transfer_to_goal', 'create_tripwire', 'set_category_budget', 'list_recurring']).toContain(x.suggestedAction.tool)
  }
}

describe('generateInsights — over-target month (Mei-like)', () => {
  const xs = generateInsights(meiLike())

  it('leads with the pace warning and stays within 8 well-formed insights', () => {
    expectWellFormed(xs)
    expect(xs[0].kind).toBe('pace_warning')
    expect(xs[0]).toMatchObject({ severity: 'warn' })
    expect(xs[0].suggestedAction).toMatchObject({ tool: 'create_tripwire', args: { kind: 'daily_over' } })
  })

  it('spots late-night delivery with evidence and a dream equivalent', () => {
    const x = byKind(xs, 'late_night')!
    expect(x.body).toContain('22 purchases between 10pm and 4am, mostly food delivery')
    expect(x.evidence).toMatchObject({ count: 22, total: yuan(3_520), topCategory: 'delivery' })
    expect(x.dream?.itemId).toBe('dream_birkin')
    expect(x.suggestedAction).toMatchObject({ tool: 'set_category_budget', args: { category: 'delivery' } })
  })

  it('flags categories that jumped vs the same point last month', () => {
    const x = xs.find((i) => i.kind === 'category_up' && i.category === 'delivery')!
    expect(x.evidence).toMatchObject({ thisMonth: yuan(3_520), comparedWith: 0 })
    expect(x.why).toContain('at least 20%')
  })

  it('counts the subscription load', () => {
    const x = byKind(xs, 'subscription_load')!
    expect(x.title).toBe('5 subscriptions = ¥5,988/year')
    expect(x.suggestedAction?.tool).toBe('list_recurring')
  })

  it('every insight with an amount carries a dream equivalent', () => {
    for (const x of xs) if (x.amount && x.amount > 0) expect(x.dream).toBeDefined()
  })

  it('copy follows the tone', () => {
    const gentle = byKind(generateInsights(meiLike('gentle')), 'late_night')!.title
    const cheeky = byKind(generateInsights(meiLike('cheeky')), 'late_night')!.title
    expect(gentle).toBe('Late-night spending: ¥3,520')
    expect(cheeky).toBe('The midnight snack tax: ¥3,520')
  })
})

describe('generateInsights — under-target month (Arif-like)', () => {
  const xs = generateInsights(arifLike())

  it('celebrates the surplus and suggests stashing it', () => {
    expectWellFormed(xs)
    const x = byKind(xs, 'under_budget')!
    expect(x.severity).toBe('positive')
    expect(x.body).toContain('Stash it and your MacBook Air gets')
    expect(x.suggestedAction).toMatchObject({ tool: 'transfer_to_goal', args: { goalId: 'dream_macbook' } })
    expect(xs.some((i) => i.kind === 'pace_warning')).toBe(false)
  })

  it('finds the latte factor', () => {
    const x = byKind(xs, 'small_frequent')!
    expect(x.evidence).toMatchObject({ count: 22, total: yuan(330), topCategory: 'coffee_tea' })
    expect(x.body).toContain('a year')
  })

  it('reports the savings rate', () => {
    const x = byKind(xs, 'savings_rate')!
    expect(x.evidence).toMatchObject({ saved: yuan(600), income: yuan(3_500), ratePct: 17 })
    expect(x.severity).toBe('positive')
  })
})

describe('generateInsights — specific detectors', () => {
  it('anomaly: a one-off far above the usual', () => {
    const history = [30, 45, 60, 80, 95, 120, 70, 55].map((a, i) => spend(addDays('2026-08-01', i * 9), 'Taobao', 'shopping', a))
    const big = spend('2026-10-18', 'Taobao', 'shopping', 1_299)
    const xs = generateInsights(makeCtx({ today: '2026-10-22', txns: [...history, big], dreams: MEI_DREAMS }))
    const x = byKind(xs, 'anomaly')!
    expect(x.title).toBe('Unusual: ¥1,299 at Taobao')
    expect(x.why).toMatch(/Robust z-score [\d.]+ \(> 3\.5\)/)
    expect(x.evidence.txnId).toBe(big.id)
    expect(x.dream?.label).toBe('1.3% of your Birkin 25')
  })

  it('category_down when spending drops vs the same days last month', () => {
    const txns = [...daily('2026-09-01', '2026-09-30', 'Haidilao', 'dining', 100), ...daily('2026-10-01', '2026-10-22', 'Haidilao', 'dining', 40)]
    const x = byKind(generateInsights(makeCtx({ today: '2026-10-22', txns, dreams: MEI_DREAMS })), 'category_down')!
    expect(x).toMatchObject({ severity: 'positive', category: 'dining', amount: yuan(1_320) })
    expect(x.title).toBe('Eating out down 60%')
  })

  it('weekend_spike when weekends run far above weekdays', () => {
    const txns: Transaction[] = []
    for (let d = '2026-10-01'; d <= '2026-10-22'; d = addDays(d, 1)) txns.push(spend(d, 'Mall', 'shopping', isWeekend(d) ? 300 : 50))
    const x = byKind(generateInsights(makeCtx({ today: '2026-10-22', txns, dreams: MEI_DREAMS })), 'weekend_spike')!
    expect(x.evidence).toMatchObject({ weekendDays: 6, weekdays: 16, ratio: 6 })
    expect(x.title).toBe('Weekends cost 6× more')
  })

  it('past months skip live-only insights', () => {
    const xs = generateInsights(meiLike(), '2026-09')
    expect(xs.some((x) => x.kind === 'subscription_load' || x.kind === 'pace_warning')).toBe(false)
    expect(xs.every((x) => x.id.includes('2026-09'))).toBe(true)
  })

  it('no data → no insights', () => {
    expect(generateInsights(makeCtx({ today: '2026-10-22' }))).toEqual([])
  })
})

describe('generateInsights — suggested caps never loosen a budget', () => {
  const budget = (limits: Partial<Record<CategoryId, number>>): BudgetPlan => ({
    month: '2026-10',
    total: yuan(9_500),
    categories: Object.entries(limits).map(([category, limit]) => ({ category: category as CategoryId, limit: yuan(limit!) })),
    method: 'custom',
    createdBy: 'user',
    createdAt: '2026-10-01T09:00:00.000Z',
  })
  const caps = (ctx: FinanceContext) =>
    generateInsights(ctx)
      .filter((x) => x.suggestedAction?.tool === 'set_category_budget')
      .map((x) => ({ kind: x.kind, category: x.suggestedAction!.args.category as CategoryId, limit: x.suggestedAction!.args.limit as number, label: x.suggestedAction!.label }))

  it('with a small budget, category_up and late_night caps sit 10% under the current limit (not above it)', () => {
    const ctx = { ...meiLike(), budget: budget({ delivery: 520, shopping: 520, dining: 520 }) }
    const out = caps(ctx)
    expect(out.length).toBeGreaterThan(0)
    for (const c of out) {
      const current = ctx.budget!.categories.find((b) => b.category === c.category)!.limit
      expect(c.limit).toBeLessThan(current)
      expect(c.limit).toBe(yuan(460))
      expect(c.label).toMatch(/at ¥460$/)
    }
    expect(out.map((c) => c.kind)).toEqual(expect.arrayContaining(['late_night']))
  })

  it('every suggested cap on the Mei-like month is below its existing limit, whatever the budget', () => {
    for (const limit of [100, 520, 1_500, 5_000]) {
      const ctx = { ...meiLike(), budget: budget({ delivery: limit, shopping: limit, dining: limit, entertainment: limit, coffee_tea: limit }) }
      for (const c of caps(ctx)) expect(c.limit).toBeLessThan(yuan(limit))
    }
  })

  it('a limit too small to tighten gets no cap suggestion rather than a looser one', () => {
    const ctx = { ...meiLike(), budget: budget({ delivery: 5 }) }
    const late = generateInsights(ctx).find((x) => x.kind === 'late_night')!
    expect(late.suggestedAction).toBeUndefined()
  })

  it('without a budget the cap is ~15% under last month\'s spend in that category (this month\'s when new)', () => {
    const late = (sep: number) => {
      const txns: Transaction[] = [
        ...(sep > 0 ? [spend('2026-09-12', 'Meituan', 'delivery', sep, { time: '19:00' })] : []),
        ...[3, 6, 9, 12].map((d) => spend(`2026-10-${String(d).padStart(2, '0')}`, 'Meituan', 'delivery', 200, { time: '23:40' })),
      ]
      return generateInsights(makeCtx({ today: '2026-10-22', txns })).find((x) => x.kind === 'late_night')!.suggestedAction!.args
    }
    expect(late(1_000)).toEqual({ category: 'delivery', limit: yuan(850) })
    expect(late(0)).toEqual({ category: 'delivery', limit: yuan(680) })
  })
})
