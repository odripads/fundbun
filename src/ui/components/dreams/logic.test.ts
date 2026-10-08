import { describe, expect, it } from 'vitest'
import { ITEM_KEYS } from '../../assets/items'
import { DREAM_SUGGESTIONS, fitWithin, guessPreset, parsePrice, PRESET_LABELS, presetImage, priceText, validateDreamForm } from './logic'
import { photoFileProblem } from './photo'

describe('presets and suggestions', () => {
  it('labels every one of the 16 presets', () => {
    expect(Object.keys(PRESET_LABELS).sort()).toEqual([...ITEM_KEYS].sort())
    expect(ITEM_KEYS).toHaveLength(16)
  })

  it('offers the four starters with real presets, and never a price', () => {
    expect(DREAM_SUGGESTIONS.map((s) => s.name)).toEqual(['Birkin', 'New sneakers', 'Weekend trip', 'Laptop'])
    for (const s of DREAM_SUGGESTIONS) {
      expect(ITEM_KEYS).toContain(s.preset)
      expect(s).not.toHaveProperty('price')
    }
  })

  it('builds preset image strings', () => {
    expect(presetImage('plane')).toBe('preset:plane')
  })
})

describe('guessPreset', () => {
  it.each([
    ['Weekend in Chengdu', 'plane'],
    ['Flight home to Medan', 'plane'],
    ['AirPods Pro', 'earbuds'],
    ['Sony headphones', 'headphones'],
    ['MacBook Air', 'laptop'],
    ['iPhone 17', 'phone'],
    ['Concert ticket', 'ticket'],
    ['New running shoes', 'sneakers'],
    ['Birkin 25', 'bag'],
    ['Engagement ring', 'ring'],
    ['Nintendo Switch', 'console'],
    ['新手机', 'phone'],
    ['机票回家', 'plane'],
  ])('%s → %s', (name, key) => {
    expect(guessPreset(name)).toBe(key)
  })

  it('does not mistake headphones for a phone or a string for a ring', () => {
    expect(guessPreset('headphones')).toBe('headphones')
    expect(guessPreset('guitar strings')).toBe('guitar')
  })

  it('returns undefined for blanks and unknown names', () => {
    expect(guessPreset('')).toBeUndefined()
    expect(guessPreset('   ')).toBeUndefined()
    expect(guessPreset('Something lovely')).toBeUndefined()
  })
})

describe('parsePrice', () => {
  it('parses plain numbers, grouping and shorthand into minor units', () => {
    expect(parsePrice('2400', 'CNY')).toEqual({ ok: true, minor: 240_000 })
    expect(parsePrice('98,000', 'CNY')).toEqual({ ok: true, minor: 9_800_000 })
    expect(parsePrice('2.4k', 'CNY')).toEqual({ ok: true, minor: 240_000 })
    expect(parsePrice('1.2万', 'CNY')).toEqual({ ok: true, minor: 1_200_000 })
    expect(parsePrice('49.99', 'USD')).toEqual({ ok: true, minor: 4_999 })
  })

  it('respects currencies without minor units', () => {
    expect(parsePrice('15000', 'JPY')).toEqual({ ok: true, minor: 15_000 })
  })

  it('rejects empty, negative, zero, non-numeric and absurd prices', () => {
    expect(parsePrice('', 'CNY').ok).toBe(false)
    expect(parsePrice('-5', 'CNY')).toMatchObject({ ok: false, error: expect.stringContaining('negative') })
    expect(parsePrice('0', 'CNY').ok).toBe(false)
    expect(parsePrice('lots', 'CNY').ok).toBe(false)
    expect(parsePrice('1000000000', 'CNY').ok).toBe(false)
  })
})

describe('priceText', () => {
  it('round-trips minor units into an editable string', () => {
    expect(priceText(240_000, 'CNY')).toBe('2400')
    expect(priceText(4_999, 'USD')).toBe('49.99')
    expect(priceText(15_000, 'JPY')).toBe('15000')
    expect(priceText(undefined, 'CNY')).toBe('')
    expect(priceText(0, 'CNY')).toBe('')
  })
})

describe('validateDreamForm', () => {
  it('returns the controller DreamInput with a tidied name', () => {
    const r = validateDreamForm({ name: '  Weekend   in Chengdu ', price: '2,400', kind: 'goal', image: 'preset:plane' }, 'CNY')
    expect(r).toEqual({ ok: true, input: { name: 'Weekend in Chengdu', price: 240_000, kind: 'goal', image: 'preset:plane' } })
  })

  it('falls back to the gift picture when none is set', () => {
    const r = validateDreamForm({ name: 'Surprise', price: '10', kind: 'treat', image: '' }, 'CNY')
    expect(r.ok && r.input.image).toBe('preset:gift')
  })

  it('reports both missing fields at once', () => {
    const r = validateDreamForm({ name: ' ', price: '', kind: 'goal', image: 'preset:gift' }, 'CNY')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.name).toBeTruthy()
      expect(r.errors.price).toBeTruthy()
    }
  })

  it('caps the name at 80 characters', () => {
    const r = validateDreamForm({ name: 'x'.repeat(81), price: '1', kind: 'goal', image: '' }, 'CNY')
    expect(r.ok).toBe(false)
  })
})

describe('fitWithin (photo resize geometry)', () => {
  it('scales the long side down to the max, keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 512)).toEqual({ width: 512, height: 384 })
    expect(fitWithin(1080, 1920, 512)).toEqual({ width: 288, height: 512 })
  })

  it('never upscales small images', () => {
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 })
  })

  it('keeps at least one pixel and handles empty input', () => {
    expect(fitWithin(10_000, 1, 512)).toEqual({ width: 512, height: 1 })
    expect(fitWithin(0, 100, 512)).toEqual({ width: 0, height: 0 })
    expect(fitWithin(Number.NaN, 100, 512)).toEqual({ width: 0, height: 0 })
  })
})

describe('photoFileProblem', () => {
  it('accepts images and refuses other files or huge ones', () => {
    expect(photoFileProblem({ type: 'image/jpeg', size: 3_000_000 })).toBeNull()
    expect(photoFileProblem({ type: 'application/pdf', size: 1000 })).toMatch(/isn’t a photo/)
    expect(photoFileProblem({ type: 'image/png', size: 30 * 1024 * 1024 })).toMatch(/too large/)
  })
})
