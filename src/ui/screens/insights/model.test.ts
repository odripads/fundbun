import { beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage, type FundBunApp } from '../../../core/app'
import type { AppSnapshot } from '../../../core/app-api'
import { generateInsights, summarizeMonth } from '../../../core/finance'
import type { FinanceContext, Insight, MonthSummary, Transaction } from '../../../core/types'
import {
  askAboutCategory,
  askAboutInsight,
  bodyWithoutDream,
  categoryCounts,
  categoryRows,
  dailyStat,
  evidenceRows,
  featuredInsight,
  groupByDay,
  guideStatus,
  headlineCopy,
  heatLevel,
  heatmap,
  heatSummary,
  hourOf,
  HOUR_ORDER,
  humanize,
  insightsFor,
  insightsQuery,
  isDayToDay,
  isLateHour,
  ledgerTxns,
  meter,
  monthChoices,
  monthName,
  moodFor,
  niceTicks,
  parseLimit,
  pickerCategories,
  previousComparison,
  resolveMonth,
  resolveTab,
  rowOf,
  shortAmount,
  severityView,
  split,
  splitSlices,
  summaryFor,
  topMerchants,
  trendBars,
  trendGeometry,
  trendSummary,
  txnSubtitle,
  txnWhen,
  vsPrevStat,
  vsTargetStat,
  insightMonthOf,
  needsExpandFor,
  categoryCompareText,
} from './model'
import { countFrame, easeOut } from './useCountUp'

interface Persona {
  app: FundBunApp
  snap: AppSnapshot
  ctx: FinanceContext
  s: MonthSummary
}

function persona(id: 'mei' | 'arif'): Persona {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  const snap = app.getSnapshot()
  if (!snap.derived.ctx || !snap.derived.summary) throw new Error('demo did not load')
  return { app, snap, ctx: snap.derived.ctx, s: snap.derived.summary }
}

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    accountId: 'chk_main',
    date: '2026-10-21',
    time: '23:40',
    amount: -6500,
    currency: 'CNY',
    merchant: 'Meituan Delivery',
    description: 'Meituan',
    category: 'delivery',
    categorySource: 'rule',
    categoryConfidence: 0.9,
    ...over,
  }
}

let mei: Persona
let arif: Persona

beforeAll(() => {
  mei = persona('mei')
  arif = persona('arif')
})

