import { describe, expect, it } from 'vitest'
import { fakeHost } from '../../../tests/helpers/fake-host'
import { checkGrounding } from '../security/grounding'
import type { ToolName } from '../types'
import { TOOL_INTENT, actionFacts, readFacts } from './facts'
import { FACT_KEYS, composeReply } from './voice'
import { executeTool } from './tools'
import {
  addMinutes,
  compact,
  isAfter,
  maskArgs,
  maskDigits,
  nameScore,
  pct,
  pctLabel,
  summarizeArgs,
} from './support'

const host = fakeHost()
const raw = host.state().bank.bills.find((b) => b.id === 'bill_electricity_2026-09')!.rawText!
const READS: [ToolName, Record<string, unknown>][] = [
  ['get_overview', {}],
  ['get_spending_breakdown', { category: 'delivery' }],
  ['search_transactions', { query: 'Luckin' }],
  ['list_recurring', { onlySubscriptions: true }],
  ['analyze_bills', {}],
  ['get_insights', {}],
  ['check_affordability', { amount: 129_900, label: 'sneakers' }],
  ['get_goals', {}],
  ['xray_bill', { text: raw }],
]

describe('readFacts', () => {
  it.each(READS)('%s → only the intent’s fact keys, and a grounded reply', (tool, args) => {
    const outcome = executeTool({ id: 'c', tool, args, proposedBy: 'offline' }, host)
    const intent = TOOL_INTENT[tool]!
    const facts = readFacts(tool, outcome.data, host.state())
    expect(Object.keys(facts).length).toBeGreaterThan(0)
    for (const k of Object.keys(facts)) expect(FACT_KEYS[intent]).toContain(k)
    for (const tone of ['gentle', 'cheeky', 'numbers'] as const) {
      const text = composeReply(intent, facts, tone)
      expect(checkGrounding(text, [outcome.data], 'CNY'), `${tone}: ${text}`).toMatchObject({ ok: true })
    }
  })

  it('overview facts describe the over story', () => {
    const facts = readFacts('get_overview', executeTool({ id: 'c', tool: 'get_overview', args: {}, proposedBy: 'offline' }, host).data, host.state())
    expect(facts).toMatchObject({ status: 'over', month: 'October 2026', goalName: 'Birkin 25' })
    expect(facts.headline).toContain('Weekend in Chengdu')
  })

  it('xray facts flag the injection and the comparison', () => {
    const facts = readFacts('xray_bill', executeTool({ id: 'c', tool: 'xray_bill', args: { text: raw }, proposedBy: 'offline' }, host).data, host.state())
    expect(facts).toMatchObject({ injection: 'yes', total: '¥486.20', dueDate: 'Oct 28' })
    expect(facts.comparison).toMatch(/above your usual/)
  })

  it('unknown tools yield no facts', () => {
    expect(readFacts('pay_bill', {}, host.state())).toEqual({})
  })
})

describe('actionFacts', () => {
  const state = host.state()
  it('transfer: amount + goal; done adds the new percentage', () => {
    expect(actionFacts('transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 }, state, { stage: 'confirm' })).toEqual({ stage: 'confirm', amount: '¥300', goalName: 'Weekend in Chengdu' })
    expect(actionFacts('transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 }, state, { stage: 'done', data: { newPct: 12.5 } }).newPct).toBe('13%')
  })

  it('blocked carries the plain reason without a trailing period', () => {
    expect(actionFacts('transfer_to_goal', { goalId: 'dream_birkin', amount: 80_000 }, state, { stage: 'blocked', reason: 'Too much.' }).reason).toBe('Too much')
  })

  it('bills, subscriptions, disputes, budgets and reminders', () => {
    expect(actionFacts('pay_bill', { billId: 'bill_electricity_2026-09' }, state, { stage: 'confirm' })).toMatchObject({ billName: 'Electricity', amount: '¥486.20', dueDate: 'Oct 28', payee: 'Shenzhen Power Supply' })
    expect(actionFacts('cancel_subscription', { recurringId: 'rec_youku' }, state, { stage: 'confirm', recurring: host.recurring() })).toMatchObject({ merchant: 'Youku', amount: '¥25', annualCost: '¥300' })
    expect(actionFacts('dispute_transaction', { txnId: 'txn_20261003_002' }, state, { stage: 'confirm' })).toMatchObject({ merchant: 'Tencent Video', amount: '¥30', date: 'Oct 3' })
    expect(actionFacts('set_category_budget', { category: 'delivery', limit: 80_000 }, state, { stage: 'confirm' })).toMatchObject({ category: 'Food delivery', limit: '¥800' })
    expect(actionFacts('set_bill_reminder', { billId: 'bill_electricity_2026-09', daysBefore: 3 }, state, { stage: 'done' }).reminder).toBe('3 days before Electricity is due (Oct 28)')
  })
})

describe('support helpers', () => {
  it('maskDigits masks account-like runs, not amounts', () => {
    expect(maskDigits('to 6222 0210 0112 3456 789 now')).toBe('to •••• 6789 now')
    expect(maskDigits('¥4,800 and 2026-10-22')).toBe('¥4,800 and 2026-10-22')
  })

  it('summarizeArgs / maskArgs keep traces and audit free of long text and full numbers', () => {
    expect(summarizeArgs({ text: 'x'.repeat(100), to: '6222021001122334455', amount: 5, nested: { a: 1 } })).toEqual({ text: '[100 chars]', to: '•••• 4455', amount: 5, nested: '[object]' })
    expect(maskArgs({ to: '6222021001122334455', amount: 5 })).toEqual({ to: '•••• 4455', amount: 5 })
  })

  it('nameScore, pct, pctLabel, compact, time helpers', () => {
    expect(nameScore('chengdu', 'Weekend in Chengdu')).toBeGreaterThan(0.5)
    expect(nameScore('pizza', 'Weekend in Chengdu')).toBe(0)
    expect(pct(1, 3)).toBe(33.3)
    expect(pct(1, 0)).toBe(0)
    expect(pctLabel(4.25)).toBe('4.3%')
    expect(pctLabel(46.3)).toBe('46%')
    expect(compact({ a: 1, b: undefined })).toEqual({ a: 1 })
    expect(addMinutes('2026-10-22T02:00:00.000Z', 10)).toBe('2026-10-22T02:10:00.000Z')
    expect(isAfter('2026-10-22T02:10:00.000Z', '2026-10-22T02:00:00.000Z')).toBe(true)
    expect(isAfter(undefined, '2026-10-22T02:00:00.000Z')).toBe(false)
  })
})

describe('facts — money in prose', () => {
  const run = (tool: ToolName, args: Record<string, unknown>) => executeTool({ id: 'c', tool, args, proposedBy: 'offline' }, host).data
  it('totals read as whole yuan from ¥100; a bill keeps its cents', () => {
    const state = host.state()
    const overview = readFacts('get_overview', run('get_overview', {}), state)
    expect(overview.spent).toMatch(/^¥\d{1,2},\d{3}$/)
    expect(overview.delta).toMatch(/^¥\d,\d{3}$/)
    const xray = readFacts('xray_bill', run('xray_bill', { text: raw }), state)
    expect(xray.total).toBe('¥486.20')
    expect(xray.comparison).toMatch(/your usual ¥\d{3}$/)
    const bills = readFacts('analyze_bills', run('analyze_bills', {}), state)
    expect(bills.nextBill).toMatch(/\(¥\d+(\.\d\d)?, due/)
    const reply = composeReply('overview', overview, 'gentle')
    expect(checkGrounding(reply, [run('get_overview', {})], 'CNY').ok).toBe(true)
  })
})
