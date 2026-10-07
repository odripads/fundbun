import { describe, expect, it } from 'vitest'
import type { BankState } from '../types'
import { CHECKING_ID } from './drafts'
import {
  HISTORY_MONTHS,
  assertISODate,
  generateDay,
  generateHistory,
  incomeDrafts,
  monthOffset,
  potContribution,
  potTransferDrafts,
} from './generator'
import { PERSONAS, type PersonaDef } from './personas'
import { ARIF } from './scripts/arif'
import { MEI } from './scripts/mei'

const TODAY = '2026-10-22'
const SEED = 20261020
const meiDef = PERSONAS.find((p) => p.id === 'mei')!
const arifDef = PERSONAS.find((p) => p.id === 'arif')!

function freshMei(seed = SEED): BankState {
  return generateHistory(meiDef, TODAY, seed)
}

describe('generateHistory', () => {
  it('opens a checking account and one pot per goal', () => {
    const bank = freshMei()
    expect(bank.accounts.map((a) => [a.id, a.type])).toEqual([
      ['chk_main', 'checking'],
      ['pot_dream_birkin', 'pot'],
      ['pot_dream_chengdu', 'pot'],
    ])
    expect(bank.accounts[0].maskedNumber).toBe('•••• 4821')
    expect(bank.accounts.filter((a) => a.type === 'pot').every((a) => a.goalId && a.currency === 'CNY')).toBe(true)
    expect(bank.personaId).toBe('mei')
  })

  it(`covers ${HISTORY_MONTHS} whole months plus the current month to date`, () => {
    const bank = generateHistory(arifDef, TODAY, SEED)
    const months = new Set(bank.transactions.map((t) => t.date.slice(0, 7)))
    expect([...months]).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('starts every account from an opening balance on the first history day', () => {
    const bank = freshMei()
    const openings = bank.transactions.filter((t) => t.merchant === 'Opening balance')
    expect(openings.map((t) => t.accountId).sort()).toEqual(['chk_main', 'pot_dream_birkin'])
    expect(openings.every((t) => t.date === '2026-04-01' && t.category === 'transfer' && t.initiatedBy === 'bank')).toBe(true)
  })

  it('is deterministic and seed-sensitive', () => {
    expect(freshMei(5)).toEqual(freshMei(5))
    expect(freshMei(5).transactions).not.toEqual(freshMei(6).transactions)
  })

  it('throws for a persona without a script and for invalid dates', () => {
    const nobody: PersonaDef = { ...meiDef, id: 'nobody' }
    expect(() => generateHistory(nobody, TODAY, SEED)).toThrow(/No sandbox script/)
    expect(() => generateHistory(meiDef, '2026-13-01', SEED)).toThrow(/Invalid ISO date/)
  })

  it('calibrates the current month from its daily rate when today is not the story day', () => {
    const bank = generateHistory(meiDef, '2026-10-10', SEED)
    const spent = bank.transactions
      .filter((t) => t.date >= '2026-10-01' && t.amount < 0 && !['income', 'savings', 'transfer'].includes(t.category))
      .reduce((s, t) => s - t.amount, 0)
    // rent + broadband + subscriptions + the story purchases + ~¥260/day of everyday spending
    expect(spent).toBeGreaterThan(800_000)
    expect(spent).toBeLessThan(1_000_000)
  })

  it('pays only bills that are due by today', () => {
    const bank = freshMei()
    for (const b of bank.bills) expect(b.status).toBe(b.dueDate <= TODAY ? 'paid' : 'upcoming')
  })

  it('never produces transactions after today, even for a story day later in the month', () => {
    const bank = generateHistory(meiDef, '2026-10-02', SEED)
    expect(bank.transactions.every((t) => t.date <= '2026-10-02')).toBe(true)
    expect(bank.transactions.some((t) => t.merchant === 'Tencent Video' && t.date === '2026-10-03')).toBe(false)
  })
})

describe('generateDay', () => {
  it('is deterministic for a seed and date, and does not mutate the bank', () => {
    const bank = freshMei()
    const before = JSON.stringify(bank)
    const a = generateDay(bank, '2026-10-23')
    const b = generateDay(bank, '2026-10-23')
    expect(a).toEqual(b)
    expect(JSON.stringify(bank)).toBe(before)
    expect(generateDay(bank, '2026-10-24')).not.toEqual(a)
  })

  it('creates ids that do not collide with existing transactions', () => {
    const bank = freshMei()
    const existing = new Set(bank.transactions.map((t) => t.id))
    const day = generateDay(bank, '2026-10-22')
    expect(day.length).toBeGreaterThan(0)
    for (const t of day) expect(existing.has(t.id)).toBe(false)
    expect(new Set(day.map((t) => t.id)).size).toBe(day.length)
  })

  it('produces organic spending only (no salary, bills or savings), sorted by time', () => {
    const bank = freshMei()
    for (let d = 23; d <= 31; d++) {
      const txns = generateDay(bank, `2026-10-${d}`)
      for (const t of txns) {
        expect(t.amount).toBeLessThan(0)
        expect(['income', 'savings', 'transfer', 'housing']).not.toContain(t.category)
        expect(t).toMatchObject({ accountId: CHECKING_ID, currency: 'CNY', categorySource: 'rule', categoryConfidence: 1 })
      }
      const times = txns.map((t) => t.time ?? '')
      expect(times).toEqual([...times].sort())
    }
  })

  it('charges subscriptions on their billing day at the latest price, unless cancelled', () => {
    const bank = freshMei()
    const nov6 = generateDay(bank, '2026-11-06')
    expect(nov6.find((t) => t.merchant === 'iQIYI')?.amount).toBe(-3000)
    expect(generateDay(bank, '2026-11-03').filter((t) => t.merchant === 'Tencent Video')).toHaveLength(1)
    bank.cancelledMerchants.push('tencent video')
    expect(generateDay(bank, '2026-11-03').some((t) => t.merchant === 'Tencent Video')).toBe(false)
  })

  it('clamps billing days to short months', () => {
    const bank = generateHistory(arifDef, TODAY, SEED)
    // QQ Music bills on the 28th, Bilibili on the 27th — February 2027 has 28 days
    const feb28 = generateDay(bank, '2027-02-28')
    expect(feb28.some((t) => t.merchant === 'QQ Music')).toBe(true)
  })

  it('returns nothing for unknown personas or banks without a checking account', () => {
    const bank = freshMei()
    expect(generateDay({ ...bank, personaId: undefined }, '2026-10-23')).toEqual([])
    expect(generateDay({ ...bank, personaId: 'ghost' }, '2026-10-23')).toEqual([])
    expect(generateDay({ ...bank, accounts: bank.accounts.filter((a) => a.type === 'pot') }, '2026-10-23')).toEqual([])
  })

  it('rejects invalid dates', () => {
    expect(() => generateDay(freshMei(), '2026-10-32')).toThrow(/Invalid ISO date/)
  })
})

describe('helpers', () => {
  it('monthOffset counts calendar months across years', () => {
    expect(monthOffset('2026-10', '2026-10')).toBe(0)
    expect(monthOffset('2026-10', '2026-04')).toBe(-6)
    expect(monthOffset('2026-10', '2027-01')).toBe(3)
    expect(monthOffset('2027-02', '2026-12')).toBe(-2)
  })

  it('assertISODate accepts real dates only', () => {
    expect(() => assertISODate('2028-02-29')).not.toThrow()
    for (const bad of ['2027-02-29', '2026-1-01', '26-10-01', '', '2026-10-01T00:00']) expect(() => assertISODate(bad)).toThrow()
  })

  it('incomeDrafts lands income on the right day with the month in the description', () => {
    expect(incomeDrafts(MEI, '2026-11-10', CHECKING_ID)).toEqual([
      expect.objectContaining({ amount: 1_850_000, category: 'income', description: expect.stringContaining('2026-11'), initiatedBy: 'bank' }),
    ])
    expect(incomeDrafts(MEI, '2026-11-11', CHECKING_ID)).toEqual([])
    expect(incomeDrafts(ARIF, '2026-11-20', CHECKING_ID).map((d) => d.amount)).toEqual([130_000])
  })

  it('potContribution is deterministic, within range and a multiple of the step', () => {
    const plan = MEI.pots[0]
    const values = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((m) => potContribution(MEI, SEED, plan, m))
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(200_000)
      expect(v).toBeLessThanOrEqual(240_000)
      expect(v % 10_000).toBe(0)
    }
    expect(potContribution(MEI, SEED, plan, '2026-08')).toBe(values[4])
    expect(potContribution(MEI, SEED, MEI.pots[1], '2026-08')).toBe(0)
  })

  it('potTransferDrafts are balanced savings moves between checking and the pot', () => {
    const [out, inn] = potTransferDrafts(MEI.pots[0], '2026-11-10', 220_000, 'Everyday account')
    expect(out).toMatchObject({ accountId: 'chk_main', amount: -220_000, category: 'savings' })
    expect(inn).toMatchObject({ accountId: 'pot_dream_birkin', amount: 220_000, category: 'savings' })
  })
})
