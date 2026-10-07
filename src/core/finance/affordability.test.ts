import { describe, expect, it } from 'vitest'
import type { FinanceContext } from '../types'
import { arifLike, checking, daily, makeCtx, MEI_DREAMS, meiLike, yuan } from './__fixtures__'
import { checkAffordability } from './affordability'
import { summarizeMonth } from './summary'

/** day 10, ¥100/day, no history → projected ¥3,100 against a ¥5,000 target (¥1,900 headroom, 10% = ¥500) */
function ctx(balance = 20_000): FinanceContext {
  return makeCtx({
    today: '2026-10-10',
    txns: daily('2026-10-01', '2026-10-10', 'Canteen', 'dining', 100),
    accounts: [checking(balance)],
    dreams: MEI_DREAMS,
    profile: { targetSpend: yuan(5_000), monthlyIncome: yuan(17_400), workHoursPerMonth: 174 },
  })
}

describe('checkAffordability', () => {
  it("'go' when it fits with >= 10% headroom", () => {
    const r = checkAffordability(ctx(), yuan(1_000), 'a jacket')
    expect(r).toMatchObject({ verdict: 'go', amount: yuan(1_000), label: 'a jacket', overTargetBy: 0, remainingAfter: yuan(3_000), hoursOfWork: 10 })
    expect(r.safeToSpendToday).toBe(summarizeMonth(ctx()).safeToSpendToday)
    expect(r.reasons[0]).toBe("With this, you'd finish around ¥4,100, leaving ¥900 of your ¥5,000 target.")
  })

  it("'think' when it leaves less than 10% headroom", () => {
    const r = checkAffordability(ctx(), yuan(1_600))
    expect(r.verdict).toBe('think')
    expect(r.reasons[0]).toContain('a thin cushion')
  })

  it("'think' when it breaches a category budget", () => {
    const c = ctx()
    c.budget = { month: '2026-10', total: yuan(500), categories: [{ category: 'shopping', limit: yuan(500) }], method: 'custom', createdBy: 'user', createdAt: '2026-10-01T00:00:00Z' }
    const r = checkAffordability(c, yuan(800), 'shoes', 'shopping')
    expect(r.verdict).toBe('think')
    expect(r.reasons).toContain('Shopping would reach ¥800 of its ¥500 budget.')
    expect(checkAffordability(c, yuan(400), 'socks', 'shopping').verdict).toBe('go')
  })

  it("'skip' when the month would end over target", () => {
    const r = checkAffordability(ctx(), yuan(2_000))
    expect(r).toMatchObject({ verdict: 'skip', overTargetBy: yuan(100) })
    expect(r.reasons[0]).toBe('With this, the month would end around ¥5,100 — ¥100 over your ¥5,000 target.')
  })

  it("'skip' when checking can't cover it, whatever the budget says", () => {
    const r = checkAffordability(ctx(500), yuan(800))
    expect(r.verdict).toBe('skip')
    expect(r.reasons[0]).toBe("Your checking balance (¥500) doesn't cover ¥800.")
  })

  it('an already-over month is a gentle skip for any purchase', () => {
    const r = checkAffordability(meiLike(), yuan(89))
    expect(r.verdict).toBe('skip')
    expect(r.reasons[0]).toMatch(/^You're already on pace to end the month ¥[\d,]+ over your ¥9,500 target\.$/)
  })

  it('includes goal delay, hours of work and dream equivalents', () => {
    const r = checkAffordability(meiLike(), yuan(1_899), 'AirPods')
    expect(r.goalName).toBe('Birkin 25')
    expect(r.goalDelayDays).toBe(Math.round((1_899 / 2_200) * 30.4))
    expect(r.hoursOfWork).toBe(17.9)
    expect(r.equivalents.map((e) => e.label)).toEqual(['AirPods Pro', '2× New running shoes', '1.9% of your Birkin 25'])
    expect(r.reasons).toContain('It pushes your Birkin 25 back about 4 weeks.')
  })

  it('uses 10% of income as the saving rate when the goal has none yet', () => {
    const r = checkAffordability(ctx(), yuan(1_740))
    expect(r.goalDelayDays).toBe(Math.round((1_740 / 1_740) * 30.4))
  })

  it('a zero amount is trivially fine; reasons never contain broken numbers', () => {
    expect(checkAffordability(ctx(), 0)).toMatchObject({ verdict: 'go', equivalents: [], hoursOfWork: 0 })
    for (const c of [ctx(), meiLike(), arifLike()]) {
      for (const amount of [1, yuan(50), yuan(5_000), yuan(100_000)]) {
        const r = checkAffordability(c, amount)
        expect(r.reasons.length).toBeGreaterThan(0)
        expect(r.reasons.join(' ')).not.toMatch(/undefined|NaN/)
      }
    }
  })
})
