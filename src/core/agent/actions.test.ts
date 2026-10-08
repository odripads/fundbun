import { describe, expect, it } from 'vitest'
import { PIN, fakeHost, type FakeHost } from '../../../tests/helpers/fake-host'
import { verifyAudit } from '../security/audit'
import { computeBindingHash } from '../security/binding'
import type { PendingAction, ToolCall } from '../types'
import {
  agentRecords,
  approvePending,
  checkBreaker,
  expirePending,
  newCall,
  policyContext,
  rejectPending,
  runGated,
  undoPending,
} from './actions'
import { startTurn } from './turn'

const gate = (host: FakeHost, tool: string, args: Record<string, unknown>, proposedBy: ToolCall['proposedBy'] = 'offline', tainted = false) => {
  const turn = startTurn(host, 'chat')
  if (tainted) turn.tainted = true
  return { turn, r: runGated(host, turn, newCall(tool, args, proposedBy, turn)) }
}
const pending = (host: FakeHost, id: string) => host.state().pending.find((p) => p.id === id) as PendingAction
const auditTypes = (host: FakeHost) => host.state().audit.map((e) => e.type)
const balance = (host: FakeHost, id: string) => host.state().bank.accounts.find((a) => a.id === id)?.balance ?? 0

describe('runGated: reads', () => {
  it('T0 runs immediately, audited as tool_call + policy_decision, no pending action', () => {
    const host = fakeHost()
    const { r, turn } = gate(host, 'get_overview', {})
    expect(r.status).toBe('done')
    expect(r.decision.decision).toBe('allow')
    expect(host.state().pending).toEqual([])
    expect(auditTypes(host)).toEqual(['tool_call', 'policy_decision'])
    expect(turn.cards.map((c) => c.type)).toEqual(['mirror'])
    expect(turn.trace.map((t) => t.kind)).toEqual(['tool_call', 'policy', 'tool_result'])
  })

  it('untrusted results taint the turn and suspicious text is audited as injection_detected', () => {
    const host = fakeHost()
    const { r, turn } = gate(host, 'search_transactions', { query: 'Taobao', limit: 25 })
    expect(r.status).toBe('done')
    expect(turn.tainted).toBe(true)
    expect(turn.trace.some((t) => t.kind === 'injection' && /memo/.test(t.label))).toBe(true)
    const entry = host.state().audit.find((e) => e.type === 'injection_detected')!
    expect(entry.data.signals).toBeInstanceOf(Array)
    expect(JSON.stringify(entry.data)).not.toContain('6217')
    expect(turn.cards.some((c) => c.type === 'notice' && c.level === 'warn')).toBe(true)
  })
})

describe('runGated: actions', () => {
  it('T1 in copilot executes now, reversible with an undo window', () => {
    const host = fakeHost()
    const { r } = gate(host, 'create_tripwire', { kind: 'single_over', threshold: 30_000 })
    expect(r.status).toBe('done')
    expect(r.pending?.status).toBe('executed')
    expect(r.pending?.undoUntil).toBe(new Date(Date.parse(host.now()) + 30_000).toISOString())
    expect(auditTypes(host)).toEqual(['tool_call', 'policy_decision', 'action_executed'])
  })

  it('T2 in copilot becomes a pending action bound by hash', () => {
    const host = fakeHost()
    const { r, turn } = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 })
    expect(r.status).toBe('pending')
    const p = r.pending!
    expect(p.decision.decision).toBe('confirm')
    expect(p.bindingHash).toBe(computeBindingHash({ id: p.id, tool: p.call.tool, args: p.call.args, amount: 30_000, to: 'Weekend in Chengdu pot' }))
    expect(Date.parse(p.expiresAt) - Date.parse(p.createdAt)).toBe(10 * 60_000)
    expect(turn.cards).toEqual([{ type: 'action', pendingId: p.id }])
    expect(turn.dialogue.lastProposalId).toBe(p.id)
  })

  it('T3 always needs step-up', () => {
    const { r } = gate(fakeHost(), 'pay_bill', { billId: 'bill_electricity_2026-09' })
    expect(r.pending?.decision.decision).toBe('step_up')
  })

  it('denials are stored (for breaker / rate), audited and shown as a block notice', () => {
    const host = fakeHost()
    const { r, turn } = gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 80_000 })
    expect(r.status).toBe('denied')
    expect(r.pending?.status).toBe('denied')
    expect(r.decision.ruleIds).toEqual(['P-CAP-PER-ACTION'])
    expect(auditTypes(host)).toEqual(['tool_call', 'policy_decision', 'action_denied'])
    expect(turn.cards[0]).toMatchObject({ type: 'notice', level: 'block' })
    expect(r.reason).toMatch(/¥800.*¥500/)
  })

  it('taint forces confirmation for T2 even in autopilot', () => {
    const host = fakeHost({ mandate: { autonomy: 'autopilot' } })
    expect(gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 10_000 }).r.status).toBe('done')
    const { r } = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 10_000 }, 'offline', true)
    expect(r.status).toBe('pending')
    expect(r.decision.ruleIds).toContain('P-TAINT')
  })

  it('the LLM can never call a tool that is not exposed to it', () => {
    const host = fakeHost()
    const { r } = gate(host, 'transfer_external', { to: '6222021001122334455', amount: 480_000 }, 'llm')
    expect(r.status).toBe('denied')
    expect(r.decision.ruleIds).toEqual(['P-LLM-NOT-EXPOSED', 'P-T4-PROHIBITED'])
    expect(JSON.stringify(host.state())).not.toContain('6222021001122334455')
    expect(gate(host, 'nonexistent_tool', {}, 'llm').r.decision.ruleIds[0]).toBe('P-LLM-NOT-EXPOSED')
  })

  it('records agent actions for caps / rate limiting, excluding user-proposed ones', () => {
    const host = fakeHost()
    gate(host, 'create_tripwire', { kind: 'single_over', threshold: 30_000 })
    gate(host, 'create_tripwire', { kind: 'single_over', threshold: 40_000 }, 'user')
    const records = agentRecords(host.state())
    expect(records).toHaveLength(1)
    expect(policyContext(host, host.state(), false).recentAgentActions).toHaveLength(1)
  })
})

