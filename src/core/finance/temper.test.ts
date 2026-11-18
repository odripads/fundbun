import { describe, expect, it } from 'vitest'
import type { FinanceContext, Tone, Transaction, Tripwire } from '../types'
import { daily, makeCtx, spend, yuan } from './__fixtures__'
import { mirrorStatus } from './mirror'
import { summarizeMonth } from './summary'
import { BLOWOUT_DAYS, COOL_DOWN_DAYS, FURIOUS_OVER, bunTemper, dayLimitOf, moodOf, overShare } from './temper'

/** ¥6,000 target, October (31 days): with no fixed costs the day limit is ¥6,000 ÷ 31 = ¥193.55, kept as ¥194. */
function ctxOf(today: string, txns: Transaction[], tone: Tone = 'cheeky', tripwires: Tripwire[] = []): FinanceContext {
  return makeCtx({ today, txns, tripwires, profile: { tone, targetSpend: yuan(6_000) } })
}

function temperOf(ctx: FinanceContext) {
  const s = summarizeMonth(ctx)
  return { s, status: mirrorStatus(s), t: bunTemper(ctx, s, mirrorStatus(s)) }
}

const lunch = (date: string, amount: number) => spend(date, 'Canteen', 'dining', amount)
/** 20 days of ¥400: ¥8,000 by Oct 20, a third past the target. */
const wayOver = daily('2026-10-01', '2026-10-20', 'Meituan', 'delivery', 400)
/** 20 days of ¥310: ¥6,200 by Oct 20, 3% past the target. */
const justOver = daily('2026-10-01', '2026-10-20', 'Meituan', 'delivery', 310)

describe('dayLimitOf — the line a day is judged by', () => {
  it('is an even share of the target once fixed costs and bills still due are taken out', () => {
    const plain = ctxOf('2026-10-10', [lunch('2026-10-02', 30)])
    expect(dayLimitOf(plain, summarizeMonth(plain))).toBe(yuan(194))
    const rent = ctxOf('2026-10-10', [spend('2026-10-01', 'Landlord', 'housing', 3_000), lunch('2026-10-02', 30)])
    expect(dayLimitOf(rent, summarizeMonth(rent))).toBe(yuan(97))
  })

  it('is the user’s own daily tripwire when one is on', () => {
    const wire: Tripwire = { id: 'tw_day', kind: 'daily_over', threshold: yuan(150), enabled: true, createdBy: 'user', label: 'Days over ¥150' }
    const ctx = ctxOf('2026-10-10', [lunch('2026-10-02', 30)], 'cheeky', [wire])
    expect(dayLimitOf(ctx, summarizeMonth(ctx))).toBe(yuan(150))
    const off = ctxOf('2026-10-10', [lunch('2026-10-02', 30)], 'cheeky', [{ ...wire, enabled: false }])
    expect(dayLimitOf(off, summarizeMonth(off))).toBe(yuan(194))
  })
})

describe('bunTemper — the ladder', () => {
  it('the carrot: spending less than the target is happy, and a run of good days is named', () => {
    const { status, t } = temperOf(ctxOf('2026-10-21', daily('2026-10-01', '2026-10-20', 'Canteen', 'dining', 60)))
    expect(status).toBe('under')
    expect(t).toMatchObject({ heat: 0, mood: 'happy', goodDays: 20, cooling: false, blowout: false, overBy: 0 })
    expect(t.reason).toBe('20 days in a row within your ¥194 day limit, and you are spending less than your target.')
    expect(t.wayBack).toBeUndefined()
  })

  it('the stick: over budget is angry, and a fifth past it is furious', () => {
    const cross = temperOf(ctxOf('2026-10-20', justOver))
    expect(cross.status).toBe('over')
    expect(cross.t).toMatchObject({ heat: 3, mood: 'angry', goodDays: 0 })
    expect(cross.t.overBy).toBeLessThan(FURIOUS_OVER)
    const furious = temperOf(ctxOf('2026-10-20', wayOver))
    expect(furious.t).toMatchObject({ heat: 4, mood: 'furious' })
    expect(furious.t.overBy).toBeCloseTo(1 / 3, 2)
    expect(furious.t.reason).toBe('You are ¥2,000 over your ¥6,000 target, 33% past it.')
    expect(furious.t.wayBack).toBe('Log 2 days within ¥194 and Bun cools down a step.')
  })

  it('heading over is the raised stick: worried, with the daily amount that still lands on target', () => {
    const { status, t } = temperOf(ctxOf('2026-10-10', daily('2026-10-01', '2026-10-10', 'Meituan', 'delivery', 300)))
    expect(status).toBe('pace_over')
    expect(t).toMatchObject({ heat: 2, mood: 'worried' })
    expect(t.wayBack).toMatch(/^Keep to ¥\d+ a day and the month still lands on target\.$/)
  })

  it('the gentle tone softens the angry faces one step; the heat is the same', () => {
    expect(temperOf(ctxOf('2026-10-20', justOver, 'gentle')).t).toMatchObject({ heat: 3, mood: 'worried' })
    expect(temperOf(ctxOf('2026-10-20', wayOver, 'gentle')).t).toMatchObject({ heat: 4, mood: 'angry' })
    expect(temperOf(ctxOf('2026-10-20', wayOver, 'numbers')).t.mood).toBe('furious')
  })

  it('no spending at all: asleep', () => {
    const { t } = temperOf(ctxOf('2026-10-10', []))
    expect(t).toMatchObject({ mood: 'sleepy', goodDays: 0 })
  })
})

