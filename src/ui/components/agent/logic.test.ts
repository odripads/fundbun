import { describe, expect, it } from 'vitest'
import type { PlanStep } from '../../../core/types'
import {
  actionPhase,
  approveLabel,
  capitalize,
  clockTime,
  evidenceChips,
  formatEvidence,
  humanizeKey,
  isReadStep,
  needsPin,
  pinLockedFor,
  planGraph,
  planIsLive,
  planLevels,
  planProgress,
  secondsLeft,
  shortHash,
  signalLabel,
  timingLine,
} from './logic'

const NOW = Date.parse('2026-10-22T10:00:00.000Z')
const iso = (offsetSec: number) => new Date(NOW + offsetSec * 1000).toISOString()

function step(id: string, dependsOn: string[] = [], status: PlanStep['status'] = 'done', tool: PlanStep['tool'] = 'get_overview'): PlanStep {
  return { id, tool, args: {}, dependsOn, label: id, status }
}

describe('secondsLeft', () => {
  it('rounds up the remaining seconds and never goes negative', () => {
    expect(secondsLeft(iso(10), NOW)).toBe(10)
    expect(secondsLeft(iso(9.2), NOW)).toBe(10)
    expect(secondsLeft(iso(-5), NOW)).toBe(0)
  })

  it('is 0 for missing or unparseable times', () => {
    expect(secondsLeft(undefined, NOW)).toBe(0)
    expect(secondsLeft('not a date', NOW)).toBe(0)
  })
})

describe('actionPhase', () => {
  it('maps every pending status to what the card shows', () => {
    expect(actionPhase({ status: 'pending' }, NOW)).toBe('pending')
    expect(actionPhase({ status: 'approved' }, NOW)).toBe('running')
    expect(actionPhase({ status: 'denied' }, NOW)).toBe('blocked')
    expect(actionPhase({ status: 'failed' }, NOW)).toBe('failed')
    expect(actionPhase({ status: 'expired' }, NOW)).toBe('expired')
    expect(actionPhase({ status: 'rejected' }, NOW)).toBe('rejected')
    expect(actionPhase({ status: 'undone' }, NOW)).toBe('undone')
  })

  it('offers Undo only while the undo window is open', () => {
    expect(actionPhase({ status: 'executed', undoUntil: iso(20) }, NOW)).toBe('undoable')
    expect(actionPhase({ status: 'executed', undoUntil: iso(-1) }, NOW)).toBe('done')
    expect(actionPhase({ status: 'executed' }, NOW)).toBe('done')
  })
})

describe('shortHash', () => {
  it('keeps the first hex characters, lower-cased', () => {
    expect(shortHash('3F9A2C11ab')).toBe('3f9a2c')
    expect(shortHash('3f9a2c11ab', 8)).toBe('3f9a2c11')
  })

  it('handles empty and non-hex input', () => {
    expect(shortHash(undefined)).toBe('')
    expect(shortHash('zz-12')).toBe('12')
    expect(shortHash('abc', -1)).toBe('')
  })
})

describe('approval wording', () => {
  const decision = (d: 'confirm' | 'step_up') => ({ decision: { decision: d, tier: 2 as const, reasons: [], ruleIds: [], tainted: false } })

  it('asks for the PIN only on step-up', () => {
    expect(needsPin(decision('step_up'))).toBe(true)
    expect(needsPin(decision('confirm'))).toBe(false)
    expect(approveLabel(decision('step_up'))).toBe('Approve with PIN')
    expect(approveLabel(decision('confirm'))).toBe('Approve')
  })

  it('describes timing from the action’s own timestamps', () => {
    const t = (s: string) => `T(${s.slice(11, 16)})`
    expect(timingLine({ ...decision('confirm'), status: 'pending', expiresAt: '2026-10-22T10:10:00Z' }, t)).toBe('Runs only after you approve · offer ends T(10:10)')
    expect(timingLine({ ...decision('step_up'), status: 'pending', expiresAt: 'bad' }, t)).toBe('Runs only after your PIN')
    expect(timingLine({ ...decision('confirm'), status: 'executed', expiresAt: '', executedAt: '2026-10-22T10:02:00Z' }, t)).toBe('Ran at T(10:02)')
    expect(timingLine({ ...decision('confirm'), status: 'rejected', expiresAt: '' }, t)).toBe('Nothing ran')
  })
})

