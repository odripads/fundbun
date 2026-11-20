import { describe, expect, it } from 'vitest'
import type { FinanceContext } from '../types'
import { daily, makeCtx, makeDream, pot, potContributions, spend, yuan } from './__fixtures__'
import { mirrorStatus } from './mirror'
import { planFor, planImpact, planOptions, usualDaily } from './dailyplan'
import { summarizeMonth } from './summary'
import { bunTemper, dayLimitOf } from './temper'

/** ¥6,000 target, Oct 2026. Twenty days of ¥400 delivery: ¥8,000 by the 20th, ¥2,000 over. A laptop goal saving ¥1,000 a month. */
function overCtx(today = '2026-10-21'): FinanceContext {
  return makeCtx({
    today,
    txns: [...daily('2026-10-01', '2026-10-20', 'Meituan', 'delivery', 400), ...potContributions('pot_laptop', 1_000, 5, ['2026-07', '2026-08', '2026-09'])],
    accounts: [pot('laptop', 2_000)],
    dreams: [makeDream('laptop', 'Laptop', 8_000, 'goal', { targetDate: '2027-06-30' })],
    profile: { tone: 'cheeky', targetSpend: yuan(6_000) },
  })
}

describe('usualDaily', () => {
  it('averages day-to-day spending over the recent days, without rent or bills', () => {
    const ctx = makeCtx({ today: '2026-10-21', txns: [...daily('2026-10-01', '2026-10-20', 'Hema', 'groceries', 60), spend('2026-10-01', 'Landlord', 'housing', 3_000)] })
    // 20 days of ¥60 over the 21 days since the first purchase
    expect(usualDaily(ctx)).toBe(Math.round(yuan(1_200) / 21))
    expect(usualDaily(makeCtx({ today: '2026-10-21' }))).toBe(0)
  })
})

describe('planImpact — what a daily amount costs', () => {
  it('ends the month at spent + the amount for each day left, and says how far the goal moves', () => {
    const ctx = overCtx()
    const s = summarizeMonth(ctx)
    // Oct 21–31 is 11 days; ¥50 a day adds ¥550 to the ¥8,000 already spent
    const r = planImpact(ctx, s, yuan(50))
    expect(r).toMatchObject({ amount: yuan(50), days: 11, monthEnd: yuan(8_550), vsTarget: yuan(2_550) })
    expect(r.goal).toMatchObject({ name: 'Laptop', targetDate: '2027-06-30' })
    // ¥2,550 over at ¥1,000 a month is about 2.5 months of saving
    expect(r.goal!.delayDays).toBe(Math.round((yuan(2_550) / yuan(1_000)) * 30.4))
    expect(r.text).toMatch(/^At ¥50 a day, October ends around ¥8,550, ¥2,550 over your ¥6,000 target\. That moves your Laptop .+ further away/)
    // a bigger daily amount costs more
    expect(planImpact(ctx, s, yuan(150)).goal!.delayDays).toBeGreaterThan(r.goal!.delayDays)
  })

  it('a month still within target leaves the goal on schedule', () => {
    const ctx = makeCtx({ today: '2026-10-10', txns: daily('2026-10-01', '2026-10-09', 'Canteen', 'dining', 50), dreams: [makeDream('laptop', 'Laptop', 8_000, 'goal')], profile: { targetSpend: yuan(6_000) } })
    const r = planImpact(ctx, summarizeMonth(ctx), yuan(100))
    expect(r.vsTarget).toBeLessThan(0)
    expect(r.goal?.delayDays).toBe(0)
    expect(r.text).toMatch(/within your ¥6,000 target\. Your Laptop stays on schedule\.$/)
  })
})

describe('planOptions', () => {
  it('offers a few whole amounts, lowest first, around the usual day', () => {
    const ctx = overCtx()
    const s = summarizeMonth(ctx)
    const options = planOptions(ctx, s, dayLimitOf(ctx, s))
    expect(options.length).toBeGreaterThanOrEqual(2)
    expect(options.length).toBeLessThanOrEqual(4)
    expect([...options].sort((a, b) => a - b)).toEqual(options)
    for (const o of options) expect(o % yuan(10)).toBe(0)
    // the usual day here is ¥8,000 over 21 days (¥381): it is offered, and so is about half of it
    expect(options).toContain(yuan(380))
    expect(options).toContain(yuan(190))
  })
})

describe('the daily amount in Bun’s temper', () => {
  it('over budget with no amount: Bun asks for one', () => {
    const ctx = overCtx()
    const s = summarizeMonth(ctx)
    expect(bunTemper(ctx, s, mirrorStatus(s))).toMatchObject({ askPlan: true })
  })

  it('with an amount: it becomes the day limit, and good days are judged by it', () => {
    const plan = { month: '2026-10' as const, amount: yuan(80), setOn: '2026-10-21' }
    const ctx = { ...overCtx('2026-10-24'), dailyPlan: plan }
    ctx.bank.transactions = [...ctx.bank.transactions, spend('2026-10-21', 'Canteen', 'dining', 70), spend('2026-10-22', 'Canteen', 'dining', 75), spend('2026-10-23', 'Canteen', 'dining', 60)]
    const s = summarizeMonth(ctx)
    expect(dayLimitOf(ctx, s)).toBe(yuan(80))
    const t = bunTemper(ctx, s, mirrorStatus(s))
    expect(t).toMatchObject({ planned: true, dayLimit: yuan(80), goodDays: 3, cooling: true })
    expect(t.askPlan).toBeUndefined()
    expect(t.reason).toContain('within your ¥80 daily amount')
  })

  it('an amount from last month no longer applies', () => {
    expect(planFor({ dailyPlan: { month: '2026-09', amount: yuan(80), setOn: '2026-09-25' } }, '2026-10')).toBeUndefined()
  })
})
