import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage } from '../../../core/app'
import { defaultTripwires } from '../../../core/finance/tripwires'
import { isValidPinFormat } from '../../../core/security/pin'
import type { Autonomy, Profile, Tier } from '../../../core/types'
import { emptyDraft, type OnboardingDraft } from './draft'
import {
  buildOnboardingInput,
  clampStep,
  decodeCsvBytes,
  defaultThreshold,
  exampleOverspend,
  firstInvalidStep,
  flowPosition,
  groupAmount,
  incomeHint,
  laneFor,
  lanes,
  nextStep,
  niceStep,
  ordinal,
  parseCaps,
  parseMoney,
  pinProblem,
  prevStep,
  previewMirror,
  stepErrors,
  summarizeCsv,
  thresholdOf,
  thresholdRange,
  tripwireDetail,
  tripwireInputs,
  validateConsent,
  validateData,
  validateMoney,
} from './logic'

const FIXTURES = resolve(__dirname, '../../../core/sandbox/__fixtures__')
const wechat = readFileSync(resolve(FIXTURES, 'wechat-pay-2026-09.csv'), 'utf8')

/** A draft that passes every step (Mei-like numbers). */
function complete(patch: Partial<OnboardingDraft> = {}): OnboardingDraft {
  const d = emptyDraft()
  return {
    ...d,
    consent: { financialData: true, llmProcessing: false, notifications: true },
    name: 'Odri',
    income: '18,500',
    target: '9500',
    payday: 10,
    dreams: [
      { key: 'a', name: 'Birkin', price: 9_800_000, image: 'preset:bag', kind: 'goal' },
      { key: 'b', name: 'New running shoes', price: 89_900, image: 'preset:sneakers', kind: 'treat' },
    ],
    data: { kind: 'persona', personaId: 'mei', csvName: '', csvText: '', balance: '' },
    ...patch,
  }
}

const ctx = { pinSet: true, csv: null }

describe('step navigation', () => {
  it('walks the eight steps in order and clamps at the ends', () => {
    expect(nextStep('welcome')).toBe('consent')
    expect(nextStep('data')).toBe('done')
    expect(nextStep('done')).toBe('done')
    expect(prevStep('consent')).toBe('welcome')
    expect(prevStep('welcome')).toBe('welcome')
  })

  it('counts six progress steps, outside welcome and done', () => {
    expect(flowPosition('consent')).toBe(1)
    expect(flowPosition('data')).toBe(6)
    expect(flowPosition('welcome')).toBeNull()
    expect(flowPosition('done')).toBeNull()
  })

  it('never lets a deep link skip a step that still needs input', () => {
    const d = emptyDraft()
    expect(firstInvalidStep(d, ctx)).toBe('consent')
    expect(clampStep('done', d, ctx)).toBe('consent')
    expect(clampStep('welcome', d, ctx)).toBe('welcome')
    expect(clampStep('done', complete(), ctx)).toBe('done')
    // the PIN lives in memory only: after a reload the flow sends the user back to set it again
    expect(clampStep('done', complete(), { pinSet: false, csv: null })).toBe('permissions')
  })
})

describe('consent', () => {
  it('starts with nothing ticked and requires only financial-data consent', () => {
    const d = emptyDraft()
    expect(d.consent).toEqual({ financialData: false, llmProcessing: false, notifications: false })
    expect(validateConsent(d).financialData).toBeTruthy()
    expect(validateConsent({ ...d, consent: { ...d.consent, financialData: true } })).toEqual({})
  })
})