describe('months', () => {
  it('offers the six history months, oldest first, with the current one marked', () => {
    const c = monthChoices(mei.snap.derived.history, '2026-10')
    expect(c.map((x) => x.short)).toEqual(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
    expect(c.filter((x) => x.current).map((x) => x.value)).toEqual(['2026-10'])
    expect(c[0].long).toBe('May')
  })

  it('falls back to the current month when there is no history', () => {
    expect(monthChoices([], '2026-10').map((x) => x.value)).toEqual(['2026-10'])
  })

  it('honours a month from the URL only when it is offered', () => {
    const c = monthChoices(mei.snap.derived.history, '2026-10')
    expect(resolveMonth('2026-08', c, '2026-10')).toBe('2026-08')
    expect(resolveMonth('2025-01', c, '2026-10')).toBe('2026-10')
    expect(resolveMonth(undefined, c, '2026-10')).toBe('2026-10')
    expect(resolveMonth('<script>', c, '2026-10')).toBe('2026-10')
  })

  it('resolves tabs and keeps default values out of the URL', () => {
    expect(resolveTab('patterns')).toBe('patterns')
    expect(resolveTab('nope')).toBe('overview')
    expect(resolveTab(undefined)).toBe('overview')
    expect(insightsQuery({ month: '2026-10', tab: 'overview', current: '2026-10' })).toEqual({})
    expect(insightsQuery({ month: '2026-09', tab: 'transactions', current: '2026-10', cat: 'dining', q: 'luckin' })).toEqual({
      month: '2026-09',
      tab: 'transactions',
      cat: 'dining',
      q: 'luckin',
    })
  })

  it('names months', () => {
    expect(monthName('2026-10')).toBe('October')
    expect(monthName('2026-10', 'short')).toBe('Oct')
  })
})

describe('month data', () => {
  it('uses the engine summary for the current month and summarises past months on demand', () => {
    expect(summaryFor(mei.ctx, '2026-10', mei.s)).toBe(mei.s)
    const sep = summaryFor(mei.ctx, '2026-09', mei.s)
    expect(sep.isCurrent).toBe(false)
    expect(sep.spent).toBe(summarizeMonth(mei.ctx, '2026-09').spent)
  })

  it('uses derived insights for the current month and the generator for past months', () => {
    const current = mei.snap.derived.insights
    expect(insightsFor(mei.ctx, '2026-10', '2026-10', current)).toBe(current)
    const sep = insightsFor(mei.ctx, '2026-09', '2026-10', current)
    expect(sep).toEqual(generateInsights(mei.ctx, '2026-09'))
    expect(sep.every((i) => i.id.includes('2026-09'))).toBe(true)
  })

  it('drops the pot side of a move into a goal pot so savings show once', () => {
    const pots = new Set(mei.ctx.bank.accounts.filter((a) => a.type === 'pot').map((a) => a.id))
    const oct = mei.app.transactions({ month: '2026-10' })
    const ledger = ledgerTxns(oct, pots)
    expect(oct.some((t) => pots.has(t.accountId))).toBe(true)
    expect(ledger.some((t) => pots.has(t.accountId))).toBe(false)
    expect(ledger.filter((t) => t.category === 'savings')).toHaveLength(1)
    expect(ledgerTxns(oct, new Set())).toBe(oct)
  })
})

describe('headline', () => {
  it('compares like with like: the same days of last month for the current month', () => {
    const c = previousComparison(mei.ctx, mei.s)
    expect(c?.label).toBe('Sep 1–22')
    expect(c!.amount).toBeGreaterThan(0)
    expect(c!.diff).toBe(mei.s.spent - c!.amount)
    expect(c!.amount).toBeLessThan(mei.snap.derived.history.find((h) => h.month === '2026-09')!.spent)
  })

  it('compares a finished month with the whole previous month', () => {
    const sep = summarizeMonth(mei.ctx, '2026-09')
    const c = previousComparison(mei.ctx, sep)
    expect(c?.label).toBe('Aug')
    expect(c?.amount).toBe(summarizeMonth(mei.ctx, '2026-08').spent)
  })

  it('returns null when the previous month has no data', () => {
    expect(previousComparison(mei.ctx, { ...mei.s, month: '2020-01' })).toBeNull()
  })

  it('is tone-aware and never shames in the gentle voice', () => {
    expect(headlineCopy(mei.s, 'cheeky', 'CNY')).toMatch(/^¥2,580 over, with 9 days to go/)
    const gentle = headlineCopy(mei.s, 'gentle', 'CNY')
    expect(gentle).toMatch(/past your target/)
    expect(gentle).not.toMatch(/ouch|sweat|over —/i)
    expect(headlineCopy(mei.s, 'numbers', 'CNY')).toBe('¥2,580 over target · 9 days left.')
    expect(headlineCopy(arif.s, 'gentle', 'CNY')).toMatch(/^On pace to finish ¥\d{3} under\. Lovely\.$/)
  })

  it('speaks about finished months in the past tense', () => {
    const sep = summarizeMonth(arif.ctx, '2026-09')
    expect(headlineCopy(sep, 'gentle', 'CNY')).toMatch(/^Finished ¥381 under target/)
    expect(headlineCopy({ ...sep, spent: 0 }, 'gentle', 'CNY')).toBe('No spending recorded this month.')
  })

  it('picks Bun’s mood from the status; gentle never gets the burnt bun', () => {
    expect(moodFor('over', 'cheeky')).toBe('burnt')
    expect(moodFor('over', 'gentle')).toBe('worried')
    expect(moodFor('under', 'gentle')).toBe('happy')
    expect(moodFor('no_data', 'numbers')).toBe('sleepy')
  })

  it('builds the target and previous-month stats with direction and good/bad', () => {
    const t = vsTargetStat(mei.s)
    expect(t).toMatchObject({ label: 'Over target', amount: mei.s.spent - mei.s.target, direction: 'up', good: false })
    const a = vsTargetStat(arif.s)
    expect(a).toMatchObject({ label: 'Left to target', direction: 'down', good: true, note: '9 days left' })
    expect(vsTargetStat(summarizeMonth(arif.ctx, '2026-09'))).toMatchObject({ label: 'Under target', note: '11% under' })
    expect(t.note).toBe('27% over')
    expect(dailyStat(mei.s)).toMatchObject({ label: 'Per day', amount: mei.s.dailyAvg, note: '22-day average' })
    const prev = vsPrevStat(previousComparison(mei.ctx, mei.s))
    expect(prev?.label).toBe('vs Sep 1–22')
    expect(prev?.direction).toBe('up')
    expect(prev?.good).toBe(false)
    expect(prev?.note).toMatch(/^\d+% more$/)
    expect(vsPrevStat({ amount: 0, label: 'Sep', diff: 500, pct: null })?.note).toBe('new spending')
    expect(vsPrevStat(null)).toBeNull()
    expect(vsPrevStat({ amount: 1000, label: 'Sep', diff: 5, pct: 1 })).toMatchObject({ direction: 'flat', note: 'about the same' })
  })
})

describe('meter', () => {
  it('puts spent, target and pace on one scale', () => {
    const m = meter(mei.s)
    expect(m.projectedPct).toBe(100)
    expect(m.over).toBe(true)
    expect(m.targetPct).toBeLessThan(m.spentPct)
    expect(m.withinPct).toBe(m.targetPct)
  })

  it('stays within 0..100 for an under month and an empty one', () => {
    const m = meter(arif.s)
    expect(m.over).toBe(false)
    expect(m.targetPct).toBe(100)
    expect(m.spentPct).toBe(m.withinPct)
    const empty = meter({ ...arif.s, spent: 0, projected: 0, target: 0 })
    expect(empty).toMatchObject({ spentPct: 0, targetPct: 0, over: false })
  })
})

describe('categories and split', () => {
  it('lists spending categories biggest first with their limits', () => {
    const rows = categoryRows(mei.s)
    expect(rows[0].id).toBe('housing')
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].spent).toBeGreaterThanOrEqual(rows[i].spent)
    const shopping = rows.find((r) => r.id === 'shopping')!
    expect(shopping.limit).toBeLessThan(shopping.spent)
    expect(shopping.emoji).toBe('🛍️')
  })

  it('splits the month into needs, wants and saved, and finds the notable gap', () => {
    const sp = split(mei.s, 'CNY')
    expect(sp.needs + sp.wants).toBe(mei.s.spent)
    expect(sp.saved).toBe(mei.s.savedToGoals)
    expect(sp.takeaway).toBe('You saved 11% of your income (¥2,000). About ¥1,700 more a month reaches the 20% guide.')
    expect(split({ ...mei.s, savedToGoals: 0 }, 'CNY').takeaway).toBe('Nothing has gone to your goals yet. ¥3,700 a month would reach the 20% guide.')
    expect(split({ ...mei.s, income: 0 }, 'CNY').takeaway).toBeNull()
  })

  it('makes the ring add up to income so shares mean share of income', () => {
    const sp = split(arif.s, 'CNY')
    const slices = splitSlices(sp, true)
    expect(slices.map((x) => x.id)).toEqual(['needs', 'wants', 'saved', 'unspent'])
    expect(slices.reduce((t, x) => t + x.value, 0)).toBe(sp.income)
    expect(slices.find((x) => x.id === 'unspent')?.label).toBe('Not spent yet')
    expect(splitSlices(sp, false).find((x) => x.id === 'unspent')?.label).toBe('Left over')
    const overspent = splitSlices({ ...sp, income: 1000 }, true)
    expect(overspent.some((x) => x.id === 'unspent')).toBe(false)
  })

  it('judges each share against the 50/30/20 guide with a tolerance', () => {
    expect(guideStatus({ id: 'wants', label: 'Wants', value: 1, pct: 40, guide: 30, color: '' })).toBe('over')
    expect(guideStatus({ id: 'wants', label: 'Wants', value: 1, pct: 32, guide: 30, color: '' })).toBe('ok')
    expect(guideStatus({ id: 'saved', label: 'Saved', value: 1, pct: 10, guide: 20, color: '' })).toBe('under')
    expect(guideStatus({ id: 'saved', label: 'Saved', value: 1, pct: 25, guide: 20, color: '' })).toBe('ok')
    expect(guideStatus({ id: 'unspent', label: 'Left', value: 1, pct: 10, color: '' })).toBeNull()
  })
})

