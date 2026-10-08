import { describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage } from '../../../core/app'
import type { Account, Bill, DreamItem, GoalProgress } from '../../../core/types'
import {
  billsDueWithin,
  celebrationCopy,
  contributionError,
  countsLine,
  etaFact,
  fmtWhole,
  groupDreams,
  isFunded,
  liquidityNote,
  monthYear,
  pctAfterAdding,
  quickAmounts,
  remainingOf,
  totalInPots,
} from './model'

const dream = (id: string, over: Partial<DreamItem> = {}): DreamItem => ({
  id,
  name: id,
  price: 100_000,
  image: 'preset:gift',
  kind: 'goal',
  createdAt: '2026-01-01',
  ...over,
})

const progress = (over: Partial<GoalProgress> = {}): GoalProgress => ({
  itemId: 'dream_birkin',
  name: 'Birkin 25',
  saved: 2_330_000,
  price: 9_800_000,
  pct: 23.8,
  monthlyRate: 223_333,
  etaMonths: 33.4,
  etaDate: '2029-08-04',
  ...over,
})

const account = (id: string, type: Account['type'], balance: number): Account => ({ id, name: id, type, balance, currency: 'CNY' })

const bill = (dueDate: string, amountDue: number, status: Bill['status'] = 'upcoming'): Bill => ({
  id: dueDate,
  payeeId: 'p',
  name: 'Bill',
  category: 'utilities',
  amountDue,
  dueDate,
  period: '2026-09',
  status,
  source: 'sandbox',
})

describe('pots and groups', () => {
  it('sums only pot balances (never checking, never negative)', () => {
    expect(totalInPots([account('chk', 'checking', 5_000_000), account('p1', 'pot', 2_330_000), account('p2', 'pot', 45_000), account('p3', 'pot', -10)])).toBe(2_375_000)
    expect(totalInPots([])).toBe(0)
  })

  it('groups open goals, treats and achieved items in the user’s order', () => {
    const dreams = [dream('a'), dream('t', { kind: 'treat' }), dream('b'), dream('done', { achievedAt: '2026-10-01' })]
    const g = groupDreams(dreams, [progress({ itemId: 'b' })])
    expect(g.goals.map((r) => r.item.id)).toEqual(['a', 'b'])
    expect(g.goals[1].progress?.itemId).toBe('b')
    expect(g.goals[0].progress).toBeUndefined()
    expect(g.treats.map((r) => r.item.id)).toEqual(['t'])
    expect(g.achieved.map((r) => r.item.id)).toEqual(['done'])
    expect(countsLine(g)).toBe('2 goals · 1 treat · 1 achieved')
    expect(countsLine({ goals: [], treats: [], achieved: [] })).toBe('')
  })
})

describe('pace and ETA', () => {
  it('knows when a goal is funded and what is left', () => {
    expect(isFunded(progress())).toBe(false)
    expect(isFunded(progress({ saved: 9_800_000 }))).toBe(true)
    expect(isFunded(undefined)).toBe(false)
    expect(remainingOf(progress())).toBe(7_470_000)
    expect(remainingOf(progress({ saved: 10_000_000 }))).toBe(0)
    expect(remainingOf(undefined)).toBe(0)
  })

  it('splits the ETA tile into a month and a phrase', () => {
    expect(etaFact(progress())).toEqual({ value: 'Aug 2029', sub: '~2.8 yrs at your pace' })
    expect(etaFact(progress({ etaMonths: 9.9, etaDate: '2027-08-20' }))).toEqual({ value: 'Aug 2027', sub: '~10 mo at your pace' })
    expect(etaFact(progress({ etaMonths: 0.5 })).sub).toBe('under a month')
    expect(etaFact(progress({ monthlyRate: 0 })).value).toBe('—')
    expect(etaFact(progress({ saved: 9_800_000 })).value).toBe('Ready')
    expect(etaFact(undefined).sub).toBe('No pot yet')
    expect(monthYear('2029-08-04')).toBe('Aug 2029')
  })
})

