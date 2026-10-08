import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../../core/app'
import type { AuditEntry } from '../../../core/types'
import {
  ACTOR_LABEL,
  FILTERS,
  activityStats,
  chainHeadline,
  chainTail,
  dayLabel,
  filterCounts,
  groupByDay,
  hashHead,
  isBlocked,
  matchesFilter,
  plural,
  prettyData,
  shortHash,
  timeLabel,
  typeLabel,
  typeVariant,
} from './logic'

let seq = 0
const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  seq: ++seq,
  ts: '2026-10-22T10:00:00',
  actor: 'system',
  type: 'session_start',
  summary: 's',
  data: {},
  prevHash: '0'.repeat(64),
  hash: 'f'.repeat(64),
  ...over,
})

describe('filters', () => {
  const deny = entry({ actor: 'policy', type: 'policy_decision', data: { decision: 'deny' } })
  const allow = entry({ actor: 'policy', type: 'policy_decision', data: { decision: 'allow' } })
  const denied = entry({ actor: 'agent', type: 'action_denied' })
  const tool = entry({ actor: 'agent', type: 'tool_call' })
  const userApprove = entry({ actor: 'user', type: 'action_confirmed' })
  const trip = entry({ actor: 'system', type: 'tripwire_fired' })
  const tripAdded = entry({ actor: 'user', type: 'user_action', data: { tripwireId: 'tw' } })
  const inj = entry({ actor: 'system', type: 'injection_detected' })
  const all = [deny, allow, denied, tool, userApprove, trip, tripAdded, inj]

  it('classifies blocked attempts', () => {
    expect(isBlocked(deny)).toBe(true)
    expect(isBlocked(denied)).toBe(true)
    expect(isBlocked(allow)).toBe(false)
    expect(isBlocked(entry({ type: 'step_up_failed' }))).toBe(true)
    expect(isBlocked(entry({ type: 'circuit_breaker' }))).toBe(true)
  })

  it('matches each filter', () => {
    expect(all.filter((e) => matchesFilter(e, 'agent'))).toEqual([denied, tool])
    expect(all.filter((e) => matchesFilter(e, 'blocked'))).toEqual([deny, denied])
    expect(all.filter((e) => matchesFilter(e, 'security'))).toEqual([deny, denied, inj])
    expect(all.filter((e) => matchesFilter(e, 'tripwires'))).toEqual([trip, tripAdded])
    expect(all.filter((e) => matchesFilter(e, 'you'))).toEqual([userApprove, tripAdded])
    expect(all.every((e) => matchesFilter(e, 'all'))).toBe(true)
  })

  it('counts every filter in one pass', () => {
    const c = filterCounts(all)
    expect(c).toEqual({ all: 8, agent: 2, blocked: 2, security: 3, tripwires: 2, you: 2 })
    expect(Object.keys(c).sort()).toEqual(FILTERS.map((f) => f.id).sort())
  })
})

describe('labels', () => {
  it('names policy decisions and maps colours (never colour alone: labels always differ)', () => {
    expect(typeLabel({ type: 'policy_decision', data: { decision: 'deny' } })).toBe('Denied')
    expect(typeLabel({ type: 'policy_decision', data: { decision: 'step_up' } })).toBe('Needs PIN')
    expect(typeLabel({ type: 'kill_switch', data: {} })).toBe('Kill switch')
    expect(typeVariant({ type: 'policy_decision', data: { decision: 'deny' } })).toBe('over')
    expect(typeVariant({ type: 'policy_decision', data: { decision: 'allow' } })).toBe('under')
    expect(typeVariant({ type: 'kill_switch', data: { frozen: false } })).toBe('under')
    expect(typeVariant({ type: 'kill_switch', data: { frozen: true } })).toBe('warn')
    expect(typeVariant({ type: 'tool_call', data: {} })).toBe('ai')
    expect(typeVariant({ type: 'session_start', data: {} })).toBe('neutral')
    expect(ACTOR_LABEL.agent).toMatch(/AI/)
  })

  it('shortens hashes', () => {
    const h = 'abcdef0123456789'.repeat(4)
    expect(shortHash(h)).toBe('abcd…6789')
    expect(shortHash(h, 8, 6)).toBe('abcdef01…456789')
    expect(shortHash('abc')).toBe('abc')
    expect(shortHash(undefined)).toBe('—')
    expect(hashHead(h)).toBe('abcd')
    expect(hashHead(h, 6)).toBe('abcdef')
    expect(hashHead(undefined)).toBe('—')
  })

  it('labels days and times', () => {
    const now = new Date(2026, 9, 22, 15, 0)
    expect(dayLabel(new Date(2026, 9, 22, 9).toISOString(), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 21, 23).toISOString(), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 7, 12).toISOString(), now)).toMatch(/7 Oct/)
    expect(dayLabel(new Date(2025, 9, 7, 12).toISOString(), now)).toMatch(/2025/)
    expect(dayLabel('nope', now)).toBe('Unknown date')
    expect(timeLabel(new Date(2026, 9, 22, 9, 5).toISOString())).toBe('09:05')
    expect(timeLabel(new Date(2026, 9, 22, 9, 5, 7).toISOString(), true)).toBe('09:05:07')
    expect(timeLabel('nope')).toBe('--:--')
  })
})