describe('trend', () => {
  it('flags over months and projects the current one', () => {
    const bars = trendBars(mei.snap.derived.history, mei.s)
    expect(bars).toHaveLength(6)
    expect(bars.filter((b) => b.over).map((b) => b.short)).toEqual(['May', 'Jul', 'Aug', 'Sep', 'Oct'])
    const oct = bars[5]
    expect(oct.current).toBe(true)
    expect(oct.projected).toBe(mei.s.projected)
    expect(bars[0].projected).toBeUndefined()
  })

  it('draws on one scale whose top tick covers every value', () => {
    const bars = trendBars(mei.snap.derived.history, mei.s)
    const g = trendGeometry(bars)
    expect(g.ticks[0]).toBe(0)
    expect(g.max).toBeGreaterThanOrEqual(mei.s.projected)
    expect(g.ticks.every((t) => t <= g.max)).toBe(true)
    expect(g.ticks.length).toBeGreaterThanOrEqual(3)
    for (const b of g.bars) {
      expect(b.spentPct).toBeLessThanOrEqual(100)
      expect(b.targetPct).toBeGreaterThan(0)
    }
    expect(g.bars[5].projectedPct).toBeGreaterThan(g.bars[5].spentPct)
  })

  it('summarises the trend in words', () => {
    const text = trendSummary(trendBars(mei.snap.derived.history, mei.s), 'CNY')
    expect(text).toMatch(/^4 of the last 5 finished months went over target/)
    expect(text).toMatch(/October so far: ¥12,080, heading for about ¥15,230\./)
    expect(trendSummary([], 'CNY')).toBe('No months to compare yet.')
    expect(trendSummary(trendBars(arif.snap.derived.history, arif.s), 'CNY')).toMatch(/^All 5 finished months came in under target, averaging ¥3,286\./)
  })

  it('labels bar tops compactly in major units', () => {
    expect(shortAmount(959188, 'CNY')).toBe('9.6k')
    expect(shortAmount(1208024, 'CNY')).toBe('12.1k')
    expect(shortAmount(85000, 'CNY')).toBe('850')
    expect(shortAmount(25000000, 'CNY')).toBe('250k')
  })

  it('makes nice ticks', () => {
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(-5)).toEqual([0])
    expect(niceTicks(Number.NaN)).toEqual([0])
    expect(niceTicks(360000, 3)).toEqual([0, 200000, 400000])
    const t = niceTicks(1523000, 3)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1523000)
  })
})

