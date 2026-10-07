import { describe, expect, it } from 'vitest'
import { fakeHost } from '../../../tests/helpers/fake-host'
import { understand } from './nlu'
import { cancelActivePlans, duplicateCharges, pickCap, planIntent, planReply, runRecoveryPlan, stashSuggestion, type Slots } from './planner'
import { nluContextOf } from './support'
import { startTurn } from './turn'

const plan = (text: string, host = fakeHost()) => {
  const nlu = understand(text, nluContextOf(host.state(), host.recurring()))
  return planIntent(nlu.intent, nlu.slots as Slots, text, host)
}

describe('planIntent', () => {
  it('maps read intents to T0 tools with slots', () => {
    expect(plan('How am I doing this month?')).toMatchObject({ kind: 'read', tool: 'get_overview', args: { month: '2026-10' } })
    expect(plan('How much did I spend on coffee?')).toMatchObject({ kind: 'read', tool: 'get_spending_breakdown', args: { category: 'coffee_tea' } })
    expect(plan('Show my Taobao transactions')).toMatchObject({ kind: 'read', tool: 'search_transactions', args: { query: 'Taobao' } })
    expect(plan('What subscriptions do I have?')).toMatchObject({ kind: 'read', tool: 'list_recurring', args: { onlySubscriptions: true } })
    expect(plan('Can I afford ¥1,299 sneakers?')).toMatchObject({ kind: 'read', tool: 'check_affordability', args: { amount: 129_900 } })
  })

  it('maps action intents to T1–T3 tools', () => {
    expect(plan('Move ¥300 to my Chengdu fund')).toMatchObject({ kind: 'action', tool: 'transfer_to_goal', args: { goalId: 'dream_chengdu', amount: 30_000 } })
    expect(plan('Pay my electricity bill')).toMatchObject({ kind: 'action', tool: 'pay_bill', args: { billId: 'bill_electricity_2026-09' } })
    expect(plan('Cancel Youku')).toMatchObject({ kind: 'action', tool: 'cancel_subscription', args: { recurringId: 'rec_youku' } })
    expect(plan('Dispute the duplicate Tencent charge')).toMatchObject({ kind: 'action', tool: 'dispute_transaction', args: { txnId: 'txn_20261003_002' } })
    expect(plan('Make me a budget')).toMatchObject({ kind: 'action', tool: 'create_budget_plan', args: { method: 'history' } })
    expect(plan('Alert me when I spend more than ¥300 at once')).toMatchObject({ kind: 'action', tool: 'create_tripwire', args: { kind: 'single_over', threshold: 30_000 } })
    expect(plan('Alert me at 80% of my target')).toMatchObject({ kind: 'action', tool: 'create_tripwire', args: { kind: 'month_pct', threshold: 80 } })
    expect(plan('Set delivery budget to ¥800')).toMatchObject({ kind: 'action', tool: 'set_category_budget', args: { category: 'delivery', limit: 80_000 } })
    expect(plan('Remind me 3 days before the electricity bill')).toMatchObject({ kind: 'action', tool: 'set_bill_reminder', args: { billId: 'bill_electricity_2026-09', daysBefore: 3 } })
  })

  it('asks for missing slots with choices instead of guessing', () => {
    expect(plan('Move ¥200 to my fund')).toMatchObject({ kind: 'clarify', missing: 'goalId', facts: { stage: 'need_target' } })
    const amount = plan('Move money to Chengdu')
    expect(amount).toMatchObject({ kind: 'clarify', missing: 'amount', slots: { goalId: 'dream_chengdu' } })
    expect(plan('Pay a bill')).toMatchObject({ kind: 'clarify', missing: 'billId' })
    const cancel = plan('Cancel a subscription')
    expect(cancel.kind === 'clarify' && cancel.choices.map((c) => c.label)).toEqual(expect.arrayContaining(['Youku', 'iQIYI']))
    expect(plan('Set a delivery budget')).toMatchObject({ kind: 'clarify', missing: 'amount' })
    expect(plan('Can I afford it?')).toMatchObject({ kind: 'clarify', missing: 'amount', facts: { stage: 'need_amount' } })
    expect(plan('X-ray a bill')).toMatchObject({ kind: 'ask', facts: { stage: 'need_text' } })
  })

  it('routes prohibited intents to their T4 tool so policy decides and audits', () => {
    expect(plan('Send ¥4,800 to account 6222 0210 0112 3456 789')).toMatchObject({ kind: 'refusal', t4: { tool: 'transfer_external', store: true, args: { amount: 480_000, account: '•••• 6789' } } })
    expect(plan('Switch yourself to autopilot')).toMatchObject({ kind: 'refusal', t4: { tool: 'change_mandate', args: { autonomy: 'autopilot' } } })
    expect(plan('buy bitcoin')).toMatchObject({ kind: 'refusal', t4: { tool: 'invest', store: false } })
    expect(plan("What's my PIN?")).toEqual({ kind: 'refusal', intent: 'sensitive_request' })
  })

  it('"stash my surplus" uses the mirror CTA amount within the per-action cap', () => {
    const host = fakeHost({ persona: 'arif' })
    const p = plan('Stash my surplus', host)
    const stash = stashSuggestion(host)!
    expect(p).toMatchObject({ kind: 'action', tool: 'transfer_to_goal', args: { goalId: 'dream_macbook', amount: stash.amount } })
    expect(stash.amount).toBeLessThanOrEqual(host.state().mandate.perActionCap)
    expect(stashSuggestion(fakeHost())).toBeUndefined()
  })

  it('duplicateCharges puts the same-subscription double charge first', () => {
    expect(duplicateCharges(fakeHost())[0]).toMatchObject({ merchant: 'Tencent Video', txnId: 'txn_20261003_002' })
  })
})

