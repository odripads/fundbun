import { CATEGORIES } from '../categories'
import { CONSENT_VERSION } from '../consent'
import { monthLabel, monthsBack, shiftMonth, ym } from '../dates'
import { evaluateTripwires } from '../finance/tripwires'
import { fmt } from '../money'
import type {
  BankState,
  BudgetPlan,
  CategoryBudget,
  CategoryId,
  Currency,
  DreamItem,
  ISODate,
  ISODateTime,
  Mandate,
  Minor,
  Profile,
  Transaction,
  Tripwire,
  TripwireEvent,
  YearMonth,
} from '../types'
import { potId } from './drafts'
import { generateHistory } from './generator'
import type { PersonaScript, TripwireSeed } from './script-types'
import { SCRIPTS, getScript } from './scripts'

export interface PersonaDef {
  id: string
  /** display name, e.g. "Mei" */
  name: string
  /** one line, e.g. "24 · UX designer in Shenzhen" */
  tagline: string
  city: string
  currency: Currency
  monthlyIncome: Minor
  targetSpend: Minor
  payday: number
  /** short description of the story this persona demonstrates */
  story: string
  /** e.g. "Mei Lin" */
  fullName?: string
}

export interface PersonaBundle {
  profile: Profile
  bank: BankState
  dreams: DreamItem[]
  budget: BudgetPlan
  tripwires: Tripwire[]
  /** the mandate the persona chose at onboarding (CONTRACT §4: copilot, ¥500 / ¥1,000 / ¥5,000) */
  mandate?: Pick<Mandate, 'autonomy' | 'perActionCap' | 'dailyCap' | 'monthlyCap'>
}

/** CONTRACT §4 constants for the demo. */
export const DEFAULT_SEED = 20261020
export const SANDBOX_TODAY: ISODate = '2026-10-22'
export const DEMO_PIN = '2580'
export const PERSONA_ONBOARDED_AT: ISODateTime = '2026-04-01T09:00:00.000Z'
/** Personas record the same consent text version as onboarding (CONSENT_VERSION). */
export const PERSONA_CONSENT_VERSION = CONSENT_VERSION
/** Tripwire alerts left unseen when a persona loads, so Home has something to show; older ones start seen. */
export const DEMO_UNSEEN_EVENTS = 2
export const WORK_HOURS_PER_MONTH = 174

/**
 * Built-in sandbox personas. Must include:
 *  - 'mei'  — young professional in Shenzhen (CNY). Current month is OVER target (overspend lands on a
 *             recognisable dream item; long-term goal "Birkin 25"). Has a subscription price hike, a duplicate
 *             charge, an electricity bill spike, overlapping video subscriptions, late-night delivery habit,
 *             a bill whose rawText contains a prompt-injection attempt, and upcoming bills with verified payees.
 *  - 'arif' — international student (e.g. Indonesian studying in Shenzhen or abroad) who is UNDER target this
 *             month (positive mirror: "that's new shoes, guilt-free" / "closer to your laptop").
 */
export const PERSONAS: PersonaDef[] = SCRIPTS.map((s) => s.def)

function buildProfile(script: PersonaScript): Profile {
  const d = script.def
  return {
    name: d.name,
    currency: d.currency,
    monthlyIncome: d.monthlyIncome,
    targetSpend: d.targetSpend,
    payday: d.payday,
    workHoursPerMonth: WORK_HOURS_PER_MONTH,
    tone: script.tone,
    consent: {
      financialData: true,
      llmProcessing: true,
      notifications: true,
      grantedAt: PERSONA_ONBOARDED_AT,
      version: CONSENT_VERSION,
    },
    onboardedAt: PERSONA_ONBOARDED_AT,
    personaId: d.id,
  }
}

function buildDreams(script: PersonaScript): DreamItem[] {
  const createdAt = PERSONA_ONBOARDED_AT.slice(0, 10)
  return script.dreams.map((seed) => {
    const item: DreamItem = { id: seed.id, name: seed.name, price: seed.price, image: seed.image, kind: seed.kind, createdAt }
    if (seed.kind === 'goal') item.potAccountId = potId(seed.id)
    if (seed.note) item.note = seed.note
    return item
  })
}

export function tripwireLabel(seed: Pick<TripwireSeed, 'kind' | 'threshold' | 'category'>, currency: Currency): string {
  switch (seed.kind) {
    case 'month_pct':
      return seed.threshold >= 100 ? 'Tell me when I hit my monthly target' : `Heads-up at ${seed.threshold}% of my monthly target`
    case 'category_pct': {
      const label = seed.category ? CATEGORIES[seed.category].label : 'A category'
      return `${label} reaches ${seed.threshold}% of its budget`
    }
    case 'single_over':
      return `Any single purchase over ${fmt(seed.threshold, currency)}`
    case 'daily_over':
      return `Spending more than ${fmt(seed.threshold, currency)} in one day`
    case 'pace_over':
      return `On pace to end ${seed.threshold - 100}% over target`
  }
}

function buildTripwires(script: PersonaScript): Tripwire[] {
  return script.tripwires.map((seed) => {
    const t: Tripwire = {
      id: seed.id,
      kind: seed.kind,
      threshold: seed.threshold,
      enabled: true,
      createdBy: 'user',
      label: tripwireLabel(seed, script.def.currency),
    }
    if (seed.category) t.category = seed.category
    return t
  })
}

// ── history-based budget plan ──────────────────────────────────────────────

const LIMIT_STEP: Minor = 1_000 // ¥10

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function roundStep(v: number): Minor {
  return Math.round(v / LIMIT_STEP) * LIMIT_STEP
}

