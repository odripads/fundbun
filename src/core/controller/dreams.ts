import type { DreamInput, Result } from '../app-api'
import { CATEGORIES, isSpendingCategory } from '../categories'
import { normalizeMerchant } from '../finance'
import { fmt, sum } from '../money'
import type { SandboxBank } from '../sandbox/bank'
import type { AppState, CategoryId, DreamItem, ISODateTime, Minor } from '../types'
import { appendAudit } from './audit'
import { OK, fail, isNonEmptyString, isPosInt, safely } from './util'
import { ym } from '../dates'

const DREAM_KINDS: readonly DreamItem['kind'][] = ['goal', 'treat']

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/, '')
  return s || 'item'
}

/** Stable goal ids `dream_<slug>`, suffixed `_2`, `_3`… when taken. */
export function dreamId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = `dream_${slugify(name)}`
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

export function dreamInputError(input: Partial<DreamInput>, partial = false): string | null {
  const has = (k: keyof DreamInput) => !partial || input[k] !== undefined
  if (has('name') && !isNonEmptyString(input.name)) return 'Give your dream item a name'
  if (has('name') && (input.name as string).length > 80) return 'Dream names can be at most 80 characters'
  if (has('price') && !isPosInt(input.price)) return 'A dream item needs a positive whole price'
  if (has('kind') && !DREAM_KINDS.includes(input.kind as DreamItem['kind'])) return 'A dream item is either a goal or a treat'
  if (has('image') && typeof input.image !== 'string') return 'Dream image must be a preset or a photo'
  return null
}

/** Build a dream (and its pot for goals) on a draft bank. Does not push it to state. */
export function makeDream(input: DreamInput, bank: SandboxBank, taken: Iterable<string>, today: string): DreamItem {
  const item: DreamItem = {
    id: dreamId(input.name, taken),
    name: input.name.trim(),
    price: input.price,
    image: input.image || 'preset:gift',
    kind: input.kind,
    createdAt: today,
  }
  if (input.note) item.note = input.note
  if (item.kind === 'goal') item.potAccountId = bank.ensurePot(item.id, item.name).id
  return item
}

export function addDreamTo(draft: AppState, bank: SandboxBank, input: DreamInput, ts: ISODateTime): DreamItem {
  const err = dreamInputError(input)
  if (err) throw new Error(err)
  const item = makeDream(input, bank, draft.dreams.map((d) => d.id), draft.bank.today)
  draft.dreams.push(item)
  appendAudit(draft, ts, 'user', 'user_action', `Dream added: ${item.name}`, { dreamId: item.id, kind: item.kind, price: item.price })
  return item
}

export function updateDreamIn(draft: AppState, bank: SandboxBank, id: string, patch: Partial<DreamInput>, ts: ISODateTime): Result {
  const item = draft.dreams.find((d) => d.id === id)
  if (!item) return fail('Dream item not found')
  const err = dreamInputError(patch, true)
  if (err) return fail(err)
  if (patch.name !== undefined) item.name = patch.name.trim()
  if (patch.price !== undefined) item.price = patch.price
  if (patch.image !== undefined) item.image = patch.image
  if (patch.note !== undefined) item.note = patch.note
  if (patch.kind !== undefined) item.kind = patch.kind
  if (item.kind === 'goal' && !item.potAccountId) item.potAccountId = bank.ensurePot(item.id, item.name).id
  appendAudit(draft, ts, 'user', 'user_action', `Dream updated: ${item.name}`, { dreamId: id, fields: Object.keys(patch) })
  return OK
}

/** Removing a goal returns its pot balance to checking (the pot account is kept for history). */
export function removeDreamFrom(draft: AppState, bank: SandboxBank, id: string, ts: ISODateTime): Result {
  const item = draft.dreams.find((d) => d.id === id)
  if (!item) return fail('Dream item not found')
  const pot = item.potAccountId ? draft.bank.accounts.find((a) => a.id === item.potAccountId) : undefined
  let returned: Minor = 0
  if (pot && pot.balance > 0) {
    returned = pot.balance
    bank.transferInternal(pot.id, bank.checking().id, returned, `Returned from ${item.name}`, 'user')
  }
  draft.dreams = draft.dreams.filter((d) => d.id !== id)
  appendAudit(draft, ts, 'user', 'user_action', `Dream removed: ${item.name}`, { dreamId: id, returnedToChecking: returned })
  return OK
}