describe('clockTime / pinLockedFor', () => {
  it('formats HH:MM and ignores bad input', () => {
    expect(clockTime('2026-10-22T10:05:00')).toMatch(/^\d{2}:\d{2}$/)
    expect(clockTime('nope')).toBe('')
  })

  it('reports how long PIN entry stays locked', () => {
    expect(pinLockedFor(iso(120), NOW)).toBe(120)
    expect(pinLockedFor(undefined, NOW)).toBe(0)
    expect(pinLockedFor(iso(-1), NOW)).toBe(0)
  })
})

describe('planLevels', () => {
  it('uses the longest dependency chain for each step', () => {
    const levels = planLevels([step('s1'), step('s2', ['s1']), step('s3', ['s1']), step('s4', ['s2']), step('s5', ['s2', 's4'])])
    expect(Object.fromEntries(levels)).toEqual({ s1: 0, s2: 1, s3: 1, s4: 2, s5: 3 })
  })

  it('ignores unknown and self dependencies and survives cycles', () => {
    const levels = planLevels([step('a', ['ghost', 'a']), step('b', ['c']), step('c', ['b'])])
    expect(levels.get('a')).toBe(0)
    expect(levels.has('b')).toBe(true)
    expect(levels.has('c')).toBe(true)
  })
})

describe('planGraph', () => {
  it('numbers steps in dependency order and groups parallel stages', () => {
    const g = planGraph([step('s3', ['s1']), step('s1'), step('s2', ['s1']), step('s4', ['s2', 's3'])])
    expect(g.nodes.map((n) => `${n.n}:${n.step.id}@${n.level}.${n.row}`)).toEqual(['1:s1@0.0', '2:s3@1.0', '3:s2@1.1', '4:s4@2.0'])
    expect(g.stages.map((s) => s.map((n) => n.step.id))).toEqual([['s1'], ['s3', 's2'], ['s4']])
    expect(g.maxRows).toBe(2)
    expect(g.edges).toEqual([
      { from: 's1', to: 's3' },
      { from: 's1', to: 's2' },
      { from: 's2', to: 's4' },
      { from: 's3', to: 's4' },
    ])
  })

  it('handles an empty plan', () => {
    const g = planGraph([])
    expect(g.nodes).toEqual([])
    expect(g.stages).toEqual([])
    expect(g.maxRows).toBe(1)
  })
})

describe('planProgress / planIsLive / isReadStep', () => {
  it('counts done and waiting steps', () => {
    expect(planProgress([step('a'), step('b', [], 'needs_approval'), step('c', [], 'skipped')])).toEqual({ done: 1, total: 3, waiting: 1 })
  })

  it('knows which plans can still be stopped', () => {
    expect(planIsLive({ status: 'running' })).toBe(true)
    expect(planIsLive({ status: 'awaiting_user' })).toBe(true)
    expect(planIsLive({ status: 'cancelled' })).toBe(false)
    expect(planIsLive({ status: 'done' })).toBe(false)
  })

  it('tells read steps from action steps', () => {
    expect(isReadStep({ tool: 'analyze_bills' })).toBe(true)
    expect(isReadStep({ tool: 'transfer_to_goal' })).toBe(false)
  })
})

describe('evidence formatting', () => {
  it('humanises keys', () => {
    expect(humanizeKey('firstDate')).toBe('First date')
    expect(humanizeKey('safe_to_spend')).toBe('Safe to spend')
    expect(signalLabel('ai-addressed')).toBe('AI addressed')
  })

  it('formats money-ish integers, percentages, dates and plain values', () => {
    expect(formatEvidence('amount', 3000, 'CNY')).toBe('¥30')
    expect(formatEvidence('from', 2500, 'CNY')).toBe('¥25')
    expect(formatEvidence('pct', 57.25, 'CNY')).toBe('57.3%')
    expect(formatEvidence('daysApart', 0, 'CNY')).toBe('0')
    expect(formatEvidence('ratio', Number.NaN, 'CNY')).toBe('—')
    expect(formatEvidence('firstDate', '2026-10-03', 'CNY')).toBe('Oct 3')
    expect(formatEvidence('rule', 'series', 'CNY')).toBe('series')
  })

  it('drops plumbing keys and caps the chip count', () => {
    const chips = evidenceChips({ amount: 3000, rule: 'series', txnId: 'x', firstDate: '2026-10-03', a: 1, b: 2, c: 3, d: 4, e: 5 }, 'CNY', 3)
    expect(chips.map((c) => c.key)).toEqual(['amount', 'firstDate', 'a'])
    expect(evidenceChips(undefined, 'CNY')).toEqual([])
  })

  it('capitalises code-built labels', () => {
    expect(capitalize('sneakers')).toBe('Sneakers')
    expect(capitalize('')).toBe('')
  })
})