function isSpendingTxn(t: Transaction): boolean {
  const kind = CATEGORIES[t.category].kind
  return t.amount < 0 && (kind === 'need' || kind === 'want') && !t.flags?.includes('reversed')
}

/**
 * Median monthly spend per spending category over the `months` that have any spending at all (a category
 * missing from an active month counts as zero there, so one-off purchases do not become budget lines).
 */
export function categoryMedians(bank: BankState, months: readonly YearMonth[]): Map<CategoryId, Minor> {
  const spending = bank.transactions.filter(isSpendingTxn)
  const active = months.filter((m) => spending.some((t) => ym(t.date) === m))
  const perMonth = new Map<CategoryId, Minor[]>()
  active.forEach((m, i) => {
    for (const t of spending) {
      if (ym(t.date) !== m) continue
      const row = perMonth.get(t.category) ?? active.map(() => 0)
      row[i] -= t.amount
      perMonth.set(t.category, row)
    }
  })
  const out = new Map<CategoryId, Minor>()
  for (const [cat, row] of perMonth) out.set(cat, median(row))
  return out
}

/**
 * A 'history' budget: needs keep their median, wants share whatever is left of the target in proportion to
 * their medians (everything scales together if needs alone exceed the target). Limits are whole ¥10s and the
 * rounding remainder goes to the biggest want, so the limits always sum exactly to `target`.
 */
export function historyBudget(bank: BankState, target: Minor, month: YearMonth, createdAt: ISODateTime, currency: Currency = 'CNY'): BudgetPlan {
  const months = monthsBack(shiftMonth(month, -1), 3)
  const medians = [...categoryMedians(bank, months)].filter(([, v]) => v > 0)
  const needs = medians.filter(([c]) => CATEGORIES[c].kind === 'need')
  const wants = medians.filter(([c]) => CATEGORIES[c].kind === 'want')
  const needTotal = needs.reduce((s, [, v]) => s + v, 0)
  const wantTotal = wants.reduce((s, [, v]) => s + v, 0)
  const needScale = needTotal > target ? target / needTotal : 1
  const wantScale = wantTotal > 0 ? Math.max(0, target - needTotal * needScale) / wantTotal : 0

  const categories: CategoryBudget[] = [
    ...needs.map(([c, v]) => ({ category: c, limit: roundStep(v * needScale) })),
    ...wants.map(([c, v]) => ({ category: c, limit: roundStep(v * wantScale) })),
  ].filter((b) => b.limit > 0)
  absorbRemainder(categories, target)
  categories.sort((a, b) => b.limit - a.limit)

  const history = needTotal + wantTotal
  const trimmed = Math.round((1 - wantScale) * 100)
  const rationale =
    history > target
      ? `Based on your median spending in ${monthLabel(months[0], 'short')}–${monthLabel(months[2], 'short')} (${fmt(roundStep(history), currency)}/month): essentials kept as they are, wants trimmed ${trimmed}% to fit your ${fmt(target, currency)} target.`
      : `Based on your median spending in ${monthLabel(months[0], 'short')}–${monthLabel(months[2], 'short')} (${fmt(roundStep(history), currency)}/month): essentials kept, the ${fmt(target - roundStep(history), currency)} of headroom spread across wants.`
  return { month, total: target, categories, method: 'history', createdBy: 'default', createdAt, rationale }
}

function absorbRemainder(categories: CategoryBudget[], target: Minor): void {
  if (categories.length === 0) return
  const remainder = target - categories.reduce((s, b) => s + b.limit, 0)
  if (remainder === 0) return
  const byWantSize = [...categories].sort((a, b) => {
    const wa = CATEGORIES[a.category].kind === 'want' ? 1 : 0
    const wb = CATEGORIES[b.category].kind === 'want' ? 1 : 0
    return wb - wa || b.limit - a.limit
  })
  const sink = byWantSize.find((b) => b.limit + remainder >= 0) ?? byWantSize[0]
  sink.limit = Math.max(0, sink.limit + remainder)
}

// ── public API ─────────────────────────────────────────────────────────────

/** Build a complete, deterministic persona bundle for the given sandbox date. */
export function loadPersona(id: string, today: ISODate, seed = DEFAULT_SEED): PersonaBundle {
  const script = getScript(id)
  if (!script) throw new Error(`Unknown persona "${id}" (available: ${PERSONAS.map((p) => p.id).join(', ')})`)
  const bank = generateHistory(script.def, today, seed)
  const month = ym(today)
  return {
    profile: buildProfile(script),
    bank,
    dreams: buildDreams(script),
    budget: historyBudget(bank, script.def.targetSpend, month, `${month}-01T09:00:00.000Z`, script.def.currency),
    tripwires: buildTripwires(script),
    mandate: { ...script.mandate },
  }
}

/**
 * Evaluate the persona's tripwires against its own history, as if they had been watching all along: the
 * alerts that are already true become events (the last `unseen` stay unseen, the rest are marked seen) and
 * every tripwire gets its lastFiredKey — so the first purchase after loading doesn't replay month-level alerts.
 */
export function primeTripwires(
  bundle: Pick<PersonaBundle, 'profile' | 'bank' | 'dreams' | 'budget' | 'tripwires'>,
  now: ISODateTime,
  unseen = DEMO_UNSEEN_EVENTS,
): { tripwires: Tripwire[]; events: TripwireEvent[] } {
  const { profile, bank, dreams, budget, tripwires } = bundle
  const out = evaluateTripwires({ profile, bank, dreams, budget, tripwires }, { now })
  const keepFrom = out.events.length - Math.max(0, unseen)
  return { tripwires: out.tripwires, events: out.events.map((e, i) => ({ ...e, seen: i < keepFrom })) }
}
