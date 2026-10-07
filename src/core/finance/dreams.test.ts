import { describe, expect, it } from 'vitest'
import { checking, makeCtx, makeDream, makeProfile, MEI_DREAMS, pot, potContributions, yuan } from './__fixtures__'
import { allGoalProgress, dreamEquivalents, goalDelayDays, goalEquivalent, goalProgress, hoursOfWork, primaryGoal } from './dreams'

const birkin = MEI_DREAMS[0]

describe('primaryGoal', () => {
  it('is the first open goal', () => {
    expect(primaryGoal(MEI_DREAMS)?.id).toBe('dream_birkin')
    expect(primaryGoal([MEI_DREAMS[2], MEI_DREAMS[1], MEI_DREAMS[0]])?.id).toBe('dream_chengdu')
  })

  it('skips achieved goals and falls back to the most expensive item', () => {
    const achieved = { ...birkin, achievedAt: '2026-10-01' }
    expect(primaryGoal([achieved, MEI_DREAMS[1]])?.id).toBe('dream_chengdu')
    expect(primaryGoal([MEI_DREAMS[3], MEI_DREAMS[2]])?.id).toBe('dream_airpods')
    expect(primaryGoal([])).toBeUndefined()
  })
})

describe('goalProgress', () => {
  const months = ['2026-07', '2026-08', '2026-09', '2026-10']
  const ctx = makeCtx({
    today: '2026-10-22',
    txns: [...potContributions('pot_dream_birkin', 2_000, 10, ['2026-07']), ...potContributions('pot_dream_birkin', 2_300, 10, months.slice(1))],
    accounts: [checking(5_000), pot('dream_birkin', 23_400)],
    dreams: MEI_DREAMS,
  })

  it('reads the pot balance and averages net inflow over the last 3 complete months', () => {
    const g = goalProgress(birkin, ctx)
    expect(g).toMatchObject({ itemId: 'dream_birkin', name: 'Birkin 25', saved: yuan(23_400), price: yuan(98_000), pct: 23.9 })
    expect(g.monthlyRate).toBe(Math.round((yuan(2_000) + yuan(2_300) + yuan(2_300)) / 3))
    expect(g.etaMonths).toBeCloseTo((98_000 - 23_400) / 2_200, 1)
    expect(g.etaDate! > '2029-01-01').toBe(true)
  })

  it('nets withdrawals and only averages months since the pot started', () => {
    const fresh = makeCtx({
      today: '2026-10-22',
      txns: [
        ...potContributions('pot_dream_birkin', 1_000, 10, ['2026-09']),
        { ...potContributions('pot_dream_birkin', 400, 12, ['2026-09'])[1], amount: -yuan(400) },
      ],
      accounts: [pot('dream_birkin', 600)],
      dreams: [{ ...birkin, createdAt: '2026-09-01' }],
    })
    expect(goalProgress(fresh.dreams[0], fresh).monthlyRate).toBe(yuan(600))
  })

  it("uses this month's inflow when the pot is brand new", () => {
    const fresh = makeCtx({
      today: '2026-10-22',
      txns: potContributions('pot_dream_birkin', 500, 12, ['2026-10']),
      accounts: [pot('dream_birkin', 500)],
      dreams: [{ ...birkin, createdAt: '2026-10-12' }],
    })
    expect(goalProgress(fresh.dreams[0], fresh).monthlyRate).toBe(yuan(500))
  })

  it('handles a goal without a pot, and a fully funded goal', () => {
    const none = goalProgress(MEI_DREAMS[1], ctx)
    expect(none).toMatchObject({ saved: 0, pct: 0, monthlyRate: 0 })
    expect(none.etaDate).toBeUndefined()
    const done = makeCtx({ today: '2026-10-22', accounts: [pot('dream_chengdu', 2_500)], dreams: MEI_DREAMS })
    expect(goalProgress(MEI_DREAMS[1], done)).toMatchObject({ pct: 100, etaMonths: 0, etaDate: '2026-10-22' })
  })

  it('finds pots by potAccountId, goalId or the pot_<id> convention', () => {
    const a = makeCtx({ today: '2026-10-22', accounts: [{ ...pot('x', 100), id: 'custom_pot', goalId: 'dream_chengdu' }] })
    expect(goalProgress(MEI_DREAMS[1], a).saved).toBe(yuan(100))
  })

  it('allGoalProgress lists open goals, then treats, then achieved items', () => {
    const dreams = [MEI_DREAMS[2], { ...MEI_DREAMS[1], achievedAt: '2026-09-01' }, MEI_DREAMS[0], MEI_DREAMS[3]]
    const out = allGoalProgress({ ...ctx, dreams })
    expect(out.map((g) => g.itemId)).toEqual(['dream_birkin', 'dream_airpods', 'dream_shoes', 'dream_chengdu'])
  })
})