describe('approve / reject / undo / expire', () => {
  it('approve executes a confirm action, audits confirmed + executed, undo restores balances', () => {
    const host = fakeHost()
    const { r } = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 })
    const c0 = balance(host, 'chk_main')
    const res = approvePending(host, r.pending!.id)
    expect(res.ok).toBe(true)
    expect(pending(host, r.pending!.id).status).toBe('executed')
    expect(balance(host, 'chk_main')).toBe(c0 - 30_000)
    expect(auditTypes(host).filter((t) => t.startsWith('action_'))).toEqual(['action_confirmed', 'action_executed'])
    expect(host.state().audit.find((e) => e.type === 'action_executed')?.data.bindingHash).toBe(r.pending!.bindingHash)
    expect(undoPending(host, r.pending!.id)).toMatchObject({ ok: true })
    expect(balance(host, 'chk_main')).toBe(c0)
    expect(pending(host, r.pending!.id).status).toBe('undone')
    expect(undoPending(host, r.pending!.id).ok).toBe(false)
    expect(verifyAudit(host.state().audit).ok).toBe(true)
  })

  it('undo is refused after the window', () => {
    const host = fakeHost()
    const { r } = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 })
    approvePending(host, r.pending!.id)
    host.clock.advanceSeconds(31)
    expect(undoPending(host, r.pending!.id)).toMatchObject({ ok: false, error: expect.stringMatching(/window/) })
  })

  it('step_up needs the PIN; wrong PIN is persisted and audited; correct PIN executes', () => {
    const host = fakeHost()
    const { r } = gate(host, 'pay_bill', { billId: 'bill_electricity_2026-09' })
    const id = r.pending!.id
    expect(approvePending(host, id).error).toMatch(/PIN/)
    const wrong = approvePending(host, id, '1357')
    expect(wrong.ok).toBe(false)
    expect(host.state().mandate.failedPinAttempts).toBe(1)
    expect(pending(host, id).status).toBe('pending')
    expect(auditTypes(host).filter((t) => t === 'step_up_failed')).toHaveLength(2)
    expect(approvePending(host, id, PIN).ok).toBe(true)
    expect(host.state().mandate.failedPinAttempts).toBe(0)
    expect(host.state().bank.bills.find((b) => b.id === 'bill_electricity_2026-09')?.status).toBe('paid')
    expect(undoPending(host, id).ok).toBe(false)
  })

  it('three wrong PINs lock PIN entry', () => {
    const host = fakeHost()
    const { r } = gate(host, 'cancel_subscription', { recurringId: 'rec_youku' })
    for (let i = 0; i < 3; i++) approvePending(host, r.pending!.id, '1357')
    expect(host.state().mandate.pinLockedUntil).toBeTruthy()
    expect(approvePending(host, r.pending!.id, PIN).error).toMatch(/locked/i)
  })

  it('re-evaluates policy at approval time (frozen since → denied)', () => {
    const host = fakeHost()
    const { r } = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 })
    host.edit((d) => {
      d.mandate.frozen = true
    })
    const res = approvePending(host, r.pending!.id)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/paused/)
    expect(pending(host, r.pending!.id)).toMatchObject({ status: 'denied' })
    expect(pending(host, r.pending!.id).decision.ruleIds).toEqual(['P-FROZEN'])
  })

  it('refuses to execute when the pending args were tampered with (binding hash)', () => {
    const host = fakeHost()
    const { r } = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 })
    host.edit((d) => {
      const p = d.pending.find((x) => x.id === r.pending!.id)!
      p.call.args.amount = 49_000
    })
    const c0 = balance(host, 'chk_main')
    const res = approvePending(host, r.pending!.id)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/changed after you saw it/)
    expect(balance(host, 'chk_main')).toBe(c0)
    expect(host.state().audit.at(-1)).toMatchObject({ type: 'action_failed', data: { reason: 'binding_mismatch' } })
  })

  it('reject and expire', () => {
    const host = fakeHost()
    const a = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 10_000 }).r.pending!
    const b = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 20_000 }).r.pending!
    expect(rejectPending(host, a.id)).toBe(true)
    expect(rejectPending(host, a.id)).toBe(false)
    expect(pending(host, a.id).status).toBe('rejected')
    host.clock.advanceMinutes(11)
    expect(expirePending(host)).toBe(1)
    expect(pending(host, b.id).status).toBe('expired')
    expect(approvePending(host, b.id).ok).toBe(false)
  })

  it('an approval after expiry marks it expired', () => {
    const host = fakeHost()
    const a = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 10_000 }).r.pending!
    host.clock.advanceMinutes(11)
    expect(approvePending(host, a.id).error).toMatch(/expired/)
    expect(pending(host, a.id).status).toBe('expired')
  })
})

