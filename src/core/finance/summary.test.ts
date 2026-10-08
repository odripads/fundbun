import { describe, expect, it } from 'vitest'
import type { BudgetPlan, Transaction } from '../types'
import { checking, daily, makeBill, makeCtx, makeTxn, monthly, pay, pot, potContributions, spend, yuan } from './__fixtures__'
import { isSpending, monthHistory, netSpend, spendingTxns, summarizeMonth, unpaidBillsDue } from './summary'

const budget = (month: string, limits: Record<string, number>): BudgetPlan => ({
  month,
  total: Object.values(limits).reduce((a, b) => a + yuan(b), 0),
  categories: Object.entries(limits).map(([category, l]) => ({ category: category as never, limit: yuan(l) })),
  method: 'custom',
  createdBy: 'user',
  createdAt: '2026-10-01T00:00:00.000Z',
})

describe('isSpending / spendingTxns', () => {
  it('counts outflows in spending categories only', () => {
    expect(isSpending(spend('2026-10-01', 'Hema', 'groceries', 50))).toBe(true)
    expect(isSpending(spend('2026-10-01', 'Goal pot', 'savings', 50))).toBe(false)
    expect(isSpending(spend('2026-10-01', 'Mum', 'transfer', 50))).toBe(false)
    expect(isSpending(makeTxn({ date: '2026-10-01', category: 'income', amount: -100 }))).toBe(false)
    expect(isSpending(makeTxn({ date: '2026-10-01', category: 'shopping', amount: 100 }))).toBe(false)
  })

  it('excludes reversed transactions and their reversal entries', () => {
    expect(isSpending(spend('2026-10-01', 'Taobao', 'shopping', 500, { flags: ['reversed'] }))).toBe(false)
    expect(isSpending(makeTxn({ date: '2026-10-02', category: 'shopping', amount: yuan(500), flags: ['reversed'] }))).toBe(false)
  })

  it('filters by month', () => {
    const txns = [spend('2026-09-30', 'A', 'dining', 10), spend('2026-10-01', 'B', 'dining', 10), pay('2026-10-10', 100)]
    expect(spendingTxns(txns).map((t) => t.merchant)).toEqual(['A', 'B'])
    expect(spendingTxns(txns, '2026-10').map((t) => t.merchant)).toEqual(['B'])
  })

  it('netSpend nets refunds and never goes negative', () => {
    expect(netSpend([spend('2026-10-01', 'Taobao', 'shopping', 300), makeTxn({ date: '2026-10-02', category: 'shopping', amount: yuan(100), flags: ['refund'] })])).toBe(yuan(200))
    expect(netSpend([makeTxn({ date: '2026-10-02', category: 'shopping', amount: yuan(100) })])).toBe(0)
  })
})

