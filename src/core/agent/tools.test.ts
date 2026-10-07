import { describe, expect, it } from 'vitest'
import { fakeHost } from '../../../tests/helpers/fake-host'
import type { ToolCall, ToolName } from '../types'
import { TOOL_NAMES, TOOL_SPECS } from './specs'
import { applyUndo, cheapestOverlapping, executeTool, previewTool, runTool } from './tools'

const call = (tool: string, args: Record<string, unknown> = {}, proposedBy: ToolCall['proposedBy'] = 'offline'): ToolCall => ({ id: `call_${tool}`, tool, args, proposedBy })
const data = (o: { data: unknown }) => o.data as Record<string, any>

describe('T0 read tools', () => {
  const host = fakeHost()

  it('get_overview: mirror card + compact numbers', () => {
    const o = executeTool(call('get_overview'), host)
    expect(o.ok).toBe(true)
    expect(o.cards[0].type).toBe('mirror')
    const d = data(o)
    expect(d.status).toBe('over')
    expect(d.spent).toBeGreaterThan(d.target)
    expect(d.headline).toContain('Weekend in Chengdu')
    expect(d.goalDelayDays).toBeGreaterThan(0)
    expect(o.untrusted).toBeUndefined()
  })

  it('get_spending_breakdown: sorted categories, focus row for a category', () => {
    const o = executeTool(call('get_spending_breakdown', { category: 'delivery' }), host)
    const d = data(o)
    const spent = d.categories.map((c: { spent: number }) => c.spent)
    expect(spent).toEqual([...spent].sort((a: number, b: number) => b - a))
    expect(d.focus.category).toBe('delivery')
    expect(d.focus.equivalent).toMatch(/Birkin|Chengdu|AirPods|shoes/)
    expect(o.cards[0]).toMatchObject({ type: 'breakdown', month: '2026-10' })
  })

  it('search_transactions: memos make the outcome untrusted', () => {
    const o = executeTool(call('search_transactions', { query: 'Taobao', limit: 25 }), host)
    expect(o.untrusted).toBe(true)
    expect(data(o).count).toBeGreaterThan(0)
    expect(data(o).transactions.some((t: { memo?: string }) => t.memo)).toBe(true)
    const run = runTool(call('search_transactions', { query: 'Taobao', limit: 25 }), host)
    expect(run.untrustedTexts.length).toBeGreaterThan(0)
    const plain = executeTool(call('search_transactions', { query: 'Luckin' }), host)
    expect(plain.untrusted).toBe(false)
    expect(plain.cards[0].type).toBe('transactions')
  })

  it('list_recurring: subscriptions with annual total, price hike and video overlap', () => {
    const d = data(executeTool(call('list_recurring', { onlySubscriptions: true }), host))
    expect(d.count).toBeGreaterThanOrEqual(6)
    expect(d.annualTotal).toBeGreaterThan(0)
    expect(d.priceHike.merchant).toBe('iQIYI')
    expect(d.overlap.merchants).toEqual(expect.arrayContaining(['iQIYI', 'Tencent Video', 'Youku']))
  })

  it('analyze_bills: findings card and unpaid bills', () => {
    const o = executeTool(call('analyze_bills'), host)
    const kinds = data(o).findings.map((f: { kind: string }) => f.kind)
    expect(kinds).toEqual(expect.arrayContaining(['price_hike', 'duplicate_charge', 'bill_spike', 'subscription_overlap', 'due_soon']))
    expect(data(o).upcoming[0].dueDate <= data(o).upcoming[1].dueDate).toBe(true)
    expect(o.cards[0].type).toBe('findings')
  })

  it('get_insights, get_goals, check_affordability', () => {
    expect(data(executeTool(call('get_insights'), host)).insights.map((i: { kind: string }) => i.kind)).toEqual(expect.arrayContaining(['late_night', 'small_frequent']))
    expect(data(executeTool(call('get_goals'), host)).goals[0].name).toBe('Birkin 25')
    const a = executeTool(call('check_affordability', { amount: 129_900, label: 'sneakers' }), host)
    expect(data(a).verdict).toBe('skip')
    expect(a.cards[0].type).toBe('affordability')
    expect(executeTool(call('check_affordability', {}), host).ok).toBe(false)
  })

  it('xray_bill: always untrusted, flags the injection, takes no action', () => {
    const before = host.state()
    const raw = host.state().bank.bills.find((b) => b.id === 'bill_electricity_2026-09')?.rawText as string
    const o = executeTool(call('xray_bill', { text: raw }), host)
    expect(o.untrusted).toBe(true)
    expect(data(o).total).toBe(48_620)
    expect(data(o).dueDate).toBe('2026-10-28')
    expect(data(o).injection.suspicious).toBe(true)
    expect(o.cards[0].type).toBe('xray')
    expect(host.state()).toBe(before)
  })
})

