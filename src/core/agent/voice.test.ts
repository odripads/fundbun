import { describe, expect, it } from 'vitest'
import type { Tone } from '../types'
import { REFUSAL_INTENTS, understand, type Intent } from './nlu'
import { TRAINING } from './nlu-data'
import { MEI_CTX } from './nlu.fixtures'
import {
  ACTION_STAGES,
  FACT_KEYS,
  REFUSALS,
  TEMPLATES,
  composeReply,
  parseTemplate,
  refusal,
  suggestionsFor,
  templateKeys,
} from './voice'

const TONES: Tone[] = ['gentle', 'cheeky', 'numbers']
const INTENTS = Object.keys(TRAINING) as Intent[]

/** Realistic pre-formatted facts, as the runtime would build them from tool results. */
const SAMPLE: Record<string, string> = {
  name: 'Mei', headline: 'You could’ve gotten a Weekend in Chengdu.', status: 'over', month: 'October', spent: '¥12,180',
  target: '¥9,500', delta: '¥2,680', remaining: '¥0', projected: '¥15,200', safeToSpend: '¥120', itemName: 'a Weekend in Chengdu',
  goalName: 'Birkin 25', goalDelayDays: '35', total: '¥12,180', topCategory: 'Food delivery', topAmount: '¥2,140', topShare: '18%',
  category: 'Food delivery', categorySpent: '¥2,140', categoryLimit: '¥1,500', categoryPct: '143%', categoryPrev: '¥1,620',
  count: '4', itemEquivalent: '89% of a Weekend in Chengdu', query: 'Meituan', largest: '¥85 at Meituan on Oct 3',
  monthlyTotal: '¥545', annualTotal: '¥6,540', priceHike: 'iQIYI went from ¥25 to ¥30', overlap: 'you pay for 3 video apps',
  nextBill: 'China Mobile ¥128, due Oct 25', duplicate: 'Tencent Video charged you twice on Oct 3',
  spike: 'Electricity is 57% above its 3-month average', reminder: '3 days before Electricity is due',
  top: '10 late-night delivery orders came to ¥620', topWhy: 'Orders between 23:00 and 01:30 this month', second: 'Milk tea is up 40%',
  verdict: 'skip', label: 'a Switch 2', amount: '¥2,299', remainingAfter: '−¥4,979', overTargetBy: '¥4,979', hoursOfWork: '16',
  equivalent: '96% of a Weekend in Chengdu', saved: '¥23,400', price: '¥98,000', pct: '24%', eta: 'Aug 2029', monthlyRate: '¥2,200',
  others: 'AirPods Pro 40%, Weekend in Chengdu 75%', stage: 'confirm', newPct: '25%', reason: 'Daily limit reached',
  options: 'Birkin 25, Weekend in Chengdu', limit: '¥1,200', previousLimit: '¥1,500', lastMonth: '¥1,620', method: '50/30/20',
  needs: '¥4,750', wants: '¥2,850', savings: '¥1,900', rationale: 'Based on your ¥18,500 income', billName: 'Electricity',
  dueDate: 'Oct 28', payee: 'Shenzhen Power Supply', scheduledFor: 'Oct 27', merchant: 'iQIYI VIP', annualCost: '¥360',
  date: 'Oct 3', injection: 'yes', lineCount: '3', comparison: 'That’s 57% above your usual', warning: 'Due in 6 days',
}

