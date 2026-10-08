import { describe, expect, it } from 'vitest'
import type { FinanceContext, Tone, Tripwire } from '../types'
import { daily, makeCtx, makeProfile, makeTxn, MEI_DREAMS, pay, spend, withTone, yuan } from './__fixtures__'
import { defaultTripwires, describeTripwire, evaluateTripwires } from './tripwires'

const NOW = '2026-10-22T10:00:00.000Z'
const tw = (id: string, kind: Tripwire['kind'], threshold: number, extra: Partial<Tripwire> = {}): Tripwire => ({
  id, kind, threshold, enabled: true, createdBy: 'user', label: id, ...extra,
})

/** day 22: ¥7,700 spent (¥350/day) against a ¥9,500 target = 81% */
function ctxAt(spentPerDay = 350, tripwires: Tripwire[] = [], tone: Tone = 'gentle'): FinanceContext {
  return makeCtx({
    today: '2026-10-22',
    txns: daily('2026-10-01', '2026-10-22', 'Canteen', 'dining', spentPerDay),
    dreams: MEI_DREAMS,
    tripwires,
    profile: { targetSpend: yuan(9_500), monthlyIncome: yuan(18_500), tone },
  })
}

describe('defaultTripwires', () => {
  it('80% and 100% of target, single purchase over 10% of target, pace over 110%', () => {
    const out = defaultTripwires(makeProfile({ targetSpend: yuan(9_500) }))
    expect(out.map((t) => [t.kind, t.threshold])).toEqual([
      ['month_pct', 80],
      ['month_pct', 100],
      ['single_over', yuan(950)],
      ['pace_over', 110],
    ])
    expect(out.every((t) => t.enabled && t.createdBy === 'default' && t.label.length > 0)).toBe(true)
    expect(new Set(out.map((t) => t.id)).size).toBe(4)
  })

  it('rounds the single-purchase line to a whole unit', () => {
    expect(defaultTripwires(makeProfile({ targetSpend: yuan(3_333.33) }))[2].threshold).toBe(yuan(333))
    expect(defaultTripwires(makeProfile({ targetSpend: 0 }))[2].threshold).toBe(100)
  })
})

describe('describeTripwire', () => {
  it.each([
    [tw('a', 'month_pct', 80), 'Alert me at 80% of my monthly target'],
    [tw('b', 'category_pct', 90, { category: 'delivery' }), 'Alert me at 90% of my Food delivery budget'],
    [tw('c', 'single_over', yuan(950)), 'Alert me on any purchase over ¥950'],
    [tw('d', 'daily_over', yuan(300)), "Alert me when a day's spending passes ¥300"],
    [tw('e', 'pace_over', 110), "Alert me if I'm on pace to end 10% over my target"],
    [tw('f', 'pace_over', 100), "Alert me if I'm on pace to go over my target"],
    [tw('g', 'pace_over', 90), "Alert me if I'm on pace to spend 90% of my target"],
  ])('%#', (t, text) => {
    expect(describeTripwire(t, 'CNY')).toBe(text)
  })
})

