import type { CategoryId, Currency, ISODate, Minor, YearMonth } from '../types'

/**
 * On-device natural-language understanding for the offline "Bun Engine" (no LLM, no network).
 * Intent classification = TF-IDF over word + character-trigram features, cosine nearest-centroid
 * against a built-in set of example utterances per intent (English + a few Chinese/Indonesian phrasings),
 * combined with high-precision regex overrides. Slot extraction is rule-based.
 */
export type Intent =
  | 'greeting'
  | 'help'
  | 'thanks'
  | 'overview'
  | 'breakdown'
  | 'search'
  | 'subscriptions'
  | 'bills'
  | 'insights'
  | 'afford'
  | 'goals'
  | 'save_to_goal'
  | 'withdraw_goal'
  | 'set_budget'
  | 'budget_plan'
  | 'tripwire'
  | 'pay_bill'
  | 'cancel_sub'
  | 'dispute'
  | 'xray'
  | 'external_transfer'
  | 'add_payee'
  | 'invest'
  | 'credit'
  | 'change_permissions'
  /** asks for PIN / full card or ID numbers / to send data to a third party — always refused */
  | 'sensitive_request'
  | 'unknown'

export interface NluSlots {
  amount?: Minor
  percent?: number
  category?: CategoryId
  month?: YearMonth
  /** merchant / subscription name as matched against known merchants */
  merchant?: string
  goalId?: string
  billId?: string
  recurringId?: string
  /** free-text item label for affordability ("a Switch 2") */
  label?: string
  /** person named in a transfer request */
  person?: string
  /** for xray: the pasted bill text */
  text?: string
}

export interface NluContext {
  currency: Currency
  today: ISODate
  /** known goal items */
  goals: { id: string; name: string }[]
  /** known bills */
  bills: { id: string; name: string }[]
  /** known recurring series */
  recurring: { id: string; merchant: string }[]
  /** known merchant names (for search) */
  merchants: string[]
}

export interface NluResult {
  intent: Intent
  /** 0..1 */
  confidence: number
  slots: NluSlots
  alternatives: { intent: Intent; confidence: number }[]
}

export function understand(text: string, ctx: NluContext): NluResult {
  throw new Error('TODO understand ' + text + ctx.today)
}
