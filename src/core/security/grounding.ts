import type { Currency, GroundingReport } from '../types'

/**
 * Numeric grounding check (anti-hallucination): every money amount / percentage / count in an assistant
 * reply must trace back to a number present in the tool results of that turn (after normalising minor →
 * major units, thousands separators, k/w suffixes, rounding to 0 or 1 decimals, and percent ↔ fraction).
 * Small integers <= 31 (dates/days), years 2000–2100 and numbers inside dates are ignored.
 */
export function checkGrounding(reply: string, sources: unknown[], currency: Currency): GroundingReport {
  throw new Error('TODO checkGrounding ' + reply.length + sources.length + currency)
}
