import { describe, expect, it } from 'vitest'
import type { Draft } from './drafts'
import { REPEAT_WINDOW_DAYS, alternativePrices, avoidAccidentalRepeats } from './repeats'
import type { MerchantSpec } from './script-types'

const menu: MerchantSpec = { merchant: 'Luckin Coffee', description: 'LUCKIN', category: 'coffee_tea', channel: 'wechat_pay', price: { pick: [990, 1390, 1390, 1690] } }
const ranged: MerchantSpec = { merchant: 'Hema Fresh', description: 'HEMA', category: 'groceries', channel: 'alipay', price: { median: 5_000, sigma: 0.3, min: 4_990, max: 5_030, step: 10 } }
const fare: MerchantSpec = { ...menu, merchant: 'Shenzhen Metro', price: { pick: [400] }, repeatable: true }

function draft(spec: MerchantSpec | undefined, date: string, amount: number, merchant = spec?.merchant ?? 'Story'): Draft {
  return { accountId: 'chk_main', date, time: '12:00', amount, merchant, description: 'd', category: 'other', spec, calibratable: spec !== undefined }
}

describe('alternativePrices', () => {
  it('offers the other menu prices, closest first, without duplicates', () => {
    expect(alternativePrices(menu, 1_390)).toEqual([1_690, 990])
    expect(alternativePrices(menu, 990)).toEqual([1_390, 1_690])
  })

  it('steps around a ranged price within its bounds', () => {
    expect(alternativePrices(ranged, 5_000)).toEqual([5_010, 4_990, 5_020, 5_030])
    expect(alternativePrices(ranged, 5_030)).toEqual([5_020, 5_010, 5_000, 4_990])
  })
})

describe('avoidAccidentalRepeats', () => {
  it('re-prices a later identical purchase from the same merchant inside the window', () => {
    const a = draft(menu, '2026-10-01', -1_390)
    const b = draft(menu, '2026-10-05', -1_390)
    const out = avoidAccidentalRepeats([b, a])
    expect(out).toHaveLength(2)
    expect(a.amount).toBe(-1_390)
    expect(b.amount).toBe(-1_690)
  })

  it(`leaves purchases more than ${REPEAT_WINDOW_DAYS} days apart, other merchants and inflows alone`, () => {
    const a = draft(menu, '2026-10-01', -1_390)
    const far = draft(menu, '2026-10-20', -1_390)
    const other = draft(ranged, '2026-10-02', -1_390)
    const refund = draft(menu, '2026-10-03', 1_390)
    avoidAccidentalRepeats([a, far, other, refund])
    expect([a.amount, far.amount, other.amount, refund.amount]).toEqual([-1_390, -1_390, -1_390, 1_390])
  })

  it('never moves story drafts or repeatable fares, and steers around them', () => {
    const planted = [draft(undefined, '2026-10-03', -3_000, 'Tencent Video'), draft(undefined, '2026-10-03', -3_000, 'Tencent Video')]
    const rides = [draft(fare, '2026-10-01', -400), draft(fare, '2026-10-01', -400)]
    const coffee = draft(menu, '2026-10-04', -1_390)
    const storyCoffee = draft(undefined, '2026-10-06', -1_390, 'Luckin Coffee')
    avoidAccidentalRepeats([...planted, ...rides, coffee, storyCoffee])
    expect(planted.map((d) => d.amount)).toEqual([-3_000, -3_000])
    expect(rides.map((d) => d.amount)).toEqual([-400, -400])
    expect(coffee.amount).toBe(-1_690)
    expect(storyCoffee.amount).toBe(-1_390)
  })

  it('respects charges already booked in the ledger', () => {
    const today = draft(menu, '2026-10-23', -990)
    avoidAccidentalRepeats([today], [{ merchant: 'Luckin Coffee', date: '2026-10-20', amount: -990 }, { merchant: 'Luckin Coffee', date: '2026-10-21', amount: -1_390 }])
    expect(today.amount).toBe(-1_690)
  })

  it('drops a purchase when every plausible price is taken', () => {
    const tiny: MerchantSpec = { ...menu, price: { pick: [500] } }
    const a = draft(tiny, '2026-10-01', -500)
    const b = draft(tiny, '2026-10-02', -500)
    const out = avoidAccidentalRepeats([a, b])
    expect(out).toEqual([a])
  })
})
