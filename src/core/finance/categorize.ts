import type { CategoryId, Minor } from '../types'

export interface CategorizeResult {
  category: CategoryId
  source: 'rule' | 'model' | 'user'
  /** 0..1 */
  confidence: number
}

/** "MEITUAN*美团外卖 SZ 0931" → "Meituan Delivery". Stable, deterministic, display-friendly. */
export function normalizeMerchant(raw: string): string {
  throw new Error('TODO normalizeMerchant ' + raw)
}

/**
 * Categorise a transaction. Order: user rules (exact normalised merchant) → merchant dictionary →
 * keyword rules → on-device multinomial naive Bayes over character/word tokens (trained on the built-in
 * labelled set) → 'other'. Positive amounts from employers → 'income'.
 */
export function categorize(
  merchant: string,
  description = '',
  amount: Minor = -1,
  userRules: Record<string, CategoryId> = {},
): CategorizeResult {
  throw new Error('TODO categorize ' + merchant + description + amount + Object.keys(userRules).length)
}