describe('summarizeMonth — current month', () => {
  // 10 days × ¥100, no history, one unpaid ¥200 bill → projected 1000 + 21×100 + 200
  const base = () =>
    makeCtx({
      today: '2026-10-10',
      txns: daily('2026-10-01', '2026-10-10', 'Canteen', 'dining', 100),
      bills: [makeBill({ id: 'b1', amountDue: yuan(200), dueDate: '2026-10-20', period: '2026-09' })],
      profile: { targetSpend: yuan(3_100) },
    })

  it('reports spend, pace and remaining', () => {
    const s = summarizeMonth(base())
    expect(s).toMatchObject({
      month: '2026-10',
      spent: yuan(1_000),
      target: yuan(3_100),
      daysInMonth: 31,
      dayOfMonth: 10,
      dailyAvg: yuan(100),
      remaining: yuan(2_100),
      isCurrent: true,
      projected: yuan(3_300),
    })
  })

  it('safeToSpendToday = max(0, remaining − unpaid bills this month) / days left incl. today', () => {
    expect(summarizeMonth(base()).safeToSpendToday).toBe(Math.floor((yuan(2_100) - yuan(200)) / 22))
  })

  it('safeToSpendToday is never negative', () => {
    const ctx = base()
    ctx.profile.targetSpend = yuan(500)
    expect(summarizeMonth(ctx).safeToSpendToday).toBe(0)
    expect(summarizeMonth(ctx).remaining).toBe(yuan(-500))
  })

  it("blends this month's pace with the trailing 3-month baseline", () => {
    const ctx = makeCtx({
      today: '2026-10-10',
      txns: [...daily('2026-07-01', '2026-09-30', 'Canteen', 'dining', 50), ...daily('2026-10-01', '2026-10-10', 'Canteen', 'dining', 100)],
      profile: { targetSpend: yuan(3_100) },
    })
    const rate = (10 / 31) * 100 + (21 / 31) * 50
    expect(summarizeMonth(ctx).projected).toBe(yuan(Math.round(1_000 + rate * 21)))
  })

  it('keeps a big one-off purchase out of the run rate', () => {
    const ctx = base()
    ctx.bank.transactions.push(spend('2026-10-05', 'Canteen', 'dining', 3_000))
    const s = summarizeMonth(ctx)
    expect(s.spent).toBe(yuan(4_000))
    expect(s.projected).toBe(yuan(4_000 + 21 * 100 + 200))
  })

  it('adds fixed recurring charges still expected this month, unless cancelled', () => {
    const txns = [...daily('2026-10-01', '2026-10-10', 'Canteen', 'dining', 100), ...monthly('Youku', 'subscriptions', 25, 25, ['2026-07', '2026-08', '2026-09'])]
    const active = summarizeMonth(makeCtx({ today: '2026-10-10', txns }))
    const cancelled = summarizeMonth(makeCtx({ today: '2026-10-10', txns, cancelledMerchants: ['Youku'] }))
    expect(active.projected - cancelled.projected).toBe(yuan(25))
  })

  it("doesn't double count a recurring bill that also has an unpaid Bill", () => {
    const txns = [...daily('2026-10-01', '2026-10-10', 'Canteen', 'dining', 100), ...monthly('China Mobile', 'phone_internet', 128, 20, ['2026-07', '2026-08', '2026-09'])]
    const bill = makeBill({ id: 'm1', payeeId: 'payee_cmcc', name: 'China Mobile', category: 'phone_internet', amountDue: yuan(128), dueDate: '2026-10-20', period: '2026-10' })
    const withBill = summarizeMonth(makeCtx({ today: '2026-10-10', txns, bills: [bill] }))
    const withoutBill = summarizeMonth(makeCtx({ today: '2026-10-10', txns }))
    expect(withBill.projected).toBe(withoutBill.projected)
  })

  it('counts overdue bills from earlier months as still due', () => {
    const ctx = base()
    ctx.bank.bills.push(makeBill({ id: 'old', amountDue: yuan(90), dueDate: '2026-09-20', period: '2026-08', status: 'overdue' }))
    expect(summarizeMonth(ctx).projected).toBe(yuan(3_390))
    expect(unpaidBillsDue(ctx.bank.bills, '2026-10', true).map((b) => b.id)).toEqual(['b1', 'old'])
    expect(unpaidBillsDue(ctx.bank.bills, '2026-10', false).map((b) => b.id)).toEqual(['b1'])
  })

  it('ignores transactions dated after today', () => {
    const ctx = base()
    ctx.bank.transactions.push(spend('2026-10-15', 'Taobao', 'shopping', 5_000))
    expect(summarizeMonth(ctx).spent).toBe(yuan(1_000))
  })
})