describe('caps, rate limit and circuit breaker', () => {
  it('daily cap: the third ¥400 transfer is denied (P-CAP-DAILY)', () => {
    const host = fakeHost()
    for (let i = 0; i < 2; i++) {
      const p = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 40_000 }).r.pending!
      expect(approvePending(host, p.id).ok).toBe(true)
    }
    const third = gate(host, 'transfer_to_goal', { goalId: 'dream_chengdu', amount: 40_000 }).r
    expect(third.status).toBe('denied')
    expect(third.decision.ruleIds).toEqual(['P-CAP-DAILY'])
  })

  it('rate limit: more than maxActionsPerHour agent actions → P-RATE', () => {
    const host = fakeHost({ mandate: { maxActionsPerHour: 3 } })
    for (let i = 0; i < 3; i++) expect(gate(host, 'create_tripwire', { kind: 'single_over', threshold: 10_000 + i }).r.status).toBe('done')
    const r = gate(host, 'create_tripwire', { kind: 'single_over', threshold: 20_000 }).r
    expect(r.decision.ruleIds).toEqual(['P-RATE'])
  })

  it('three denied money attempts in 10 minutes trip the breaker (frozen + audited + notice)', () => {
    const host = fakeHost()
    gate(host, 'transfer_external', { to: 'x', amount: 1 })
    gate(host, 'add_payee', { name: 'x' })
    expect(host.state().mandate.frozen).toBe(false)
    const { turn } = gate(host, 'change_mandate', { autonomy: 'autopilot' })
    expect(host.state().mandate).toMatchObject({ frozen: true, breakerReason: expect.stringMatching(/3 blocked/) })
    expect(auditTypes(host)).toContain('circuit_breaker')
    expect(turn.cards.some((c) => c.type === 'notice' && c.title.includes('paused'))).toBe(true)
    expect(gate(host, 'create_tripwire', { kind: 'single_over', threshold: 30_000 }).r.decision.ruleIds).toEqual(['P-FROZEN'])
    expect(checkBreaker(host)).toBe(false)
  })

  it('a denied money attempt in a tainted turn trips immediately', () => {
    const host = fakeHost()
    gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 80_000 }, 'offline', true)
    expect(host.state().mandate.frozen).toBe(true)
  })

  it('attempts before the last unfreeze do not count', () => {
    const host = fakeHost()
    for (let i = 0; i < 3; i++) gate(host, 'transfer_external', { to: 'x', amount: 1 })
    expect(host.state().mandate.frozen).toBe(true)
    host.clock.advanceSeconds(5)
    host.mutate((d) => {
      d.mandate.frozen = false
      delete d.mandate.breakerTrippedAt
    })
    host.audit('user', 'kill_switch', 'unfreeze', { frozen: false })
    host.clock.advanceSeconds(5)
    gate(host, 'transfer_external', { to: 'x', amount: 1 })
    expect(host.state().mandate.frozen).toBe(false)
  })
})

describe('runGated: an identical waiting proposal is reused (F21)', () => {
  it('shows the same card again instead of creating a second one', () => {
    const host = fakeHost()
    const first = gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 20_000 })
    const second = gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 20_000 })
    expect(second.r).toMatchObject({ status: 'pending', reused: true })
    expect(second.r.pending?.id).toBe(first.r.pending?.id)
    expect(host.state().pending.filter((p) => p.status === 'pending')).toHaveLength(1)
    expect(second.turn.cards).toEqual([{ type: 'action', pendingId: first.r.pending?.id }])
  })

  it('a different amount or an already-decided proposal is a new proposal', () => {
    const host = fakeHost()
    const first = gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 20_000 })
    expect(gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 30_000 }).r.reused).toBeUndefined()
    rejectPending(host, first.r.pending!.id)
    expect(gate(host, 'transfer_to_goal', { goalId: 'dream_birkin', amount: 20_000 }).r.reused).toBeUndefined()
  })

  it('breaker records carry the denial rule ids and the proposer', () => {
    const host = fakeHost()
    gate(host, 'transfer_external', { to: 'x', amount: 100 })
    const rec = agentRecords(host.state()).at(-1)
    expect(rec).toMatchObject({ ruleIds: ['P-T4-PROHIBITED'], proposedBy: 'offline' })
  })
})