describe('T1 organize tools', () => {
  it('set_category_budget updates the plan and can be undone', () => {
    const host = fakeHost()
    const before = host.state().budget
    const run = runTool(call('set_category_budget', { category: 'delivery', limit: 80_000 }), host)
    expect(run.outcome.ok).toBe(true)
    expect(host.state().budget?.categories.find((c) => c.category === 'delivery')?.limit).toBe(80_000)
    expect(data(run.outcome).previousLimit).toBe(before?.categories.find((c) => c.category === 'delivery')?.limit)
    host.mutate((draft, bank) => applyUndo(run.undo!, draft, bank))
    expect(host.state().budget).toEqual(before)
  })

  it('create_budget_plan: limits sum to the target', () => {
    const host = fakeHost()
    const o = executeTool(call('create_budget_plan', { method: 'history' }), host)
    const plan = host.state().budget!
    expect(o.ok).toBe(true)
    expect(plan.categories.reduce((s, c) => s + c.limit, 0)).toBe(host.state().profile!.targetSpend)
    expect(plan.createdBy).toBe('agent')
  })

  it('create_tripwire adds an agent tripwire; undo removes it', () => {
    const host = fakeHost()
    const run = runTool(call('create_tripwire', { kind: 'single_over', threshold: 30_000 }), host)
    const t = host.state().tripwires.find((x) => x.id === data(run.outcome).id)
    expect(t).toMatchObject({ kind: 'single_over', threshold: 30_000, createdBy: 'agent', enabled: true })
    expect(t?.label).toContain('¥300')
    host.mutate((d, b) => applyUndo(run.undo!, d, b))
    expect(host.state().tripwires.some((x) => x.id === t?.id)).toBe(false)
    expect(executeTool(call('create_tripwire', { kind: 'category_pct', threshold: 80 }), host).ok).toBe(false)
  })

  it('recategorize_transaction learns the merchant rule; undo restores both', () => {
    const host = fakeHost()
    const txn = host.state().bank.transactions.find((t) => t.merchant === 'Luckin Coffee')!
    const run = runTool(call('recategorize_transaction', { txnId: txn.id, category: 'groceries' }), host)
    expect(host.state().bank.transactions.find((t) => t.id === txn.id)?.category).toBe('groceries')
    expect(Object.values(host.state().categoryRules)).toContain('groceries')
    host.mutate((d, b) => applyUndo(run.undo!, d, b))
    expect(host.state().bank.transactions.find((t) => t.id === txn.id)?.category).toBe(txn.category)
    expect(host.state().categoryRules).toEqual({})
  })

  it('set_bill_reminder stores days-before; undo clears it', () => {
    const host = fakeHost()
    const run = runTool(call('set_bill_reminder', { billId: 'bill_electricity_2026-09', daysBefore: 3 }), host)
    expect(host.state().billReminders['bill_electricity_2026-09']).toBe(3)
    host.mutate((d, b) => applyUndo(run.undo!, d, b))
    expect(host.state().billReminders).toEqual({})
    expect(executeTool(call('set_bill_reminder', { billId: 'nope', daysBefore: 3 }), host).ok).toBe(false)
  })
})