function expectClean(text: string, context: string): void {
  expect(text.trim().length, context).toBeGreaterThan(0)
  expect(text, context).not.toMatch(/undefined|null|NaN|\[object/)
  expect(text, context).not.toMatch(/[{}[\]]/)
  expect(text, context).not.toMatch(/\s{2,}|\s[.,!?]/)
}

/** Every value a `when` clause can select, so each variant gets exercised. */
function variantFacts(intent: Intent): Record<string, string>[] {
  const sets: Record<string, string>[] = [{ ...SAMPLE }, {}]
  for (const status of ['over', 'pace_over', 'on_track', 'under', 'no_data']) sets.push({ ...SAMPLE, status })
  for (const verdict of ['go', 'think', 'skip']) sets.push({ ...SAMPLE, verdict, stage: '' }, { verdict })
  for (const stage of [...ACTION_STAGES, 'need_text']) sets.push({ ...SAMPLE, stage }, { stage })
  for (const injection of ['yes', 'no']) sets.push({ ...SAMPLE, injection })
  sets.push({ ...SAMPLE, count: '0' }, { count: '0' })
  for (const key of FACT_KEYS[intent]) {
    const without = { ...SAMPLE }
    delete without[key]
    sets.push(without, { [key]: SAMPLE[key] ?? 'x' })
  }
  return sets
}

describe('composeReply', () => {
  it('produces clean text for every intent × tone with full facts', () => {
    for (const intent of INTENTS) {
      for (const tone of TONES) expectClean(composeReply(intent, SAMPLE, tone), `${intent}/${tone}`)
    }
  })

  it('degrades gracefully with no facts at all', () => {
    for (const intent of INTENTS) for (const tone of TONES) expectClean(composeReply(intent, {}, tone), `${intent}/${tone}`)
  })

  it('stays clean for every variant selector and every single missing fact', () => {
    for (const intent of INTENTS) {
      for (const tone of TONES) {
        for (const facts of variantFacts(intent)) expectClean(composeReply(intent, facts, tone), `${intent}/${tone} ${JSON.stringify(facts).slice(0, 80)}`)
      }
    }
  })

  it('interpolates the facts it is given', () => {
    const text = composeReply('overview', { status: 'over', month: 'October', spent: '¥12,180', target: '¥9,500', delta: '¥2,680' }, 'gentle')
    expect(text).toContain('¥12,180')
    expect(text).toContain('¥9,500')
    expect(text).toContain('¥2,680 over')
  })

  it('picks the variant for the status, verdict and stage', () => {
    expect(composeReply('overview', { status: 'under', spent: '¥2,190', target: '¥3,600', delta: '¥620', goalName: 'MacBook Air' }, 'gentle')).toMatch(/under.*MacBook Air/)
    expect(composeReply('afford', { verdict: 'go', label: 'new headphones', amount: '¥399', remainingAfter: '¥1,021' }, 'gentle')).toMatch(/^New headphones at ¥399: that fits/)
    expect(composeReply('afford', { verdict: 'skip', label: 'a Switch 2', amount: '¥2,299', overTargetBy: '¥4,979' }, 'gentle')).toMatch(/hold off/)
    expect(composeReply('save_to_goal', { stage: 'done', amount: '¥620', goalName: 'MacBook Air' }, 'gentle')).toMatch(/^Done — ¥620 is now in MacBook Air/)
    expect(composeReply('save_to_goal', { amount: '¥620', goalName: 'MacBook Air' }, 'gentle')).toMatch(/^Ready to move ¥620 into MacBook Air/)
    expect(composeReply('save_to_goal', { stage: 'need_amount', goalName: 'MacBook Air' }, 'gentle')).toBe('How much would you like to move into MacBook Air?')
    expect(composeReply('search', { count: '0', query: 'Luckin' }, 'numbers')).toBe('0 transactions for Luckin.')
  })

  it('never claims an action is pending when it is done but facts are missing', () => {
    for (const intent of ['save_to_goal', 'withdraw_goal', 'pay_bill', 'cancel_sub', 'dispute', 'set_budget', 'budget_plan', 'tripwire'] as Intent[]) {
      for (const tone of TONES) expect(composeReply(intent, { stage: 'done' }, tone), `${intent}/${tone}`).toMatch(/^Done/)
    }
  })

  it('mentions the PIN on every money-moving T3 confirmation', () => {
    for (const intent of ['pay_bill', 'cancel_sub', 'dispute'] as Intent[]) {
      for (const tone of TONES) expect(composeReply(intent, { ...SAMPLE, stage: 'confirm' }, tone), `${intent}/${tone}`).toMatch(/PIN/)
    }
  })

  it('flags an injection attempt found while x-raying a bill', () => {
    for (const tone of TONES) expect(composeReply('xray', { injection: 'yes', total: '¥486.20' }, tone)).toMatch(/instructions/i)
  })

  it('keeps the history comparison in every tone, with or without an injection warning', () => {
    const facts = { merchant: 'Shenzhen Power Supply', total: '¥486.20', dueDate: 'Oct 28', comparison: '57% above your usual ¥310' }
    for (const tone of TONES) {
      for (const injection of [undefined, 'yes']) {
        const text = composeReply('xray', { ...facts, ...(injection ? { injection } : {}) }, tone)
        expect(text, `${tone}/${injection ?? 'clean'}`).toContain('57% above your usual ¥310')
        expect(text).not.toMatch(/\.\.|\{|\}/)
      }
    }
    // with nothing but the injection flag the cheeky reply doesn't leave dangling punctuation
    expect(composeReply('xray', { injection: 'yes' }, 'cheeky')).toMatch(/orders from you\.$/)
  })

  it('inserts fact values verbatim and never re-expands template syntax inside them', () => {
    const text = composeReply('goals', { goalName: '{amount} [x] {goalName}', saved: '¥1', price: '¥2', pct: '50%', amount: 'LEAK' }, 'numbers')
    expect(text).toContain('{amount} [x] {goalName}')
    expect(text).not.toContain('LEAK')
  })

  it('sanitises fact values: control characters, newlines and runaway length', () => {
    const text = composeReply('search', { count: '2', query: 'Mei\ntuan\u0000\u200B' + 'x'.repeat(500) }, 'numbers')
    expect(text).not.toMatch(/[\n\u0000\u200B]/)
    expect(text.length).toBeLessThan(260)
    expect(text).toContain('…')
  })

  it('ignores empty or whitespace-only facts', () => {
    expect(composeReply('goals', { goalName: '   ', saved: '¥1', price: '¥2', pct: '50%' }, 'gentle')).toBe('Here’s how your dreams are coming along.')
  })

  it('capitalises a fact that opens a sentence but leaves brand casing alone', () => {
    expect(composeReply('subscriptions', { count: '6', annualTotal: '¥6,540', priceHike: 'iQIYI went from ¥25 to ¥30', overlap: 'you pay for 3 video apps' }, 'cheeky'))
      .toBe('6 subscriptions, ¥6,540 a year. iQIYI went from ¥25 to ¥30 — sneaky. You pay for 3 video apps. Do all of them still spark joy?')
  })

  it('answers refusal intents with the refusal text', () => {
    for (const intent of REFUSAL_INTENTS) for (const tone of TONES) expect(composeReply(intent, SAMPLE, tone)).toBe(refusal(intent, tone).text)
  })

  it('keeps the copy kind: no shaming words and no push to buy', () => {
    const banned = /\b(?:stupid|idiot|dumb|lazy|pathetic|loser|broke|irresponsible|shame(?:ful)?|ashamed|failure|waste of|buy now|treat yourself|go for it|you deserve it)\b/i
    for (const intent of INTENTS) {
      for (const tone of TONES) {
        for (const facts of [SAMPLE, {}]) expect(composeReply(intent, facts, tone), `${intent}/${tone}`).not.toMatch(banned)
      }
    }
  })
})

describe('FACT_KEYS', () => {
  it('lists exactly the facts each intent’s templates read (placeholders and variant selectors)', () => {
    for (const intent of INTENTS) {
      const used = new Set<string>()
      for (const variants of Object.values(TEMPLATES[intent])) {
        for (const variant of variants ?? []) {
          templateKeys(variant.t).forEach((k) => used.add(k))
          Object.keys(variant.when ?? {}).forEach((k) => used.add(k))
        }
      }
      expect([...used].sort(), intent).toEqual([...FACT_KEYS[intent]].sort())
    }
  })

  it('covers every intent', () => {
    expect(Object.keys(FACT_KEYS).sort()).toEqual([...INTENTS].sort())
  })
})

describe('templates', () => {
  it('give every non-refusal intent a gentle template ending in a fact-free fallback', () => {
    for (const intent of INTENTS.filter((i) => !REFUSAL_INTENTS.includes(i))) {
      for (const tone of TONES) {
        const variants = TEMPLATES[intent][tone] ?? TEMPLATES[intent].gentle
        const last = variants[variants.length - 1]
        expect(last.when, `${intent}/${tone}`).toBeUndefined()
        const required = parseTemplate(last.t).filter((n) => n.kind === 'key')
        expect(required, `${intent}/${tone}: ${last.t}`).toEqual([])
      }
    }
  })

  it('do not nest optional groups', () => {
    for (const intent of INTENTS) {
      for (const variants of Object.values(TEMPLATES[intent])) {
        for (const variant of variants ?? []) expect(variant.t, variant.t).not.toMatch(/\[[^\]]*\[/)
      }
    }
  })

  it('parse placeholders inside and outside optional groups', () => {
    expect(templateKeys('Spent {spent}[ of {target}].')).toEqual(['spent', 'target'])
    expect(parseTemplate('a[b{c}]d')).toEqual([
      { kind: 'text', value: 'a' },
      { kind: 'optional', nodes: [{ kind: 'text', value: 'b' }, { kind: 'key', key: 'c' }] },
      { kind: 'text', value: 'd' },
    ])
  })
})

describe('refusal', () => {
  it('gives a titled, non-empty refusal for every refusal intent and tone', () => {
    for (const intent of REFUSAL_INTENTS) {
      for (const tone of TONES) {
        const r = refusal(intent, tone)
        expectClean(r.title, `${intent}/${tone} title`)
        expectClean(r.text, `${intent}/${tone} text`)
      }
    }
  })

  it('says what FundBun can do instead', () => {
    expect(refusal('external_transfer', 'gentle').text).toBe(
      'Sending money to other people is something only you can do, in your banking app. I can move money between your own pots, or pay a verified bill with your PIN.',
    )
    for (const tone of TONES) {
      expect(refusal('external_transfer', tone).text).toMatch(/own pots/)
      expect(refusal('add_payee', tone).text).toMatch(/verified/)
      expect(refusal('invest', tone).text).toMatch(/not a licensed adviser/)
      expect(refusal('invest', tone).text).toMatch(/personali[sz]ed investment advice/)
      expect(refusal('credit', tone).text).toMatch(/budget/)
      expect(refusal('change_permissions', tone).text).toMatch(/PIN/)
      expect(refusal('sensitive_request', tone).text).toMatch(/PIN/)
      expect(refusal('sensitive_request', tone).text).toMatch(/card/)
      expect(refusal('sensitive_request', tone).text).toMatch(/never send your data|sending data to third parties/)
    }
  })

  it('tells the user that tightening permissions needs no PIN', () => {
    for (const tone of TONES) expect(refusal('change_permissions', tone).text).toMatch(/no PIN/)
  })

  it('falls back to a generic refusal for other intents', () => {
    for (const tone of TONES) expectClean(refusal('greeting', tone).text, tone)
    expect(REFUSALS.greeting).toBeUndefined()
  })

  it('returns a copy callers can mutate safely', () => {
    const r = refusal('invest', 'gentle')
    r.text = 'changed'
    expect(refusal('invest', 'gentle').text).not.toBe('changed')
  })
})

describe('suggestionsFor', () => {
  it('offers 3–4 short, distinct chips for every intent', () => {
    for (const intent of INTENTS) {
      const chips = suggestionsFor(intent)
      expect(chips.length, intent).toBeGreaterThanOrEqual(3)
      expect(chips.length, intent).toBeLessThanOrEqual(4)
      expect(new Set(chips).size, intent).toBe(chips.length)
      for (const chip of chips) expect(chip.length, chip).toBeLessThanOrEqual(32)
    }
  })

  it('offers chips the offline engine understands as something it can do', () => {
    const chips = new Set(INTENTS.flatMap(suggestionsFor))
    for (const chip of chips) {
      const r = understand(chip, MEI_CTX)
      expect(r.intent, chip).not.toBe('unknown')
      expect(REFUSAL_INTENTS, chip).not.toContain(r.intent)
    }
  })

  it('never suggests spending or anything FundBun would refuse', () => {
    for (const chip of new Set(INTENTS.flatMap(suggestionsFor))) expect(chip).not.toMatch(/\b(?:buy|invest|loan|send money)\b/i)
  })

  it('returns a fresh array each time', () => {
    const chips = suggestionsFor('overview')
    chips.push('mutated')
    expect(suggestionsFor('overview')).not.toContain('mutated')
  })
})
