import { describe, expect, it } from 'vitest'
import type { CheckIns } from '../types'
import { daily, makeCtx, spend, yuan } from './__fixtures__'
import { CHECKIN_CARD_DAYS, checkInStreak, checkInView, recordCheckIn } from './checkin'
import { mirrorStatus } from './mirror'
import { summarizeMonth } from './summary'
import { bunTemper } from './temper'

const days = (...d: string[]): CheckIns => ({ days: d, best: 0, golden: 0 })

describe('checkInStreak — days in a row', () => {
  it('runs through today once checked in, and through yesterday while today is still open', () => {
    expect(checkInStreak(['2026-10-20', '2026-10-21', '2026-10-22'], '2026-10-22')).toBe(3)
    expect(checkInStreak(['2026-10-20', '2026-10-21'], '2026-10-22')).toBe(2)
  })

  it('a missed day ends it', () => {
    expect(checkInStreak(['2026-10-18', '2026-10-19'], '2026-10-22')).toBe(0)
    expect(checkInStreak(['2026-10-18', '2026-10-19', '2026-10-21', '2026-10-22'], '2026-10-22')).toBe(2)
    expect(checkInStreak([], '2026-10-22')).toBe(0)
  })
})

describe('checkInView — the seven-day card', () => {
  it('a new user: day 1 is open, nothing stamped', () => {
    const v = checkInView(undefined, '2026-10-22')
    expect(v).toMatchObject({ done: false, streak: 0, next: 1, best: 0, golden: 0 })
    expect(v.card.map((s) => s.state)).toEqual(['today', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead'])
    expect(v.card.filter((s) => s.golden).map((s) => s.day)).toEqual([CHECKIN_CARD_DAYS])
  })

  it('a four-day streak: four stamps, day 5 open; after checking in, five stamps', () => {
    const open = checkInView(days('2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'), '2026-10-22')
    expect(open).toMatchObject({ done: false, streak: 4, next: 5 })
    expect(open.card.map((s) => s.state)).toEqual(['stamped', 'stamped', 'stamped', 'stamped', 'today', 'ahead', 'ahead'])
    const done = checkInView(days('2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'), '2026-10-22')
    expect(done).toMatchObject({ done: true, streak: 5, next: 5, best: 5 })
    expect(done.card.map((s) => s.state)).toEqual(['stamped', 'stamped', 'stamped', 'stamped', 'stamped', 'ahead', 'ahead'])
  })

  it('the card starts over after the seventh day', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `2026-10-${String(15 + i).padStart(2, '0')}`)
    const v = checkInView(days(...eight), '2026-10-22')
    expect(v).toMatchObject({ done: true, streak: 8 })
    expect(v.card.map((s) => s.state)).toEqual(['stamped', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead'])
  })

  it('a broken streak starts at day 1 again, and the best one is remembered', () => {
    const v = checkInView({ days: ['2026-10-10', '2026-10-11', '2026-10-12'], best: 3, golden: 0 }, '2026-10-22')
    expect(v).toMatchObject({ streak: 0, next: 1, best: 3 })
  })
})

describe('recordCheckIn', () => {
  it('once a day: a second check-in changes nothing', () => {
    const first = recordCheckIn(undefined, '2026-10-22')
    expect(first).toMatchObject({ added: true, streak: 1, earned: false, checkIns: { days: ['2026-10-22'], best: 1, golden: 0 } })
    const again = recordCheckIn(first.checkIns, '2026-10-22')
    expect(again).toMatchObject({ added: false, streak: 1, earned: false })
    expect(again.checkIns).toBe(first.checkIns)
  })

  it('every seventh day in a row earns a golden bun', () => {
    let c: CheckIns | undefined
    const earned: number[] = []
    for (let i = 1; i <= 15; i++) {
      const r = recordCheckIn(c, `2026-10-${String(i).padStart(2, '0')}`)
      c = r.checkIns
      if (r.earned) earned.push(r.streak)
    }
    expect(earned).toEqual([7, 14])
    expect(c).toMatchObject({ best: 15, golden: 2 })
  })

  it('keeps recent days only', () => {
    const old = days('2025-01-01', '2026-10-21')
    expect(recordCheckIn(old, '2026-10-22').checkIns.days).toEqual(['2026-10-21', '2026-10-22'])
  })
})

describe('a check-in is a logged day for Bun’s temper', () => {
  /** 20 days of ¥400 against a ¥6,000 target: a third past it, so Bun is furious. */
  const wayOver = daily('2026-10-01', '2026-10-20', 'Meituan', 'delivery', 400)
  const temper = (checkedDays?: string[]) => {
    const ctx = { ...makeCtx({ today: '2026-10-23', txns: wayOver, profile: { tone: 'cheeky', targetSpend: yuan(6_000) } }), ...(checkedDays ? { checkedDays } : {}) }
    const s = summarizeMonth(ctx)
    return bunTemper(ctx, s, mirrorStatus(s))
  }

  it('two quiet days with nothing logged do not calm Bun; the same two days checked in do', () => {
    expect(temper()).toMatchObject({ heat: 4, goodDays: 0, cooling: false })
    expect(temper(['2026-10-21', '2026-10-22'])).toMatchObject({ heat: 3, goodDays: 2, cooling: true })
  })

  it('checking in does not hide spending: a checked-in day over the limit is still a bad day', () => {
    const ctx = { ...makeCtx({ today: '2026-10-23', txns: [...wayOver, spend('2026-10-22', 'Nike', 'shopping', 900)], profile: { tone: 'cheeky', targetSpend: yuan(6_000) } }), checkedDays: ['2026-10-21', '2026-10-22'] }
    const s = summarizeMonth(ctx)
    expect(bunTemper(ctx, s, mirrorStatus(s))).toMatchObject({ goodDays: 0, cooling: false })
  })
})
