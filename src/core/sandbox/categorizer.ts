import { CATEGORIES } from '../categories'
import { categorize, normalizeMerchant, type CategorizeResult } from '../finance/categorize'
import type { CategoryId, Minor } from '../types'

/** Same shape as finance/categorize.categorize — injectable so the sandbox can be tested in isolation. */
export type Categorizer = (
  merchant: string,
  description?: string,
  amount?: Minor,
  userRules?: Record<string, CategoryId>,
) => CategorizeResult

export type MerchantNormalizer = (raw: string) => string

export const defaultCategorizer: Categorizer = categorize
export const defaultNormalizer: MerchantNormalizer = normalizeMerchant

/** Categorise without ever throwing: an unusable categoriser result degrades to 'other' with zero confidence. */
export function safeCategorize(
  categorizer: Categorizer,
  merchant: string,
  description: string,
  amount: Minor,
  userRules: Record<string, CategoryId>,
): CategorizeResult {
  try {
    const r = categorizer(merchant, description, amount, userRules)
    if (r && Object.hasOwn(CATEGORIES, r.category)) return r
  } catch {
    // fall through: a categoriser bug must not block a payment or an import
  }
  return { category: 'other', source: 'rule', confidence: 0 }
}
