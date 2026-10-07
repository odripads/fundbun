import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeBills, computeMirror, detectRecurring, evaluateTripwires, summarizeMonth, xrayBill } from '../finance'
import { scanForInjection } from '../security/injection'
import type { FinanceContext } from '../types'
import { SandboxBank } from './bank'
import { importCsv } from './csv'
import { loadPersona, type PersonaBundle } from './personas'

/**
 * End-to-end check of the demo story (CONTRACT §4) through the real finance and security modules:
 * if a change anywhere breaks what the judges will see, this file says so.
 */

const TODAY = '2026-10-22'
const NOW = '2026-10-22T10:00:00.000Z'

function ctxOf(b: PersonaBundle): FinanceContext {
  return { profile: b.profile, bank: b.bank, dreams: b.dreams, budget: b.budget, tripwires: b.tripwires }
}

describe('story — Mei is over target', () => {
  const mei = loadPersona('mei', TODAY)
  const ctx = ctxOf(mei)

  it('spends ¥12,000–12,400 by Oct 22 and the Mirror shows the Weekend in Chengdu, Birkin ~5 weeks later', () => {
    const summary = summarizeMonth(ctx)
    expect(summary.spent).toBeGreaterThanOrEqual(1_200_000)
    expect(summary.spent).toBeLessThanOrEqual(1_240_000)
    const mirror = computeMirror(ctx)
    expect(mirror.status).toBe('over')
    expect(mirror.item?.id).toBe('dream_chengdu')
    expect(mirror.headline).toContain('Weekend in Chengdu')
    expect(mirror.goalDelayDays).toBeGreaterThanOrEqual(28)
    expect(mirror.goalDelayDays).toBeLessThanOrEqual(42)
  })

  it('surfaces exactly the planted bill findings — no noise duplicates', () => {
    const findings = analyzeBills(ctx, detectRecurring(mei.bank.transactions, TODAY, []))
    const kinds = findings.map((f) => f.kind)
    for (const k of ['duplicate_charge', 'price_hike', 'bill_spike', 'subscription_overlap', 'due_soon'] as const) expect(kinds).toContain(k)
    const duplicates = findings.filter((f) => f.kind === 'duplicate_charge')
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].title).toContain('Tencent Video')
    expect(findings.find((f) => f.kind === 'price_hike')!.title).toContain('iQIYI')
    expect(findings.find((f) => f.kind === 'bill_spike')!.billId).toBe('bill_electricity_2026-09')
  })

  it('fires the delivery category tripwire', () => {
    const { events } = evaluateTripwires(ctx, { now: NOW })
    expect(events.some((e) => e.tripwireId === 'tw_delivery_100')).toBe(true)
  })

  it('flags the injection in the electricity bill and the refund memo, while X-ray still reads the real total', () => {
    const spike = mei.bank.bills.find((b) => b.id === 'bill_electricity_2026-09')!
    expect(scanForInjection(spike.rawText!).suspicious).toBe(true)
    expect(scanForInjection(mei.bank.transactions.find((t) => t.memo?.startsWith('[assistant]'))!.memo!).suspicious).toBe(true)
    const xray = xrayBill(spike.rawText!, ctx)
    expect(xray.total).toBe(48_620)
    expect(xray.dueDate).toBe('2026-10-28')
    expect(xray.injection.suspicious).toBe(true)
    for (const b of mei.bank.bills.filter((x) => x.id !== spike.id && x.status !== 'paid')) expect(scanForInjection(b.rawText!).suspicious, b.id).toBe(false)
  })

  it('categorises a live purchase with the real categoriser', () => {
    const bank = new SandboxBank(loadPersona('mei', TODAY).bank)
    expect(bank.simulatePurchase({ merchant: 'Heytea', amount: 2_300 }).category).toBe('coffee_tea')
  })
})

describe('story — Arif is under target', () => {
  const arif = loadPersona('arif', TODAY)
  const ctx = ctxOf(arif)

  it('spends ¥2,050–2,300 by Oct 22 and is on pace to finish ¥500–700 under', () => {
    const summary = summarizeMonth(ctx)
    expect(summary.spent).toBeGreaterThanOrEqual(205_000)
    expect(summary.spent).toBeLessThanOrEqual(230_000)
    const mirror = computeMirror(ctx)
    expect(mirror.status).toBe('under')
    expect(mirror.delta).toBeGreaterThanOrEqual(50_000)
    expect(mirror.delta).toBeLessThanOrEqual(75_000)
    expect(Math.round(mirror.goal!.pct)).toBe(46)
  })
})

describe('story — wallet imports with the real categoriser', () => {
  it('categorises the WeChat and Alipay fixtures without falling back to "other"', () => {
    for (const name of ['wechat-pay-2026-09.csv', 'alipay-2026-09.csv']) {
      const text = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
      const r = importCsv(text, { accountId: 'chk_main', currency: 'CNY' })
      expect(r.errors).toEqual([])
      expect(r.transactions.filter((t) => t.category === 'other')).toEqual([])
    }
  })
})
