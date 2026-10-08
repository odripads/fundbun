import { describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage } from '../../../core/app'
import type { AppSnapshot } from '../../../core/app-api'
import type { Bill, DreamItem, GoalProgress, Insight, MirrorState, MonthSummary, TripwireEvent } from '../../../core/types'
import {
  STATUS_META,
  affordabilityQuestion,
  barPx,
  billIcon,
  couldveHeadline,
  ctaHint,
  ctaIcon,
  delayReason,
  divergingScale,
  dueLabel,
  dueTone,
  fmtWhole,
  freshEvents,
  heroDream,
  historyBars,
  hoursReason,
  hoursText,
  itemReason,
  leadEvent,
  mirrorEyebrow,
  mirrorStats,
  monthName,
  monthTrack,
  monthTrackSummary,
  newestFirst,
  nextBills,
  paceLine,
  payAction,
  pctAfter,
  peekInsights,
  relativeTime,
  safeToSpendNote,
  sameIds,
  shortDate,
  shortDelay,
  splitHeadline,
  stashAmount,
  statusRule,
  treatOf,
  verdictMeta,
} from './model'

function demo(id: 'mei' | 'arif'): AppSnapshot {
  const app = createTestApp({ storage: memoryStorage() })
  app.loadDemo(id)
  return app.getSnapshot()
}

const dream = (over: Partial<DreamItem> = {}): DreamItem => ({
  id: 'dream_x',
  name: 'Thing',
  price: 100_000,
  image: 'preset:gift',
  kind: 'goal',
  createdAt: '2026-01-01',
  ...over,
})

const goal = (over: Partial<GoalProgress> = {}): GoalProgress => ({
  itemId: 'dream_goal',
  name: 'MacBook Air',
  saved: 370_000,
  price: 799_900,
  pct: 46.3,
  monthlyRate: 43_333,
  ...over,
})

const mirror = (over: Partial<MirrorState> = {}): MirrorState => ({
  status: 'over',
  month: '2026-10',
  spent: 1_208_024,
  target: 950_000,
  projected: 1_523_000,
  delta: 258_024,
  headline: "You could've gotten a Weekend in Chengdu.",
  subline: 'sub',
  tone: 'cheeky',
  mood: 'burnt',
  ...over,
})

const summary = (over: Partial<MonthSummary> = {}): MonthSummary => ({
  month: '2026-10',
  income: 1_850_000,
  spent: 1_208_024,
  target: 950_000,
  byCategory: [],
  daysInMonth: 31,
  dayOfMonth: 22,
  projected: 1_523_000,
  dailyAvg: 54_910,
  safeToSpendToday: 0,
  remaining: -258_024,
  savedToGoals: 200_000,
  isCurrent: true,
  ...over,
})

const event = (id: string, over: Partial<TripwireEvent> = {}): TripwireEvent => ({
  id,
  tripwireId: 'tw',
  firedAt: '2026-10-22T10:00:00.000Z',
  title: id,
  message: 'msg',
  seen: false,
  ...over,
})

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'bill_a',
  payeeId: 'payee',
  name: 'Electricity',
  category: 'utilities',
  amountDue: 48_620,
  dueDate: '2026-10-28',
  period: '2026-09',
  status: 'upcoming',
  source: 'sandbox',
  ...over,
})

describe('copy helpers', () => {
  it('labels every status in words (colour is never the only cue)', () => {
    for (const meta of Object.values(STATUS_META)) expect(meta.label.length).toBeGreaterThan(3)
  })

  it('formats whole money, month names and the eyebrow', () => {
    expect(fmtWhole(258_024, 'CNY')).toBe('¥2,580')
    expect(monthName('2026-10')).toBe('October')
    expect(monthName('2026-08', 'short')).toBe('Aug')
    expect(mirrorEyebrow({ month: '2026-10' })).toBe('Dream Mirror · October')
  })

  it('splits a headline around the dream name, or returns null', () => {
    expect(splitHeadline("You could've gotten a Weekend in Chengdu.", 'Weekend in Chengdu')).toEqual(["You could've gotten a ", 'Weekend in Chengdu', '.'])
    expect(splitHeadline('¥620 under target.', 'MacBook Air')).toBeNull()
    expect(splitHeadline('anything')).toBeNull()
  })

  it('shortens delays and hours for tight tiles', () => {
    expect(shortDelay(0)).toBe('1 day')
    expect(shortDelay(9)).toBe('9 days')
    expect(shortDelay(35)).toBe('5 wks')
    expect(shortDelay(120)).toBe('4 mo')
    expect(hoursText(24.3)).toBe('24 h')
    expect(hoursText(4.46)).toBe('4.5 h')
    expect(hoursText(-1)).toBe('0 h')
    expect(hoursText(Number.NaN)).toBe('0 h')
  })
})

