import type { CategoryId, CategoryKind, CategoryMeta } from './types'

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  housing:        { id: 'housing',        label: 'Rent & housing',    kind: 'need',     emoji: '🏠', color: '#8C6A4F' },
  utilities:      { id: 'utilities',      label: 'Utilities',         kind: 'need',     emoji: '💡', color: '#C9A227' },
  phone_internet: { id: 'phone_internet', label: 'Phone & internet',  kind: 'need',     emoji: '📶', color: '#5E8C9A' },
  groceries:      { id: 'groceries',      label: 'Groceries',         kind: 'need',     emoji: '🥬', color: '#4F9A6B' },
  dining:         { id: 'dining',         label: 'Eating out',        kind: 'want',     emoji: '🍜', color: '#D9472B' },
  delivery:       { id: 'delivery',       label: 'Food delivery',     kind: 'want',     emoji: '🛵', color: '#E8743B' },
  coffee_tea:     { id: 'coffee_tea',     label: 'Coffee & milk tea', kind: 'want',     emoji: '🧋', color: '#B07A4A' },
  transport:      { id: 'transport',      label: 'Transport',         kind: 'need',     emoji: '🚇', color: '#4A78B5' },
  shopping:       { id: 'shopping',       label: 'Shopping',          kind: 'want',     emoji: '🛍️', color: '#C2557A' },
  subscriptions:  { id: 'subscriptions',  label: 'Subscriptions',     kind: 'want',     emoji: '📺', color: '#7A5AB5' },
  entertainment:  { id: 'entertainment',  label: 'Fun & going out',   kind: 'want',     emoji: '🎤', color: '#D4609B' },
  health:         { id: 'health',         label: 'Health',            kind: 'need',     emoji: '🩺', color: '#3E9C9C' },
  education:      { id: 'education',      label: 'Learning',          kind: 'need',     emoji: '📚', color: '#6B7FD6' },
  travel:         { id: 'travel',         label: 'Travel',            kind: 'want',     emoji: '✈️', color: '#2F8FB5' },
  personal_care:  { id: 'personal_care',  label: 'Personal care',     kind: 'want',     emoji: '💅', color: '#C98BB0' },
  gifts:          { id: 'gifts',          label: 'Gifts & red packets', kind: 'want',   emoji: '🧧', color: '#C0392B' },
  insurance:      { id: 'insurance',      label: 'Insurance',         kind: 'need',     emoji: '🛡️', color: '#607D8B' },
  fees:           { id: 'fees',           label: 'Fees & charges',    kind: 'need',     emoji: '🧾', color: '#9E7B5B' },
  other:          { id: 'other',          label: 'Other',             kind: 'want',     emoji: '🫧', color: '#9A8F85' },
  income:         { id: 'income',         label: 'Income',            kind: 'income',   emoji: '💰', color: '#2E8B66' },
  transfer:       { id: 'transfer',       label: 'Transfers',         kind: 'transfer', emoji: '🔁', color: '#8A8A8A' },
  savings:        { id: 'savings',        label: 'Goal savings',      kind: 'save',     emoji: '🥟', color: '#E3A21A' },
}

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[]

/** Categories that count toward "spending" (everything except income, transfers and savings). */
export const SPENDING_CATEGORIES: CategoryId[] = CATEGORY_IDS.filter((c) => {
  const k: CategoryKind = CATEGORIES[c].kind
  return k === 'need' || k === 'want'
})

export function isSpendingCategory(c: CategoryId): boolean {
  const k = CATEGORIES[c].kind
  return k === 'need' || k === 'want'
}