describe('adding money', () => {
  it('offers presets that fit the goal and the balance, plus the rest', () => {
    expect(quickAmounts(7_470_000, 5_018_917, 'CNY').map((q) => q.label)).toEqual(['¥100', '¥200', '¥500'])
    expect(quickAmounts(30_000, 5_000_000, 'CNY').map((q) => q.label)).toEqual(['¥100', '¥200', 'The rest · ¥300'])
    expect(quickAmounts(30_000, 15_000, 'CNY').map((q) => q.amount)).toEqual([10_000])
    expect(quickAmounts(0, 1_000_000, 'CNY')).toEqual([])
    expect(quickAmounts(5_000, 1_000, 'JPY').map((q) => q.amount)).toEqual([100, 200, 500])
  })

  it('validates the typed amount against checking', () => {
    expect(contributionError(null, 100, 'CNY')).toMatch(/Type an amount/)
    expect(contributionError(0, 100, 'CNY')).toMatch(/more than zero/)
    expect(contributionError(-5, 100, 'CNY')).toMatch(/more than zero/)
    expect(contributionError(20_000, 10_000, 'CNY')).toBe('That’s more than your checking balance (¥100)')
    expect(contributionError(5_000, 10_000, 'CNY')).toBeNull()
  })

  it('warns (without blocking) when a stash leaves checking short of bills due soon', () => {
    const bills = [bill('2026-10-25', 12_800), bill('2026-10-28', 48_620), bill('2026-11-30', 420_000), bill('2026-10-23', 9_999, 'paid')]
    expect(billsDueWithin(bills, '2026-10-22')).toBe(61_420)
    expect(liquidityNote(100_000, 50_000, 61_420, 'CNY')).toBe('This leaves ¥500 in checking — less than the ¥614 in bills due in the next two weeks.')
    expect(liquidityNote(1_000_000, 50_000, 61_420, 'CNY')).toBeNull()
    expect(liquidityNote(100_000, 0, 61_420, 'CNY')).toBeNull()
    expect(liquidityNote(100_000, 50_000, 0, 'CNY')).toBeNull()
  })

  it('previews progress after the stash', () => {
    expect(pctAfterAdding(progress(), 50_000)).toBe(24.3)
    expect(pctAfterAdding(progress(), 99_000_000)).toBe(100)
    expect(pctAfterAdding(undefined, 5)).toBe(0)
  })
})

describe('celebration', () => {
  it('celebrates saving in every tone, and never mentions buying', () => {
    const birkin = dream('dream_birkin', { name: 'Birkin 25', price: 9_800_000 })
    for (const tone of ['gentle', 'cheeky', 'numbers'] as const) {
      const c = celebrationCopy(birkin, 9_800_000, tone, 'CNY')
      expect(c.title).toBe('Birkin 25 — achieved!')
      expect(c.body).toContain('¥98,000')
      expect(`${c.title} ${c.body}`).not.toMatch(/buy|shop|spend/i)
    }
  })

  it('falls back to the price when the pot is empty, and keeps treats calm', () => {
    expect(celebrationCopy(dream('x', { name: 'X', price: 50_000 }), 0, 'gentle', 'CNY').body).toContain('¥500')
    const treat = celebrationCopy(dream('t', { name: 'Concert ticket', kind: 'treat', price: 48_000 }), 0, 'gentle', 'CNY')
    expect(treat.title).toBe('Concert ticket — enjoyed, guilt-free')
    expect(treat.body).toMatch(/planned/)
    expect(fmtWhole(48_050, 'CNY')).toBe('¥481')
  })
})

describe('with the demo personas', () => {
  it('Arif’s pots and goals line up with the derived progress', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('arif')
    const s = app.getSnapshot()
    const g = groupDreams(s.state.dreams, s.derived.goals)
    expect(g.goals.map((r) => r.item.id)).toEqual(['dream_macbook', 'dream_flight'])
    expect(g.treats.map((r) => r.item.id)).toEqual(['dream_concert', 'dream_sneakers'])
    expect(totalInPots(s.state.bank.accounts)).toBe(g.goals.reduce((sum, r) => sum + (r.progress?.saved ?? 0), 0))
    expect(etaFact(g.goals[0].progress).value).toMatch(/20\d\d$/)
  })
})

describe('a minus sign is never dropped silently (F59)', () => {
  it('"-50" is an error that points to moving money back, not "Stash ¥50"', async () => {
    const { contributionError: check, isNegativeInput, NEGATIVE_AMOUNT_ERROR } = await import('./model')
    expect(isNegativeInput('-50')).toBe(true)
    expect(isNegativeInput(' −50')).toBe(true)
    expect(isNegativeInput('50')).toBe(false)
    expect(check(5000, 1_000_000, 'CNY', '-50')).toBe(NEGATIVE_AMOUNT_ERROR)
    expect(check(5000, 1_000_000, 'CNY', '50')).toBeNull()
    // without the typed text the old contract is unchanged
    expect(check(5000, 1_000_000, 'CNY')).toBeNull()
  })
})
