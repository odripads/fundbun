import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../../core/app'
import type { AuditEntry, ChatMessage, PlanStep, TaskPlan, TraceStep } from '../../../core/types'
import {
  ATTACKS,
  DECISION_META,
  currentPlan,
  decisionCounts,
  freshSeqs,
  humanize,
  isDecision,
  latestTurn,
  layoutPlan,
  pctLabel,
  recentDecisions,
  stepView,
  summarizeTrace,
  traceRows,
  turnPlanId,
} from './logic'

const ts = '2026-10-22T10:00:00Z'
const step = (kind: TraceStep['kind'], label: string, detail?: unknown): TraceStep => ({ kind, label, detail, ts })
const msg = (role: ChatMessage['role'], id: string, trace?: TraceStep[], text = id): ChatMessage => ({ id, role, text, ts, trace })

describe('latestTurn', () => {
  it('finds the newest traced assistant message and its question', () => {
    const chat = [msg('user', 'q1'), msg('assistant', 'a1', [step('intent', 'x')]), msg('user', 'q2'), msg('assistant', 'a2', [step('intent', 'y')]), msg('assistant', 'a3')]
    expect(latestTurn(chat)).toEqual({ message: chat[3], question: 'q2' })
  })

  it('omits the question when another assistant message sits in between', () => {
    const chat = [msg('user', 'q1'), msg('assistant', 'greeting'), msg('assistant', 'a1', [step('intent', 'x')])]
    expect(latestTurn(chat)).toEqual({ message: chat[2] })
    expect(latestTurn([])).toBeNull()
    expect(latestTurn([msg('assistant', 'a', [])])).toBeNull()
  })
})

describe('stepView', () => {
  it('reads intents with confidence and alternatives', () => {
    const v = stepView(step('intent', 'pay_bill (100%)', { intent: 'pay_bill', confidence: 1, rule: 'R-PAY-BILL', engine: 'offline', alternatives: [{ intent: 'bills', confidence: 0.4 }, { nope: 1 }] }))
    expect(v).toMatchObject({ kind: 'intent', intent: 'pay_bill', confidence: 1, rule: 'R-PAY-BILL', engine: 'offline' })
    expect(v.kind === 'intent' && v.alternatives).toEqual([{ intent: 'bills', confidence: 0.4 }, { intent: '?', confidence: 0 }])
    expect(stepView(step('intent', 'affirm (dialogue)', { act: 'affirm' }))).toMatchObject({ intent: 'affirm' })
  })

  it('reads tool calls with tiers and truncated args', () => {
    const v = stepView(step('tool_call', 'offline → transfer_external', { tool: 'transfer_external', args: { to: '•••• 4821', amount: 480000, memo: 'x'.repeat(60) }, proposedBy: 'offline' }))
    expect(v).toMatchObject({ kind: 'tool_call', tool: 'transfer_external', tier: 4, proposedBy: 'offline' })
    expect(v.kind === 'tool_call' && v.args.find(([k]) => k === 'memo')?.[1].length).toBeLessThanOrEqual(28)
    // unknown tools are treated as prohibited
    expect(stepView(step('tool_call', 'x', { tool: 'wire_money' }))).toMatchObject({ tier: 4 })
  })

  it('reads policy decisions, refusals and breaker trips as blocks', () => {
    expect(stepView(step('policy', 'DENY · transfer_external', { tool: 'transfer_external', decision: 'deny', tier: 4, ruleIds: ['P-T4-PROHIBITED'], reasons: ['never'] }))).toMatchObject({
      decision: 'deny', tier: 4, ruleIds: ['P-T4-PROHIBITED'], reasons: ['never'],
    })
    expect(stepView(step('policy', 'Sensitive request refused', { rule: 'R-FULL-NUMBER' }))).toMatchObject({ decision: 'deny', ruleIds: ['R-FULL-NUMBER'] })
    expect(stepView(step('policy', 'Circuit breaker tripped — agent frozen', { reason: 'Too many denied money attempts' }))).toMatchObject({ decision: 'deny', reasons: ['Too many denied money attempts'] })
    expect(stepView(step('policy', 'Plan cancelled by the user', { plans: 1 }))).toMatchObject({ decision: undefined })
  })

  it('reads injection, grounding, results and other steps defensively', () => {
    expect(stepView(step('injection', 'Prompt injection detected', { signals: ['payment-instruction', 3], score: 1 }))).toMatchObject({ signals: ['payment-instruction'], score: 1 })
    expect(stepView(step('grounding', 'g', { ok: false, checked: 3, ungrounded: ['¥99'] }))).toMatchObject({ ok: false, checked: 3, ungrounded: ['¥99'] })
    expect(stepView(step('tool_result', 'r', { ok: true, untrusted: true, tool: 'xray_bill' }))).toMatchObject({ ok: true, untrusted: true })
    expect(stepView(step('llm', 'LLM request', { round: 1, messages: 4 }))).toMatchObject({ kind: 'llm', facts: [['round', '1'], ['messages', '4']] })
    expect(stepView(step('policy', 'odd', 'not an object'))).toMatchObject({ kind: 'policy', ruleIds: [], reasons: [] })
  })
})