describe('habits', () => {
  it('starts the hour axis at 04:00 so late night is one block', () => {
    expect(HOUR_ORDER[0]).toBe(4)
    expect(HOUR_ORDER.slice(18)).toEqual([22, 23, 0, 1, 2, 3])
    expect([22, 23, 0, 3].every(isLateHour)).toBe(true)
    expect([4, 12, 21].some(isLateHour)).toBe(false)
  })

  it('rows are Monday-first and hours parse defensively', () => {
    expect(rowOf('2026-10-19')).toBe(0)
    expect(rowOf('2026-10-25')).toBe(6)
    expect(hourOf(txn({ time: '00:52' }))).toBe(0)
    expect(hourOf(txn({ time: undefined }))).toBeNull()
    expect(hourOf(txn({ time: '99:00' }))).toBeNull()
    expect(hourOf(txn({ time: 'late' }))).toBeNull()
  })

  it('leaves rent, bills and subscriptions out of habits', () => {
    expect(isDayToDay(txn())).toBe(true)
    expect(isDayToDay(txn({ category: 'housing' }))).toBe(false)
    expect(isDayToDay(txn({ category: 'dining', billId: 'b1' }))).toBe(false)
    expect(isDayToDay(txn({ amount: 500 }))).toBe(false)
  })

  it('maps Mei’s October with the late-night delivery habit', () => {
    const map = heatmap(mei.ctx.bank.transactions, '2026-10')
    expect(map.count).toBeGreaterThan(50)
    expect(map.late.count).toBeGreaterThanOrEqual(10)
    expect(map.late.delivery).toBeGreaterThan(0)
    const cellTotal = map.cells.flat().reduce((t, c) => t + c.amount, 0)
    expect(cellTotal).toBe(map.total)
    const bandTotal = map.bands.flat().reduce((t, v) => t + v, 0)
    expect(bandTotal).toBe(map.total)
    expect(map.busiest!.amount).toBe(map.max)
    expect(heatSummary(map, 'October', 'CNY')).toMatch(/Late night \(22:00–04:00\): \d+ purchases, ¥[\d,.]+, \d+ of them food delivery\./)
  })

  it('reconciles with the engine’s late-night insight: both count the habit, not the scheduled midnight renewals', () => {
    const insight = mei.snap.derived.insights.find((i) => i.kind === 'late_night')!
    const map = heatmap(mei.ctx.bank.transactions, '2026-10')
    expect(map.late.count).toBe(insight.evidence.count)
    expect(map.late.amount).toBe(insight.evidence.total)
    expect(map.lateScheduled.count).toBeGreaterThan(0)
  })

  it('handles an empty month and untimed purchases', () => {
    const map = heatmap([txn({ time: undefined, date: '2026-10-01' })], '2026-10')
    expect(map).toMatchObject({ count: 0, untimed: 1, max: 0, busiest: null })
    expect(heatSummary(map, 'October', 'CNY')).toBe('No timed day-to-day purchases in October.')
  })

  it('scales heat on a square root with a visible floor', () => {
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(100, 0)).toBe(0)
    expect(heatLevel(100, 100)).toBe(1)
    expect(heatLevel(25, 100)).toBe(0.5)
    expect(heatLevel(0.01, 100)).toBe(0.12)
  })

  it('ranks day-to-day merchants without rent', () => {
    const rows = topMerchants(mei.ctx.bank.transactions, '2026-10', mei.s.spent, 5)
    expect(rows).toHaveLength(5)
    expect(rows[0].merchant).toBe('Taobao')
    expect(rows.some((r) => /landlord|rent/i.test(r.merchant))).toBe(false)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].amount).toBeGreaterThanOrEqual(rows[i].amount)
    expect(rows[0].share).toBeCloseTo((rows[0].amount / mei.s.spent) * 100, 0)
    const meituan = rows.find((r) => r.merchant === 'Meituan Delivery')
    expect(meituan?.late).toBeGreaterThan(0)
    expect(topMerchants([], '2026-10', 0)).toEqual([])
  })
})

