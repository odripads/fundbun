import { beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import type { AppSnapshot } from '../../../core/app-api'
import type { Account, CategoryId, FinanceContext, MonthSummary, Transaction } from '../../../core/types'
import {
  REST_ID,
  TXN_PAGE,
  categoryBars,
  categorySummary,
  dailySeries,
  dailySummary,
  dayLimitFor,
  filterTxns,
  goalRows,
  isDayToDay,
  ledgerRows,
  monthColumnNote,
  monthColumns,
  monthColumnsSummary,
  monthKpis,
  shareText,
  spentOn,
  txnCategories,
  txnCountLine,
  txnDate,
} from './model'

interface Persona {
  app: FundBunApp
  snap: AppSnapshot
  ctx: FinanceContext
  summary: MonthSummary
}

function persona(id: 'mei' | 'arif'): Persona {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  const snap = app.getSnapshot()
  return { app, snap, ctx: snap.derived.ctx!, summary: snap.derived.summary! }
}

let n = 0
function txn(date: string, amount: number, category: CategoryId, extra: Partial<Transaction> = {}): Transaction {
  n++
  return {
    id: `t${n}`,
    accountId: 'chk_main',
    date,
    amount,
    currency: 'CNY',
    merchant: `Shop ${n}`,
    description: `desc ${n}`,
    category,
    categorySource: 'rule',
    categoryConfidence: 1,
    ...extra,
  }
}

let jing: Persona
let arif: Persona
beforeAll(() => {
  jing = persona('mei')
  arif = persona('arif')
})

describe('this month', () => {
  it('Jing: over budget, by exactly what the summary says, with the share of the target', () => {
    const k = monthKpis({ summary: jing.summary, currency: 'CNY', tone: 'gentle', tracking: false, plan: null, spentToday: 8390 })
    expect(k.monthLong).toBe('October')
    expect(k.spent).toBe(jing.summary.spent)
    expect(k.target).toBe(jing.summary.target)
    expect(k.verdict).toEqual({ kind: 'over', label: 'Over budget', amount: 258024, note: '27% past your ¥9,500 target' })
    expect(k.verdict!.amount).toBe(jing.summary.spent - jing.summary.target)
    expect(k.daily.label).toBe('Safe to spend today')
    expect(k.daily.amount).toBe(jing.summary.safeToSpendToday)
    expect(k.daysLeft).toBe(9)
    expect(k.savedToGoals).toBe(200000)
  })

  it('Arif: money left over, never "under"', () => {
    const k = monthKpis({ summary: arif.summary, currency: 'CNY', tone: 'numbers', tracking: false, plan: null, spentToday: 0 })
    expect(k.verdict).toEqual({ kind: 'left', label: 'Left over', amount: 133468, note: 'of your ¥3,600 target, 9 days to go' })
    expect(k.verdict!.amount).toBe(arif.summary.target - arif.summary.spent)
    expect(JSON.stringify(k)).not.toMatch(/under (target|budget)/i)
  })

  it('a daily amount the user set replaces "safe to spend"', () => {
    const k = monthKpis({ summary: jing.summary, currency: 'CNY', tone: 'gentle', tracking: false, plan: 15000, spentToday: 0 })
    expect(k.daily).toEqual({ label: 'Your daily amount', amount: 15000, note: 'You set it for the rest of October. Bun judges each day by it.' })
  })

  it('daily tracking has no target and no verdict: the count and today', () => {
    const k = monthKpis({ summary: jing.summary, currency: 'CNY', tone: 'gentle', tracking: true, plan: null, spentToday: 8390 })
    expect(k.target).toBeNull()
    expect(k.verdict).toBeNull()
    expect(k.daily.label).toBe('Spent today')
    expect(k.daily.amount).toBe(8390)
    // 1,208,024 over 22 days, to the whole unit the Home month card shows
    expect(k.daily.note).toBe('About ¥549 a day this month.')
  })

  it('a finished month says what was left over, without days to go', () => {
    const done: MonthSummary = { ...arif.summary, isCurrent: false, dayOfMonth: 31 }
    expect(monthKpis({ summary: done, currency: 'CNY', tone: 'gentle', tracking: false, plan: null, spentToday: 0 }).verdict!.note).toBe('of your ¥3,600 target')
  })

  it('spentOn adds the day’s outflows and leaves out transfers, savings and income', () => {
    const txns = [
      txn('2026-10-22', -7290, 'delivery'),
      txn('2026-10-22', -600, 'transport'),
      txn('2026-10-22', -50000, 'savings'),
      txn('2026-10-22', -20000, 'transfer'),
      txn('2026-10-22', 1850000, 'income'),
      txn('2026-10-21', -4830, 'delivery'),
    ]
    expect(spentOn(txns, '2026-10-22')).toBe(7890)
    expect(spentOn(txns, '2026-10-20')).toBe(0)
    // the persona's own day matches the temper's count (Jing has no fixed costs on the 22nd)
    expect(spentOn(jing.snap.state.bank.transactions, '2026-10-22')).toBe(8390)
  })
})

describe('daily spending', () => {
  const txns = [
    txn('2026-10-01', -420000, 'housing'),
    txn('2026-10-01', -3000, 'dining'),
    txn('2026-10-02', -2000, 'groceries'),
    txn('2026-10-02', -9000, 'shopping'),
    txn('2026-10-02', 1500, 'shopping'), // a refund: money back is not spending
    txn('2026-10-03', -5500, 'subscriptions'),
    txn('2026-10-03', -4862, 'utilities', { billId: 'bill_1' }),
    txn('2026-10-04', -50000, 'savings'),
    txn('2026-10-05', -1200, 'coffee_tea'),
    txn('2026-10-08', -99900, 'shopping'), // after the as-of date
    txn('2026-09-30', -7700, 'dining'), // another month
  ]

  it('one bar per day: day-to-day spending up to the as-of date, fixed costs kept apart', () => {
    const d = dailySeries(txns, '2026-10', '2026-10-05', 10000)
    expect(d.days).toHaveLength(31)
    expect(d.days.slice(0, 6).map((b) => b.amount)).toEqual([3000, 11000, 0, 0, 1200, 0])
    expect(d.total).toBe(15200)
    expect(d.total).toBe(d.days.reduce((s, b) => s + b.amount, 0))
    // rent + the subscription + the utility bill
    expect(d.fixed).toBe(420000 + 5500 + 4862)
    expect(d.max).toBe(11000)
    expect(d.peak?.date).toBe('2026-10-02')
    expect(d.spendDays).toBe(3)
  })

  it('marks today, the days still to come, and the days above the limit', () => {
    const d = dailySeries(txns, '2026-10', '2026-10-05', 10000)
    expect(d.days.filter((b) => b.isToday).map((b) => b.day)).toEqual([5])
    expect(d.days.filter((b) => b.future).map((b) => b.day)[0]).toBe(6)
    expect(d.days[7].amount).toBe(0) // the 8th has not happened
    expect(d.days.filter((b) => b.overLimit).map((b) => b.day)).toEqual([2])
    expect(d.overDays).toBe(1)
  })

  it('without a limit nothing is over; looking back at an older month marks no today', () => {
    const d = dailySeries(txns, '2026-10', '2026-10-31', null, '2026-11-25')
    expect(d.limit).toBeNull()
    expect(d.overDays).toBe(0)
    expect(d.days.some((b) => b.isToday || b.future)).toBe(false)
    expect(d.days[7].amount).toBe(99900)
  })

  it('agrees with Bun’s temper for the personas: same day limit, same count for today', () => {
    for (const p of [jing, arif]) {
      const temper = p.snap.derived.mirror!.temper!
      const limit = dayLimitFor(p.ctx, p.summary)
      expect(limit).toBe(temper.dayLimit)
      const d = dailySeries(p.ctx.bank.transactions, p.summary.month, p.ctx.bank.today, limit, p.snap.derived.today)
      const today = d.days.find((b) => b.isToday)!
      expect(today.day).toBe(22)
      expect(today.amount).toBe(temper.spentToday)
      expect(d.days.filter((b) => b.future)).toHaveLength(9)
      // every spending row of the month up to today is in the bars or in the fixed costs, once
      const month = p.ctx.bank.transactions.filter((t) => t.date.startsWith(p.summary.month) && t.date <= p.ctx.bank.today)
      expect(d.total).toBe(month.filter(isDayToDay).reduce((s, t) => s - t.amount, 0))
      expect(d.total + d.fixed).toBeGreaterThanOrEqual(p.summary.spent)
    }
  })

  it('daily tracking draws a limit only when the user set one', () => {
    const tracking: FinanceContext = { ...jing.ctx, profile: { ...jing.ctx.profile, mode: 'tracking' }, tripwires: [], dailyPlan: undefined }
    expect(dayLimitFor(tracking, jing.summary)).toBeNull()
    expect(dayLimitFor({ ...tracking, dailyPlan: { month: jing.summary.month, amount: 12000, setOn: '2026-10-20' } }, jing.summary)).toBe(12000)
    expect(
      dayLimitFor({ ...tracking, tripwires: [{ id: 'tw', kind: 'daily_over', threshold: 30000, enabled: true, createdBy: 'user', label: 'Daily' }] }, jing.summary),
    ).toBe(30000)
  })

  it('says the chart in one sentence', () => {
    const d = dailySeries(txns, '2026-10', '2026-10-05', 10000)
    expect(dailySummary(d, 'CNY')).toBe('Day-to-day spending in October: ¥152 over 3 days. Biggest day: Oct 2, ¥110. Day limit ¥100: 1 day went over it. Today: ¥12.')
    expect(dailySummary(dailySeries([], '2026-10', '2026-10-05', null), 'CNY')).toBe('No day-to-day spending in October yet.')
  })
})

describe('spending by category', () => {
  it('Jing: biggest first, the tail folded, shares of the month’s spending', () => {
    const c = categoryBars(jing.summary, 7)
    expect(c.rows.map((r) => r.id)).toEqual(['housing', 'shopping', 'dining', 'groceries', 'delivery', 'subscriptions', REST_ID])
    expect(c.total).toBe(jing.summary.spent)
    expect(c.rows.reduce((s, r) => s + r.spent, 0)).toBe(jing.summary.spent)
    const rest = c.rows[c.rows.length - 1]
    // entertainment + transport + coffee + personal care + phone
    expect(rest.spent).toBe(54800 + 31196 + 19380 + 14477 + 10000)
    expect(rest.folded).toBe(5)
    expect(c.rows[0].shareText).toBe('35%')
    expect(c.max).toBe(420000)
  })

  it('carries each category’s cap and whether it was passed', () => {
    const c = categoryBars(jing.summary, 20)
    const by = Object.fromEntries(c.rows.map((r) => [r.id, r]))
    expect(by.shopping.limit).toBe(52000)
    expect(by.shopping.overLimit).toBe(true)
    expect(by.housing.overLimit).toBe(false) // exactly at the cap is not over it
    expect(by.transport.overLimit).toBe(false)
    expect(c.rows.some((r) => r.id === REST_ID)).toBe(false)
    // categories with a cap and nothing spent stay off the chart
    expect(c.rows.every((r) => r.spent > 0)).toBe(true)
  })

  it('share text rounds, and never calls a real share zero', () => {
    expect(shareText(34.6)).toBe('35%')
    expect(shareText(0.4)).toBe('<1%')
    expect(shareText(0)).toBe('0%')
    expect(shareText(Number.NaN)).toBe('0%')
  })

  it('an empty month has no rows', () => {
    const empty: MonthSummary = { ...jing.summary, spent: 0, byCategory: [] }
    const c = categoryBars(empty)
    expect(c).toEqual({ rows: [], total: 0, max: 0 })
    expect(categorySummary(c, '2026-10', 'CNY')).toBe('No spending in October yet.')
    expect(categorySummary(categoryBars(jing.summary), '2026-10', 'CNY')).toBe('Spending by category in October, ¥12,080.24 in all. Biggest: Rent & housing, ¥4,200 (35%).')
  })
})

describe('the last six months', () => {
  it('Jing: spent against target, with what went over and what was left', () => {
    const m = monthColumns(jing.snap.derived.history, jing.summary, false)
    expect(m.cols.map((c) => c.short)).toEqual(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
    expect(m.cols.map((c) => c.over)).toEqual([true, false, true, true, true, true])
    expect(m.overCount).toBe(5)
    const june = m.cols[1]
    expect(june.left).toBe(950000 - 944469)
    expect(june.overBy).toBe(0)
    const oct = m.cols[5]
    expect(oct.current).toBe(true)
    expect(oct.overBy).toBe(258024)
    expect(oct.left).toBe(0)
    // a round axis at or above every bar
    expect(m.max).toBeGreaterThanOrEqual(1208024)
    expect(m.ticks[0]).toBe(0)
    expect(m.ticks[m.ticks.length - 1]).toBe(m.max)
  })

  it('names each month’s result in the app’s words', () => {
    const m = monthColumns(jing.snap.derived.history, jing.summary, false)
    expect(monthColumnNote(m.cols[1], 'CNY')).toBe('¥55.31 left over')
    expect(monthColumnNote(m.cols[5], 'CNY')).toBe('¥2,580.24 over budget')
    const a = monthColumns(arif.snap.derived.history, arif.summary, false)
    expect(monthColumnNote(a.cols[5], 'CNY')).toBe('¥1,334.68 left before the ¥3,600 target')
    expect(a.overCount).toBe(0)
    expect(monthColumnsSummary(a, 'CNY')).toBe('Spending for the last 6 months. October so far: ¥2,265.32 of a ¥3,600 target. No month went over budget.')
    expect(monthColumnsSummary(m, 'CNY')).toBe('Spending for the last 6 months. October so far: ¥12,080.24 of a ¥9,500 target, ¥2,580.24 over budget. 5 of 6 months went over budget.')
  })

  it('daily tracking has no targets to hold a month against', () => {
    const m = monthColumns(jing.snap.derived.history, jing.summary, true)
    expect(m.cols.every((c) => c.target === null && !c.over && c.overBy === 0 && c.left === 0)).toBe(true)
    expect(monthColumnNote(m.cols[5], 'CNY')).toBeUndefined()
    expect(monthColumnsSummary(m, 'CNY')).toBe('Spending for the last 6 months. October so far: ¥12,080.24.')
    expect(monthColumnsSummary(monthColumns([], null, false), 'CNY')).toBe('No months to compare yet.')
  })
})

describe('goals', () => {
  it('Jing: goals first, then treats, each with its progress and its date', () => {
    const rows = goalRows(jing.snap.state.dreams, jing.snap.derived.goals, 'CNY')
    expect(rows.map((r) => r.name)).toEqual(['Birkin 25', 'Weekend in Chengdu', 'AirPods Pro', 'New running shoes'])
    expect(rows.map((r) => r.kind)).toEqual(['goal', 'goal', 'treat', 'treat'])
    const birkin = rows[0]
    expect(birkin.saved).toBe(2330000)
    expect(birkin.price).toBe(9800000)
    expect(birkin.pct).toBeCloseTo(23.8)
    expect(birkin.factValue).toBe('By Dec 2028')
    expect(birkin.factSub).toBe('Needs ¥2,835/mo · ¥93/day')
    expect(birkin.onSchedule).toBe(false)
    // no deadline: the pace's own estimate, and no schedule to be on or off
    expect(rows[1].onSchedule).toBeUndefined()
    expect(rows[1].funded).toBe(false)
  })

  it('leaves achieved dreams out and clamps the bar', () => {
    const dreams = jing.snap.state.dreams.map((d, i) => (i === 3 ? { ...d, achievedAt: '2026-10-01' } : d))
    const rows = goalRows(dreams, [{ itemId: dreams[0].id, name: dreams[0].name, saved: 9900000, price: 9800000, pct: 101, monthlyRate: 0 }], 'CNY')
    expect(rows).toHaveLength(3)
    expect(rows[0].pct).toBe(100)
    expect(rows[0].funded).toBe(true)
  })
})

describe('transactions', () => {
  const accounts: Account[] = [
    { id: 'chk_main', name: 'Checking', type: 'checking', balance: 0, currency: 'CNY' },
    { id: 'pot_a', name: 'Pot', type: 'pot', balance: 0, currency: 'CNY' },
  ]
  const txns = [
    txn('2026-10-20', -1000, 'dining', { merchant: 'Hunan Kitchen', time: '12:29' }),
    txn('2026-10-22', -600, 'transport', { merchant: 'Shenzhen Metro', time: '09:08' }),
    txn('2026-10-22', -7290, 'delivery', { merchant: 'Meituan Delivery', time: '00:52', description: 'MEITUAN*美团外卖 luosifen' }),
    txn('2026-10-22', -500, 'transport', { merchant: 'Shenzhen Metro', time: '20:11' }),
    txn('2026-10-21', -50000, 'savings', { merchant: 'To Birkin pot' }),
    txn('2026-10-21', 50000, 'savings', { merchant: 'Birkin pot', accountId: 'pot_a' }),
    txn('2026-10-25', -12800, 'phone_internet', { merchant: 'China Mobile' }),
    txn('2026-10-21', -300, 'coffee_tea', { merchant: 'Chagee' }),
  ]

  it('newest first, nothing after today, and no pot side of a move', () => {
    const rows = ledgerRows(txns, accounts, '2026-10-22')
    expect(rows.map((t) => `${t.date} ${t.time ?? ''} ${t.merchant}`.replace(/\s+/g, ' '))).toEqual([
      '2026-10-22 20:11 Shenzhen Metro',
      '2026-10-22 09:08 Shenzhen Metro',
      '2026-10-22 00:52 Meituan Delivery',
      '2026-10-21 Chagee',
      '2026-10-21 To Birkin pot',
      '2026-10-20 12:29 Hunan Kitchen',
    ])
  })

  it('searches merchant, description and category name; filters by category', () => {
    const rows = ledgerRows(txns, accounts, '2026-10-22')
    expect(filterTxns(rows, { query: '  metro ', category: 'all' })).toHaveLength(2)
    expect(filterTxns(rows, { query: 'LUOSIFEN', category: 'all' }).map((t) => t.merchant)).toEqual(['Meituan Delivery'])
    expect(filterTxns(rows, { query: 'coffee', category: 'all' }).map((t) => t.merchant)).toEqual(['Chagee'])
    expect(filterTxns(rows, { query: 'shenzhen kitchen', category: 'all' })).toEqual([])
    expect(filterTxns(rows, { query: '', category: 'transport' })).toHaveLength(2)
    expect(filterTxns(rows, { query: 'metro', category: 'dining' })).toEqual([])
    expect(filterTxns(rows, { query: '', category: 'all' })).toHaveLength(rows.length)
  })

  it('lists the categories on the ledger by name, with their row counts', () => {
    const rows = ledgerRows(txns, accounts, '2026-10-22')
    expect(txnCategories(rows)).toEqual([
      { id: 'coffee_tea', label: 'Coffee & milk tea', count: 1 },
      { id: 'dining', label: 'Eating out', count: 1 },
      { id: 'delivery', label: 'Food delivery', count: 1 },
      { id: 'savings', label: 'Goal savings', count: 1 },
      { id: 'transport', label: 'Transport', count: 2 },
    ])
  })

  it('Jing’s ledger: every row once, in order, a page at a time', () => {
    const { transactions, accounts: accts } = jing.snap.state.bank
    const rows = ledgerRows(transactions, accts, jing.snap.derived.today)
    expect(rows.length).toBeGreaterThan(TXN_PAGE)
    expect(rows.length).toBeLessThanOrEqual(transactions.length)
    expect(new Set(rows.map((t) => t.id)).size).toBe(rows.length)
    expect(rows.every((t, i) => i === 0 || rows[i - 1].date >= t.date)).toBe(true)
    expect(rows[0].date).toBe('2026-10-22')
    expect(rows.every((t) => !t.accountId.startsWith('pot_'))).toBe(true)
  })

  it('dates name the year only when it is not this one', () => {
    expect(txnDate('2026-10-22', '2026-10-22')).toBe('Oct 22')
    expect(txnDate('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025')
  })

  it('says how many rows are showing', () => {
    expect(txnCountLine(50, 856, 856)).toBe('Showing 50 of 856 transactions')
    expect(txnCountLine(12, 12, 856)).toBe('12 of 856 transactions')
    expect(txnCountLine(50, 61, 856)).toBe('Showing 50 of 61 of 856 transactions')
    expect(txnCountLine(1, 1, 1)).toBe('1 transaction')
    expect(txnCountLine(0, 0, 856)).toBe('No transactions match')
    expect(txnCountLine(0, 0, 0)).toBe('No transactions yet')
    expect(txnCountLine(1200, 1200, 1200)).toBe('1,200 transactions')
  })
})