describe('money', () => {
  it('parses typed amounts in the chosen currency', () => {
    expect(parseMoney('18,500', 'CNY', { what: 'x', example: '1' })).toEqual({ ok: true, minor: 1_850_000 })
    expect(parseMoney('1.85万', 'CNY', { what: 'x', example: '1' })).toEqual({ ok: true, minor: 1_850_000 })
    expect(parseMoney('250000', 'JPY', { what: 'x', example: '1' })).toEqual({ ok: true, minor: 250_000 })
    expect(parseMoney('0', 'CNY', { what: 'x', example: '1', allowZero: true })).toEqual({ ok: true, minor: 0 })
  })

  it('explains bad amounts', () => {
    expect(parseMoney('', 'CNY', { what: 'your pay', example: '18,500' })).toEqual({ ok: false, error: 'Enter your pay, like 18,500' })
    expect(parseMoney('-3', 'CNY', { what: 'x', example: '1' }).ok).toBe(false)
    expect(parseMoney('0', 'CNY', { what: 'x', example: '1' }).ok).toBe(false)
    expect(parseMoney('abc', 'CNY', { what: 'x', example: '1' }).ok).toBe(false)
  })

  it('tidies amounts on blur and leaves junk alone', () => {
    expect(groupAmount('18500', 'CNY')).toBe('18,500')
    expect(groupAmount('1.9k', 'CNY')).toBe('1,900')
    expect(groupAmount('12.5', 'USD')).toBe('12.5')
    expect(groupAmount('nope', 'CNY')).toBe('nope')
    expect(groupAmount('-4', 'CNY')).toBe('-4')
    expect(groupAmount('', 'CNY')).toBe('')
  })

  it('gives the live hint from the brief: "That’s 51% of your income — leaves ¥9,000 to save."', () => {
    expect(incomeHint(1_850_000, 950_000, 'CNY')).toEqual({ tone: 'save', spendPct: 51, save: 900_000, text: 'That’s 51% of your income — leaves ¥9,000 to save.' })
  })

  it('flags tight, break-even and over-income targets', () => {
    expect(incomeHint(1_000_000, 950_000, 'CNY')?.tone).toBe('tight')
    expect(incomeHint(1_000_000, 1_000_000, 'CNY')?.text).toMatch(/nothing left/)
    expect(incomeHint(480_000, 500_000, 'CNY')).toMatchObject({ tone: 'over', save: -20_000, text: 'That’s ¥200 more than you earn — Bun will flag it every month.' })
    expect(incomeHint(0, 1, 'CNY')).toBeNull()
  })

  it('validates name, income, target and payday', () => {
    expect(validateMoney(complete())).toEqual({})
    const e = validateMoney({ ...emptyDraft(), payday: 31 })
    expect(Object.keys(e).sort()).toEqual(['income', 'name', 'payday', 'target'])
  })

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '28th'])
  })
})

describe('tripwires', () => {
  it('uses the same defaults as the core (80% · 100% · 10% of target · pace 110%)', () => {
    const core = defaultTripwires({ currency: 'CNY', targetSpend: 950_000 } as Profile)
    expect(core.map((t) => t.threshold)).toEqual([80, 100, 95_000, 110])
    expect(['month80', 'month100', 'single', 'pace'].map((k) => defaultThreshold(k as never, 950_000, 'CNY'))).toEqual([80, 100, 95_000, 110])
  })

  it('follows the target until the user edits a threshold', () => {
    const t = { key: 'single' as const, enabled: true, threshold: null }
    expect(thresholdOf(t, 360_000, 'CNY')).toBe(36_000)
    expect(thresholdOf({ ...t, threshold: 50_000 }, 360_000, 'CNY')).toBe(50_000)
  })

  it('picks sensible steps and ranges', () => {
    expect(niceStep(237)).toBe(200)
    expect(niceStep(0.9)).toBe(1)
    expect(niceStep(0)).toBe(1)
    expect(thresholdRange('month80', 950_000, 'CNY')).toEqual({ min: 10, max: 200, step: 5 })
    expect(thresholdRange('pace', 950_000, 'CNY').min).toBeGreaterThan(100)
    expect(thresholdRange('single', 950_000, 'CNY')).toEqual({ min: 100, max: 1_900_000, step: 20_000 })
  })

  it('describes each tripwire with the user’s own numbers', () => {
    expect(tripwireDetail('month80', 80, 950_000, 'CNY')).toBe('When the month passes ¥7,600 of your ¥9,500.')
    expect(tripwireDetail('month100', 100, 950_000, 'CNY')).toBe('The moment the month reaches ¥9,500.')
    expect(tripwireDetail('single', 95_000, 950_000, 'CNY', 'Birkin')).toBe('Any one purchase over ¥950, shown as a slice of your Birkin.')
    expect(tripwireDetail('pace', 110, 950_000, 'CNY')).toBe('When you’re on pace to end 10% over — about ¥10,450.')
  })

  it('sends every tripwire to the controller, switched-off ones disabled', () => {
    const d = complete()
    d.tripwires = d.tripwires.map((t) => (t.key === 'pace' ? { ...t, enabled: false } : t))
    expect(tripwireInputs(d)).toEqual([
      { kind: 'month_pct', threshold: 80, enabled: true },
      { kind: 'month_pct', threshold: 100, enabled: true },
      { kind: 'single_over', threshold: 95_000, enabled: true },
      { kind: 'pace_over', threshold: 110, enabled: false },
    ])
  })

  it('rejects out-of-range thresholds only on enabled tripwires', () => {
    const d = complete()
    d.tripwires = d.tripwires.map((t) => (t.key === 'month80' ? { ...t, threshold: 5000 } : t))
    expect(stepErrors('tripwires', d, ctx).month80).toBeTruthy()
    d.tripwires = d.tripwires.map((t) => (t.key === 'month80' ? { ...t, enabled: false } : t))
    expect(stepErrors('tripwires', d, ctx)).toEqual({})
  })
})