describe('summarizeMonth — totals', () => {
  it('nets refunds, ignores reversals, floors categories at zero and sums income', () => {
    const ctx = makeCtx({
      today: '2026-10-22',
      txns: [
        pay('2026-10-10', 18_500),
        makeTxn({ date: '2026-10-11', category: 'income', amount: yuan(999), flags: ['reversed'] }),
        spend('2026-10-02', 'Taobao', 'shopping', 300),
        makeTxn({ date: '2026-10-05', merchant: 'Taobao', category: 'shopping', amount: yuan(100), flags: ['refund'] }),
        makeTxn({ date: '2026-10-06', merchant: 'JD', category: 'gifts', amount: yuan(80), flags: ['refund'] }),
        spend('2026-10-07', 'Haidilao', 'dining', 500, { flags: ['reversed'] }),
        makeTxn({ date: '2026-10-08', merchant: 'Haidilao', category: 'dining', amount: yuan(500), flags: ['reversed'] }),
        makeTxn({ date: '2026-10-09', merchant: 'Stranger', category: 'other', amount: yuan(5_000) }),
      ],
    })
    const s = summarizeMonth(ctx)
    expect(s.income).toBe(yuan(18_500))
    expect(s.spent).toBe(yuan(200))
    expect(s.byCategory.find((r) => r.category === 'shopping')).toMatchObject({ spent: yuan(200), count: 1 })
    expect(s.byCategory.find((r) => r.category === 'gifts')?.spent ?? 0).toBe(0)
    expect(s.byCategory.find((r) => r.category === 'dining')).toBeUndefined()
  })

  it('savedToGoals counts pot inflows once (not the matching checking outflow)', () => {
    const txns = potContributions('pot_dream_x', 2_200, 10, ['2026-10'])
    expect(summarizeMonth(makeCtx({ today: '2026-10-22', txns, accounts: [checking(1_000), pot('dream_x', 2_200)] })).savedToGoals).toBe(yuan(2_200))
    const noPots = makeCtx({ today: '2026-10-22', txns: [spend('2026-10-10', 'Saving', 'savings', 500)], accounts: [checking(1_000)] })
    expect(summarizeMonth(noPots).savedToGoals).toBe(yuan(500))
  })

  it('attaches budget limits, pct and the previous month to category rows, biggest first', () => {
    const ctx = makeCtx({
      today: '2026-10-22',
      txns: [spend('2026-09-12', 'Meituan', 'delivery', 300), spend('2026-10-03', 'Meituan', 'delivery', 400), spend('2026-10-04', 'Hema', 'groceries', 900)],
      budget: budget('2026-10', { delivery: 500, groceries: 1_000, entertainment: 200 }),
    })
    const rows = summarizeMonth(ctx).byCategory
    expect(rows.map((r) => r.category)).toEqual(['groceries', 'delivery', 'entertainment'])
    expect(rows[1]).toEqual({ category: 'delivery', spent: yuan(400), count: 1, limit: yuan(500), pct: 80, prevMonth: yuan(300), prevMonthToDate: yuan(300) })
    expect(rows[2]).toMatchObject({ spent: 0, count: 0, limit: yuan(200), pct: 0 })
  })

  it('prevMonthToDate compares like with like: the previous month up to the same day', () => {
    const txns = [
      spend('2026-09-05', 'Meituan', 'delivery', 100),
      spend('2026-09-22', 'Meituan', 'delivery', 50),
      spend('2026-09-23', 'Meituan', 'delivery', 300),
      spend('2026-10-03', 'Meituan', 'delivery', 400),
    ]
    const ctx = makeCtx({ today: '2026-10-22', txns })
    const now = summarizeMonth(ctx).byCategory.find((r) => r.category === 'delivery')!
    expect(now).toMatchObject({ prevMonth: yuan(450), prevMonthToDate: yuan(150) })
    // a finished month compares with all of the month before
    const sep = summarizeMonth(makeCtx({ today: '2026-10-22', txns: [...txns, spend('2026-08-30', 'Meituan', 'delivery', 70)] }), '2026-09')
    expect(sep.byCategory.find((r) => r.category === 'delivery')).toMatchObject({ prevMonth: yuan(70), prevMonthToDate: yuan(70) })
  })

  it("doesn't apply a plan to months before it starts", () => {
    const ctx = makeCtx({ today: '2026-10-22', txns: [spend('2026-09-03', 'Meituan', 'delivery', 400)], budget: budget('2026-10', { delivery: 500 }) })
    expect(summarizeMonth(ctx, '2026-09').byCategory[0].limit).toBeUndefined()
  })
})