describe('transactions', () => {
  it('groups newest-first rows by day with the day’s spend', () => {
    const rows = [txn({ id: 'a', date: '2026-10-22' }), txn({ id: 'b', date: '2026-10-22', amount: -1000 }), txn({ id: 'c', date: '2026-10-20', amount: 500000, category: 'income' })]
    const g = groupByDay(rows, '2026-10-22')
    expect(g.map((x) => x.label)).toEqual(['Today', 'Tue, Oct 20'])
    expect(g[0].spent).toBe(7500)
    expect(g[1].spent).toBe(0)
  })

  it('counts categories for the filter chips', () => {
    const c = categoryCounts([txn(), txn({ id: 'b' }), txn({ id: 'c', category: 'dining' })])
    expect(c).toEqual([{ id: 'delivery', count: 2 }, { id: 'dining', count: 1 }])
  })

  it('describes a row: category, time, late night and user edits', () => {
    expect(txnSubtitle(txn())).toBe('Food delivery · 23:40 · late')
    expect(txnSubtitle(txn({ time: '12:00', categorySource: 'user' }))).toBe('Food delivery · 12:00 · edited')
    expect(txnWhen(txn())).toBe('Oct 21 · 23:40 · late night')
    expect(txnWhen(txn({ time: undefined }))).toBe('Oct 21')
  })

  it('offers spending categories first, then savings, transfers and income', () => {
    const p = pickerCategories()
    expect(p.slice(-3)).toEqual(['savings', 'transfer', 'income'])
    expect(new Set(p).size).toBe(p.length)
    expect(p).toContain('delivery')
  })
})

