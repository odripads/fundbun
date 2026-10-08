import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../../core/app'
import { evaluatePolicy } from '../../../core/security/policy'
import type { Autonomy, BankState, Mandate, PendingAction, Profile, Tier, ToolCall, TripwireEvent } from '../../../core/types'
import {
  AUTONOMY_ORDER,
  CAP_KEYS,
  LICENCES,
  TIERS,
  TRIPWIRE_KINDS,
  TRIPWIRE_KIND_ORDER,
  capUsage,
  capsDraft,
  capsRaise,
  changedCaps,
  checkCapsDraft,
  checkProfileDraft,
  deleteConfirmed,
  gateChanges,
  isBudgetCategory,
  isRaise,
  mirrorPreview,
  newPinProblem,
  parseMoneyInput,
  parseThreshold,
  pinLockText,
  profileDraft,
  thresholdInput,
  tierGate,
  toInput,
  toneLine,
  toolGroups,
  toolToggleNeedsPin,
  tripwireFires,
  tripwireSentence,
} from './logic'

const loadedApp = () => {
  const app = createTestApp()
  app.loadDemo('mei')
  return app
}

describe('autonomy and the tier matrix', () => {
  it('orders levels and detects raises', () => {
    expect(AUTONOMY_ORDER).toEqual(['observe', 'suggest', 'copilot', 'autopilot'])
    expect(isRaise('copilot', 'autopilot')).toBe(true)
    expect(isRaise('copilot', 'suggest')).toBe(false)
    expect(isRaise('suggest', 'suggest')).toBe(false)
  })

  it('matches the policy engine for every tier × autonomy (unfrozen, untainted)', () => {
    const app = loadedApp()
    const s = app.getSnapshot().state
    const sample: Record<Tier, ToolCall> = {
      0: { id: 'c0', tool: 'get_overview', args: {}, proposedBy: 'offline' },
      1: { id: 'c1', tool: 'create_tripwire', args: { kind: 'single_over', threshold: 50000 }, proposedBy: 'offline' },
      2: { id: 'c2', tool: 'transfer_to_goal', args: { goalId: 'dream_birkin', amount: 1000 }, proposedBy: 'offline' },
      3: { id: 'c3', tool: 'pay_bill', args: { billId: 'bill_electricity_2026-09' }, proposedBy: 'offline' },
      4: { id: 'c4', tool: 'transfer_external', args: { to: '•••• 4821', amount: 1000 }, proposedBy: 'offline' },
    }
    const toGate = { allow: 'auto', confirm: 'tap', step_up: 'pin', deny: 'never' } as const
    for (const autonomy of AUTONOMY_ORDER) {
      const mandate: Mandate = { ...s.mandate, autonomy, frozen: false }
      for (const tier of TIERS) {
        const d = evaluatePolicy(sample[tier], {
          mandate,
          bank: s.bank,
          dreams: s.dreams,
          tainted: false,
          consentFinancial: true,
          now: '2026-10-22T10:00:00+08:00',
          recentAgentActions: [],
        })
        expect([tier, autonomy, toGate[d.decision]]).toEqual([tier, autonomy, tierGate(tier, autonomy)])
      }
    }
  })

  it('freezing blocks everything but reading; T4 is never allowed', () => {
    for (const a of AUTONOMY_ORDER) {
      expect(tierGate(0, a, true)).toBe('auto')
      expect(tierGate(1, a, true)).toBe('never')
      expect(tierGate(3, a, true)).toBe('never')
      expect(tierGate(4, a)).toBe('never')
    }
  })

  it('lists only the tiers that change between two levels', () => {
    expect(gateChanges('copilot', 'autopilot')).toEqual([{ tier: 2, from: 'tap', to: 'auto' }])
    expect(gateChanges('observe', 'suggest').map((c) => c.tier)).toEqual([1, 2, 3])
    expect(gateChanges('suggest', 'suggest')).toEqual([])
    // frozen: nothing actionable changes
    expect(gateChanges('suggest', 'autopilot', true)).toEqual([])
  })
})