/** A USER action: not agent-initiated, does not count toward the agent's caps. */
export function contributeIn(draft: AppState, bank: SandboxBank, id: string, amount: Minor, ts: ISODateTime): Result {
  if (!isPosInt(amount)) return fail('Amount must be a positive whole amount')
  const item = draft.dreams.find((d) => d.id === id)
  if (!item) return fail('Dream item not found')
  if (item.kind !== 'goal') return fail('Only goals have a savings pot')
  const potExists = item.potAccountId && draft.bank.accounts.some((a) => a.id === item.potAccountId)
  if (!potExists) item.potAccountId = bank.ensurePot(item.id, item.name).id
  const txns = bank.transferInternal(bank.checking().id, item.potAccountId as string, amount, `Saved toward ${item.name}`, 'user')
  const currency = draft.profile?.currency ?? 'CNY'
  appendAudit(draft, ts, 'user', 'user_action', `You moved ${fmt(amount, currency)} into ${item.name}`, {
    dreamId: id, amount, initiatedBy: 'user', txnIds: txns.map((t) => t.id),
  })
  return OK
}

export function markAchievedIn(draft: AppState, id: string, ts: ISODateTime): Result {
  const item = draft.dreams.find((d) => d.id === id)
  if (!item) return fail('Dream item not found')
  if (item.achievedAt) return OK
  item.achievedAt = draft.bank.today
  appendAudit(draft, ts, 'user', 'user_action', `Dream achieved: ${item.name}`, { dreamId: id })
  return OK
}

/** Set (or with limit 0 remove) one category limit; the plan becomes a user-owned custom plan. */
export function setCategoryBudgetIn(draft: AppState, category: CategoryId, limit: Minor, ts: ISODateTime): Result {
  if (!(category in CATEGORIES) || !isSpendingCategory(category)) return fail(`"${String(category)}" is not a spending category`)
  if (!(limit === 0 || isPosInt(limit))) return fail('Budget limit must be a positive whole amount')
  const plan = draft.budget ?? {
    month: ym(draft.bank.today), total: 0, categories: [], method: 'custom' as const, createdBy: 'user' as const, createdAt: ts,
  }
  const others = plan.categories.filter((c) => c.category !== category)
  plan.categories = limit > 0 ? [...others, { category, limit }] : others
  plan.total = sum(plan.categories.map((c) => c.limit))
  plan.method = 'custom'
  plan.createdBy = 'user'
  draft.budget = plan
  const currency = draft.profile?.currency ?? 'CNY'
  const what = limit > 0 ? `${CATEGORIES[category].label} limit ${fmt(limit, currency)}` : `${CATEGORIES[category].label} limit removed`
  appendAudit(draft, ts, 'user', 'user_action', `Budget: ${what}`, { category, limit })
  return OK
}

/** Re-categorise one transaction and learn a rule for its merchant (used by future imports/categorisation). */
export function recategorizeIn(draft: AppState, txnId: string, category: CategoryId, ts: ISODateTime): Result {
  if (!(category in CATEGORIES)) return fail(`Unknown category "${String(category)}"`)
  const txn = draft.bank.transactions.find((t) => t.id === txnId)
  if (!txn) return fail('Transaction not found')
  const from = txn.category
  txn.category = category
  txn.categorySource = 'user'
  txn.categoryConfidence = 1
  const key = safely('normalizeMerchant', () => normalizeMerchant(txn.merchant), txn.merchant) || txn.merchant
  draft.categoryRules = { ...draft.categoryRules, [key]: category }
  appendAudit(draft, ts, 'user', 'user_action', `Recategorised ${txn.merchant}: ${from} → ${category}`, {
    txnId, from, to: category, rule: key,
  })
  return OK
}