describe('heroDream', () => {
  const macbook = dream({ id: 'dream_goal', name: 'MacBook Air' })
  const ticket = dream({ id: 'dream_ticket', name: 'Concert ticket', kind: 'treat', price: 48_000 })

  it('shows the goal when an under-target headline is about the goal, even if the mirror item is a treat', () => {
    const m = mirror({ status: 'under', headline: '¥668 closer to your MacBook Air (46% there).', item: ticket, quantity: 1, goal: goal() })
    expect(heroDream(m, [macbook, ticket])).toEqual({ item: macbook, role: 'goal' })
  })

  it('keeps the treat when the headline names it', () => {
    const m = mirror({ status: 'under', headline: "You're ¥620 under target — that's a Concert ticket, guilt-free!", item: ticket, quantity: 1, goal: goal() })
    expect(heroDream(m, [macbook, ticket])).toEqual({ item: ticket, role: 'item' })
  })

  it('shows the could-have item when over target, and nothing when there is no item', () => {
    const plane = dream({ id: 'dream_plane', name: 'Weekend in Chengdu' })
    expect(heroDream(mirror({ item: plane, quantity: 1 }), [plane])).toEqual({ item: plane, role: 'item' })
    expect(heroDream(mirror({ status: 'no_data', headline: 'Nothing to mirror yet.' }), [])).toEqual({ role: 'none' })
  })

  it('treats the main goal as a goal when on track', () => {
    const m = mirror({ status: 'on_track', headline: 'Right on track.', item: macbook, goal: goal() })
    expect(heroDream(m, [macbook]).role).toBe('goal')
  })
})

describe('mirrorStats', () => {
  it('over with one whole item leads with the amount (the item is already the headline)', () => {
    const m = mirror({ item: dream({ name: 'Weekend in Chengdu' }), quantity: 1, hoursOfWork: 24.3, goal: goal({ name: 'Birkin 25' }), goalDelayDays: 35 })
    const stats = mirrorStats(m, 'CNY')
    expect(stats.map((s) => s.value)).toEqual(['¥2,580', '24 h', '+5 wks'])
    expect(stats[0].label).toBe('over target')
    expect(stats[2].label).toBe('Birkin 25 delay')
    expect(stats[2].description).toContain('about 5 weeks')
  })

  it('shows multiples and fractions of the item', () => {
    expect(mirrorStats(mirror({ item: dream({ name: 'Sneakers' }), quantity: 3 }), 'CNY')[0]).toMatchObject({ value: '3×', label: 'Sneakers' })
    expect(mirrorStats(mirror({ item: dream({ name: 'Birkin' }), fraction: 0.026 }), 'CNY')[0]).toMatchObject({ value: '2.6%', label: 'of Birkin' })
  })

  it('under target shows the surplus, hours kept and goal progress after the stash', () => {
    const m = mirror({
      status: 'under',
      delta: 66_800,
      hoursOfWork: 24.2,
      goal: goal(),
      cta: { tool: 'transfer_to_goal', args: { goalId: 'dream_goal', amount: 33_000 }, label: 'Stash ¥330 in MacBook Air' },
    })
    const stats = mirrorStats(m, 'CNY')
    expect(stats.map((s) => s.value)).toEqual(['¥668', '24 h', '46→50%'])
    expect(stats.every((s) => s.tone === 'under' || s.tone === 'neutral')).toBe(true)
  })

  it('under target without a stash CTA shows plain goal progress; no_data shows nothing', () => {
    expect(mirrorStats(mirror({ status: 'under', delta: 1000, goal: goal() }), 'CNY').at(-1)!.value).toBe('46%')
    expect(mirrorStats(mirror({ status: 'no_data', delta: 0 }), 'CNY')).toEqual([])
  })

  it('computes stash amount and pct after', () => {
    expect(stashAmount({ tool: 'transfer_to_goal', args: { amount: 33_000 }, label: '' })).toBe(33_000)
    expect(stashAmount({ tool: 'create_tripwire', args: { amount: 5 }, label: '' })).toBe(0)
    expect(stashAmount({ tool: 'transfer_to_goal', args: { amount: 'x' }, label: '' })).toBe(0)
    expect(stashAmount()).toBe(0)
    expect(pctAfter(goal(), 33_000)).toBeCloseTo(50.38, 1)
    expect(pctAfter(goal({ saved: 790_000 }), 100_000)).toBe(100)
    expect(pctAfter(goal({ price: 0 }), 1)).toBe(0)
  })
})