describe('caps', () => {
  const caps = { perActionCap: 50000, dailyCap: 100000, monthlyCap: 500000 }

  it('detects raises and keeps only changed caps', () => {
    expect(capsRaise(caps, { dailyCap: 200000 })).toBe(true)
    expect(capsRaise(caps, { dailyCap: 50000, monthlyCap: 500000 })).toBe(false)
    expect(changedCaps(caps, { perActionCap: 50000, dailyCap: 80000 })).toEqual({ dailyCap: 80000 })
  })

  it('round-trips the editor draft and validates nesting', () => {
    const d = capsDraft(caps, 'CNY')
    expect(d).toEqual({ perActionCap: '500', dailyCap: '1000', monthlyCap: '5000' })
    expect(checkCapsDraft(d, 'CNY')).toEqual({ caps })
    const bad = checkCapsDraft({ perActionCap: '2000', dailyCap: '1000', monthlyCap: 'abc' }, 'CNY')
    expect('errors' in bad && bad.errors.perActionCap).toMatch(/daily/)
    expect('errors' in bad && bad.errors.monthlyCap).toBeTruthy()
    const nested = checkCapsDraft({ perActionCap: '100', dailyCap: '9000', monthlyCap: '5000' }, 'CNY')
    expect('errors' in nested && nested.errors.dailyCap).toMatch(/monthly/)
    expect(CAP_KEYS).toHaveLength(3)
  })

  it('counts only agent money moves that were approved or executed, today and this month', () => {
    const bank = { bills: [{ id: 'b1', amountDue: 48620 }] } as unknown as BankState
    const now = Date.parse('2026-10-22T12:00:00')
    const mk = (over: Partial<PendingAction> & { tool: string; amount?: number; proposedBy?: string; at: string }): PendingAction => ({
      id: Math.random().toString(36),
      call: { id: 'c', tool: over.tool, args: over.tool === 'pay_bill' ? { billId: 'b1' } : { amount: over.amount }, proposedBy: (over.proposedBy ?? 'offline') as ToolCall['proposedBy'] },
      decision: { decision: 'confirm', tier: 2, reasons: [], ruleIds: [], tainted: false },
      preview: { title: '', summary: '', reversible: true, risk: 'low', effects: [] },
      createdAt: over.at,
      expiresAt: over.at,
      status: over.status ?? 'executed',
      executedAt: over.at,
      bindingHash: 'x',
    })
    const pending = [
      mk({ tool: 'transfer_to_goal', amount: 30000, at: '2026-10-22T09:00:00' }),
      mk({ tool: 'pay_bill', at: '2026-10-22T10:00:00' }),
      mk({ tool: 'transfer_to_goal', amount: 10000, at: '2026-10-03T09:00:00' }),
      mk({ tool: 'transfer_to_goal', amount: 99999, at: '2026-10-22T09:00:00', status: 'rejected' }),
      mk({ tool: 'transfer_to_goal', amount: 99999, at: '2026-10-22T09:00:00', proposedBy: 'user' }),
      mk({ tool: 'create_tripwire', amount: 99999, at: '2026-10-22T09:00:00' }),
      mk({ tool: 'transfer_to_goal', amount: 5000, at: '2026-09-30T09:00:00' }),
    ]
    expect(capUsage(pending, bank, now)).toEqual({ today: 30000 + 48620, month: 30000 + 48620 + 10000 })
    expect(capUsage([], bank, now)).toEqual({ today: 0, month: 0 })
  })
})

