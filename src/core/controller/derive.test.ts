import { afterEach, describe, expect, it, vi } from 'vitest'
import * as mirror from '../finance/mirror'
import { buildDemoState } from './demo'
import { capUsageOf, createDerived, financeFor } from './derive'
import { emptyState } from './state'

vi.mock('../finance/mirror', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../finance/mirror')>()
  return { ...mod, couldveCollection: vi.fn(mod.couldveCollection), mirrorHistory: vi.fn(mod.mirrorHistory) }
})

const NOW = '2026-10-22T02:00:00.000Z'
const RT = { llm: { checked: true, available: false }, busy: 0 }

afterEach(() => {
  vi.mocked(mirror.couldveCollection).mockClear()
  vi.mocked(mirror.mirrorHistory).mockClear()
  vi.restoreAllMocks()
})

describe('createDerived — couldve & mirrorHistory', () => {
  it('populates the 6-month mirror history and the could\'ve collection for the demo', () => {
    const state = buildDemoState('mei', NOW)
    const d = createDerived(state, RT)
    expect(d.mirrorHistory?.map((p) => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(d.mirrorHistory?.[5]).toMatchObject({ status: 'over', item: { itemId: 'dream_chengdu' } })
    const ctx = financeFor(state).ctx!
    expect(d.couldve).toEqual(mirror.couldveCollection(ctx, 6))
    expect(d.couldve!.totalOver).toBeGreaterThan(0)
    expect(d.couldve!.equivalents.length).toBeGreaterThan(0)
  })

  it('is memoised per committed state (computed once, shared across snapshots)', () => {
    const state = buildDemoState('arif', NOW)
    const a = createDerived(state, RT)
    const b = createDerived(state, { ...RT, busy: 1 })
    expect(a.couldve).toBe(a.couldve)
    expect(a.couldve).toBe(b.couldve)
    expect(a.mirrorHistory).toBe(b.mirrorHistory)
    expect(mirror.couldveCollection).toHaveBeenCalledTimes(1)
    expect(mirror.mirrorHistory).toHaveBeenCalledTimes(1)
  })

  it('a failing analysis yields undefined instead of breaking the snapshot', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(mirror.couldveCollection).mockImplementationOnce(() => { throw new Error('boom') })
    vi.mocked(mirror.mirrorHistory).mockImplementationOnce(() => { throw new Error('boom') })
    const d = createDerived(buildDemoState('mei', NOW), RT)
    expect(d.couldve).toBeUndefined()
    expect(d.mirrorHistory).toBeUndefined()
    expect(d.mirror?.status).toBe('over')
    expect(errors).toHaveBeenCalled()
  })

  it('is undefined before onboarding', () => {
    const d = createDerived(emptyState('2026-10-22'), RT)
    expect(d.couldve).toBeUndefined()
    expect(d.mirrorHistory).toBeUndefined()
  })
})

describe('createDerived — capUsage', () => {
  it('shows the mandate caps and zero usage for a fresh demo, memoised per snapshot', () => {
    const state = buildDemoState('mei', NOW)
    const d = createDerived(state, RT, () => NOW)
    expect(d.capUsage).toEqual({ today: 0, month: 0, dailyCap: 100_000, monthlyCap: 500_000, perActionCap: 50_000 })
    expect(d.capUsage).toBe(d.capUsage)
  })

  it('counts executed agent moves of the day; user moves and other days do not count', () => {
    const state = buildDemoState('mei', NOW)
    const p = (id: string, proposedBy: 'offline' | 'user', executedAt: string, amount: number) => ({
      id, call: { id: `c_${id}`, tool: 'transfer_to_goal', args: { goalId: 'dream_chengdu', amount }, proposedBy },
      decision: { decision: 'confirm', tier: 2, reasons: [], ruleIds: [], tainted: false },
      preview: { title: 't', summary: 's', amount, reversible: true, risk: 'low', effects: [] },
      createdAt: executedAt, expiresAt: executedAt, executedAt, status: 'executed', bindingHash: 'x',
    })
    const withMoves = { ...state, pending: [p('a', 'offline', NOW, 30_000), p('b', 'user', NOW, 20_000), p('c', 'offline', '2026-10-02T02:00:00.000Z', 10_000)] } as typeof state
    expect(capUsageOf(withMoves, NOW)).toMatchObject({ today: 30_000, month: 40_000 })
  })
})