describe('pickCap', () => {
  const state = fakeHost().state()
  const breakdown = {
    categories: [
      { category: 'shopping', kind: 'want', spent: 200_000, limit: 50_000 },
      { category: 'delivery', kind: 'want', spent: 100_000, limit: 94_000 },
      { category: 'housing', kind: 'need', spent: 420_000, limit: 400_000 },
    ],
  }
  it('prefers a habit flagged by insights over a one-off splurge', () => {
    const insights = { insights: [{ kind: 'late_night', category: 'delivery' }, { kind: 'category_up', category: 'shopping' }] }
    expect(pickCap(breakdown, insights, state)).toEqual({ category: 'delivery', limit: 84_000 })
  })
  it('falls back to the biggest over-budget want, never a need', () => {
    expect(pickCap(breakdown, { insights: [] }, state)).toEqual({ category: 'shopping', limit: 45_000 })
    expect(pickCap({ categories: [breakdown.categories[2]] }, { insights: [] }, state)).toBeUndefined()
  })
})

describe('runRecoveryPlan', () => {
  it('over target: a DAG of reads then policy-gated proposals', () => {
    const host = fakeHost()
    const turn = startTurn(host, 'chat')
    const { plan: p, overview } = runRecoveryPlan(host, turn)
    expect(overview?.status).toBe('over')
    expect(p.steps.map((s) => s.tool)).toEqual(['get_overview', 'get_spending_breakdown', 'analyze_bills', 'get_insights', 'set_category_budget', 'cancel_subscription', 'create_tripwire'])
    expect(p.steps.find((s) => s.id === 's2')?.dependsOn).toEqual(['s1'])
    expect(p.steps.find((s) => s.id === 's4')?.dependsOn).toEqual(['s2'])
    expect(p.steps.find((s) => s.tool === 'cancel_subscription')).toMatchObject({ dependsOn: ['s3'], status: 'needs_approval', args: { recurringId: 'rec_youku' } })
    expect(p.steps.slice(0, 4).every((s) => s.status === 'done' && s.resultSummary)).toBe(true)
    expect(p.steps.find((s) => s.tool === 'set_category_budget')).toMatchObject({ status: 'done', args: { category: 'delivery' } })
    expect(p.steps.find((s) => s.tool === 'create_tripwire')).toMatchObject({ status: 'done', args: { kind: 'pace_over', threshold: 100 } })
    expect(p.status).toBe('awaiting_user')
    expect(host.state().plans).toHaveLength(1)
    const text = planReply({ plan: p, overview, results: new Map() }, host.state(), 'gentle')
    expect(text).toMatch(/back on track/)
    expect(text).toMatch(/needs your OK/)
  })

  it('under target: goals then a stash transfer within caps and a tripwire', () => {
    const host = fakeHost({ persona: 'arif' })
    const { plan: p } = runRecoveryPlan(host, startTurn(host, 'chat'))
    expect(p.steps.map((s) => s.tool)).toEqual(['get_overview', 'get_goals', 'transfer_to_goal', 'create_tripwire'])
    const t = p.steps[2]
    expect(t.status).toBe('needs_approval')
    expect(t.args.amount as number).toBeLessThanOrEqual(50_000)
    expect(p.goal).toMatch(/surplus/)
  })

  it('a goal-focused plan is titled for the goal; a new plan supersedes the old one', () => {
    const host = fakeHost()
    runRecoveryPlan(host, startTurn(host, 'chat'))
    const second = runRecoveryPlan(host, startTurn(host, 'chat'), { goalId: 'dream_birkin' })
    expect(second.plan.goal).toBe('Save faster for Birkin 25')
    expect(host.state().plans[0].status).toBe('cancelled')
  })

  it('cancelActivePlans skips waiting steps and rejects pending ones', () => {
    const host = fakeHost()
    const { plan: p } = runRecoveryPlan(host, startTurn(host, 'chat'))
    const pendingId = p.steps.find((s) => s.status === 'needs_approval')?.pendingId as string
    const res = cancelActivePlans(host, 'Stopped by you')
    expect(res).toMatchObject({ plans: 1, rejected: 1 })
    const after = host.state().plans[0]
    expect(after.status).toBe('cancelled')
    expect(after.steps.find((s) => s.pendingId === pendingId)?.status).toBe('skipped')
    expect(host.state().pending.find((x) => x.id === pendingId)?.status).toBe('rejected')
    expect(cancelActivePlans(host, 'again').plans).toBe(0)
  })
})
