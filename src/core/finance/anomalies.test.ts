import { describe, expect, it } from 'vitest'
import { addDays } from '../dates'
import { spend, yuan } from './__fixtures__'
import { detectAnomalies, modifiedZ } from './anomalies'

const TODAY = '2026-10-22'
const days = (n: number, from = '2026-09-01') => Array.from({ length: n }, (_, i) => addDays(from, i * 2))

describe('modifiedZ', () => {
  it('is 0.6745 × (x − median) / MAD', () => {
    const z = modifiedZ([1, 2, 3, 4, 100])
    expect(z[2]).toBe(0)
    expect(z[4]).toBeCloseTo((0.6745 * 97) / 1, 5)
  })
  it('falls back to the mean absolute deviation when MAD is 0, and to 0 when everything is equal', () => {
    const z = modifiedZ([5, 5, 5, 5, 9])
    expect(z[4]).toBeCloseTo(4 / (1.253314 * 0.8), 5)
    expect(modifiedZ([7, 7, 7])).toEqual([0, 0, 0])
  })
})

describe('detectAnomalies', () => {
  const shopping = [30, 45, 60, 80, 95, 120, 70, 55, 85, 110].map((a, i) => spend(days(10)[i], 'Taobao', 'shopping', a))

  it('flags a purchase far above the category norm, with a readable reason', () => {
    const big = spend('2026-10-18', 'Taobao', 'shopping', 1_299)
    const [a, ...rest] = detectAnomalies([...shopping, big], TODAY)
    expect(rest).toEqual([])
    expect(a).toMatchObject({ txnId: big.id, category: 'shopping', amount: yuan(1_299) })
    expect(a.score).toBeGreaterThan(3.5)
    expect(a.typical).toBe(yuan(80))
    expect(a.reason).toBe('¥1,299 at Taobao is about 16× what you usually spend there (¥80).')
  })

  it('explains against the category when the merchant is new', () => {
    const big = spend('2026-10-18', 'Apple Store', 'shopping', 9_999)
    const [a] = detectAnomalies([...shopping, big], TODAY)
    expect(a.reason).toBe('¥9,999 at Apple Store is about 125× your typical shopping purchase (¥80).')
  })

  it('needs at least 6 samples in the category', () => {
    const few = shopping.slice(0, 4)
    expect(detectAnomalies([...few, spend('2026-10-18', 'Taobao', 'shopping', 1_299)], TODAY)).toEqual([])
  })

  it('only looks at the last 120 days', () => {
    const old = [...shopping.map((t) => ({ ...t, date: addDays(t.date, -150) })), spend('2026-04-20', 'Taobao', 'shopping', 1_299)]
    expect(detectAnomalies(old, TODAY)).toEqual([])
  })

  it('ignores housing, insurance, savings and transfers', () => {
    const rent = [...Array.from({ length: 8 }, (_, i) => spend(days(8)[i], 'Landlord', 'housing', 50)), spend('2026-10-01', 'Landlord', 'housing', 4_200)]
    const moves = [...Array.from({ length: 8 }, (_, i) => spend(days(8)[i], 'Mum', 'transfer', 50)), spend('2026-10-01', 'Mum', 'transfer', 9_000)]
    expect(detectAnomalies([...rent, ...moves], TODAY)).toEqual([])
  })

  it("doesn't flag a usual taxi fare in a metro-heavy category", () => {
    const metro = Array.from({ length: 30 }, (_, i) => spend(addDays('2026-09-01', i), 'Shenzhen Metro', 'transport', 4 + (i % 3)))
    const didi = [38, 42, 45, 40, 52].map((a, i) => spend(addDays('2026-09-03', i * 7), 'DiDi', 'transport', a))
    expect(detectAnomalies([...metro, ...didi], TODAY)).toEqual([])
    const crazy = spend('2026-10-20', 'DiDi', 'transport', 260)
    expect(detectAnomalies([...metro, ...didi, crazy], TODAY).map((a) => a.txnId)).toEqual([crazy.id])
  })

  it("doesn't flag a statistically odd but small step (¥40 coffee among ¥30 ones)", () => {
    const coffee = Array.from({ length: 20 }, (_, i) => spend(addDays('2026-09-01', i), 'Luckin Coffee', 'coffee_tea', 30))
    expect(detectAnomalies([...coffee, spend('2026-10-20', 'Luckin Coffee', 'coffee_tea', 40)], TODAY)).toEqual([])
  })

  it('ignores refunds, income and future-dated transactions; sorts by score', () => {
    const big1 = spend('2026-10-10', 'JD', 'shopping', 2_000)
    const big2 = spend('2026-10-11', 'JD', 'shopping', 600)
    const future = spend('2026-11-01', 'JD', 'shopping', 9_000)
    const out = detectAnomalies([...shopping, big1, big2, future, { ...big1, id: 'refund', amount: yuan(2_000) }], TODAY)
    expect(out.map((a) => a.txnId)).toEqual([big1.id, big2.id])
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })
})
