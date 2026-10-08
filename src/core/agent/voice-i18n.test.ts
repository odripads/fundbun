import { describe, expect, it } from 'vitest'
import { REFUSAL_INTENTS, understand, type Intent } from './nlu'
import { ARIF_CTX, MEI_CTX } from './nlu.fixtures'
import { CHIPS_I18N, I18N_TEMPLATES, LINES, REFUSALS_I18N, categoryName, dateName, dueInPhrase, joinList, monthName, topicOf } from './voice-i18n'
import { composeReply, line, refusal } from './voice'

const LOCAL = ['zh', 'id'] as const

const SAMPLE: Record<string, string> = {
  name: 'Mei', status: 'over', month: '2026年10月', spent: '¥12,080', target: '¥9,500', delta: '¥2,580', remaining: '¥1,000', projected: '¥15,230',
  safeToSpend: '¥120', goalName: 'Birkin 25', goalDelayDays: '35', total: '¥12,080', topCategory: '外卖', topAmount: '¥1,007', topShare: '8%',
  category: '外卖', categorySpent: '¥1,007', categoryLimit: '¥940', categoryPct: '107%', categoryPrev: '¥1,285', count: '6', nextBill: 'Rent (¥4,200)',
  verdict: 'skip', label: '手机', amount: '¥3,000', remainingAfter: '¥0', overTargetBy: '¥8,730', hoursOfWork: '16', saved: '¥23,300', price: '¥98,000',
  pct: '24%', eta: '2029年8月', others: 'AirPods Pro (0%)', stage: 'confirm', options: 'Birkin 25', merchant: 'iQIYI', annualCost: '¥360', billName: 'Electricity',
  dueDate: '10月28日', payee: 'Shenzhen Power Supply', account: 'Everyday account •••• 4821', checking: '¥50,189.17', pots: 'Birkin 25 ¥23,300',
}

function clean(text: string, context: string): void {
  expect(text.trim().length, context).toBeGreaterThan(0)
  expect(text, context).not.toMatch(/undefined|null|NaN|\[object|[{}[\]]/)
}

describe('localized templates', () => {
  it('render cleanly with full facts, no facts and every selector', () => {
    for (const lang of LOCAL) {
      for (const intent of Object.keys(I18N_TEMPLATES[lang]) as Intent[]) {
        for (const facts of [SAMPLE, {}, { ...SAMPLE, focus: 'balance' }, { ...SAMPLE, focus: 'safe_to_spend', overBy: '¥2,580', daysLeft: '9' }, { ...SAMPLE, verdict: 'go' }, { ...SAMPLE, stage: 'done' }, { count: '0' }]) {
          clean(composeReply(intent, facts, 'gentle', lang), `${lang}/${intent}`)
        }
      }
    }
  })

  it('answer Chinese in Chinese and Indonesian in Indonesian', () => {
    expect(composeReply('overview', SAMPLE, 'cheeky', 'zh')).toMatch(/目标/)
    expect(composeReply('overview', SAMPLE, 'cheeky', 'id')).toMatch(/target/)
    expect(composeReply('overview', { ...SAMPLE, focus: 'balance' }, 'gentle', 'zh')).toContain('¥50,189.17')
    expect(composeReply('afford', SAMPLE, 'gentle', 'zh')).toMatch(/^建议先缓一缓/)
  })

  it('fall back to English for intents without hand-written copy', () => {
    expect(composeReply('budget_plan', { stage: 'done', total: '¥9,500' }, 'gentle', 'zh')).toMatch(/budget/)
  })
})

describe('localized refusals and lines', () => {
  it('have a refusal for every refusal intent and the override reply', () => {
    for (const lang of LOCAL) {
      for (const intent of REFUSAL_INTENTS) {
        const r = refusal(intent, 'cheeky', { lang })
        clean(r.title, `${lang}/${intent}`)
        clean(r.text, `${lang}/${intent}`)
        expect(r).toEqual(REFUSALS_I18N[lang][intent])
      }
      expect(refusal('sensitive_request', 'gentle', { lang, override: true }).text).toBe(REFUSALS_I18N[lang].override.text)
    }
  })

  it('every engine line exists in all three languages and renders without placeholders', () => {
    for (const [key, set] of Object.entries(LINES)) {
      for (const lang of ['en', 'zh', 'id'] as const) {
        expect(set[lang], `${key}/${lang}`).toBeTruthy()
        const text = line(key, lang, { title: 'X', amount: '¥1', seconds: '30', a: 'A', b: 'B', bill: 'Water', due: '¥58', brand: 'Spotify', person: 'Li Wei', cap: '¥500', goal: 'Birkin 25', pct: '50%', merchant: 'M', date: '10月1日', to: 'Shopping', from: 'Other', spent: '¥1', category: 'C', pin: '' })
        clean(text, `${key}/${lang}`)
      }
    }
  })

  it('only "Nice try" a turn that looks like an attack', () => {
    expect(refusal('external_transfer', 'cheeky').text).not.toMatch(/Nice try/)
    expect(refusal('external_transfer', 'cheeky', { attack: true }).text).toMatch(/^Nice try — sending money/)
    expect(refusal('change_permissions', 'cheeky').title).not.toBe('Nice try')
  })
})

describe('localized chips', () => {
  it('are understood by the NLU as something FundBun can do', () => {
    for (const lang of LOCAL) {
      for (const chips of Object.values(CHIPS_I18N[lang])) {
        for (const chip of chips ?? []) {
          const r = understand(chip, lang === 'id' ? ARIF_CTX : MEI_CTX)
          expect(r.intent, `${lang}: ${chip}`).not.toBe('unknown')
          expect(REFUSAL_INTENTS, `${lang}: ${chip}`).not.toContain(r.intent)
        }
      }
    }
  })
})

describe('labels', () => {
  it('format months, dates, categories, lists and due phrases per language', () => {
    expect(monthName('2026-10', 'zh')).toBe('2026年10月')
    expect(monthName('2026-10', 'id')).toBe('Oktober 2026')
    expect(monthName('2026-10', 'id', true)).toBe('Okt')
    expect(dateName('2026-10-28', 'zh')).toBe('10月28日')
    expect(dateName('2026-10-28', 'id')).toBe('28 Okt')
    expect(categoryName('delivery', 'zh')).toBe('外卖')
    expect(joinList(['A', 'B', 'C'], 'zh')).toBe('A、B和C')
    expect(joinList(['A', 'B'], 'id')).toBe('A dan B')
    expect(dueInPhrase(3, 'en')).toBe('in 3 days')
    expect(dueInPhrase(-1, 'en')).toBe('1 day overdue')
    expect(dueInPhrase(0, 'zh')).toBe('今天到期')
    expect(topicOf("what's the weather", 'en')).toBe('the weather')
    expect(topicOf('讲个笑话', 'zh')).toBe('讲笑话')
  })
})
