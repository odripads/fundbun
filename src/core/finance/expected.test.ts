import { describe, expect, it } from 'vitest'
import type { BankState, Transaction } from '../types'
import { makeCtx, monthly, spend } from './__fixtures__'
import { MARKED_PAID_PREFIX, expectedBills, hasBank, syncExpectedBills } from './expected'
import { detectRecurring } from './recurring'

const MONTHS = ['2026-08', '2026-09', '2026-10'] as const
/** Three months of rent on the 1st, phone on the 5th and a streaming plan on the 12th. */
const statement = (): Transaction[] => [
  ...monthly('Landlord Zhang', 'housing', 3_000, 1, [...MONTHS]),
  ...monthly('China Mobile', 'phone_internet', 128, 5, [...MONTHS]),
  ...monthly('Netflix', 'subscriptions', 68, 12, [...MONTHS]),
  spend('2026-10-20', 'Hema Fresh', 'groceries', 120),
]

function bankOf(today: string, txns: Transaction[] = statement()): BankState {
  return makeCtx({ today, txns }).bank
}

const names = (bank: BankState) => bank.bills.map((b) => `${b.name} ${b.dueDate} ${b.status}`)

describe('hasBank', () => {
  it('is true only for the demo personas, whose bank is simulated', () => {
    expect(hasBank({ personaId: 'mei' })).toBe(true)
    expect(hasBank({})).toBe(false)
  })
})

describe('expectedBills — bills read off the user’s own repeating charges', () => {
  it('one per repeating charge, on its usual day next month, at the amount it last cost', () => {
    const bank = bankOf('2026-10-28')
    const bills = expectedBills(detectRecurring(bank.transactions, bank.today), bank.transactions, bank.today)
    expect(bills.map((b) => [b.name, b.dueDate, b.amountDue, b.status, b.source, b.category])).toEqual([
      ['Landlord Zhang', '2026-11-01', 300_000, 'upcoming', 'expected', 'housing'],
      ['China Mobile', '2026-11-05', 12_800, 'upcoming', 'expected', 'phone_internet'],
      ['Netflix', '2026-11-12', 6_800, 'upcoming', 'expected', 'subscriptions'],
    ])
    // predictions have no payee: there is nobody FundBun could pay
    expect(bills.every((b) => b.payeeId === '')).toBe(true)
  })

  it('a bill a little past its day is overdue; one long past is dropped, because the charge has probably stopped', () => {
    const late = bankOf('2026-11-08')
    const bills = expectedBills(detectRecurring(late.transactions, late.today), late.transactions, late.today)
    expect(bills.find((b) => b.name === 'Landlord Zhang')?.status).toBe('overdue')
    expect(bills.find((b) => b.name === 'Netflix')?.status).toBe('upcoming')
    const gone = bankOf('2026-12-20')
    expect(expectedBills(detectRecurring(gone.transactions, gone.today), gone.transactions, gone.today)).toEqual([])
  })

  it('one-off purchases never become bills', () => {
    const bank = bankOf('2026-10-28', [spend('2026-10-20', 'Hema Fresh', 'groceries', 120), spend('2026-10-21', 'Nike', 'shopping', 900)])
    expect(expectedBills(detectRecurring(bank.transactions, bank.today), bank.transactions, bank.today)).toEqual([])
  })
})

describe('syncExpectedBills — kept in step with the ledger', () => {
  it('fills in the bills, and running it again changes nothing', () => {
    const bank = bankOf('2026-10-28')
    syncExpectedBills(bank)
    expect(names(bank)).toEqual(['Landlord Zhang 2026-11-01 upcoming', 'China Mobile 2026-11-05 upcoming', 'Netflix 2026-11-12 upcoming'])
    const before = JSON.stringify(bank.bills)
    syncExpectedBills(bank)
    expect(JSON.stringify(bank.bills)).toBe(before)
  })

  it('a charge that shows up on a later statement closes its bill, and next month’s takes its place', () => {
    const bank = bankOf('2026-10-28')
    syncExpectedBills(bank)
    bank.today = '2026-11-03'
    bank.transactions = [...bank.transactions, spend('2026-11-01', 'Landlord Zhang', 'housing', 3_000, { id: 'csv_rent_nov' })]
    syncExpectedBills(bank)
    expect(names(bank)).toEqual(['Landlord Zhang 2026-11-01 paid', 'China Mobile 2026-11-05 upcoming', 'Netflix 2026-11-12 upcoming', 'Landlord Zhang 2026-12-01 upcoming'])
    expect(bank.bills[0].paidTxnId).toBe('csv_rent_nov')
  })

  it('marking a bill paid early never moves next month’s date', () => {
    const bank = bankOf('2026-10-28')
    syncExpectedBills(bank)
    const rent = bank.bills[0]
    // what markBillPaid does: a hand-entered payment today, and the bill closed
    bank.transactions = [...bank.transactions, spend('2026-10-28', 'Landlord Zhang', 'housing', 3_000, { id: `${MARKED_PAID_PREFIX}${rent.id}`, billId: rent.id })]
    rent.status = 'paid'
    rent.paidTxnId = `${MARKED_PAID_PREFIX}${rent.id}`
    syncExpectedBills(bank)
    // December's rent is expected on the 1st, not 30 days after the tap
    expect(names(bank)).toContain('Landlord Zhang 2026-12-01 upcoming')
    expect(bank.bills.filter((b) => b.name === 'Landlord Zhang' && b.period === '2026-11')).toHaveLength(1)
  })

  it('never touches a connected bank’s bills', () => {
    const bank: BankState = { ...bankOf('2026-10-28'), personaId: 'mei' }
    syncExpectedBills(bank)
    expect(bank.bills).toEqual([])
  })
})
