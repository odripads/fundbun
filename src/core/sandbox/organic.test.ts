import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import { CHECKING_ID, nextTxnId, potId, sortDrafts, toTransaction, type Draft } from './drafts'
import { datesBetween, dayKind, describe as describeMerchant, isHoliday, monthlyHabitDays, organicDrafts, purchaseDraft, subscriptionPrice } from './organic'
import { ARIF } from './scripts/arif'
import { MEI } from './scripts/mei'
import { SCRIPTS, getScript } from './scripts'

const SEED = 20261020
const opts = { accountId: CHECKING_ID, cancelled: [] as string[] }

describe('calendar', () => {
  it('treats weekends and the 2026 public holidays as days off', () => {
    expect(dayKind('2026-10-22')).toBe('work') // Thursday
    expect(dayKind('2026-10-24')).toBe('off') // Saturday
    expect(dayKind('2026-10-05')).toBe('off') // National Day week (Monday)
    expect(isHoliday('2026-10-07')).toBe(true)
    expect(isHoliday('2026-10-08')).toBe(false)
    expect(datesBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(datesBetween('2026-03-02', '2026-03-01')).toEqual([])
  })
})

describe('organicDrafts', () => {
  it('is deterministic per seed and date', () => {
    expect(organicDrafts(MEI, SEED, '2026-10-12', opts)).toEqual(organicDrafts(MEI, SEED, '2026-10-12', opts))
    expect(organicDrafts(MEI, SEED, '2026-10-12', opts)).not.toEqual(organicDrafts(MEI, SEED + 1, '2026-10-12', opts))
  })

  it('produces realistic purchases: merchant names, channels, times and categories from the script', () => {
    const merchants = new Set(MEI.habits.flatMap((h) => h.merchants.map((m) => m.merchant)).concat(MEI.subscriptions.map((s) => s.merchant)))
    for (const date of datesBetween('2026-09-01', '2026-09-30')) {
      for (const d of organicDrafts(MEI, SEED, date, opts)) {
        expect(merchants.has(d.merchant)).toBe(true)
        expect(d.amount).toBeLessThan(0)
        expect(d.time).toMatch(/^\d{2}:\d{2}$/)
        expect(d.description).not.toContain('{item}')
        expect(['wechat_pay', 'alipay', 'card']).toContain(d.channel)
      }
    }
  })

  it('marks story-critical habits as protected and subscriptions as fixed', () => {
    const month = datesBetween('2026-09-01', '2026-09-30').flatMap((d) => organicDrafts(MEI, SEED, d, opts))
    const late = month.filter((d) => d.protected)
    expect(late.length).toBeGreaterThanOrEqual(9)
    expect(late.every((d) => d.category === 'delivery')).toBe(true)
    const subs = month.filter((d) => d.category === 'subscriptions')
    expect(subs.every((d) => !d.calibratable && d.initiatedBy === 'bank')).toBe(true)
    expect(subs).toHaveLength(6)
  })

  it('scales discretionary activity with intensity but leaves inelastic habits alone', () => {
    const count = (intensity: number) =>
      datesBetween('2026-09-01', '2026-09-30').flatMap((d) => organicDrafts(MEI, SEED, d, { ...opts, intensity })).filter((x) => x.calibratable)
    const calm = count(0.5)
    const wild = count(2)
    expect(wild.length).toBeGreaterThan(calm.length * 2)
    expect(wild.filter((d) => d.protected).length).toBe(calm.filter((d) => d.protected).length)
  })

  it('skips cancelled subscriptions (case-insensitive)', () => {
    const day = organicDrafts(MEI, SEED, '2026-10-06', { ...opts, cancelled: [' IQIYI '] })
    expect(day.some((d) => d.merchant === 'iQIYI')).toBe(false)
  })
})

describe('monthlyHabitDays', () => {
  it('picks the planned number of eligible days, stable across calls', () => {
    const habit = MEI.habits.find((h) => h.key === 'cinema')!
    const days = monthlyHabitDays(MEI, SEED, '2026-09', habit, 1)
    expect(days.size).toBeGreaterThanOrEqual(1)
    expect(days.size).toBeLessThanOrEqual(2)
    for (const d of days) expect(dayKind(d)).toBe('off')
    expect(monthlyHabitDays(MEI, SEED, '2026-09', habit, 1)).toEqual(days)
  })
})

describe('subscriptionPrice', () => {
  it('applies price changes from their month offset; live days use the latest price', () => {
    const iqiyi = MEI.subscriptions.find((s) => s.merchant === 'iQIYI')!
    expect(subscriptionPrice(iqiyi, -3)).toBe(2_500)
    expect(subscriptionPrice(iqiyi, -2)).toBe(3_000)
    expect(subscriptionPrice(iqiyi, 0)).toBe(3_000)
    expect(subscriptionPrice(iqiyi)).toBe(3_000)
  })
})

describe('purchaseDraft / describe', () => {
  it('fills the {item} slot and honours an explicit amount', () => {
    const rng = createRng(1)
    const m = MEI.fillers[0]
    const d = purchaseDraft(rng, m, '2026-09-01', [12, 13], CHECKING_ID, 4_200)
    expect(d).toMatchObject({ amount: -4_200, merchant: m.merchant, category: m.category, calibratable: true, initiatedBy: 'user' })
    expect(d.time! >= '12:00' && d.time! < '13:00').toBe(true)
    expect(describeMerchant(rng, { ...m, items: undefined, description: 'SHOP {item}' })).toBe('SHOP')
  })
})

describe('drafts', () => {
  it('creates readable ids that skip used ones', () => {
    const used = new Set(['txn_20261003_001'])
    expect(nextTxnId('2026-10-03', used)).toBe('txn_20261003_002')
    expect(nextTxnId('2026-10-03', used)).toBe('txn_20261003_003')
    expect(nextTxnId('2026-10-04', used)).toBe('txn_20261004_001')
    expect(potId('dream_birkin')).toBe('pot_dream_birkin')
  })

  it('turns a draft into a transaction without generation metadata', () => {
    const draft: Draft = { accountId: 'a', date: '2026-10-01', amount: -5, merchant: 'M', description: 'D', category: 'other', calibratable: true, protected: true, flags: ['refund'] }
    const t = toTransaction(draft, 'id1', 'CNY')
    expect(t).toEqual({ id: 'id1', accountId: 'a', date: '2026-10-01', amount: -5, currency: 'CNY', merchant: 'M', description: 'D', category: 'other', categorySource: 'rule', categoryConfidence: 1, flags: ['refund'] })
    expect(t.flags).not.toBe(draft.flags)
  })

  it('sorts by date then time (untimed first), keeping ties stable', () => {
    const items = [
      { k: 1, date: '2026-10-02', time: '09:00' },
      { k: 2, date: '2026-10-01', time: '23:00' },
      { k: 3, date: '2026-10-01' },
      { k: 4, date: '2026-10-01', time: '23:00' },
    ]
    expect(sortDrafts(items).map((x) => x.k)).toEqual([3, 2, 4, 1])
  })
})

describe('scripts registry', () => {
  it('registers both personas and resolves them by id', () => {
    expect(SCRIPTS.map((s) => s.def.id)).toEqual(['mei', 'arif'])
    expect(getScript('arif')).toBe(ARIF)
    expect(getScript('nobody')).toBeUndefined()
    expect(getScript(undefined)).toBeUndefined()
  })

  it.each(SCRIPTS.map((s) => [s.def.id, s] as const))('%s: script is internally consistent', (_, s) => {
    const payeeIds = new Set(s.payees.map((p) => p.id))
    for (const b of s.bills) expect(payeeIds.has(b.payeeId)).toBe(true)
    const goals = s.dreams.filter((d) => d.kind === 'goal').map((d) => d.id)
    expect(s.pots.map((p) => p.goalId)).toEqual(goals)
    for (const h of s.habits) expect(Boolean(h.perDay) !== Boolean(h.perMonth)).toBe(true)
    expect(s.fillers.length).toBeGreaterThan(0)
    expect(s.calibration.tolerance.current).toBeGreaterThan(0)
  })
})