describe('tone preview — the real Dream Mirror engine', () => {
  it('a whole treat inside one month: cheeky says "You could’ve gotten…"', () => {
    const d = complete({ tone: 'cheeky', dreams: [{ key: 's', name: 'New sneakers', price: 89_900, image: 'preset:sneakers', kind: 'treat' }] })
    const p = previewMirror(d)
    expect(p.overspend).toBe(89_900)
    expect(p.headline).toBe("You could've gotten New sneakers.")
    expect(p.mood).toBe('burnt')
  })

  it('a big goal: a realistic month over, in slices, with the goal delay', () => {
    const cheeky = previewMirror(complete({ tone: 'cheeky' }))
    expect(cheeky.overspend).toBe(290_000)
    expect(cheeky.headline).toBe("You could've had 3% of your Birkin.")
    expect(cheeky.subline).toMatch(/Birkin just moved about \d+ weeks further away/)
    const gentle = previewMirror(complete({ tone: 'gentle' }))
    expect(gentle.headline).toBe("This month's extra ¥2,900 = 3% of your Birkin.")
    expect(gentle.mood).toBe('worried')
    expect(previewMirror(complete({ tone: 'numbers' })).headline).toBe('¥2,900 over target.')
  })

  it('works before any dream exists (an example trip)', () => {
    const p = previewMirror({ ...complete(), dreams: [] })
    expect(p.dream.name).toBe('Weekend trip')
    expect(p.headline).toContain('Weekend trip')
  })

  it('rounds example overspends to friendly numbers', () => {
    expect(exampleOverspend(9_800_000, 950_000, 'CNY')).toBe(290_000)
    expect(exampleOverspend(48_000, 360_000, 'CNY')).toBe(48_000)
    expect(exampleOverspend(10_000_000, 100, 'JPY')).toBeGreaterThan(0)
  })
})

describe('permissions', () => {
  const tiers: Tier[] = [0, 1, 2, 3]
  const table = (a: Autonomy) => tiers.map((t) => laneFor(t, a))

  it('mirrors the policy engine’s tier matrix', () => {
    expect(table('observe')).toEqual(['auto', 'off', 'off', 'off'])
    expect(table('suggest')).toEqual(['auto', 'tap', 'tap', 'pin'])
    expect(table('copilot')).toEqual(['auto', 'auto', 'tap', 'pin'])
    expect(table('autopilot')).toEqual(['auto', 'auto', 'auto', 'pin'])
  })

  it('groups abilities into lanes; paying always needs the PIN', () => {
    expect(lanes('autopilot').pin.map((a) => a.id)).toEqual(['pay', 'cancel', 'dispute'])
    expect(lanes('observe').off).toHaveLength(5)
  })

  it('parses caps and keeps them ordered', () => {
    expect(parseCaps(complete()).values).toEqual({ perAction: 50_000, daily: 100_000, monthly: 500_000 })
    const bad = parseCaps({ ...complete(), caps: { perAction: '2000', daily: '1000', monthly: '' } })
    expect(bad.errors.daily).toBeTruthy()
    expect(bad.errors.monthly).toBe('Enter an amount')
  })

  it('pinProblem agrees with security/pin for every 4-digit PIN', () => {
    for (let i = 0; i < 10_000; i++) {
      const pin = String(i).padStart(4, '0')
      expect(pinProblem(pin) === null).toBe(isValidPinFormat(pin))
    }
  })

  it('explains why a PIN is weak', () => {
    expect(pinProblem('1111')).toMatch(/repeated/)
    expect(pinProblem('1234')).toMatch(/straight runs/)
    expect(pinProblem('9876')).toMatch(/straight runs/)
    expect(pinProblem('123')).toMatch(/4 to 6/)
    expect(pinProblem('1234567')).toMatch(/4 to 6/)
    expect(pinProblem('12a4')).toMatch(/Digits only/)
    expect(pinProblem('258046')).toBeNull()
  })

  it('needs the PIN before moving on', () => {
    expect(stepErrors('permissions', complete(), { pinSet: false, csv: null }).pin).toBeTruthy()
    expect(stepErrors('permissions', complete(), ctx)).toEqual({})
  })
})

