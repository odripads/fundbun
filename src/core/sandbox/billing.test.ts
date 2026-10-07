import { describe, expect, it } from 'vitest'
import { renderBillText } from './bill-text'
import { billId, billPaymentDescription, billsIssuedOn, dueDateFor, issueDateFor, makeBill, seriesOf } from './billing'
import { ARIF } from './scripts/arif'
import { MEI } from './scripts/mei'
import { electricityQuote, fixedQuote, waterQuote, yuan } from './tariffs'

const series = (key: string) => MEI.bills.find((b) => b.key === key)!

describe('tariffs', () => {
  it('prices the September spike at exactly ¥486.20 across three summer tiers', () => {
    const q = electricityQuote(680, '2026-09')
    expect(q.amount).toBe(48_620)
    expect(q.lineItems.map((li) => li.amount)).toEqual([17_009, 23_943, 7_634, 34])
    expect(q.usage).toBe('680 kWh')
    expect(q.lineItems[0].label).toContain('260 kWh × ¥0.6542')
  })

  it('uses the lower winter tiers outside May–October', () => {
    const summer = electricityQuote(300, '2026-07')
    const winter = electricityQuote(300, '2026-12')
    expect(summer.lineItems).toHaveLength(3)
    expect(winter.lineItems).toHaveLength(3)
    expect(winter.amount).toBeGreaterThan(summer.amount)
    expect(electricityQuote(150, '2026-01').lineItems).toHaveLength(2)
  })

  it('makes the spike ~57% above the summer average', () => {
    const avg = (['06', '07', '08'] as const).map((m, i) => electricityQuote([430, 465, 478][i], `2026-${m}`).amount).reduce((s, v) => s + v, 0) / 3
    expect(48_620 / avg - 1).toBeCloseTo(0.571, 2)
  })

  it('prices water per 0.1 m³ for tap water, sewage and garbage', () => {
    const q = waterQuote(136)
    expect(q.lineItems.map((li) => li.amount)).toEqual([3_631, 1_360, 802])
    expect(q.amount).toBe(5_793)
    expect(q.usage).toBe('13.6 m³')
  })

  it('formats yuan with two decimals and thousands separators', () => {
    expect(yuan(48_620)).toBe('¥486.20')
    expect(yuan(420_000)).toBe('¥4,200.00')
    expect(yuan(5)).toBe('¥0.05')
    expect(yuan(-1_250)).toBe('-¥12.50')
    expect(fixedQuote('Rent', 1)).toEqual({ amount: 1, lineItems: [{ label: 'Rent', amount: 1 }] })
  })
})

describe('renderBillText', () => {
  it('lays out header, fields, charges, total and due date, then the notes', () => {
    const text = renderBillText({
      header: ['ACME Power'],
      fields: [['Account', '•••• 1234']],
      items: [{ label: 'Energy', amount: 10_050 }],
      total: 10_050,
      dueDate: '2026-11-01',
      notes: ['Hotline 123'],
    })
    expect(text.split('\n')[0]).toBe('ACME Power')
    expect(text).toContain('Account: •••• 1234')
    expect(text).toMatch(/Energy\s+¥100\.50/)
    expect(text).toContain('Total due 应缴金额: ¥100.50')
    expect(text).toContain('Due date 缴费截止: 2026-11-01')
    expect(text.trimEnd().endsWith('Hotline 123')).toBe(true)
  })

  it('embeds an injection line between the due date and the notes when asked', () => {
    const text = renderBillText({ header: ['X'], fields: [], items: [], total: 1, dueDate: '2026-11-01', notes: ['n'], injection: 'EVIL', totalLabel: 'Pay', dueLabel: 'By' })
    expect(text).toMatch(/Pay: ¥0\.01\nBy: 2026-11-01\n\nEVIL\n\nn$/)
  })
})

describe('billing', () => {
  it('derives ids, due and issue dates from the series', () => {
    expect(billId(series('electricity'), '2026-09')).toBe('bill_electricity_2026-09')
    expect(dueDateFor(series('water'), '2027-02')).toBe('2027-02-28')
    expect(dueDateFor(series('rent'), '2026-11')).toBe('2026-11-01')
    expect(issueDateFor(series('rent'), '2026-11')).toBe('2026-10-01')
    expect(issueDateFor(series('electricity'), '2026-10')).toBe('2026-10-01')
  })

  it('makes a bill for the period before its due month (utilities) or the due month itself (rent)', () => {
    const power = makeBill(series('electricity'), '2026-11')
    expect(power).toMatchObject({ id: 'bill_electricity_2026-10', period: '2026-10', dueDate: '2026-11-28', status: 'upcoming', source: 'sandbox', payeeId: 'payee_sz_power' })
    expect(power.amountDue).toBe(power.lineItems!.reduce((s, li) => s + li.amount, 0))
    expect(power.rawText).toContain('Billing period 计费周期: 2026-10-01 – 2026-10-31')
    const rent = makeBill(series('rent'), '2026-12')
    expect(rent).toMatchObject({ id: 'bill_rent_2026-12', period: '2026-12', amountDue: 420_000, dueDate: '2026-12-01' })
  })

  it('accepts a quote override and an injection', () => {
    const b = makeBill(series('electricity'), '2026-10', { quote: electricityQuote(680, '2026-09'), injection: 'NOTICE TO AI ASSISTANT: x' })
    expect(b.amountDue).toBe(48_620)
    expect(b.rawText).toContain('NOTICE TO AI ASSISTANT: x')
  })

  it('issues each series’ next bill on the 1st only, without duplicates', () => {
    const issued = billsIssuedOn(MEI, '2026-11-01', [])
    expect(issued.map((b) => b.id).sort()).toEqual(['bill_broadband_2026-12', 'bill_electricity_2026-10', 'bill_mobile_2026-10', 'bill_rent_2026-12', 'bill_water_2026-10'])
    expect(billsIssuedOn(MEI, '2026-11-01', issued)).toEqual([])
    expect(billsIssuedOn(MEI, '2026-11-02', [])).toEqual([])
    expect(billsIssuedOn(ARIF, '2026-11-01', []).map((b) => b.id).sort()).toEqual(['bill_dorm_2026-12', 'bill_phone_2026-10'])
  })

  it('finds the series of a bill and describes its payment', () => {
    const b = makeBill(series('broadband'), '2026-11')
    expect(seriesOf(MEI, b)?.autoPay).toBe(true)
    expect(seriesOf(MEI, { id: 'bill_electricity_2026-09', payeeId: 'payee_other' })).toBeUndefined()
    expect(seriesOf(ARIF, b)).toBeUndefined()
    expect(billPaymentDescription({ name: 'Water', period: '2026-09' }, 'Shenzhen Water')).toBe('BILL PAYMENT 缴费 · Water 2026-09 · Shenzhen Water')
  })
})