describe('dreamEquivalents', () => {
  it('lists whole items first (largest first), then the primary goal as a fraction', () => {
    const out = dreamEquivalents(yuan(2_830), MEI_DREAMS)
    expect(out.map((e) => e.label)).toEqual(['a Weekend in Chengdu', 'AirPods Pro', '3× New running shoes'])
    expect(out[0]).toMatchObject({ itemId: 'dream_chengdu', image: 'preset:plane', fraction: 1.1792 })
  })

  it('expresses small amounts against the primary goal', () => {
    const [first, ...rest] = dreamEquivalents(yuan(1_299), MEI_DREAMS, 3)
    expect(first.label).toBe('New running shoes')
    expect(rest[0].label).toBe('1.3% of your Birkin 25')
    expect(dreamEquivalents(yuan(500), MEI_DREAMS, 1)[0].label).toBe('0.5% of your Birkin 25')
    expect(dreamEquivalents(yuan(40_000), MEI_DREAMS, 4).map((e) => e.label)).toContain('41% of your Birkin 25')
  })

  it('labels multiples', () => {
    expect(dreamEquivalents(yuan(1_800), [MEI_DREAMS[3]])[0]).toMatchObject({ label: '2× New running shoes', fraction: 2.0022 })
  })

  it('respects max, skips achieved items and returns nothing for non-positive amounts', () => {
    expect(dreamEquivalents(yuan(100_000), MEI_DREAMS, 2)).toHaveLength(2)
    expect(dreamEquivalents(yuan(3_000), [{ ...MEI_DREAMS[1], achievedAt: '2026-01-01' }])).toEqual([])
    expect(dreamEquivalents(0, MEI_DREAMS)).toEqual([])
    expect(dreamEquivalents(-500, MEI_DREAMS)).toEqual([])
    expect(dreamEquivalents(yuan(100), [])).toEqual([])
  })
})

describe('goalEquivalent', () => {
  it('prefers the primary goal ("That ¥1,299 = 1.3% of your Birkin")', () => {
    expect(goalEquivalent(yuan(1_299), MEI_DREAMS)?.label).toBe('1.3% of your Birkin 25')
    expect(goalEquivalent(yuan(120_000), MEI_DREAMS)?.label).toBe('a Birkin 25')
    expect(goalEquivalent(0, MEI_DREAMS)).toBeUndefined()
  })
})

describe('goalDelayDays', () => {
  const g = { itemId: 'g', name: 'G', saved: 0, price: yuan(10_000), pct: 0, monthlyRate: yuan(2_200) }
  it('round(amount / monthlyRate × 30.4)', () => {
    expect(goalDelayDays(yuan(2_830), g, yuan(1_850))).toBe(Math.round((2_830 / 2_200) * 30.4))
  })
  it('falls back to the given rate, and is 0 without any rate or amount', () => {
    expect(goalDelayDays(yuan(1_850), { ...g, monthlyRate: 0 }, yuan(1_850))).toBe(30)
    expect(goalDelayDays(yuan(1_000), { ...g, monthlyRate: 0 }, 0)).toBe(0)
    expect(goalDelayDays(0, g, yuan(1))).toBe(0)
  })
})

describe('hoursOfWork', () => {
  it('amount ÷ hourly income, one decimal', () => {
    expect(hoursOfWork(yuan(1_299), makeProfile({ monthlyIncome: yuan(18_500), workHoursPerMonth: 174 }))).toBe(12.2)
  })
  it('defaults the work hours and handles zero income', () => {
    expect(hoursOfWork(yuan(174), makeProfile({ monthlyIncome: yuan(1_740), workHoursPerMonth: 0 }))).toBe(17.4)
    expect(hoursOfWork(yuan(100), makeProfile({ monthlyIncome: 0 }))).toBe(0)
  })
})

describe('fixtures sanity', () => {
  it('dream prices are integer minor units', () => {
    for (const d of [...MEI_DREAMS, makeDream('x', 'X', 0.1, 'treat')]) expect(Number.isInteger(d.price)).toBe(true)
  })
})
