import { describe, expect, it } from 'vitest'
import { CATEGORY_IDS } from '../categories'
import type { CategoryId } from '../types'
import { categorize, MERCHANTS, merchantInfo, NB_TRAINING_SIZE, nbTokens, normalizeMerchant, predictCategory, subscriptionNiche } from './categorize'

describe('normalizeMerchant', () => {
  it.each([
    ['MEITUAN*美团外卖 SZ 0931', 'Meituan Delivery'],
    ['美团外卖', 'Meituan Delivery'],
    ['饿了么', 'Ele.me'],
    ['喜茶(海岸城店)', 'Heytea'],
    ['麦当劳（科技园店）', "McDonald's"],
    ['JD.COM 京东商城', 'JD'],
    ['APPLE.COM/BILL', 'Apple Services'],
    ['腾讯视频VIP', 'Tencent Video'],
    ['ＳＴＡＲＢＵＣＫＳ', 'Starbucks'],
    ['STEAMPOWERED', 'Steam'],
    ['12306', 'China Railway 12306'],
    ['深圳供电局', 'Shenzhen Power Supply'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeMerchant(raw)).toBe(expected)
  })

  it('cleans unknown merchants: branch suffix, processor prefix, trailing refs, legal suffix, shouting', () => {
    expect(normalizeMerchant('云膳过桥米线(传奇广场店)')).toBe('云膳过桥米线')
    expect(normalizeMerchant('SQ *COFFEE SHOP 1234')).toBe('Coffee Shop')
    expect(normalizeMerchant('深圳市某某科技有限公司')).toBe('深圳市某某科技')
    expect(normalizeMerchant('Blue Door Bakery Co., Ltd.')).toBe('Blue Door Bakery')
    expect(normalizeMerchant('  Corner   Store  ')).toBe('Corner Store')
  })

  it('prefers the most specific alias', () => {
    expect(normalizeMerchant('美团买菜')).toBe('Meituan Grocery')
    expect(normalizeMerchant('Apple Music')).toBe('Apple Music')
    expect(normalizeMerchant('Apple Store Shenzhen')).toBe('Apple Store')
  })

  it('matches Latin aliases on word boundaries only', () => {
    expect(normalizeMerchant('Steamed Bun House')).toBe('Steamed Bun House')
    expect(normalizeMerchant('Pineapple Bakery')).toBe('Pineapple Bakery')
  })

  it('keeps the counterparty name for generic concepts (rent, canteen, salary)', () => {
    expect(normalizeMerchant('房东 张先生')).toBe('房东 张先生')
    expect(normalizeMerchant('Campus canteen')).toBe('Campus canteen')
  })

  it('is idempotent', () => {
    for (const raw of ['MEITUAN*美团外卖 SZ 0931', 'SQ *COFFEE SHOP 1234', '云膳过桥米线(传奇广场店)', '深圳市某某科技有限公司', 'H&M', "Sam's Club", 'Disney+']) {
      const once = normalizeMerchant(raw)
      expect(normalizeMerchant(once)).toBe(once)
    }
    for (const e of MERCHANTS) expect(normalizeMerchant(e.name)).toBe(e.name)
  })

  it('never returns an empty string', () => {
    expect(normalizeMerchant('')).toBe('Unknown')
    expect(normalizeMerchant('   ')).toBe('Unknown')
    expect(normalizeMerchant('(分店)')).not.toBe('')
  })
})

describe('categorize — dictionary', () => {
  const cases: [string, CategoryId][] = [
    ['美团外卖', 'delivery'], ['饿了么', 'delivery'], ['喜茶', 'coffee_tea'], ['瑞幸咖啡', 'coffee_tea'], ['蜜雪冰城', 'coffee_tea'],
    ['霸王茶姬', 'coffee_tea'], ['Starbucks', 'coffee_tea'], ['滴滴出行', 'transport'], ['深圳通', 'transport'], ['淘宝', 'shopping'],
    ['天猫', 'shopping'], ['京东', 'shopping'], ['拼多多', 'shopping'], ['爱奇艺', 'subscriptions'], ['腾讯视频', 'subscriptions'],
    ['优酷', 'subscriptions'], ['哔哩哔哩', 'subscriptions'], ['QQ音乐', 'subscriptions'], ['网易云音乐', 'subscriptions'],
    ['iCloud', 'subscriptions'], ['中国移动', 'phone_internet'], ['中国联通', 'phone_internet'], ['中国电信', 'phone_internet'],
    ['深圳供电局', 'utilities'], ['深圳水务', 'utilities'], ['盒马鲜生', 'groceries'], ['山姆会员店', 'groceries'], ['沃尔玛', 'groceries'],
    ['Pure Fitness', 'health'], ['屈臣氏', 'personal_care'], ['Uniqlo', 'shopping'], ['海底捞', 'dining'], ['KFC', 'dining'],
    ["McDonald's", 'dining'], ['携程旅行', 'travel'], ['12306', 'travel'], ['Apple Store', 'shopping'], ['Steam', 'entertainment'],
    ['学校食堂', 'dining'], ['学生宿舍', 'housing'], ['房租 十月', 'housing'], ['Landlord Zhang', 'housing'],
  ]
  it.each(cases)('%s → %s', (merchant, cat) => {
    const r = categorize(merchant)
    expect(r.category).toBe(cat)
    expect(r.source).toBe('rule')
    expect(r.confidence).toBeGreaterThanOrEqual(0.9)
  })
})