describe('tools', () => {
  it('groups every tool by tier, T0 → T4', () => {
    const groups = toolGroups()
    expect(groups.map((g) => g.tier)).toEqual([0, 1, 2, 3, 4])
    expect(groups.every((g) => g.tools.every((t) => t.tier === g.tier))).toBe(true)
    expect(groups.flatMap((g) => g.tools)).toHaveLength(24)
    expect(groups[4].tools.map((t) => t.name)).toContain('change_mandate')
  })

  it('needs the PIN only to switch a money/payment tool back on', () => {
    expect(toolToggleNeedsPin('transfer_to_goal', true)).toBe(true)
    expect(toolToggleNeedsPin('pay_bill', true)).toBe(true)
    expect(toolToggleNeedsPin('pay_bill', false)).toBe(false)
    expect(toolToggleNeedsPin('create_tripwire', true)).toBe(false)
    expect(toolToggleNeedsPin('add_payee', true)).toBe(false)
  })
})

describe('money inputs', () => {
  it('formats minor units for editing and parses typed amounts', () => {
    expect(toInput(950000, 'CNY')).toBe('9500')
    expect(toInput(48620, 'CNY')).toBe('486.2')
    expect(parseMoneyInput('1,299', 'CNY')).toBe(129900)
    expect(parseMoneyInput('¥500', 'CNY')).toBe(50000)
    expect(parseMoneyInput('', 'CNY')).toBeNull()
    expect(parseMoneyInput('-5', 'CNY')).toBeNull()
    expect(parseMoneyInput('0', 'CNY')).toBeNull()
    expect(parseMoneyInput('abc', 'CNY')).toBeNull()
  })
})

describe('profile draft', () => {
  const profile = { name: 'Mei', currency: 'CNY', monthlyIncome: 1850000, targetSpend: 950000, payday: 10, tone: 'cheeky' } as Profile

  it('round-trips without a patch', () => {
    expect(checkProfileDraft(profileDraft(profile), profile)).toEqual({ patch: {}, errors: {} })
  })

  it('returns only changed fields', () => {
    const d = { ...profileDraft(profile), target: '9000', tone: 'gentle' as const, name: ' Mei Lin ' }
    expect(checkProfileDraft(d, profile).patch).toEqual({ name: 'Mei Lin', targetSpend: 900000, tone: 'gentle' })
  })

  it('flags bad fields', () => {
    const d = { ...profileDraft(profile), name: ' ', income: 'x', payday: '31' }
    const { errors, patch } = checkProfileDraft(d, profile)
    expect(Object.keys(errors).sort()).toEqual(['income', 'name', 'payday'])
    expect(patch).toEqual({})
    expect(checkProfileDraft({ ...profileDraft(profile), payday: '1.5' }, profile).errors.payday).toBeTruthy()
  })

  it('picks tone copy with a gentle fallback', () => {
    const copy = { gentle: 'g', cheeky: 'c', numbers: 'n' }
    expect(toneLine('cheeky', copy)).toBe('c')
    expect(toneLine(undefined, copy)).toBe('g')
  })

  it('previews the real mirror line for a tone and target', () => {
    const ctx = loadedApp().getSnapshot().derived.ctx
    const cheeky = mirrorPreview(ctx, 'cheeky')
    const numbers = mirrorPreview(ctx, 'numbers')
    expect(cheeky?.status).toBe('over')
    expect(cheeky?.headline).toContain('Chengdu')
    expect(numbers?.headline).not.toEqual(cheeky?.headline)
    expect(mirrorPreview(ctx, 'gentle', 5_000_000)?.status).toBe('under')
    expect(mirrorPreview(null, 'gentle')).toBeNull()
  })
})

