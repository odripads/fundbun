/** Pure helpers for the sandbox controls: demo presets, custom-purchase validation, result copy. */
import type { SandboxPurchase } from '../../../core/app-api'
import { CATEGORIES } from '../../../core/categories'
import { parseAmount } from '../../../core/money'
import type { CategoryId, Currency, Transaction, TripwireEvent } from '../../../core/types'

export interface SandboxPreset {
  id: string
  /** chip text, e.g. "Heytea" */
  label: string
  /** context on the chip ("01:10" = a late-night order) */
  note?: string
  /** `time` (HH:MM) is forwarded once the controller's SandboxPurchase accepts it (the bank already does) */
  purchase: SandboxPurchase & { time?: string }
  /** what it demonstrates (title attribute / screen readers) */
  demo: string
}

const yuan = (major: number) => Math.round(major * 100)

/** One tap each: everyday, late-night, a tripwire-crossing splurge, a mid-size buy and a ride. */
export const PRESETS: readonly SandboxPreset[] = [
  { id: 'heytea', label: 'Heytea', purchase: { merchant: 'Heytea', amount: yuan(28), category: 'coffee_tea' }, demo: 'An everyday milk tea' },
  { id: 'meituan', label: 'Meituan', note: '01:10', purchase: { merchant: 'Meituan', amount: yuan(68), category: 'delivery', time: '01:10' }, demo: 'A late-night delivery order' },
  { id: 'jd', label: 'JD headphones', purchase: { merchant: 'JD.com', amount: yuan(1299), category: 'shopping' }, demo: 'A big purchase that crosses the single-purchase tripwire' },
  { id: 'taobao', label: 'Taobao', purchase: { merchant: 'Taobao', amount: yuan(459), category: 'shopping' }, demo: 'A mid-size online order' },
  { id: 'didi', label: 'DiDi', purchase: { merchant: 'DiDi', amount: yuan(36), category: 'transport' }, demo: 'A taxi ride' },
]

/** Categories offered for a custom purchase (spending categories only). */
export const PURCHASE_CATEGORIES: CategoryId[] = (Object.keys(CATEGORIES) as CategoryId[]).filter((c) => {
  const k = CATEGORIES[c].kind
  return k === 'need' || k === 'want'
})

export type PurchaseCheck = { ok: true; purchase: SandboxPurchase } | { ok: false; errors: { merchant?: string; amount?: string } }

/** Validate the custom-purchase form. Merchant names are trimmed and capped (the bank cleans them again). */
export function checkPurchase(merchant: string, amount: string, category: CategoryId | '', currency: Currency): PurchaseCheck {
  const errors: { merchant?: string; amount?: string } = {}
  const name = merchant.trim().replace(/\s+/g, ' ')
  if (!name) errors.merchant = 'Who did you pay?'
  else if (name.length > 60) errors.merchant = 'Keep the name under 60 characters'
  const minor = amount.trim().startsWith('-') ? null : parseAmount(amount, currency)
  if (minor === null || minor <= 0) errors.amount = 'Enter an amount, like 128'
  else if (minor > 100_000_00) errors.amount = 'That’s more than the sandbox allows in one go'
  if (errors.merchant || errors.amount) return { ok: false, errors }
  const purchase: SandboxPurchase = { merchant: name, amount: minor as number }
  if (category) purchase.category = category
  return { ok: true, purchase }
}

export type SandboxResult =
  | { kind: 'purchase'; txn: Transaction; events: TripwireEvent[] }
  | { kind: 'advance'; days: number; from: string; to: string; txns: Transaction[]; events: TripwireEvent[] }
  | { kind: 'persona'; personaId: string }

/** Totals for an "advance the clock" result (spending only, money in shown separately). */
export function advanceTotals(txns: readonly Transaction[]): { out: number; in: number; count: number } {
  let out = 0
  let inn = 0
  for (const t of txns) {
    if (t.amount < 0) out += -t.amount
    else inn += t.amount
  }
  return { out, in: inn, count: txns.length }
}

export const PERSONAS: { id: 'mei' | 'arif'; label: string; blurb: string }[] = [
  { id: 'mei', label: 'Mei', blurb: 'Over target — the Dream Mirror story' },
  { id: 'arif', label: 'Arif', blurb: 'Under target — the stash-it story' },
]