describe('data source', () => {
  it('summarises a WeChat Pay export on-device before importing', () => {
    const s = summarizeCsv(wechat, 'CNY')
    expect(s.format).toBe('wechat_pay')
    expect(s.count).toBeGreaterThan(0)
    expect(s.from).toMatch(/^Sep/)
  })

  it('reports unreadable files', () => {
    expect(summarizeCsv('', 'CNY')).toMatchObject({ count: 0, errors: ['The file is empty.'] })
    expect(summarizeCsv('hello,world\n1,2', 'CNY').count).toBe(0)
  })

  it('decodes UTF-8 (dropping the BOM) and falls back to GBK for Alipay-style files', () => {
    const utf8 = new TextEncoder().encode('﻿交易时间,金额')
    expect(decodeCsvBytes(utf8)).toBe('交易时间,金额')
    // "支付宝" in GBK
    expect(decodeCsvBytes(new Uint8Array([0xd6, 0xa7, 0xb8, 0xb6, 0xb1, 0xa6]))).toBe('支付宝')
  })

  it('validates each kind of source', () => {
    const base = complete()
    expect(validateData({ ...base, data: { ...base.data, kind: null } }, null).source).toBeTruthy()
    expect(validateData({ ...base, data: { ...base.data, kind: 'persona', personaId: null } }, null).persona).toBeTruthy()
    expect(validateData({ ...base, data: { ...base.data, kind: 'empty', balance: '' } }, null).balance).toBeTruthy()
    expect(validateData({ ...base, data: { ...base.data, kind: 'empty', balance: '0' } }, null)).toEqual({})
    expect(validateData({ ...base, data: { ...base.data, kind: 'csv', csvText: '', balance: '10' } }, null).csv).toBeTruthy()
  })
})

describe('buildOnboardingInput → the real controller', () => {
  it('lists what is missing per step when incomplete', () => {
    const r = buildOnboardingInput(emptyDraft(), null, null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(new Set(r.problems.map((p) => p.step))).toEqual(new Set(['consent', 'money', 'dreams', 'permissions', 'data']))
  })

  it('refuses without a PIN even when everything else is filled', () => {
    expect(buildOnboardingInput(complete(), null, null).ok).toBe(false)
  })

  it('onboards with a sandbox ledger', () => {
    const r = buildOnboardingInput(complete({ tone: 'cheeky', autonomy: 'copilot' }), '2580', null)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input).toMatchObject({ monthlyIncome: 1_850_000, targetSpend: 950_000, caps: { perActionCap: 50_000, dailyCap: 100_000, monthlyCap: 500_000 } })
    expect(r.input.dreams[0]).toEqual({ name: 'Birkin', price: 9_800_000, image: 'preset:bag', kind: 'goal' })
    const app = createTestApp({ storage: memoryStorage() })
    expect(app.completeOnboarding(r.input)).toEqual({ ok: true })
    const s = app.getSnapshot()
    expect(s.state.profile?.tone).toBe('cheeky')
    expect(s.state.mandate.autonomy).toBe('copilot')
    expect(s.state.mandate.pinHash).toBeTruthy()
    expect(JSON.stringify(s.state)).not.toContain('"2580"')
    expect(s.state.tripwires).toHaveLength(4)
    expect(s.derived.mirror?.status).toBe('over')
  })

  it('onboards from a CSV export and from an empty start', () => {
    const csvDraft = complete({ data: { kind: 'csv', personaId: null, csvName: 'wechat.csv', csvText: wechat, balance: '6,500' } })
    const csv = summarizeCsv(wechat, 'CNY')
    const r1 = buildOnboardingInput(csvDraft, '2580', csv)
    expect(r1.ok).toBe(true)
    if (r1.ok) {
      const app = createTestApp({ storage: memoryStorage() })
      expect(app.completeOnboarding(r1.input)).toEqual({ ok: true })
      expect(app.getSnapshot().state.bank.transactions.length).toBe(csv.count)
    }
    const r2 = buildOnboardingInput(complete({ data: { kind: 'empty', personaId: null, csvName: '', csvText: '', balance: '2k' } }), '2580', null)
    expect(r2.ok && r2.input.dataSource).toEqual({ kind: 'empty', startingBalance: 200_000 })
    if (r2.ok) expect(createTestApp({ storage: memoryStorage() }).completeOnboarding(r2.input)).toEqual({ ok: true })
  })

  it('keeps LLM consent off unless the user turned it on', () => {
    const r = buildOnboardingInput(complete(), '2580', null)
    expect(r.ok && r.input.consent).toEqual({ financialData: true, llmProcessing: false, notifications: true })
  })
})

describe('the name error says what to do (F58)', () => {
  it('does not just repeat the field label', () => {
    const d = { ...emptyDraft(), name: '  ' } as OnboardingDraft
    const e = validateMoney(d)
    expect(e.name).toBe('Add a first name (or nickname) so Bun can greet you')
    expect(e.name).not.toBe('What should Bun call you?')
  })
})