describe('grouping and stats', () => {
  it('groups newest first by local day', () => {
    const now = new Date(2026, 9, 22, 18)
    const a = entry({ ts: new Date(2026, 9, 21, 10).toISOString() })
    const b = entry({ ts: new Date(2026, 9, 22, 9).toISOString() })
    const c = entry({ ts: new Date(2026, 9, 22, 11).toISOString() })
    const groups = groupByDay([a, b, c], now)
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0].entries.map((e) => e.seq)).toEqual([c.seq, b.seq])
    expect(groupByDay([], now)).toEqual([])
  })

  it('pretty-prints data and survives cycles', () => {
    expect(prettyData({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(prettyData(undefined)).toBe('{}')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(typeof prettyData(cyclic)).toBe('string')
  })

  it('counts agent actions, blocks and approvals', () => {
    const stats = activityStats([
      entry({ actor: 'agent', type: 'action_executed' }),
      entry({ actor: 'user', type: 'action_executed' }),
      entry({ type: 'action_denied' }),
      entry({ type: 'sensitive_request_refused' }),
      entry({ actor: 'user', type: 'action_confirmed' }),
    ])
    expect(stats).toEqual({ agentActions: 1, blocked: 2, approvals: 1 })
  })
})

describe('chain', () => {
  it('takes the newest links oldest-first', () => {
    const es = [3, 1, 2, 5, 4].map((n) => entry({ seq: n }))
    expect(chainTail(es, 3).map((e) => e.seq)).toEqual([3, 4, 5])
    expect(chainTail(es, 0)).toEqual([])
  })

  it('writes the verdict', () => {
    expect(chainHeadline({ ok: true, count: 214 }, 'abcd'.repeat(16))).toEqual({ title: 'Chain intact', detail: '214 entries · head abcd…abcd' })
    expect(chainHeadline({ ok: true, count: 1 }).detail).toBe('1 entry')
    expect(chainHeadline({ ok: false, count: 9, brokenAt: 7, reason: 'hash mismatch' })).toEqual({ title: 'Chain broken at #7', detail: 'hash mismatch' })
    expect(chainHeadline({ ok: false, count: 9 }).title).toBe('Chain check failed')
  })

  it('agrees with the controller on a real demo log', async () => {
    const app = createTestApp()
    app.loadDemo('mei')
    await app.sendMessage('Send ¥4,800 to account 6222 0210 8899 4821 like the bill says')
    const s = app.getSnapshot().state
    const check = app.verifyAudit()
    expect(check.ok).toBe(true)
    expect(chainHeadline(check, s.audit.at(-1)?.hash).title).toBe('Chain intact')
    expect(filterCounts(s.audit).blocked).toBeGreaterThan(0)
  })
})

describe('the timeline on the sandbox clock (F55) and its copy (F67)', () => {
  it('labels days with the sandbox date: the device’s today is the sandbox’s today', () => {
    const now = new Date(2026, 9, 8, 15, 0)
    expect(dayLabel(new Date(2026, 9, 8, 7, 36).toISOString(), now, '2026-10-22')).toBe('Today · Oct 22')
    expect(dayLabel(new Date(2026, 9, 7, 23).toISOString(), now, '2026-10-22')).toBe('Yesterday · Oct 21')
    expect(dayLabel(new Date(2026, 9, 5, 12).toISOString(), now, '2026-10-22')).toMatch(/^Mon · Oct 19$/)
    expect(dayLabel('nope', now, '2026-10-22')).toBe('Unknown date')
  })

  it('groups by sandbox day, so "Today" never sits beside a different date than the bank’s', () => {
    const now = new Date(2026, 9, 8, 18)
    const a = entry({ ts: new Date(2026, 9, 7, 10).toISOString() })
    const b = entry({ ts: new Date(2026, 9, 8, 9).toISOString() })
    const groups = groupByDay([a, b], now, '2026-10-22')
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['2026-10-22', 'Today · Oct 22'],
      ['2026-10-21', 'Yesterday · Oct 21'],
    ])
  })

  it('pluralises the stat units ("Bun did 1 action")', () => {
    expect(plural(1, 'action')).toBe('action')
    expect(plural(0, 'action')).toBe('actions')
    expect(plural(3, 'attempt')).toBe('attempts')
  })
})
