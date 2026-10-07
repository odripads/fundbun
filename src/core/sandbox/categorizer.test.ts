import { describe, expect, it, vi } from 'vitest'
import { defaultCategorizer, defaultNormalizer, safeCategorize, type Categorizer } from './categorizer'
import { categorize, normalizeMerchant } from '../finance/categorize'

describe('safeCategorize', () => {
  it('passes everything through to the categoriser and returns its answer', () => {
    const c = vi.fn<Categorizer>(() => ({ category: 'delivery', source: 'model', confidence: 0.7 }))
    expect(safeCategorize(c, 'Meituan', 'desc', -100, { a: 'dining' })).toEqual({ category: 'delivery', source: 'model', confidence: 0.7 })
    expect(c).toHaveBeenCalledWith('Meituan', 'desc', -100, { a: 'dining' })
  })

  it('degrades to "other" with zero confidence when the categoriser throws or returns junk', () => {
    const fallback = { category: 'other', source: 'rule', confidence: 0 }
    expect(safeCategorize(() => { throw new Error('x') }, 'M', '', -1, {})).toEqual(fallback)
    expect(safeCategorize(() => ({ category: 'bitcoin' as never, source: 'rule', confidence: 1 }), 'M', '', -1, {})).toEqual(fallback)
    expect(safeCategorize(() => undefined as never, 'M', '', -1, {})).toEqual(fallback)
    expect(safeCategorize(() => ({ category: 'toString' as never, source: 'rule', confidence: 1 }), 'M', '', -1, {})).toEqual(fallback)
  })

  it('defaults to the finance module', () => {
    expect(defaultCategorizer).toBe(categorize)
    expect(defaultNormalizer).toBe(normalizeMerchant)
  })
})