describe('treat and CTA helpers', () => {
  it('offers a treat only under target', () => {
    const ticket = dream({ name: 'Concert ticket', kind: 'treat', price: 48_000 })
    expect(treatOf(mirror({ status: 'under', delta: 66_800, item: ticket, quantity: 1 }))?.itemName).toBe('Concert ticket')
    expect(treatOf(mirror({ status: 'over', item: ticket, quantity: 1 }))).toBeUndefined()
    const explicit = { itemId: 'a', itemName: 'A', image: 'preset:gift', fraction: 1, label: 'A' }
    expect(treatOf(mirror({ status: 'under', treat: explicit }))).toBe(explicit)
  })

  it('maps CTA tools to icons and tier hints', () => {
    expect(ctaIcon({ tool: 'create_tripwire', args: {}, label: '' })).toBe('bell')
    expect(ctaIcon({ tool: 'set_category_budget', args: {}, label: '' })).toBe('gauge')
    expect(ctaIcon({ tool: 'transfer_to_goal', args: {}, label: '' })).toBe('piggy')
    expect(ctaIcon({ tool: 'pay_bill', args: {}, label: '' })).toBe('spark')
    expect(ctaHint({ tool: 'create_tripwire', args: {}, label: '' })).toMatch(/not a payment/)
    expect(ctaHint({ tool: 'transfer_to_goal', args: {}, label: '' })).toMatch(/confirm/)
    expect(ctaHint({ tool: 'pay_bill', args: {}, label: '' })).toMatch(/PIN/)
  })
})

describe('month track', () => {
  it('places target, pace and projection on one scale', () => {
    const t = monthTrack(summary())
    expect(t.paceAmount).toBe(Math.round((950_000 * 22) / 31))
    expect(t.projectedPct).toBeGreaterThan(t.spentPct)
    expect(t.spentPct).toBeGreaterThan(t.targetPct)
    expect(t.withinPct).toBeCloseTo(t.targetPct)
    expect(t.daysLeft).toBe(9)
    expect(t.tone).toBe('over')
    expect(t.aheadOfPace).toBe(true)
    expect(Math.max(t.spentPct, t.projectedPct, t.targetPct)).toBeLessThanOrEqual(100)
  })

  it('is under/warn by projection and survives an empty month', () => {
    expect(monthTrack(summary({ spent: 200_000, projected: 300_000 })).tone).toBe('under')
    expect(monthTrack(summary({ spent: 800_000, projected: 1_000_000 })).tone).toBe('warn')
    const empty = monthTrack(summary({ spent: 0, projected: 0, target: 0 }))
    expect(empty.spentPct).toBe(0)
  })

  it('describes the bar and the pace in words', () => {
    expect(monthTrackSummary(summary(), 'CNY')).toBe('Spent ¥12,080 of a ¥9,500 target by day 22 of 31. An even pace would be ¥6,742 by today. Projected month end: ¥15,230.')
    expect(paceLine(summary(), 'CNY')).toBe('¥5,338 above an even pace')
    expect(paceLine(summary({ spent: 500_000 }), 'CNY')).toBe('¥1,742 below an even pace')
    expect(paceLine(summary({ spent: 674_000 }), 'CNY')).toBe('Right on an even pace')
  })

  it('never nudges toward spending, in any tone', () => {
    for (const tone of ['cheeky', 'gentle', 'numbers'] as const) {
      for (const s of [summary(), summary({ remaining: 133_468, safeToSpendToday: 12_766 })]) {
        const note = safeToSpendNote(s, tone, 'CNY')
        expect(note).not.toMatch(/treat yourself|go ahead|spend it/i)
        expect(note.length).toBeGreaterThan(10)
      }
    }
    expect(safeToSpendNote(summary(), 'numbers', 'CNY')).toBe('¥2,580 over target, 9 days left.')
  })
})

