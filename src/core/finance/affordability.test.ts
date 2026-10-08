import { describe, expect, it } from 'vitest'
import type { FinanceContext } from '../types'
import { arifLike, checking, daily, makeBill, makeCtx, MEI_DREAMS, meiLike, monthly, spend, yuan } from './__fixtures__'
import { checkAffordability } from './affordability'
import { delayShort } from './copy'
import { computeMirror } from './mirror'
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

  it("'skip' when the month would end clearly over target (beyond the mirror's 5% band)", () => {
    const r = checkAffordability(ctx(), yuan(2_300))
    expect(r).toMatchObject({ verdict: 'skip', overTargetBy: yuan(400), projectedAfter: yuan(5_400), basis: 'projection' })
    expect(r.reasons[0]).toBe('With this, the month would end around ¥5,400 — ¥400 over your ¥5,000 target.')
  })

  it("'think' (not skip) when it lands within the mirror's 5% band — the mirror would still say on track", () => {
    const r = checkAffordability(ctx(), yuan(2_000))
    expect(r).toMatchObject({ verdict: 'think', overTargetBy: yuan(100) })
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
    expect(r.reasons[0]).toMatch(/^You're already ¥[\d,]+ over your ¥9,500 target this month\.$/)
  })

  describe('F27: one verdict rule with the Dream Mirror', () => {
    /** 1 Nov: an October at ~¥9,000 behind, ¥120 spent today, rent ¥4,200 due today → projection ≈ target + 20% */
    function newMonth(): FinanceContext {
      return makeCtx({
        today: '2026-11-01',
        txns: [
          ...monthly('Landlord', 'housing', 4_200, 1, ['2026-08', '2026-09', '2026-10'], { billId: 'x' }),
          ...daily('2026-08-01', '2026-10-31', 'Canteen', 'dining', 200),
          spend('2026-11-01', 'Canteen', 'dining', 120),
        ],
        bills: [makeBill({ id: 'bill_rent_2026-11', name: 'Rent', category: 'housing', amountDue: yuan(4_200), dueDate: '2026-11-01', period: '2026-11' })],
        accounts: [checking(30_000)],
        dreams: MEI_DREAMS,
        profile: { targetSpend: yuan(9_500), monthlyIncome: yuan(18_500) },
      })
    }

    it('in the first days the mirror has no pace verdict, so a small purchase is judged on spent + bills, not the projection', () => {
      const c = newMonth()
      const s = summarizeMonth(c)
      // the projection runs > 5% over the target, but on day 1 the mirror (rightly) gives no pace verdict
      expect(s.projected).toBeGreaterThan(yuan(9_500) * 1.05)
      expect(computeMirror(c).status).toBe('on_track')
      const r = checkAffordability(c, yuan(20), 'coffee', 'coffee_tea')
      expect(r.verdict).toBe('go')
      expect(r).toMatchObject({ basis: 'spent_and_bills', projectedAfter: s.spent + yuan(4_200) + yuan(20) })
      expect(r.reasons.join(' ')).not.toMatch(/on pace to end the month/)
    })

    it('a purchase within today\'s safe-to-spend is never a skip just because the pace runs hot', () => {
      const c = meiLike()
      // Mei is over already → skip regardless; take an under-target month that paces over instead
      const hot = makeCtx({
        today: '2026-10-12',
        txns: [...daily('2026-07-01', '2026-09-30', 'Canteen', 'dining', 400), ...daily('2026-10-01', '2026-10-12', 'Canteen', 'dining', 380)],
        accounts: [checking(50_000)],
        dreams: MEI_DREAMS,
        profile: { targetSpend: yuan(10_000), monthlyIncome: yuan(18_500) },
      })
      expect(computeMirror(hot).status).toBe('pace_over')
      const s = summarizeMonth(hot)
      expect(s.safeToSpendToday).toBeGreaterThan(yuan(20))
      const small = checkAffordability(hot, yuan(20))
      expect(small.verdict).toBe('think')
      expect(small.reasons[0]).toMatch(/fits today's safe-to-spend, so it's your call/)
      expect(checkAffordability(hot, s.safeToSpendToday + yuan(100)).verdict).toBe('skip')
      expect(checkAffordability(c, yuan(20)).verdict).toBe('skip')
    })

    it('delay text uses the one short form', () => {
      const r = checkAffordability(meiLike(), yuan(1_899), 'AirPods')
      expect(r.delayText).toBe('4 wks')
      expect(delayShort(9)).toBe('9 days')
      expect(delayShort(18)).toBe('3 wks')
      expect(delayShort(120)).toBe('4 mo')
    })
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