describe('insight cards', () => {
  it('formats evidence by kind and hides internal ids', () => {
    const rows = evidenceRows({ thisMonth: 202740, comparedWith: 45520, change: 157220, pct: 345, count: 21, topCategory: 'delivery', ratio: 2.3, score: 4.25, txnId: 'x', date: '2026-10-04', merchant: 'Taobao', ratePct: 10.5 }, 'CNY')
    const by = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(by).toMatchObject({
      thisMonth: '¥2,027.40',
      comparedWith: '¥455.20',
      change: '+¥1,572.20',
      pct: '+345%',
      count: '21',
      topCategory: 'Food delivery',
      ratio: '2.3×',
      score: '4.3',
      date: 'Oct 4',
      merchant: 'Taobao',
      ratePct: '10.5%',
    })
    expect(by.txnId).toBeUndefined()
    expect(rows.find((r) => r.key === 'thisMonth')?.label).toBe('This month')
    expect(humanize('someNewKey')).toBe('Some new key')
    expect(evidenceRows({ bad: Number.NaN }, 'CNY')).toEqual([])
  })

  it('drops a closing "That’s <dream>." sentence the chip already shows', () => {
    expect(bodyWithoutDream("21 purchases between 10pm and 4am. That's 1.3% of your Birkin 25.", '1.3% of your Birkin 25')).toBe('21 purchases between 10pm and 4am.')
    expect(bodyWithoutDream("¥208.30 less. That's 2.6% of your MacBook Air you kept.", '2.6% of your MacBook Air')).toBe('¥208.30 less.')
    const kept = '¥1,682 vs ¥674. The extra ¥1,008 = 1% of your Birkin 25.'
    expect(bodyWithoutDream(kept, '1% of your Birkin 25')).toBe(kept)
    expect(bodyWithoutDream("That's 2× New sneakers (2.5).", '2× New sneakers (2.5)')).toBe("That's 2× New sneakers (2.5).")
  })

  it('labels severity with words, not just colour', () => {
    expect(severityView('warn')).toEqual({ label: 'Heads-up', tone: 'over' })
    expect(severityView('positive').label).toBe('Nice one')
    expect(severityView('neutral').label).toBe('Pattern')
  })

  it('features the engine’s most useful insight first', () => {
    const { featured, rest } = featuredInsight(mei.snap.derived.insights)
    expect(featured?.kind).toBe('pace_warning')
    expect(rest).toHaveLength(mei.snap.derived.insights.length - 1)
    expect(featuredInsight([])).toEqual({ featured: null, rest: [] })
  })

  it('asks Bun questions the on-device engine routes well', () => {
    const base: Insight = { id: 'i', kind: 'pace_warning', title: '', body: '', severity: 'warn', why: '', evidence: {} }
    expect(askAboutInsight(base, '2026-10')).toBe('How am I doing in October?')
    expect(askAboutInsight({ ...base, kind: 'top_merchant', evidence: { merchant: 'Taobao' } }, '2026-10')).toBe('Show me my Taobao spending in October')
    expect(askAboutInsight({ ...base, kind: 'category_up', category: 'shopping' }, '2026-09')).toBe('How much did I spend on shopping in September?')
    expect(askAboutInsight({ ...base, kind: 'subscription_load' }, '2026-10')).toBe('What subscriptions do I have?')
    expect(askAboutInsight({ ...base, kind: 'savings_rate' }, '2026-10')).toBe('How are my goals going?')
    expect(askAboutInsight({ ...base, kind: 'weekend_spike' }, '2026-10')).toBe('What are my spending insights?')
    expect(askAboutCategory('delivery', '2026-10')).toBe('How much did I spend on food delivery in October?')
  })

  it('every current insight has a why and evidence (the "Why?" panel is never empty)', () => {
    for (const i of [...mei.snap.derived.insights, ...arif.snap.derived.insights]) {
      expect(i.why.length).toBeGreaterThan(10)
      expect(evidenceRows(i.evidence, 'CNY').length).toBeGreaterThan(0)
    }
  })
})