describe('tripwire events', () => {
  it('formats relative time', () => {
    const now = Date.parse('2026-10-22T10:00:00.000Z')
    expect(relativeTime('2026-10-22T09:59:50.000Z', now)).toBe('just now')
    expect(relativeTime('2026-10-22T09:55:00.000Z', now)).toBe('5 min ago')
    expect(relativeTime('2026-10-22T07:00:00.000Z', now)).toBe('3 h ago')
    expect(relativeTime('2026-10-20T10:00:00.000Z', now)).toBe('2 d ago')
    expect(relativeTime('2026-10-01T10:00:00.000Z', now)).toBe('Oct 1')
    expect(relativeTime('nope', now)).toBe('')
  })

  it('orders newest first, leading a simultaneous batch with the purchase that tripped it', () => {
    const batch = [event('month'), event('purchase', { txnId: 't1' }), event('pace')]
    expect(newestFirst(batch).map((e) => e.id)).toEqual(['purchase', 'pace', 'month'])
    const older = event('old', { firedAt: '2026-10-21T10:00:00.000Z', txnId: 't0' })
    expect(newestFirst([older, event('new')]).map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('finds the lead event and the fresh ones', () => {
    expect(leadEvent([event('a'), event('b', { txnId: 'x' })])?.id).toBe('b')
    expect(leadEvent([event('a'), event('b')])?.id).toBe('b')
    expect(leadEvent([])).toBeUndefined()
    expect(freshEvents(new Set(['a']), [event('a'), event('b')]).map((e) => e.id)).toEqual(['b'])
  })

  it('compares id lists for useSnapshot', () => {
    expect(sameIds([event('a')], [event('a', { message: 'other' })])).toBe(true)
    expect(sameIds([event('a')], [event('b')])).toBe(false)
    expect(sameIds([], [event('a')])).toBe(false)
  })
})

describe('bills', () => {
  it('labels and tones due dates', () => {
    expect(dueLabel('2026-10-22', '2026-10-21')).toBe('Overdue 1 day')
    expect(dueLabel('2026-10-22', '2026-10-19')).toBe('Overdue 3 days')
    expect(dueLabel('2026-10-22', '2026-10-22')).toBe('Due today')
    expect(dueLabel('2026-10-22', '2026-10-23')).toBe('Due tomorrow')
    expect(dueLabel('2026-10-22', '2026-10-28')).toBe('Due in 6 days')
    expect(dueTone('2026-10-22', '2026-10-21')).toBe('over')
    expect(dueTone('2026-10-22', '2026-10-25')).toBe('warn')
    expect(dueTone('2026-10-22', '2026-10-28')).toBe('neutral')
    expect(shortDate('2026-10-28')).toBe('Oct 28')
  })

  it('takes the next unpaid bills and builds a pay action for the policy gate', () => {
    const bills = [bill({ id: 'a', status: 'paid' }), bill({ id: 'b' }), bill({ id: 'c', status: 'scheduled' }), bill({ id: 'd' }), bill({ id: 'e' })]
    expect(nextBills(bills).map((b) => b.id)).toEqual(['b', 'c', 'd'])
    expect(payAction(bill(), 'CNY')).toEqual({ tool: 'pay_bill', args: { billId: 'bill_a' }, label: 'Pay Electricity ¥486.20' })
  })

  it('picks a bill icon by category and name', () => {
    expect(billIcon('housing')).toBe('home')
    expect(billIcon('utilities', 'Electricity')).toBe('zap')
    expect(billIcon('utilities', 'Water')).toBe('receipt')
    expect(billIcon('phone_internet')).toBe('phone')
    expect(billIcon('subscriptions')).toBe('repeat')
    expect(billIcon('insurance')).toBe('shield')
    expect(billIcon('education')).toBe('book')
    expect(billIcon('other')).toBe('receipt')
  })
})

describe('insights peek', () => {
  const ins = (id: string, kind: Insight['kind']): Insight => ({ id, kind, title: id, body: '', severity: 'neutral', why: '', evidence: {} })

  it('skips the month verdicts the mirror already tells', () => {
    expect(peekInsights([ins('a', 'pace_warning'), ins('b', 'category_up'), ins('c', 'under_budget'), ins('d', 'top_merchant'), ins('e', 'late_night')]).map((i) => i.id)).toEqual(['b', 'd'])
  })

  it('falls back to whatever exists', () => {
    expect(peekInsights([ins('a', 'pace_warning')]).map((i) => i.id)).toEqual(['a'])
    expect(peekInsights([])).toEqual([])
  })
})

describe("could've collection", () => {
  const points = [
    { month: '2026-05', status: 'over' as const, delta: 9_188 },
    { month: '2026-06', status: 'under' as const, delta: 5_531, item: { itemId: 'b', itemName: 'Birkin', image: 'preset:bag', fraction: 0.0006, label: '<0.1% of your Birkin' } },
    { month: '2026-07', status: 'on_track' as const, delta: 0 },
    { month: '2026-08', status: 'no_data' as const, delta: 0 },
    { month: '2026-10', status: 'over' as const, delta: 258_024, item: { itemId: 'c', itemName: 'Chengdu', image: 'preset:plane', fraction: 1.07, label: 'a Weekend in Chengdu' } },
  ]

  it('builds bars with direction, captions and amounts', () => {
    const bars = historyBars(points, '2026-10', 'CNY')
    expect(bars.map((b) => b.direction)).toEqual(['over', 'under', 'even', 'even', 'over'])
    expect(bars.map((b) => b.amountText)).toEqual(['+¥92', '−¥55', '±0', '±0', '+¥2,580'])
    expect(bars[4].current).toBe(true)
    expect(bars[4].height).toBe(1)
    expect(bars[4].caption).toBe('October: ¥2,580 over so far — a Weekend in Chengdu you could’ve had.')
    expect(bars[1].caption).toBe('June: ¥55 under — <0.1% of your Birkin you didn’t spend.')
    expect(bars[2].caption).toBe('July: right on target.')
    expect(bars[3].caption).toBe('August: no spending recorded.')
    expect(bars[0].short).toBe('May')
  })

  it('splits the chart height by the biggest over and under, on one scale', () => {
    const bars = historyBars(points, '2026-10', 'CNY')
    const scale = divergingScale(bars)
    expect(scale.up + scale.down).toBeCloseTo(88)
    expect(scale.down).toBe(14)
    expect(barPx(258_024, scale)).toBeCloseTo(scale.up)
    expect(barPx(5_531, scale)).toBe(4)
    expect(barPx(0, scale)).toBe(0)
    const balanced = divergingScale([{ direction: 'over', delta: 100 }, { direction: 'under', delta: 100 }])
    expect(balanced.up).toBe(44)
    expect(balanced.down).toBe(44)
    const underOnly = divergingScale([{ direction: 'under', delta: 50 }])
    expect(underOnly.up).toBe(14)
    expect(barPx(50, underOnly)).toBeCloseTo(74)
    expect(divergingScale([{ direction: 'even', delta: 0 }]).perUnit).toBe(0)
  })

  it('sums six months in one line', () => {
    const eq = [{ itemId: 'c', itemName: 'Chengdu', image: 'preset:plane', fraction: 1.7, label: 'a Weekend in Chengdu' }]
    expect(couldveHeadline({ totalOver: 413_213, totalUnder: 5_531, equivalents: eq }, 6, 'CNY')).toBe('¥4,132 over target in 6 months — a Weekend in Chengdu.')
    expect(couldveHeadline({ totalOver: 0, totalUnder: 156_818, equivalents: [] }, 6, 'CNY')).toBe('¥1,568 kept under target in 6 months.')
    expect(couldveHeadline({ totalOver: 0, totalUnder: 0, equivalents: [] }, 6, 'CNY')).toMatch(/Nothing to tally/)
  })
})

describe('"Should I buy it?"', () => {
  it('maps verdicts to words, tone and a mood', () => {
    expect(verdictMeta('go', 'gentle')).toMatchObject({ badge: 'Fits', tone: 'under', mood: 'happy' })
    expect(verdictMeta('think', 'cheeky')).toMatchObject({ tone: 'warn', mood: 'worried' })
    expect(verdictMeta('skip', 'gentle').mood).toBe('worried')
    expect(verdictMeta('skip', 'cheeky')).toMatchObject({ tone: 'over', mood: 'burnt', title: 'Your dreams say no' })
    expect(verdictMeta('skip', 'numbers').title).toBe('Over budget')
  })

  it('asks Bun the same question in chat', () => {
    expect(affordabilityQuestion(129_900, 'Winter coat', 'CNY')).toBe('Should I buy Winter coat for ¥1,299?')
    expect(affordabilityQuestion(5_000, 'this', 'CNY')).toBe('Should I buy it for ¥50?')
  })
})

describe('"Why am I seeing this?"', () => {
  it('has a rule for every status', () => {
    for (const s of ['over', 'pace_over', 'under', 'on_track', 'no_data'] as const) expect(statusRule(s).length).toBeGreaterThan(20)
  })

  it('explains the item, the delay and the hours from the numbers', () => {
    const m = mirror({ item: dream({ name: 'Weekend in Chengdu', price: 240_000 }), quantity: 1, goal: goal({ name: 'Birkin 25', monthlyRate: 223_333 }), goalDelayDays: 35, hoursOfWork: 24.3 })
    expect(itemReason(m, 'CNY')).toBe('Weekend in Chengdu (¥2,400) is the biggest dream on your list that ¥2,580 fully covers.')
    expect(itemReason(mirror({ item: dream({ name: 'Sneakers', price: 50_000 }), quantity: 5 }), 'CNY')).toContain('5 times over')
    expect(itemReason(mirror({ item: dream({ name: 'Birkin', price: 9_800_000 }), fraction: 0.02 }), 'CNY')).toContain('share of your main goal')
    expect(itemReason(mirror({ status: 'on_track', item: dream({ name: 'Birkin' }) }), 'CNY')).toBe('Birkin is your main goal.')
    expect(itemReason(mirror(), 'CNY')).toBeNull()
    expect(delayReason(m, 'CNY')).toBe('You save about ¥2,233 a month toward Birkin 25 (3-month average), so ¥2,580 is roughly 35 days of saving.')
    expect(delayReason(mirror({ goal: goal({ monthlyRate: 0 }), goalDelayDays: 12 }), 'CNY')).toContain('10% of your income')
    expect(delayReason(mirror(), 'CNY')).toBeNull()
    expect(hoursReason(m, 1_850_000, 174, 'CNY')).toBe('At ¥18,500 a month over 174 work hours, ¥2,580 is about 24.3 hours of work.')
    expect(hoursReason(mirror(), 1_850_000, 174, 'CNY')).toBeNull()
  })
})

describe('with the demo personas', () => {
  it('Mei (over): the hero shows the could-have item and three evidence tiles', () => {
    const s = demo('mei')
    const m = s.derived.mirror!
    expect(m.status).toBe('over')
    const hero = heroDream(m, s.state.dreams)
    expect(hero.role).toBe('item')
    expect(hero.item?.name).toBe('Weekend in Chengdu')
    expect(splitHeadline(m.headline, hero.item?.name)?.[1]).toBe('Weekend in Chengdu')
    expect(mirrorStats(m, 'CNY').map((x) => x.id)).toEqual(['delta', 'hours', 'delay'])
  })

  it('Arif (under): the hero shows the goal with its progress, and the treat stays a secondary choice', () => {
    const s = demo('arif')
    const m = s.derived.mirror!
    expect(m.status).toBe('under')
    const hero = heroDream(m, s.state.dreams)
    expect(hero).toMatchObject({ role: 'goal', item: { id: 'dream_macbook' } })
    expect(m.cta?.tool).toBe('transfer_to_goal')
    expect(treatOf(m)?.itemName).toBe('Concert ticket')
    expect(mirrorStats(m, 'CNY').at(-1)!.value).toMatch(/^46→\d+%$/)
  })
})