describe('summarizeMonth — other months', () => {
  const ctx = makeCtx({ today: '2026-10-22', txns: daily('2026-09-01', '2026-10-22', 'Canteen', 'dining', 40) })

  it('past months: projected = spent, full month elapsed, nothing safe to spend', () => {
    const s = summarizeMonth(ctx, '2026-09')
    expect(s).toMatchObject({ spent: yuan(1_200), projected: yuan(1_200), dayOfMonth: 30, daysInMonth: 30, safeToSpendToday: 0, isCurrent: false, dailyAvg: yuan(40) })
  })

  it('future months: nothing spent yet, a forecast from the baseline', () => {
    const s = summarizeMonth(ctx, '2026-11')
    expect(s.spent).toBe(0)
    expect(s.dayOfMonth).toBe(0)
    expect(s.isCurrent).toBe(false)
    expect(s.projected).toBeGreaterThan(0)
  })

  it('empty data', () => {
    const s = summarizeMonth(makeCtx({ today: '2026-10-22' }))
    expect(s).toMatchObject({ spent: 0, projected: 0, income: 0, byCategory: [], savedToGoals: 0 })
  })
})

describe('monthHistory', () => {
  it('returns the last n months oldest first, including the current one', () => {
    const ctx = makeCtx({
      today: '2026-10-22',
      txns: [pay('2026-09-10', 18_500), spend('2026-09-12', 'A', 'dining', 100), spend('2026-10-02', 'B', 'dining', 50)],
      profile: { targetSpend: yuan(9_500) },
    })
    expect(monthHistory(ctx, 3)).toEqual([
      { month: '2026-08', spent: 0, target: yuan(9_500), income: 0 },
      { month: '2026-09', spent: yuan(100), target: yuan(9_500), income: yuan(18_500) },
      { month: '2026-10', spent: yuan(50), target: yuan(9_500), income: 0 },
    ])
    expect(monthHistory(ctx, 0)).toEqual([])
  })
})

describe('summarizeMonth — bills vs recurring', () => {
  it('still expects a recurring bill whose bill for this month has not been issued yet', () => {
    const txns = [
      ...daily('2026-10-01', '2026-10-10', 'Canteen', 'dining', 100),
      ...monthly('China Mobile', 'phone_internet', 128, 20, ['2026-07', '2026-08', '2026-09'], { payeeId: 'payee_cmcc' }),
    ]
    const lastMonthBill = makeBill({ id: 'm9', payeeId: 'payee_cmcc', name: 'China Mobile', category: 'phone_internet', amountDue: yuan(128), dueDate: '2026-09-20', period: '2026-09', status: 'paid' })
    const withOldBill = summarizeMonth(makeCtx({ today: '2026-10-10', txns, bills: [lastMonthBill] }))
    const cancelled = summarizeMonth(makeCtx({ today: '2026-10-10', txns, bills: [lastMonthBill], cancelledMerchants: ['China Mobile'] }))
    expect(withOldBill.projected - cancelled.projected).toBe(yuan(128))
  })
})

describe('savedToGoals — F36: net of money moved back out', () => {
  it('pot withdrawals and money returned to checking count against what was saved; undone moves are ignored', () => {
    const potTx = (date: string, amount: number, extra: Partial<Transaction> = {}) => makeTxn({ date, amount: yuan(amount), accountId: 'pot_dream_chengdu', category: 'savings', merchant: 'Checking', ...extra })
    const base = { today: '2026-10-22', accounts: [checking(5_000), pot('dream_chengdu', 0)] }
    const saved = (txns: Transaction[]) => summarizeMonth(makeCtx({ ...base, txns })).savedToGoals
    expect(saved([potTx('2026-10-05', 2_000), potTx('2026-10-12', 500)])).toBe(yuan(2_500))
    expect(saved([potTx('2026-10-05', 2_000), potTx('2026-10-12', 500), potTx('2026-10-15', -300)])).toBe(yuan(2_200))
    expect(saved([potTx('2026-10-05', 500), potTx('2026-10-15', -900)])).toBe(0)
    expect(saved([potTx('2026-10-05', 500), potTx('2026-10-06', 300, { flags: ['reversed'] }), potTx('2026-10-06', -300, { flags: ['reversed'] })])).toBe(yuan(500))
  })
})
