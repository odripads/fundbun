import { describe, expect, it } from 'vitest'
import { checkGrounding, extractNumbers } from './grounding'

/** A trimmed get_overview + get_goals tool result for persona Mei (minor units). */
const MEI_SOURCES = [
  {
    month: '2026-10',
    spent: 1_215_000,
    target: 950_000,
    projected: 1_712_000,
    delta: 345_000,
    savedToGoals: 220_000,
    mirror: { headline: "You could've gotten a Weekend in Chengdu.", goalDelayDays: 36, fraction: 0.38 },
    bill: { name: 'Electricity', amountDue: 48_620, dueDate: '2026-10-28', changePct: 57.3 },
  },
  { goals: [{ itemId: 'dream_birkin', saved: 2_340_000, price: 9_800_000, pct: 23.9 }] },
  'Tencent Video ¥30 charged twice on 2026-10-03',
]

const check = (reply: string, sources: unknown[] = MEI_SOURCES) => checkGrounding(reply, sources, 'CNY')

describe('checkGrounding — grounded replies pass', () => {
  it.each([
    ["You're ¥3,450 over your ¥9,500 target.", 2],
    ['That overspend is 3.4k — about 38% of a Chengdu weekend.', 2],
    ['That is 0.38 of the trip.', 1],
    ['You have spent ¥12,150 so far and are heading for ¥17,120.', 2],
    ['Your electricity bill is ¥486.20, 57% above normal, due Oct 28.', 2],
    ['Electricity: 486.20元，比平时高57.3%。', 2],
    ['Birkin pot: ¥23,400 of ¥98,000 (23.9%).', 3],
    ['Your Birkin moved 36 days further away.', 1],
    ['You stashed ¥2,200 into goals this month.', 1],
    ['That overspend is ¥3.45k or 0.345万.', 2],
    ['Tencent Video charged ¥30 twice.', 0],
  ])('%s', (reply, checked) => {
    const r = check(reply)
    expect(r).toEqual({ ok: true, checked, ungrounded: [] })
  })

  it('accepts rounding to whole units and to one decimal', () => {
    const r = checkGrounding('About ¥486 for power, and the Birkin is 24% there (23.9%).', MEI_SOURCES, 'CNY')
    expect(r.ok).toBe(true)
  })

  it('accepts numbers that only appear inside source strings', () => {
    expect(checkGrounding('Overspent by ¥3,450.', ['You are ¥3,450 over target'], 'CNY').ok).toBe(true)
  })

  it('accepts negative amounts written with a minus sign', () => {
    expect(check('Net change −¥3,450 this month.').ok).toBe(true)
  })
})

describe('checkGrounding — invented numbers fail', () => {
  it.each([
    ['You are ¥5,000 over target.', ['¥5,000']],
    ['Cut back ¥3,460 next month.', ['¥3,460']],
    ['That is 45% of the trip.', ['45%']],
    ['A 3.9k overspend.', ['3.9k']],
    ['The bill went up 75%, to ¥520.', ['75%', '¥520']],
    ['You spent 1.5万 on delivery.', ['1.5万']],
    ['You saved ¥2,200 but spent ¥8,888.', ['¥8,888']],
  ])('%s', (reply, ungrounded) => {
    const r = check(reply)
    expect(r.ok).toBe(false)
    expect(r.ungrounded).toEqual(ungrounded)
  })

  it('lists each invented number once', () => {
    expect(check('¥777 and again ¥777').ungrounded).toEqual(['¥777'])
  })

  it('fails everything when there are no sources', () => {
    expect(checkGrounding('You spent ¥3,450.', [], 'CNY')).toEqual({ ok: false, checked: 1, ungrounded: ['¥3,450'] })
  })
})

describe('checkGrounding — what is ignored', () => {
  it.each([
    'Your bill is due on 2026-10-28 at 23:00.',
    'Due 28 Oct 2026, or October 28th, or 10/28.',
    'Paid on 2026年10月28日 (10月3日 duplicate, 3号).',
    'You have 3 video subscriptions and ordered late 10 times.',
    'Day 22 of 31 this month.',
    'Since 2019 you have saved well.',
    'Your iPhone15 and Q4 plan, T3 tools, 5G data.',
    'A 30m walk instead of a taxi.',
    '',
  ])('%j has nothing to check', (reply) => {
    const r = check(reply)
    expect(r).toEqual({ ok: true, checked: 0, ungrounded: [] })
  })

  it('ignores zero amounts', () => {
    expect(check('¥0 left to spend.').checked).toBe(0)
  })
})

describe('checkGrounding — currency units', () => {
  it('reads JPY sources as whole units (no minor-unit division needed)', () => {
    expect(checkGrounding('¥3,450 over', [{ delta: 3450 }], 'JPY').ok).toBe(true)
  })

  it('never crashes on cyclic or deeply nested sources', () => {
    const a: Record<string, unknown> = { v: 345_000 }
    a.self = a
    let deep: unknown = { v: 1 }
    for (let i = 0; i < 1000; i++) deep = { deep }
    expect(checkGrounding('¥3,450', [a, deep], 'CNY').ok).toBe(true)
  })

  it('handles large source sets efficiently', () => {
    const txns = Array.from({ length: 20_000 }, (_, i) => ({ id: `t${i}`, amount: -(i * 37) }))
    const started = performance.now()
    expect(checkGrounding('A charge of ¥7,399.63', [txns], 'CNY').ok).toBe(true)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('extractNumbers', () => {
  it('parses symbols, separators, suffixes and units', () => {
    const tokens = extractNumbers('¥3,450 · 3.4k · 38% · 0.38 · 1.2万元 · 486.20元 · ¥1.5m · HK$200 · 25 percent')
    expect(tokens.map((t) => [t.raw, t.value])).toEqual([
      ['¥3,450', 3450],
      ['3.4k', 3400],
      ['38%', 38],
      ['0.38', 0.38],
      ['1.2万元', 12000],
      ['486.20元', 486.2],
      ['¥1.5m', 1_500_000],
      ['HK$200', 200],
      ['25 percent', 25],
    ])
    expect(tokens[0]).toMatchObject({ currency: true, grouped: true, unit: 1 })
    expect(tokens[1]).toMatchObject({ scaled: true, unit: 100 })
    expect(tokens[2]).toMatchObject({ percent: true })
    expect(tokens[3]).toMatchObject({ decimals: 2, unit: 0.01 })
  })

  it('skips numbers glued to letters and dates', () => {
    expect(extractNumbers('iPhone15 10am 2.5x 2026-10-28 Oct 3')).toEqual([])
  })
})