describe('evaluateTripwires — month_pct', () => {
  it('fires once per month with a tangible dream equivalent', () => {
    const ctx = ctxAt(350, [tw('m80', 'month_pct', 80)])
    const { events, tripwires } = evaluateTripwires(ctx, { now: NOW })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'twe_m80_2026-10', tripwireId: 'm80', firedAt: NOW, seen: false, amount: yuan(7_700) })
    expect(events[0].title).toBe('81% of your monthly target used')
    expect(events[0].message).toContain('¥7,700 of your ¥9,500 target')
    expect(events[0].dream?.itemId).toBe('dream_birkin')
    expect(tripwires[0].lastFiredKey).toBe('2026-10')

    const again = evaluateTripwires({ ...ctx, tripwires }, { now: NOW })
    expect(again.events).toEqual([])
    expect(again.tripwires).toEqual(tripwires)
  })

  it('fires again in a new month', () => {
    const ctx = ctxAt(350, [tw('m80', 'month_pct', 80, { lastFiredKey: '2026-09' })])
    expect(evaluateTripwires(ctx, { now: NOW }).events).toHaveLength(1)
  })

  it("doesn't fire below the threshold", () => {
    expect(evaluateTripwires(ctxAt(300, [tw('m80', 'month_pct', 80)]), { now: NOW }).events).toEqual([])
  })

  it('crossing 80% and 100% at once is one message; both are marked fired', () => {
    const ctx = ctxAt(500, [tw('m80', 'month_pct', 80), tw('m100', 'month_pct', 100)])
    const { events, tripwires } = evaluateTripwires(ctx, { now: NOW })
    expect(events.map((e) => e.tripwireId)).toEqual(['m100'])
    expect(events[0].message).toContain("You're ¥1,500 over your ¥9,500 target.")
    expect(events[0].message).toContain('That ¥1,500 = 1.5% of your Birkin 25.')
    expect(tripwires.map((t) => t.lastFiredKey)).toEqual(['2026-10', '2026-10'])
  })
})

describe('evaluateTripwires — single_over', () => {
  it('"That ¥1,299 = 1.3% of your Birkin." for a new purchase over the line', () => {
    const big = spend('2026-10-22', 'Taobao', 'shopping', 1_299)
    const ctx = ctxAt(100, [tw('s', 'single_over', yuan(950))])
    ctx.bank.transactions.push(big)
    const { events, tripwires } = evaluateTripwires(ctx, { newTxns: [big], now: NOW })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: `twe_s_${big.id}`, txnId: big.id, amount: yuan(1_299), title: 'Big purchase: ¥1,299 at Taobao' })
    expect(events[0].message).toBe("That ¥1,299 = 1.3% of your Birkin 25. Still worth it? It's your call.")
    expect(events[0].dream).toMatchObject({ itemId: 'dream_birkin', label: '1.3% of your Birkin 25' })
    expect(tripwires[0].lastFiredKey).toBe(big.id)
    expect(evaluateTripwires({ ...ctx, tripwires }, { newTxns: [big], now: NOW }).events).toEqual([])
  })

  it('works even if the new transaction is not yet in the bank state', () => {
    const big = spend('2026-10-22', 'JD', 'shopping', 2_000)
    expect(evaluateTripwires(ctxAt(100, [tw('s', 'single_over', yuan(950))]), { newTxns: [big], now: NOW }).events).toHaveLength(1)
  })

  it('ignores income, transfers, small purchases and old history', () => {
    const ctx = ctxAt(100, [tw('s', 'single_over', yuan(950))])
    const newTxns = [pay('2026-10-22', 18_500), spend('2026-10-22', 'Mum', 'transfer', 5_000), spend('2026-10-22', 'Hema', 'groceries', 120)]
    expect(evaluateTripwires(ctx, { newTxns, now: NOW }).events).toEqual([])
    expect(evaluateTripwires(ctx, { now: NOW }).events).toEqual([])
  })

  it('each big purchase in a batch fires', () => {
    const a = spend('2026-10-22', 'Taobao', 'shopping', 1_000)
    const b = spend('2026-10-22', 'JD', 'shopping', 1_200)
    expect(evaluateTripwires(ctxAt(100, [tw('s', 'single_over', yuan(950))]), { newTxns: [a, b], now: NOW }).events.map((e) => e.txnId)).toEqual([a.id, b.id])
  })
})