describe('tripwires', () => {
  it('describes every kind and has defaults that parse', () => {
    for (const k of TRIPWIRE_KIND_ORDER) {
      const meta = TRIPWIRE_KINDS[k]
      expect(meta.kind).toBe(k)
      expect('value' in parseThreshold(k, String(meta.defaultValue), 'CNY')).toBe(true)
      expect(tripwireSentence(k, meta.unit === 'pct' ? 80 : 80000, 'delivery', 'CNY')).toMatch(/^Bun nudges you/)
    }
    expect(tripwireSentence('single_over', 80000, undefined, 'CNY')).toContain('¥800')
    expect(tripwireSentence('category_pct', 90, 'delivery', 'CNY')).toContain('Food delivery')
  })

  it('converts thresholds both ways', () => {
    expect(thresholdInput({ kind: 'month_pct', threshold: 80 }, 'CNY')).toBe('80')
    expect(thresholdInput({ kind: 'single_over', threshold: 80000 }, 'CNY')).toBe('800')
    expect(parseThreshold('month_pct', '85%', 'CNY')).toEqual({ value: 85 })
    expect(parseThreshold('single_over', '1,299', 'CNY')).toEqual({ value: 129900 })
    expect('error' in parseThreshold('month_pct', '0', 'CNY')).toBe(true)
    expect('error' in parseThreshold('pace_over', '12.5', 'CNY')).toBe(true)
    expect('error' in parseThreshold('daily_over', 'lots', 'CNY')).toBe(true)
  })

  it('counts firings and finds the latest', () => {
    const ev = (id: string, tw: string, at: string) => ({ id, tripwireId: tw, firedAt: at, title: '', message: '', seen: false }) as TripwireEvent
    const events = [ev('a', 't1', '2026-10-01T10:00:00Z'), ev('b', 't1', '2026-10-21T10:00:00Z'), ev('c', 't2', '2026-10-22T10:00:00Z')]
    expect(tripwireFires(events, 't1')).toEqual({ total: 2, last: events[1] })
    expect(tripwireFires(events, 'none')).toEqual({ total: 0, last: undefined })
  })

  it('only spending categories carry budgets', () => {
    expect(isBudgetCategory('delivery')).toBe(true)
    expect(isBudgetCategory('income')).toBe(false)
    expect(isBudgetCategory('savings')).toBe(false)
  })
})

describe('security & about', () => {
  it('requires the exact delete phrase (case-insensitive, trimmed)', () => {
    expect(deleteConfirmed('DELETE')).toBe(true)
    expect(deleteConfirmed(' delete ')).toBe(true)
    expect(deleteConfirmed('DELET')).toBe(false)
    expect(deleteConfirmed('')).toBe(false)
  })

  it('rejects weak or malformed new PINs', () => {
    expect(newPinProblem('2580')).toBeNull()
    expect(newPinProblem('482916')).toBeNull()
    expect(newPinProblem('123')).toMatch(/4 to 6/)
    expect(newPinProblem('12a4')).toMatch(/4 to 6/)
    expect(newPinProblem('1111')).toMatch(/guess/)
    expect(newPinProblem('1234')).toMatch(/guess/)
    expect(newPinProblem('9876')).toMatch(/guess/)
  })

  it('explains a PIN lockout only while it lasts', () => {
    const now = Date.parse('2026-10-22T10:00:00Z')
    expect(pinLockText('2026-10-22T10:04:10Z', now)).toBe('PIN locked for 5 more minutes after too many wrong tries')
    expect(pinLockText('2026-10-22T10:00:30Z', now)).toMatch(/1 more minute /)
    expect(pinLockText('2026-10-22T09:00:00Z', now)).toBeNull()
    expect(pinLockText(undefined, now)).toBeNull()
    expect(pinLockText('garbage', now)).toBeNull()
  })

  it('credits the shipped open-source components', () => {
    expect(LICENCES.length).toBeGreaterThan(4)
    expect(LICENCES.every((l) => l.name && l.licence)).toBe(true)
  })

  it('the controller agrees: raising autonomy needs the PIN, lowering does not', () => {
    const app = loadedApp()
    const level = (): Autonomy => app.getSnapshot().state.mandate.autonomy
    expect(app.setAutonomy('autopilot').ok).toBe(false)
    expect(level()).toBe('copilot')
    expect(app.setAutonomy('autopilot', '2580').ok).toBe(true)
    expect(app.setAutonomy('suggest').ok).toBe(true)
    expect(level()).toBe('suggest')
  })
})
