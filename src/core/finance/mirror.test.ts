import { describe, expect, it } from 'vitest'
import type { FinanceContext, MirrorState, Tone } from '../types'
import { ARIF_DREAMS, arifLike, daily, makeCtx, makeDream, MEI_DREAMS, meiLike, withTone, yuan } from './__fixtures__'
import { computeMirror, couldveCollection, mirrorHistory, mirrorStatus, pickMirrorItem } from './mirror'
import { summarizeMonth } from './summary'

const TONES: Tone[] = ['gentle', 'cheeky', 'numbers']
const SAFE_TOOLS = ['transfer_to_goal', 'create_tripwire', 'set_category_budget']
const birkin = MEI_DREAMS[0]

/** today 2026-10-10, ¥100/day since the 1st, no history → projected = 1000 + 21 × 100 = ¥3,100 */
function paced(target: number, dreams = MEI_DREAMS, tone: Tone = 'cheeky', today = '2026-10-10', perDay = 100): FinanceContext {
  return makeCtx({ today, txns: daily('2026-10-01', today, 'Canteen', 'dining', perDay), dreams, profile: { targetSpend: yuan(target), monthlyIncome: yuan(10_000), tone } })
}

function expectCleanCopy(m: MirrorState) {
  for (const text of [m.headline, m.subline]) {
    expect(text.length).toBeGreaterThan(5)
    expect(text).not.toMatch(/undefined|NaN|null|\[object/)
  }
}

describe('computeMirror — over', () => {
  it('whole item: "You could\'ve gotten a Weekend in Chengdu." with goal delay and hours of work', () => {
    const ctx = meiLike('cheeky')
    const s = summarizeMonth(ctx)
    const m = computeMirror(ctx)
    const delta = s.spent - s.target
    expect(m).toMatchObject({ status: 'over', month: '2026-10', spent: s.spent, target: yuan(9_500), delta, quantity: 1, tone: 'cheeky', mood: 'burnt' })
    expect(delta).toBeGreaterThan(yuan(2_400))
    expect(m.item?.id).toBe('dream_chengdu')
    expect(m.fraction).toBeUndefined()
    expect(m.headline).toBe("You could've gotten a Weekend in Chengdu.")
    expect(m.goal?.itemId).toBe('dream_birkin')
    expect(m.goalDelayDays).toBe(Math.round((delta / yuan(2_200)) * 30.4))
    expect(m.subline).toContain('over your ¥9,500 target')
    expect(m.subline).toContain('Birkin 25 just moved about 6 weeks further away')
    expect(m.hoursOfWork).toBeCloseTo(delta / (yuan(18_500) / 174), 0)
    expect(SAFE_TOOLS).toContain(m.cta?.tool)
  })

  it('fraction of the main goal when no dream item fits', () => {
    const ctx = paced(500, [birkin, makeDream('dream_watch', 'Watch', 3_000, 'treat')])
    const m = computeMirror(ctx)
    expect(m.status).toBe('over')
    expect(m.delta).toBe(yuan(500))
    expect(m.item?.id).toBe('dream_birkin')
    expect(m.quantity).toBeUndefined()
    expect(m.fraction).toBeCloseTo(500 / 98_000, 4)
    expect(m.headline).toBe("You could've had 0.5% of your Birkin 25.")
  })

  it('several of a cheaper item', () => {
    const m = computeMirror(paced(500, [birkin, makeDream('dream_tea', 'Milk tea treat', 200, 'treat')]))
    expect(m).toMatchObject({ quantity: 2 })
    expect(m.headline).toBe("You could've gotten 2× Milk tea treat.")
  })

  it('gentle and numbers tones: kind, factual, still tangible', () => {
    const gentle = computeMirror(meiLike('gentle'))
    expect(gentle.headline).toMatch(/^This month's extra ¥[\d,]+ = a Weekend in Chengdu\.$/)
    expect(gentle.subline).toContain('nudges your Birkin 25 back')
    expect(gentle.subline).not.toMatch(/could've|should|fail|bad|waste/i)
    expect(gentle.mood).toBe('worried')
    const numbers = computeMirror(meiLike('numbers'))
    expect(numbers.headline).toMatch(/^¥[\d,]+ over target\.$/)
    expect(numbers.subline).toContain('Equals a Weekend in Chengdu.')
    expect(numbers.subline).toMatch(/Birkin 25 delayed \d+ days\./)
  })

  it('suggests capping the biggest want category (never a purchase)', () => {
    const m = computeMirror(meiLike())
    expect(m.cta).toEqual({ tool: 'set_category_budget', args: { category: 'delivery', limit: expect.any(Number) }, label: expect.stringMatching(/^Cap Food delivery at ¥/) })
    expect((m.cta!.args.limit as number) % 1000).toBe(0)
  })

  it('suggests a tripwire instead when that category already has a budget', () => {
    const ctx = meiLike()
    ctx.budget = { month: '2026-10', total: yuan(800), categories: [{ category: 'delivery', limit: yuan(800) }], method: 'custom', createdBy: 'user', createdAt: '2026-10-01T00:00:00Z' }
    expect(computeMirror(ctx).cta).toMatchObject({ tool: 'create_tripwire', args: { kind: 'category_pct', threshold: 80, category: 'delivery' } })
  })
})

describe('computeMirror — pace_over', () => {
  it('"Careful — at this pace you\'ll trade away …" with projected delta', () => {
    const ctx = paced(2_500, [birkin, ARIF_DREAMS[2]])
    const m = computeMirror(ctx)
    expect(m).toMatchObject({ status: 'pace_over', spent: yuan(1_000), projected: yuan(3_100), delta: yuan(600), quantity: 1, mood: 'worried' })
    expect(m.item?.id).toBe('dream_concert')
    expect(m.headline).toBe("Careful — at this pace you'll trade away a Concert ticket.")
    expect(m.subline).toContain('¥3,100')
    expect(m.goalDelayDays).toBe(Math.round((600 / 1_000) * 30.4)) // fallback rate: 10% of ¥10,000 income
    expect(SAFE_TOOLS).toContain(m.cta?.tool)
  })

  it('stays quiet before day 5 (early projections are noise)', () => {
    const m = computeMirror(paced(3_100, MEI_DREAMS, 'cheeky', '2026-10-03', 500))
    expect(summarizeMonth(paced(3_100, MEI_DREAMS, 'cheeky', '2026-10-03', 500)).projected).toBeGreaterThan(yuan(3_300))
    expect(m.status).toBe('on_track')
  })
})

describe('computeMirror — under', () => {
  it('leads with goal progress and offers the treat as the user\'s choice', () => {
    const ctx = arifLike('gentle')
    const s = summarizeMonth(ctx)
    const m = computeMirror(ctx)
    const delta = s.target - s.projected
    expect(m).toMatchObject({ status: 'under', delta, quantity: 1, mood: 'happy', tone: 'gentle' })
    expect(delta).toBeGreaterThanOrEqual(yuan(500))
    expect(delta).toBeLessThanOrEqual(yuan(700))
    expect(m.item?.id).toBe('dream_concert')
    expect(m.goal).toMatchObject({ itemId: 'dream_macbook', pct: 46 })
    expect(m.headline).toMatch(/^¥6\d\d closer to your MacBook Air \(46% there\)\.$/)
    expect(m.subline).toContain('a Concert ticket, guilt-free')
    expect(m.subline).toContain('Your call.')
    expect(m.goalDelayDays).toBeUndefined()
  })

  it('primary CTA stashes half of a projected surplus in the goal — never a purchase', () => {
    const ctx = arifLike()
    const m = computeMirror(ctx)
    const half = Math.floor(m.delta / 2 / 1000) * 1000
    expect(m.cta).toEqual({ tool: 'transfer_to_goal', args: { goalId: 'dream_macbook', amount: half }, label: `Stash ¥${half / 100} in MacBook Air` })
  })

  it('cheeky and numbers variants', () => {
    const cheeky = computeMirror(arifLike('cheeky'))
    expect(cheeky.headline).toMatch(/^¥6\d\d under target — your MacBook Air is blushing\.$/)
    expect(cheeky.subline).toContain('Concert ticket, guilt-free — your call')
    const numbers = computeMirror(arifLike('numbers'))
    expect(numbers.headline).toMatch(/^¥6\d\d under target\.$/)
    expect(numbers.subline).toMatch(/MacBook Air: 46% saved, \d\d% if stashed\. Alternative: Concert ticket \(¥480\)\./)
  })

  it('with only treats on the wishlist: "that\'s a Concert ticket, guilt-free!" and no CTA', () => {
    const ctx = arifLike()
    ctx.dreams = ARIF_DREAMS.filter((d) => d.kind === 'treat')
    const m = computeMirror(ctx)
    expect(m.headline).toMatch(/^You're ¥6\d\d under target — that's a Concert ticket, guilt-free!$/)
    expect(m.cta).toBeUndefined()
  })

  it('a finished month under target stashes the whole surplus', () => {
    const ctx = arifLike()
    const s = summarizeMonth(ctx, '2026-09')
    const m = computeMirror(ctx, '2026-09')
    expect(m).toMatchObject({ status: 'under', delta: s.target - s.spent, projected: s.spent })
    expect(m.subline).toContain('You finished')
    expect(m.cta?.args.amount).toBe(Math.floor(m.delta / 1000) * 1000)
  })
})

describe('computeMirror — on_track and no_data', () => {
  it('on track within ±5% of target', () => {
    const m = computeMirror(paced(3_100, MEI_DREAMS, 'gentle'))
    expect(m).toMatchObject({ status: 'on_track', mood: 'calm', headline: 'Right on track.' })
    expect(m.item?.id).toBe('dream_birkin')
    expect(m.cta).toBeUndefined()
    expect(m.hoursOfWork).toBeUndefined()
    expect(m.subline).toContain('Safe to spend today')
  })

  it('no spending yet', () => {
    const ctx = makeCtx({ today: '2026-10-22', dreams: MEI_DREAMS })
    for (const tone of TONES) {
      const m = computeMirror(withTone(ctx, tone))
      expect(m).toMatchObject({ status: 'no_data', delta: 0, mood: 'sleepy', spent: 0 })
      expect(m.cta).toBeUndefined()
      expectCleanCopy(m)
    }
  })

  it('works with no dreams at all', () => {
    for (const ctx of [meiLike(), arifLike(), paced(2_500, [])]) {
      ctx.dreams = []
      const m = computeMirror(ctx)
      expect(m.item).toBeUndefined()
      expect(m.goal).toBeUndefined()
      expectCleanCopy(m)
    }
  })
})

describe('computeMirror — copy & safety properties', () => {
  const contexts = (tone: Tone) => [meiLike(tone), arifLike(tone), paced(2_500, MEI_DREAMS, tone), paced(3_100, MEI_DREAMS, tone), paced(500, MEI_DREAMS, tone)]

  it('every status × tone produces clean copy with money.fmt numbers', () => {
    const seen = new Set<string>()
    for (const tone of TONES) {
      for (const ctx of contexts(tone)) {
        const m = computeMirror(ctx)
        seen.add(m.status)
        expectCleanCopy(m)
        expect(`${m.headline} ${m.subline}`).not.toMatch(/\d{4,}(?![\d,])/) // big numbers always carry thousands separators
        if (m.cta) expect(SAFE_TOOLS).toContain(m.cta.tool)
      }
    }
    expect([...seen].sort()).toEqual(['on_track', 'over', 'pace_over', 'under'])
  })

  it('tones produce different copy for the same month', () => {
    const heads = TONES.map((t) => computeMirror(meiLike(t)).headline)
    expect(new Set(heads).size).toBe(3)
  })

  it('mirrorStatus thresholds', () => {
    const s = summarizeMonth(paced(3_100))
    expect(mirrorStatus({ ...s, projected: Math.round(s.target * 1.05) })).toBe('on_track')
    expect(mirrorStatus({ ...s, projected: Math.round(s.target * 1.05) + 1 })).toBe('pace_over')
    expect(mirrorStatus({ ...s, projected: Math.round(s.target * 0.95) - 1 })).toBe('under')
    expect(mirrorStatus({ ...s, spent: s.target + 1 })).toBe('over')
    expect(mirrorStatus({ ...s, spent: 0 })).toBe('no_data')
    expect(mirrorStatus({ ...s, isCurrent: false, spent: s.target })).toBe('on_track')
  })

  it('pickMirrorItem picks the most expensive item fully covered', () => {
    expect(pickMirrorItem(yuan(2_000), MEI_DREAMS)).toMatchObject({ item: { id: 'dream_airpods' }, quantity: 1 })
    expect(pickMirrorItem(yuan(5_000), MEI_DREAMS)).toMatchObject({ item: { id: 'dream_chengdu' }, quantity: 2 })
    expect(pickMirrorItem(yuan(100), MEI_DREAMS)).toMatchObject({ item: { id: 'dream_birkin' }, fraction: 0.001 })
  })
})

describe('mirrorHistory & couldveCollection', () => {
  it('mirrors each month, oldest first, with the dream item as an equivalent', () => {
    const h = mirrorHistory(meiLike(), 4)
    expect(h.map((p) => p.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
    const oct = h[3]
    expect(oct.status).toBe('over')
    expect(oct.item).toMatchObject({ itemId: 'dream_chengdu', label: 'a Weekend in Chengdu' })
    for (const p of h.slice(0, 3)) expect(['under', 'on_track', 'over']).toContain(p.status)
    expect(mirrorHistory(meiLike(), 0)).toEqual([])
  })

  it("adds up the realised overspend into a \"could've\" collection", () => {
    const ctx = meiLike()
    const h = mirrorHistory(ctx, 4)
    const c = couldveCollection(ctx, 4)
    expect(c.totalOver).toBe(h.filter((p) => p.status === 'over').reduce((s, p) => s + p.delta, 0))
    expect(c.totalUnder).toBe(h.filter((p) => p.status === 'under' && p.month !== '2026-10').reduce((s, p) => s + p.delta, 0))
    expect(c.equivalents[0]).toMatchObject({ itemId: 'dream_chengdu' })
  })

  it("doesn't count a projected surplus that hasn't happened yet", () => {
    const ctx = arifLike()
    const c = couldveCollection(ctx, 1)
    expect(c).toEqual({ totalOver: 0, totalUnder: 0, equivalents: [] })
    expect(couldveCollection(ctx, 2).totalUnder).toBe(summarizeMonth(ctx, '2026-09').target - summarizeMonth(ctx, '2026-09').spent)
  })
})

describe('computeMirror — finished months and empty wishlists', () => {
  it('speaks in the past tense about a finished month', () => {
    const ctx = paced(500, MEI_DREAMS, 'gentle', '2026-10-31')
    const next = { ...ctx, bank: { ...ctx.bank, today: '2026-11-02' } }
    const m = computeMirror(next, '2026-10')
    expect(m.status).toBe('over')
    expect(m.headline).toMatch(/^October's extra ¥[\d,]+ = /)
    expect(m.subline).toMatch(/^You went ¥[\d,]+ over your ¥500 target/)
    expect(m.subline).toContain('A new month is a fresh start.')
  })

  it('no dreams: plain, still kind, no dangling phrases', () => {
    const over = paced(500, [], 'cheeky')
    expect(computeMirror(over).headline).toBe('¥500 past your target.')
    expect(computeMirror(withTone(over, 'gentle')).headline).toBe("This month's extra ¥500 went past your target.")
    expect(computeMirror(paced(2_500, [], 'cheeky')).headline).toBe('Careful — this pace overshoots by ¥600.')
  })
})