describe('summary and folding', () => {
  const trace = [
    step('intent', 'external_transfer', { intent: 'external_transfer', confidence: 1 }),
    step('tool_call', 'offline → transfer_external', { tool: 'transfer_external', args: {} }),
    step('policy', 'DENY', { tool: 'transfer_external', decision: 'deny', tier: 4, ruleIds: ['P-T4-PROHIBITED'] }),
    step('tool_call', 'offline → xray_bill', { tool: 'xray_bill', args: {} }),
    step('policy', 'ALLOW', { tool: 'xray_bill', decision: 'allow', tier: 0, ruleIds: ['P-TIER-MATRIX'] }),
    step('tool_result', 'flagged', { tool: 'xray_bill', ok: true, untrusted: true }),
    step('injection', 'Turn tainted', { reason: 'untrusted' }),
    step('injection', 'Prompt injection detected', { signals: ['instruction-override'] }),
    step('grounding', 'Grounded', { ok: true, checked: 2, ungrounded: [] }),
  ]

  it('summarises a turn', () => {
    expect(summarizeTrace(trace)).toEqual({ steps: 9, tools: 2, denied: 1, waiting: 0, tainted: true, injections: 1, grounded: { ok: true, checked: 2 } })
  })

  it('folds call + decision + result into one row', () => {
    const rows = traceRows(trace)
    expect(rows.map((r) => r.kind)).toEqual(['step', 'tool', 'tool', 'step', 'step', 'step'])
    const [, deny, xray] = rows
    expect(deny.kind === 'tool' && [deny.call.tool, deny.policy?.decision, deny.result]).toEqual(['transfer_external', 'deny', undefined])
    expect(xray.kind === 'tool' && [xray.policy?.decision, xray.result?.untrusted]).toEqual(['allow', true])
  })

  it('does not attach a decision for a different tool', () => {
    const rows = traceRows([
      step('tool_call', 'a', { tool: 'get_overview' }),
      step('policy', 'p', { tool: 'pay_bill', decision: 'step_up' }),
    ])
    expect(rows.map((r) => r.kind)).toEqual(['tool', 'step'])
  })

  it('finds the plan a turn made', () => {
    expect(turnPlanId([step('intent', 'Task plan: x', { planId: 'plan_1' })])).toBe('plan_1')
    expect(turnPlanId(trace)).toBeUndefined()
  })
})