describe('T2 / T3 tools (bank)', () => {
  it('transfer_to_goal moves money via transferInternal (agent) and is reversible', () => {
    const host = fakeHost()
    const checking = () => host.state().bank.accounts.find((a) => a.id === 'chk_main')!.balance
    const pot = () => host.state().bank.accounts.find((a) => a.id === 'pot_dream_chengdu')!.balance
    const [c0, p0] = [checking(), pot()]
    const run = runTool(call('transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 }), host)
    expect(run.outcome.ok).toBe(true)
    expect(checking()).toBe(c0 - 30_000)
    expect(pot()).toBe(p0 + 30_000)
    expect(run.outcome.txnIds).toHaveLength(2)
    const txns = host.state().bank.transactions.filter((t) => run.outcome.txnIds!.includes(t.id))
    expect(txns.every((t) => t.initiatedBy === 'agent' && !t.memo)).toBe(true)
    host.mutate((d, b) => applyUndo(run.undo!, d, b))
    expect([checking(), pot()]).toEqual([c0, p0])
  })

  it('transfer_to_goal opens a pot for a dream without one; withdraw needs a pot', () => {
    const host = fakeHost()
    const o = executeTool(call('transfer_to_goal', { goalId: 'dream_airpods', amount: 10_000 }), host)
    expect(o.ok).toBe(true)
    expect(host.state().bank.accounts.find((a) => a.id === 'pot_dream_airpods')?.balance).toBe(10_000)
    expect(host.state().dreams.find((d) => d.id === 'dream_airpods')?.potAccountId).toBe('pot_dream_airpods')
    expect(executeTool(call('withdraw_from_goal', { goalId: 'dream_shoes', amount: 100 }), host).ok).toBe(false)
    expect(executeTool(call('withdraw_from_goal', { goalId: 'dream_airpods', amount: 10_000 }), host).ok).toBe(true)
  })

  it('pay_bill pays the verified payee and marks the bill paid', () => {
    const host = fakeHost()
    const o = executeTool(call('pay_bill', { billId: 'bill_electricity_2026-09' }), host)
    expect(o.ok).toBe(true)
    const bill = host.state().bank.bills.find((b) => b.id === 'bill_electricity_2026-09')!
    expect(bill.status).toBe('paid')
    expect(data(o).payee).toBe('Shenzhen Power Supply')
    expect(executeTool(call('pay_bill', { billId: 'bill_electricity_2026-09' }), host).ok).toBe(false)
  })

  it('cancel_subscription stops future charges', () => {
    const host = fakeHost()
    const o = executeTool(call('cancel_subscription', { recurringId: 'rec_youku' }), host)
    expect(o.ok).toBe(true)
    expect(host.state().bank.cancelledMerchants).toContain('Youku')
    expect(host.recurring().find((r) => r.id === 'rec_youku')?.status).toBe('cancelled')
  })

  it('dispute_transaction opens a dispute once', () => {
    const host = fakeHost()
    const o = executeTool(call('dispute_transaction', { txnId: 'txn_20261003_002', reason: 'Duplicate' }), host)
    expect(o.ok).toBe(true)
    expect(host.state().bank.disputes).toHaveLength(1)
    expect(executeTool(call('dispute_transaction', { txnId: 'txn_20261003_002', reason: 'Again' }), host).ok).toBe(false)
  })
})

describe('T4 and unknown tools never execute', () => {
  it.each(TOOL_NAMES.filter((t) => TOOL_SPECS[t].tier === 4))('%s returns ok:false and changes nothing', (tool) => {
    const host = fakeHost()
    const before = host.state()
    const o = executeTool(call(tool, { to: '6222021001122334455', amount: 480_000 }), host)
    expect(o.ok).toBe(false)
    expect(host.state()).toBe(before)
  })

  it('unknown tool', () => {
    expect(executeTool(call('rm_rf'), fakeHost()).ok).toBe(false)
  })
})

describe('previewTool', () => {
  const host = fakeHost()
  const actionTools = TOOL_NAMES.filter((t) => TOOL_SPECS[t].tier >= 1 && TOOL_SPECS[t].tier <= 3)
  const sample: Record<string, Record<string, unknown>> = {
    set_category_budget: { category: 'delivery', limit: 80_000 },
    create_budget_plan: { method: 'history' },
    create_tripwire: { kind: 'single_over', threshold: 30_000 },
    recategorize_transaction: { txnId: 'txn_20261003_002', category: 'entertainment' },
    set_bill_reminder: { billId: 'bill_electricity_2026-09', daysBefore: 3 },
    transfer_to_goal: { goalId: 'dream_chengdu', amount: 30_000 },
    withdraw_from_goal: { goalId: 'dream_birkin', amount: 10_000 },
    pay_bill: { billId: 'bill_electricity_2026-09' },
    cancel_subscription: { recurringId: 'rec_youku' },
    dispute_transaction: { txnId: 'txn_20261003_002', reason: 'Duplicate' },
  }

  it.each(actionTools)('%s has a structured preview', (tool: ToolName) => {
    const p = previewTool(call(tool, sample[tool]), host)
    expect(p.title.length).toBeGreaterThan(5)
    expect(p.effects.length).toBeGreaterThan(0)
    expect(p.reversible).toBe(TOOL_SPECS[tool].reversible)
  })

  it('money previews show exact amount and masked from → to', () => {
    const p = previewTool(call('transfer_to_goal', sample.transfer_to_goal), host)
    expect(p).toMatchObject({ amount: 30_000, from: 'Everyday account •••• 4821', to: 'Weekend in Chengdu pot', reversible: true })
    expect(p.effects.join(' ')).toMatch(/undo/i)
    const bill = previewTool(call('pay_bill', sample.pay_bill), host)
    expect(bill).toMatchObject({ amount: 48_620, reversible: false, risk: 'high' })
    expect(bill.to).toBe('Shenzhen Power Supply •••• 0458 (verified payee)')
  })

  it('T4 previews mask account numbers', () => {
    const p = previewTool(call('transfer_external', { to: '6222021001122334455', amount: 480_000 }), host)
    expect(p.to).toBe('•••• 4455')
    expect(JSON.stringify(p)).not.toContain('6222021001122334455')
  })
})

describe('cheapestOverlapping', () => {
  it('picks the cheapest of 2+ subscriptions in the same niche', () => {
    expect(cheapestOverlapping(fakeHost().recurring())?.merchant).toBe('Youku')
    expect(cheapestOverlapping(fakeHost({ persona: 'arif' }).recurring())).toBeUndefined()
  })
})