describe('categorize — cascade', () => {
  it('user rules win over everything, keyed by normalised merchant', () => {
    const r = categorize('MEITUAN*美团外卖 SZ 0931', '', -5000, { 'Meituan Delivery': 'groceries' })
    expect(r).toEqual({ category: 'groceries', source: 'user', confidence: 1 })
    expect(categorize('Corner Store', '', -100, { 'Corner Store': 'gifts' }).category).toBe('gifts')
  })

  it('ignores inherited object keys in user rules', () => {
    for (const m of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(CATEGORY_IDS).toContain(categorize(m, '', -100, {}).category)
    }
  })

  it('falls back to keyword rules', () => {
    expect(categorize('老王牛肉面馆')).toMatchObject({ category: 'dining', source: 'rule' })
    expect(categorize('街角奶茶店')).toMatchObject({ category: 'coffee_tea', source: 'rule' })
    expect(categorize('Unknown Co', 'monthly rent')).toMatchObject({ category: 'housing', source: 'rule' })
  })

  it('uses the on-device model for merchants no rule knows', () => {
    const r = categorize('Burger Joint')
    expect(r.source).toBe('model')
    expect(r.category).toBe('dining')
    expect(r.confidence).toBeGreaterThan(0.45)
    expect(r.confidence).toBeLessThanOrEqual(0.95)
  })

  it("returns 'other' with low confidence for gibberish", () => {
    const r = categorize('qzxv 9931')
    expect(r.category).toBe('other')
    expect(r.confidence).toBeLessThan(0.5)
  })

  it('positive amounts: employer → income, merchant refund → its category, stranger → transfer', () => {
    expect(categorize('深圳某某科技有限公司', '代发工资', 1_850_000).category).toBe('income')
    expect(categorize('Acme Technology Ltd', '', 1_000_000).category).toBe('income')
    expect(categorize('CSC Scholarship stipend', '', 350_000).category).toBe('income')
    expect(categorize('Taobao', '退款', 8_900)).toMatchObject({ category: 'shopping', source: 'rule' })
    expect(categorize('李四', '', 50_000).category).toBe('transfer')
    expect(categorize('微信转账', '', 20_000).category).toBe('transfer')
  })

  it('never labels an outflow as income', () => {
    expect(categorize('工资', '', -100).category).not.toBe('income')
    expect(categorize('salary advance repayment', '', -100).category).not.toBe('income')
  })

  it('always returns a known category and a confidence in 0..1', () => {
    for (const m of ['', '?', '😀😀', 'a'.repeat(500), '123456', '美团', 'zzz']) {
      for (const amount of [-1, 0, 1]) {
        const r = categorize(m, '', amount)
        expect(CATEGORY_IDS).toContain(r.category)
        expect(r.confidence).toBeGreaterThanOrEqual(0)
        expect(r.confidence).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('naive Bayes', () => {
  it('is trained on at least 150 hand-labelled examples', () => {
    expect(NB_TRAINING_SIZE).toBeGreaterThanOrEqual(150)
  })

  it('tokenises into words, character trigrams and CJK uni/bigrams', () => {
    const toks = nbTokens('喜茶 Heytea')
    expect(toks).toContain('w:heytea')
    expect(toks).toContain('t:^喜茶')
    expect(toks).toContain('b:喜茶')
    expect(toks).toContain('u:茶')
  })

  it('generalises to merchants it has never seen (held-out accuracy >= 75%)', () => {
    const heldOut: [string, CategoryId][] = [
      ['张记麻辣香锅', 'dining'], ['老王饺子馆', 'dining'], ['Pho noodle bar', 'dining'], ['Korean BBQ house', 'dining'],
      ['Blue Bottle Coffee', 'coffee_tea'], ['柠季 柠檬茶', 'coffee_tea'], ['惠民超市', 'groceries'], ['fresh mart', 'groceries'],
      ['嘀嗒出行', 'transport'], ['city bus fare', 'transport'], ['Zara 海岸城', 'shopping'], ['口腔医院', 'health'],
      ['演唱会门票', 'entertainment'], ['亚朵酒店', 'travel'], ['春秋航空', 'travel'], ['优酷会员', 'subscriptions'],
      ['Notion subscription', 'subscriptions'], ['理发 洗剪吹', 'personal_care'], ['nail salon', 'personal_care'], ['外卖 宵夜', 'delivery'],
    ]
    const hits = heldOut.filter(([text, cat]) => predictCategory(text, (c) => c !== 'income').category === cat).length
    expect(hits / heldOut.length).toBeGreaterThanOrEqual(0.75)
  })

  it('respects the allowed-class filter and reports zero coverage for unseen text', () => {
    expect(predictCategory('工资 代发', (c) => c !== 'income').category).not.toBe('income')
    expect(predictCategory('qzxv')).toMatchObject({ category: 'other', confidence: 0, coverage: 0 })
  })
})

describe('merchant info', () => {
  it('knows subscription niches for overlap detection', () => {
    for (const m of ['爱奇艺', 'Tencent Video', '优酷', '芒果TV', 'Bilibili']) expect(subscriptionNiche(m)).toBe('video')
    for (const m of ['QQ音乐', 'NetEase Cloud Music', '酷狗音乐', 'Spotify', 'Apple Music']) expect(subscriptionNiche(m)).toBe('music')
    expect(subscriptionNiche('Starbucks')).toBeUndefined()
  })

  it('marks gyms as subscription-like', () => {
    expect(merchantInfo('Pure Fitness')?.subscription).toBe(true)
  })
})