describe('evaluateTripwires — daily_over, category_pct, pace_over', () => {
  it('daily_over fires once per day, on the days the new transactions touch', () => {
    const ctx = ctxAt(100, [tw('d', 'daily_over', yuan(300))])
    const big = spend('2026-10-22', 'Haidilao', 'dining', 400)
    const { events, tripwires } = evaluateTripwires(ctx, { newTxns: [big], now: NOW })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'twe_d_2026-10-22', amount: yuan(500) })
    expect(tripwires[0].lastFiredKey).toBe('2026-10-22')
    expect(evaluateTripwires({ ...ctx, tripwires }, { newTxns: [big], now: NOW }).events).toEqual([])
  })

  it('category_pct needs a budget for the category', () => {
    const ctx = ctxAt(100, [tw('c', 'category_pct', 80, { category: 'dining' })])
    expect(evaluateTripwires(ctx, { now: NOW }).events).toEqual([])
    ctx.budget = { month: '2026-10', total: yuan(2_500), categories: [{ category: 'dining', limit: yuan(2_500) }], method: 'custom', createdBy: 'user', createdAt: NOW }
    const [e] = evaluateTripwires(ctx, { now: NOW }).events
    expect(e).toMatchObject({ title: 'Eating out is at 88% of its budget', amount: yuan(2_200) })
    expect(e.message).toContain('¥2,200 of your ¥2,500 eating out budget so far.')
    expect(e.dream).toBeDefined()
  })

  it('pace_over compares the projection with threshold% of target, quiet before day 5', () => {
    const ctx = ctxAt(400, [tw('p', 'pace_over', 110)])
    const [e] = evaluateTripwires(ctx, { now: NOW }).events
    expect(e.id).toBe('twe_p_2026-10')
    expect(e.message).toMatch(/At this pace you'll end the month around ¥[\d,]+, ¥[\d,]+ over your ¥9,500 target\./)
    expect(e.dream).toBeDefined()
    const early = makeCtx({ today: '2026-10-03', txns: daily('2026-10-01', '2026-10-03', 'X', 'dining', 2_000), tripwires: [tw('p', 'pace_over', 110)], profile: { targetSpend: yuan(9_500) } })
    expect(evaluateTripwires(early, { now: NOW }).events).toEqual([])
  })
})

describe('evaluateTripwires — general', () => {
  it('disabled tripwires never fire', () => {
    expect(evaluateTripwires(ctxAt(500, [tw('m', 'month_pct', 50, { enabled: false })]), { now: NOW }).events).toEqual([])
  })

  it('copy follows the tone', () => {
    const big = spend('2026-10-22', 'Taobao', 'shopping', 1_299)
    const titles = (['gentle', 'cheeky', 'numbers'] as Tone[]).map((tone) =>
      evaluateTripwires(withTone(ctxAt(100, [tw('s', 'single_over', yuan(950))]), tone), { newTxns: [big], now: NOW }).events[0].title,
    )
    expect(titles).toEqual(['Big purchase: ¥1,299 at Taobao', 'Whoa, ¥1,299 at Taobao', 'Purchase over ¥950: ¥1,299'])
  })

  it('does not mutate its input', () => {
    const ctx = ctxAt(500, defaultTripwires(makeProfile({ targetSpend: yuan(9_500) })))
    const before = JSON.stringify(ctx)
    evaluateTripwires(ctx, { newTxns: [makeTxn({ date: '2026-10-22', amount: -yuan(2_000), category: 'shopping' })], now: NOW })
    expect(JSON.stringify(ctx)).toBe(before)
  })

  it('without dreams the message is still useful and has no dream', () => {
    const ctx = ctxAt(350, [tw('m80', 'month_pct', 80)])
    ctx.dreams = []
    const [e] = evaluateTripwires(ctx, { now: NOW }).events
    expect(e.dream).toBeUndefined()
    expect(e.message).not.toMatch(/undefined|NaN/)
  })
})

describe('evaluateTripwires — money in prose', () => {
  it('month totals read as whole yuan; a single purchase keeps its exact amount', () => {
    const ctx = ctxAt(350.37, [tw('m', 'month_pct', 80)])
    const [ev] = evaluateTripwires(ctx, { now: NOW }).events
    expect(ev.message).toMatch(/^You've spent ¥7,708 of your ¥9,500 target/)
    const big = spend('2026-10-22', 'Taobao', 'shopping', 1_299.5)
    const one = ctxAt(100, [tw('s', 'single_over', yuan(950))])
    one.bank.transactions.push(big)
    expect(evaluateTripwires(one, { newTxns: [big], now: NOW }).events[0].title).toBe('Big purchase: ¥1,299.50 at Taobao')
  })
})