describe('bunTemper — good days cool Bun down', () => {
  it(`every ${COOL_DOWN_DAYS} logged days within the limit take a step off, down to worried`, () => {
    const two = temperOf(ctxOf('2026-10-23', [...wayOver, lunch('2026-10-21', 50), lunch('2026-10-22', 50)]))
    expect(two.t).toMatchObject({ heat: 3, mood: 'angry', goodDays: 2, cooling: true })
    expect(two.t.reason).toContain('2 days in a row within your ¥194 day limit calmed Bun down.')
    const four = temperOf(ctxOf('2026-10-25', [...wayOver, ...daily('2026-10-21', '2026-10-24', 'Canteen', 'dining', 50)]))
    expect(four.t).toMatchObject({ heat: 2, mood: 'worried', goodDays: 4, cooling: true })
    // the month is still over: good days never take Bun below worried
    const six = temperOf(ctxOf('2026-10-27', [...wayOver, ...daily('2026-10-21', '2026-10-26', 'Canteen', 'dining', 50)]))
    expect(six.t).toMatchObject({ heat: 2, mood: 'worried', goodDays: 6 })
    expect(six.t.wayBack).toBe('Keep it within ¥194 a day. Every day you do counts in your favour.')
  })

  it('one good day is not enough yet, and the way back says how many more', () => {
    const { t } = temperOf(ctxOf('2026-10-22', [...wayOver, lunch('2026-10-21', 50)]))
    expect(t).toMatchObject({ heat: 4, goodDays: 1, cooling: false })
    expect(t.wayBack).toBe('Log 1 day within ¥194 and Bun cools down a step.')
  })

  it('going quiet never calms Bun: a day with nothing logged is skipped, not rewarded', () => {
    const { t } = temperOf(ctxOf('2026-10-23', wayOver))
    expect(t).toMatchObject({ heat: 4, mood: 'furious', goodDays: 0, cooling: false })
  })

  it('a short gap is skipped, a three-day gap ends the streak', () => {
    const good = daily('2026-10-10', '2026-10-12', 'Canteen', 'dining', 50)
    expect(temperOf(ctxOf('2026-10-15', good)).t.goodDays).toBe(3)
    expect(temperOf(ctxOf('2026-10-16', good)).t.goodDays).toBe(0)
  })

  it('going over the limit today breaks the streak at once', () => {
    const run = daily('2026-10-10', '2026-10-14', 'Canteen', 'dining', 50)
    expect(temperOf(ctxOf('2026-10-15', run)).t.goodDays).toBe(5)
    expect(temperOf(ctxOf('2026-10-15', [...run, lunch('2026-10-15', 250)])).t.goodDays).toBe(0)
  })

  it('rent and other fixed costs are not day-to-day spending: they neither break a streak nor blow a day', () => {
    const txns = [spend('2026-10-11', 'Landlord', 'housing', 3_000), lunch('2026-10-10', 40), lunch('2026-10-12', 40)]
    const { t } = temperOf(ctxOf('2026-10-13', txns))
    expect(t.goodDays).toBe(3)
  })
})

describe('bunTemper — a blowout heats Bun up now', () => {
  it(`today alone at ${BLOWOUT_DAYS} times the day limit adds a step while the month is over, and blocks cooling`, () => {
    const before = temperOf(ctxOf('2026-10-21', justOver))
    expect(before.t).toMatchObject({ heat: 3, blowout: false })
    const after = temperOf(ctxOf('2026-10-21', [...justOver, spend('2026-10-21', 'Nike', 'shopping', 600)]))
    expect(after.t).toMatchObject({ heat: 4, mood: 'furious', blowout: true, cooling: false, spentToday: yuan(600) })
    expect(after.t.reason).toContain('Today alone is ¥600, 3 times your ¥194 day limit.')
  })

  it('a big day in a month that is fine changes nothing: the month is what counts', () => {
    const { status, t } = temperOf(ctxOf('2026-10-21', [...daily('2026-10-01', '2026-10-20', 'Canteen', 'dining', 60), spend('2026-10-21', 'Nike', 'shopping', 600)]))
    expect(status).not.toBe('over')
    expect(t.blowout).toBe(false)
    expect(t.heat).toBeLessThanOrEqual(2)
  })
})

describe('bunTemper — a finished month keeps its verdict', () => {
  it('no cooling and no blowout once the month is closed', () => {
    const ctx = ctxOf('2026-11-03', [...wayOver, ...daily('2026-10-21', '2026-10-31', 'Canteen', 'dining', 50)])
    const s = summarizeMonth(ctx, '2026-10')
    const t = bunTemper(ctx, s, mirrorStatus(s))
    expect(t).toMatchObject({ heat: 4, mood: 'furious', cooling: false, blowout: false, goodDays: 11 })
    expect(t.wayBack).toBe('That month is closed. A new month starts clean.')
  })
})

describe('moodOf / overShare — the ladder from a verdict alone', () => {
  it('maps a verdict to a face', () => {
    expect(moodOf('under', 'cheeky')).toBe('happy')
    expect(moodOf('on_track', 'cheeky')).toBe('calm')
    expect(moodOf('pace_over', 'cheeky')).toBe('worried')
    expect(moodOf('over', 'cheeky')).toBe('angry')
    expect(moodOf('over', 'cheeky', FURIOUS_OVER)).toBe('furious')
    expect(moodOf('over', 'gentle', 0.5)).toBe('angry')
    expect(moodOf('no_data', 'cheeky')).toBe('sleepy')
  })

  it('overShare is the part of the target already overspent', () => {
    expect(overShare(yuan(7_200), yuan(6_000))).toBeCloseTo(0.2)
    expect(overShare(yuan(5_000), yuan(6_000))).toBe(0)
    expect(overShare(yuan(100), 0)).toBe(0)
  })
})