describe('task-plan DAG', () => {
  const s = (id: string, dependsOn: string[], status: PlanStep['status'] = 'done'): PlanStep => ({ id, tool: 'get_overview', args: {}, dependsOn, label: id, status })

  it('layers steps by longest dependency path', () => {
    const { levels, edges } = layoutPlan([s('s1', []), s('s2', ['s1']), s('s3', ['s1']), s('s4', ['s2']), s('s5', ['s2', 's4'])])
    expect(levels.map((l) => l.map((n) => n.step.id))).toEqual([['s1'], ['s2', 's3'], ['s4'], ['s5']])
    expect(levels[1].map((n) => n.x)).toEqual([25, 75])
    expect(edges).toHaveLength(5)
  })

  it('tolerates cycles, self-references and unknown deps', () => {
    const { levels, edges } = layoutPlan([s('a', ['b']), s('b', ['a']), s('c', ['c', 'zz'])])
    expect(levels.flat()).toHaveLength(3)
    expect(edges.every((e) => e.from !== e.to)).toBe(true)
    expect(layoutPlan([])).toEqual({ levels: [], edges: [] })
  })

  it('prefers a plan still in flight', () => {
    const p = (id: string, status: TaskPlan['status']): TaskPlan => ({ id, goal: id, createdAt: ts, status, steps: [] })
    expect(currentPlan([p('a', 'awaiting_user'), p('b', 'done')])?.id).toBe('a')
    expect(currentPlan([p('a', 'done'), p('b', 'cancelled')])?.id).toBe('b')
    expect(currentPlan([])).toBeNull()
  })
})

describe('policy tail', () => {
  const e = (seq: number, type: AuditEntry['type'], data: Record<string, unknown>): AuditEntry => ({ seq, ts, actor: 'policy', type, summary: '', data, prevHash: '', hash: '' })
  const audit = [
    e(1, 'policy_decision', { tool: 'get_overview', decision: 'allow', tier: 0, ruleIds: ['P-TIER-MATRIX'] }),
    e(2, 'tool_call', {}),
    e(3, 'policy_decision', { tool: 'transfer_external', decision: 'deny', tier: 4, ruleIds: ['P-T4-PROHIBITED'], tainted: true }),
    e(4, 'policy_decision', { decision: 'maybe' }),
    e(5, 'policy_decision', { tool: 'pay_bill', decision: 'step_up', tier: 9 }),
  ]

  it('lists the newest valid decisions first', () => {
    const r = recentDecisions(audit, 2)
    expect(r.map((d) => [d.seq, d.decision, d.tier])).toEqual([[5, 'step_up', undefined], [3, 'deny', 4]])
    expect(r[1].tainted).toBe(true)
  })

  it('counts decisions and fresh entries', () => {
    expect(decisionCounts(audit)).toEqual({ allow: 1, confirm: 0, step_up: 1, deny: 1 })
    expect([...freshSeqs(audit, 3)]).toEqual([4, 5])
  })

  it('has labels for every decision', () => {
    for (const d of ['allow', 'confirm', 'step_up', 'deny'] as const) {
      expect(isDecision(d)).toBe(true)
      expect(DECISION_META[d].label).toBeTruthy()
    }
    expect(isDecision('nope')).toBe(false)
  })
})

describe('red-team prompts against the real engine', () => {
  it('every attack is defended: denied, flagged or refused', async () => {
    const app = createTestApp()
    app.loadDemo('mei')
    for (const a of ATTACKS) {
      const m = await app.sendMessage(a.text)
      const sum = summarizeTrace(m.trace ?? [])
      expect([a.id, sum.denied > 0 || sum.injections > 0]).toEqual([a.id, true])
    }
    expect(app.getSnapshot().state.bank.accounts.find((x) => x.id === 'chk_main')?.balance).toBeGreaterThan(0)
  })

  it('formats helpers', () => {
    expect(pctLabel(0.876)).toBe('88%')
    expect(pctLabel(2)).toBe('100%')
    expect(pctLabel(undefined)).toBe('')
    expect(humanize('transfer_to_goal')).toBe('transfer to goal')
  })
})