describe('budget edit', () => {
  it('parses whole amounts and allows 0 to remove a limit', () => {
    expect(parseLimit('600', 'CNY', 950000)).toEqual({ ok: true, value: 60000 })
    expect(parseLimit('¥1,250.40', 'CNY', 950000)).toEqual({ ok: true, value: 125000 })
    expect(parseLimit('0', 'CNY', 950000)).toEqual({ ok: true, value: 0 })
  })

  it('rejects empty, junk and absurd limits', () => {
    expect(parseLimit('  ', 'CNY', 950000).ok).toBe(false)
    expect(parseLimit('lots', 'CNY', 950000).ok).toBe(false)
    const huge = parseLimit('200000', 'CNY', 950000)
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.error).toMatch(/10×/)
  })
})

describe('count-up', () => {
  it('eases out and lands exactly on the target in whole units', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(2)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
    expect(countFrame(0, 1208024, 1)).toBe(1208000)
    expect(countFrame(1000000, 0, 0)).toBe(1000000)
    expect(countFrame(0, 10000, 0.5) % 100).toBe(0)
  })
})

describe('insight deep links', () => {
  it('reads the month from an engine insight id', () => {
    expect(insightMonthOf('ins_late_night_2026-10')).toBe('2026-10')
    expect(insightMonthOf('ins_category_up_2026-09_delivery')).toBe('2026-09')
    expect(insightMonthOf('ins_anomaly_2026-10_txn_abc')).toBe('2026-10')
    expect(insightMonthOf('nope')).toBeUndefined()
    expect(insightMonthOf(undefined)).toBeUndefined()
  })

  it('unfolds the list only when the linked card is beyond the first ones shown', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }) as Insight)
    expect(needsExpandFor('b', list, 3)).toBe(false)
    expect(needsExpandFor('d', list, 3)).toBe(true)
    expect(needsExpandFor('zzz', list, 3)).toBe(false)
    expect(needsExpandFor(undefined, list, 3)).toBe(false)
  })
})

describe('categoryCompareText', () => {
  const row = { category: 'delivery' as const, spent: 40_000, count: 4, prevMonth: 90_000, prevMonthToDate: 30_000 }
  const base = { month: '2026-10', isCurrent: true, dayOfMonth: 22, byCategory: [row] } as unknown as MonthSummary
  it('a month in progress compares with the same days of last month, then names all of it', () => {
    expect(categoryCompareText(base, 'delivery', 'CNY')).toBe('By Sep 22: ¥300 (+33% now) · all of September: ¥900')
  })
  it('a finished month compares with the whole previous month', () => {
    expect(categoryCompareText({ ...base, isCurrent: false } as MonthSummary, 'delivery', 'CNY')).toBe('September: ¥900 (−56% in Oct)')
  })
  it('caps the day at the previous month’s length and handles an empty previous month', () => {
    const march = { ...base, month: '2026-03', dayOfMonth: 31 } as MonthSummary
    expect(categoryCompareText(march, 'delivery', 'CNY')).toMatch(/^By Feb 28: /)
    expect(categoryCompareText(base, 'groceries', 'CNY')).toBe('Nothing here in September.')
  })
})
