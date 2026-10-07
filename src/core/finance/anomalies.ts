import type { CategoryId, ISODate, Minor, Transaction } from '../types'

export interface Anomaly {
  txnId: string
  /** robust z-score */
  score: number
  reason: string
  category: CategoryId
  amount: Minor
  /** median amount for this category */
  typical: Minor
}

/**
 * Robust outlier detection per category over the last 120 days: modified z = 0.6745 × (x − median) / MAD;
 * flag |z| > 3.5 with at least 6 samples in the category; ignore housing/insurance/savings/transfers.
 */
export function detectAnomalies(txns: Transaction[], today: ISODate): Anomaly[] {
  throw new Error('TODO detectAnomalies ' + txns.length + today)
}
