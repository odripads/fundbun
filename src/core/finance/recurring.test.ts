import { describe, expect, it } from 'vitest'
import { monthsBack } from '../dates'
import { makeTxn, monthly, spend, yuan } from './__fixtures__'
import { detectRecurring, findPriceChange, recurringId } from './recurring'

const TODAY = '2026-10-22'
const MONTHS = monthsBack('2026-10', 4) // Jul..Oct

describe('detectRecurring', () => {
  it('detects a monthly subscription with cadence, amounts, next date and annual cost', () => {
    const [s] = detectRecurring(monthly('Youku', 'subscriptions', 25, 8, MONTHS), TODAY)
    expect(s).toMatchObject({
      id: 'rec_youku',
      merchant: 'Youku',
      category: 'subscriptions',
      cadence: 'monthly',
      averageAmount: yuan(25),
      lastAmount: yuan(25),
      lastDate: '2026-10-08',
      nextExpected: '2026-11-08',
      occurrences: 4,
      isSubscription: true,
      annualCost: yuan(300),
      status: 'active',
    })
    expect(s.priceChange).toBeUndefined()
    expect(s.confidence).toBeGreaterThan(0.8)
    expect(s.txnIds).toHaveLength(4)
  })

  it('groups by normalised merchant (Chinese and English names are one series)', () => {
    const txns = [
      spend('2026-07-08', '优酷', 'subscriptions', 25),
      spend('2026-08-08', 'YOUKU VIP', 'subscriptions', 25),
      spend('2026-09-08', 'Youku', 'subscriptions', 25),
      spend('2026-10-08', '优酷VIP会员', 'subscriptions', 25),
    ]
    const out = detectRecurring(txns, TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].occurrences).toBe(4)
  })

  it('reports a price hike (iQIYI ¥25 → ¥30 from August) dated at the first new charge', () => {
    const [s] = detectRecurring(monthly('iQIYI', 'subscriptions', (m) => (m < '2026-08' ? 25 : 30), 5, monthsBack('2026-10', 7)), TODAY)
    expect(s.priceChange).toEqual({ from: yuan(25), to: yuan(30), pct: 20, date: '2026-08-05' })
    expect(s.lastAmount).toBe(yuan(30))
    expect(s.annualCost).toBe(yuan(360))
  })

  it('needs both >= ¥1 and >= 5% for a hike', () => {
    const tiny = monthly('Svc A', 'subscriptions', (m) => (m < '2026-10' ? 25 : 25.5), 5, MONTHS)
    const smallPct = monthly('Svc B', 'subscriptions', (m) => (m < '2026-10' ? 100 : 104.5), 5, MONTHS)
    const edge = monthly('Svc C', 'subscriptions', (m) => (m < '2026-10' ? 20 : 21), 5, MONTHS)
    const out = detectRecurring([...tiny, ...smallPct, ...edge], TODAY)
    expect(out.find((s) => s.merchant === 'Svc A')?.priceChange).toBeUndefined()
    expect(out.find((s) => s.merchant === 'Svc B')?.priceChange).toBeUndefined()
    expect(out.find((s) => s.merchant === 'Svc C')?.priceChange).toMatchObject({ from: yuan(20), to: yuan(21), pct: 5 })
  })

  it('treats a persisted large change (¥15 → ¥40) as a price change, not noise', () => {
    const txns = monthly('Cloud Box', 'subscriptions', (m) => (m < '2026-09' ? 15 : 40), 3, monthsBack('2026-10', 6))
    const [s] = detectRecurring(txns, TODAY)
    expect(s.occurrences).toBe(6)
    expect(s.priceChange).toMatchObject({ from: yuan(15), to: yuan(40), date: '2026-09-03' })
  })

  it('folds an exact duplicate in the same period into one occurrence but keeps both txn ids', () => {
    const txns = [...monthly('Tencent Video', 'subscriptions', 30, 3, MONTHS), spend('2026-10-03', 'Tencent Video', 'subscriptions', 30)]
    const [s] = detectRecurring(txns, TODAY)
    expect(s.occurrences).toBe(4)
    expect(s.txnIds).toHaveLength(5)
    expect(s.cadence).toBe('monthly')
  })

  it('weekly series need at least 3 charges', () => {
    const two = [spend('2026-10-07', 'Badminton Club', 'entertainment', 40), spend('2026-10-14', 'Badminton Club', 'entertainment', 40)]
    expect(detectRecurring(two, TODAY)).toEqual([])
    const three = [...two, spend('2026-10-21', 'Badminton Club', 'entertainment', 40)]
    const [s] = detectRecurring(three, TODAY)
    expect(s).toMatchObject({ cadence: 'weekly', nextExpected: '2026-10-28', annualCost: yuan(40) * 52 })
  })

  it('detects quarterly and yearly cadences', () => {
    const q = [spend('2026-01-15', 'Insurer', 'insurance', 600), spend('2026-04-15', 'Insurer', 'insurance', 600), spend('2026-07-15', 'Insurer', 'insurance', 600)]
    const y = [spend('2025-03-01', 'Domain Co', 'subscriptions', 88), spend('2026-03-01', 'Domain Co', 'subscriptions', 88)]
    const out = detectRecurring([...q, ...y], TODAY)
    expect(out.find((s) => s.merchant === 'Insurer')).toMatchObject({ cadence: 'quarterly', nextExpected: '2026-10-15', annualCost: yuan(2400) })
    expect(out.find((s) => s.merchant === 'Domain Co')).toMatchObject({ cadence: 'yearly', nextExpected: '2027-03-01', annualCost: yuan(88) })
  })

  it('ignores everyday spending with irregular gaps or daily frequency', () => {
    const txns = [
      ...['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-11', '2026-09-12', '2026-09-25', '2026-10-02', '2026-10-15'].map((d, i) =>
        spend(d, 'Meituan Delivery', 'delivery', 45 + i * 5),
      ),
      ...Array.from({ length: 20 }, (_, i) => spend(`2026-10-${String(i + 1).padStart(2, '0')}`, 'Shenzhen Metro', 'transport', 4)),
    ]
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects two look-alike monthly charges with different amounts (two dinners are not a subscription)', () => {
    const txns = [spend('2026-09-12', 'Haidilao', 'dining', 200), spend('2026-10-12', 'Haidilao', 'dining', 260)]
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('accepts seasonal utility bills and never calls their swings a price hike', () => {
    const amounts = [180, 260, 420, 450, 310, 200]
    const txns = monthsBack('2026-09', 6).map((m, i) => spend(`${m}-20`, 'Shenzhen Power Supply', 'utilities', amounts[i]))
    const [s] = detectRecurring(txns, TODAY)
    expect(s).toMatchObject({ merchant: 'Shenzhen Power Supply', cadence: 'monthly', isSubscription: false })
    expect(s.priceChange).toBeUndefined()
  })

  it('drops series whose next charge is long overdue, but keeps cancelled ones visible', () => {
    const old = monthly('Old Gym', 'health', 199, 2, ['2026-04', '2026-05', '2026-06'])
    expect(detectRecurring(old, TODAY)).toEqual([])
    const iqiyi = monthly('iQIYI', 'subscriptions', 30, 5, ['2026-05', '2026-06', '2026-07'])
    const [s] = detectRecurring(iqiyi, TODAY, ['爱奇艺'])
    expect(s.status).toBe('cancelled')
  })

  it('excludes savings, transfers, income, reversed and future-dated transactions', () => {
    const txns = [
      ...monthly('Goal pot', 'savings', 2200, 10, MONTHS),
      ...monthly('Mum', 'transfer', 500, 1, MONTHS),
      ...monthly('Youku', 'subscriptions', 25, 8, MONTHS, { flags: ['reversed'] }),
      ...MONTHS.map((m) => makeTxn({ date: `${m}-10`, merchant: 'Payroll', category: 'income', amount: yuan(18_500) })),
      ...monthly('Future Svc', 'subscriptions', 10, 1, ['2026-11', '2026-12', '2027-01']),
    ]
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('flags subscription-like merchants outside the subscriptions category', () => {
    const gym = monthly('Pure Fitness', 'health', 399, 15, MONTHS)
    const club = monthly('Book Club', 'education', 50, 2, MONTHS, { description: '月度会员 自动续费' })
    const rent = monthly('Landlord Zhang', 'housing', 4200, 1, MONTHS)
    const out = detectRecurring([...gym, ...club, ...rent], TODAY)
    expect(out.find((s) => s.merchant === 'Pure Fitness')?.isSubscription).toBe(true)
    expect(out.find((s) => s.merchant === 'Book Club')?.isSubscription).toBe(true)
    expect(out.find((s) => s.merchant === 'Landlord Zhang')?.isSubscription).toBe(false)
  })

  it('sorts by annual cost, most expensive first', () => {
    const txns = [...monthly('Youku', 'subscriptions', 25, 8, MONTHS), ...monthly('Landlord Zhang', 'housing', 4200, 1, MONTHS), ...monthly('Pure Fitness', 'health', 399, 15, MONTHS)]
    expect(detectRecurring(txns, TODAY).map((s) => s.merchant)).toEqual(['Landlord Zhang', 'Pure Fitness', 'Youku'])
  })

  it('handles empty input', () => {
    expect(detectRecurring([], TODAY)).toEqual([])
  })
})

describe('findPriceChange', () => {
  it('returns undefined for flat, falling or single-charge series', () => {
    expect(findPriceChange([{ date: '2026-10-01', amount: 2500 }])).toBeUndefined()
    expect(findPriceChange([2500, 2500, 2500].map((amount, i) => ({ date: `2026-0${i + 7}-01`, amount })))).toBeUndefined()
    expect(findPriceChange([3000, 3000, 2500].map((amount, i) => ({ date: `2026-0${i + 7}-01`, amount })))).toBeUndefined()
  })

  it('compares against the median of up to 3 charges before the new level', () => {
    const events = [2000, 2600, 2500, 2500, 3000].map((amount, i) => ({ date: `2026-0${i + 4}-01`, amount }))
    expect(findPriceChange(events)).toMatchObject({ from: 2500, to: 3000, date: '2026-08-01' })
  })
})

describe('recurringId', () => {
  it('is stable and ASCII-safe', () => {
    expect(recurringId('Tencent Video')).toBe('rec_tencent_video')
    expect(recurringId('云膳过桥米线')).toMatch(/^rec_[a-z0-9_]+$/)
    expect(recurringId('云膳过桥米线')).toBe(recurringId('云膳过桥米线'))
    expect(recurringId('云膳过桥米线')).not.toBe(recurringId('沙县小吃'))
  })
})
