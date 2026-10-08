/**
 * Pure view logic for Settings and the glass box: the permission matrix, cap usage, profile drafts,
 * tripwire inputs and tone-aware copy. No React, no DOM — unit-tested in logic.test.ts.
 */
import { TOOL_SPECS, isToolName } from '../../../core/agent/specs'
import { CATEGORIES } from '../../../core/categories'
import { computeMirror } from '../../../core/finance/mirror'
import { fmt, MINOR_PER_MAJOR, parseAmount, toMajor } from '../../../core/money'
import { isValidPinFormat } from '../../../core/security/pin'
import type {
  Autonomy,
  BankState,
  BunMood,
  CategoryId,
  Currency,
  FinanceContext,
  Mandate,
  Minor,
  MirrorStatus,
  PendingAction,
  Profile,
  Tier,
  Tone,
  ToolName,
  ToolSpec,
  Tripwire,
  TripwireEvent,
  TripwireKind,
} from '../../../core/types'

// ───────────────────────────── autonomy & the tier matrix ─────────────────────────────

export const AUTONOMY_ORDER: readonly Autonomy[] = ['observe', 'suggest', 'copilot', 'autopilot']

export interface AutonomyMeta {
  value: Autonomy
  label: string
  /** one line under the slider */
  hint: string
}

export const AUTONOMY_META: Record<Autonomy, AutonomyMeta> = {
  observe: { value: 'observe', label: 'Observe', hint: 'Bun only reads and explains. It can’t propose or do anything.' },
  suggest: { value: 'suggest', label: 'Suggest', hint: 'Bun proposes; every change waits for your tap.' },
  copilot: { value: 'copilot', label: 'Co-pilot', hint: 'Organizing runs on its own. Moving money needs a tap, paying needs your PIN.' },
  autopilot: { value: 'autopilot', label: 'Autopilot', hint: 'Moves money between your own pots within your limits. Paying still needs your PIN.' },
}

export const AUTONOMY_STEPS = AUTONOMY_ORDER.map((a) => AUTONOMY_META[a])

export function autonomyRank(a: Autonomy): number {
  return AUTONOMY_ORDER.indexOf(a)
}

/** Raising autonomy needs the PIN; lowering is instant. */
export function isRaise(from: Autonomy, to: Autonomy): boolean {
  return autonomyRank(to) > autonomyRank(from)
}

export type Gate = 'auto' | 'tap' | 'pin' | 'never'

export const GATE_META: Record<Gate, { label: string; long: string }> = {
  auto: { label: 'Auto', long: 'runs on its own' },
  tap: { label: 'Tap', long: 'needs your tap' },
  pin: { label: 'PIN', long: 'needs your tap and PIN' },
  never: { label: 'Never', long: 'never allowed' },
}

export const TIERS: readonly Tier[] = [0, 1, 2, 3, 4]

/** Short tier names for the matrix (read · organize · move own money · pay & cancel · never). */
export const TIER_SHORT: Record<Tier, string> = {
  0: 'Read',
  1: 'Organize',
  2: 'Move own money',
  3: 'Pay & cancel',
  4: 'Never',
}

/**
 * What the policy engine does with a tier at an autonomy level (mirrors security/policy.ts tierMatrix,
 * P-OBSERVE and P-FROZEN). Autopilot's T2 'auto' still requires an untainted turn within the caps.
 */
export function tierGate(tier: Tier, autonomy: Autonomy, frozen = false): Gate {
  if (tier === 4) return 'never'
  if (tier === 0) return 'auto'
  if (frozen || autonomy === 'observe') return 'never'
  if (tier === 3) return 'pin'
  if (tier === 2) return autonomy === 'autopilot' ? 'auto' : 'tap'
  return autonomy === 'suggest' ? 'tap' : 'auto'
}

export interface GateChange {
  tier: Tier
  from: Gate
  to: Gate
}

/** Which tiers change behaviour between two autonomy levels (what the PIN sheet spells out before a raise). */
export function gateChanges(from: Autonomy, to: Autonomy, frozen = false): GateChange[] {
  return TIERS.map((tier) => ({ tier, from: tierGate(tier, from, frozen), to: tierGate(tier, to, frozen) })).filter((c) => c.from !== c.to)
}

// ───────────────────────────── caps ─────────────────────────────

export type CapKey = 'perActionCap' | 'dailyCap' | 'monthlyCap'
export type Caps = Pick<Mandate, CapKey>
export const CAP_KEYS: readonly CapKey[] = ['perActionCap', 'dailyCap', 'monthlyCap']

export const CAP_META: Record<CapKey, { label: string; hint: string }> = {
  perActionCap: { label: 'Per action', hint: 'The most one agent action may move' },
  dailyCap: { label: 'Per day', hint: 'Total Bun may move today' },
  monthlyCap: { label: 'Per month', hint: 'Total Bun may move this month' },
}

/** True when any cap goes up (needs the PIN). */
export function capsRaise(current: Caps, next: Partial<Caps>): boolean {
  return CAP_KEYS.some((k) => next[k] !== undefined && (next[k] as number) > current[k])
}

/** Only the caps that actually changed. */
export function changedCaps(current: Caps, next: Partial<Caps>): Partial<Caps> {
  const out: Partial<Caps> = {}
  for (const k of CAP_KEYS) if (next[k] !== undefined && next[k] !== current[k]) out[k] = next[k]
  return out
}

export type CapsDraft = Record<CapKey, string>

export function capsDraft(m: Caps, currency: Currency): CapsDraft {
  return { perActionCap: toInput(m.perActionCap, currency), dailyCap: toInput(m.dailyCap, currency), monthlyCap: toInput(m.monthlyCap, currency) }
}

/** Parse the caps editor: positive amounts, and per action ≤ per day ≤ per month (a looser inner cap would be dead). */
export function checkCapsDraft(d: CapsDraft, currency: Currency): { caps: Caps } | { errors: Partial<Record<CapKey, string>> } {
  const errors: Partial<Record<CapKey, string>> = {}
  const out: Partial<Caps> = {}
  for (const k of CAP_KEYS) {
    const v = parseMoneyInput(d[k], currency)
    if (v === null) errors[k] = 'Enter an amount, like 500'
    else out[k] = v
  }
  if (!errors.perActionCap && !errors.dailyCap && (out.perActionCap as number) > (out.dailyCap as number)) {
    errors.perActionCap = 'One action can’t be more than the daily limit'
  }
  if (!errors.dailyCap && !errors.monthlyCap && (out.dailyCap as number) > (out.monthlyCap as number)) {
    errors.dailyCap = 'A day can’t be more than the monthly limit'
  }
  return Object.keys(errors).length ? { errors } : { caps: out as Caps }
}

const AGENT_PROPOSERS = new Set(['llm', 'offline'])
const COUNTED: ReadonlySet<PendingAction['status']> = new Set(['approved', 'executed'])

function localDay(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function amountOf(p: PendingAction, bank: BankState): Minor {
  if (typeof p.preview.amount === 'number' && Number.isFinite(p.preview.amount)) return Math.abs(p.preview.amount)
  if (p.call.tool === 'pay_bill') return bank.bills.find((b) => b.id === p.call.args.billId)?.amountDue ?? 0
  const a = p.call.args.amount
  return typeof a === 'number' && Number.isFinite(a) ? Math.abs(a) : 0
}

/**
 * Agent money movement counted against the caps — the same records the policy engine counts
 * (agent-proposed, approved or executed, money-moving tools), bucketed by the device's calendar day/month.
 */
export function capUsage(pending: readonly PendingAction[], bank: BankState, nowMs: number): { today: Minor; month: Minor } {
  const day = localDay(nowMs)
  const month = day.slice(0, 7)
  let today = 0
  let thisMonth = 0
  for (const p of pending) {
    if (!AGENT_PROPOSERS.has(p.call.proposedBy) || !COUNTED.has(p.status)) continue
    if (!isToolName(p.call.tool) || !TOOL_SPECS[p.call.tool].movesMoney) continue
    const ms = Date.parse(p.executedAt ?? p.createdAt)
    const amt = amountOf(p, bank)
    const key = Number.isFinite(ms) ? localDay(ms) : day
    if (key === day) today += amt
    if (key.slice(0, 7) === month) thisMonth += amt
  }
  return { today, month: thisMonth }
}

// ───────────────────────────── tools ─────────────────────────────

export interface ToolGroup {
  tier: Tier
  tools: ToolSpec[]
}

/** Every tool grouped by tier (T0 → T4), in spec order. */
export function toolGroups(): ToolGroup[] {
  const specs = Object.values(TOOL_SPECS)
  return TIERS.map((tier) => ({ tier, tools: specs.filter((s) => s.tier === tier) }))
}

/** Switching a T2/T3 tool back on needs the PIN; switching off never does. T4 can't be toggled. */
export function toolToggleNeedsPin(tool: ToolName, enable: boolean): boolean {
  return enable && TOOL_SPECS[tool].tier >= 2 && TOOL_SPECS[tool].tier <= 3
}

// ───────────────────────────── money inputs ─────────────────────────────

/** Minor units → the plain number a user edits ("500", "486.2"). */
export function toInput(minor: Minor, currency: Currency): string {
  const major = toMajor(minor, currency)
  return Number.isInteger(major) ? String(major) : String(Math.round(major * 100) / 100)
}

/** A typed amount → positive minor units, or null. Accepts "1,299", "¥500", "2k". */
export function parseMoneyInput(text: string, currency: Currency): Minor | null {
  const trimmed = text.trim()
  if (!trimmed || /^-/.test(trimmed)) return null
  const m = parseAmount(trimmed, currency)
  return m !== null && m > 0 && Number.isSafeInteger(m) ? m : null
}

// ───────────────────────────── profile ─────────────────────────────

export interface ProfileDraft {
  name: string
  income: string
  target: string
  payday: string
  tone: Tone
}

export type ProfilePatch = Partial<Pick<Profile, 'name' | 'monthlyIncome' | 'targetSpend' | 'payday' | 'tone'>>

export function profileDraft(p: Profile): ProfileDraft {
  return {
    name: p.name,
    income: toInput(p.monthlyIncome, p.currency),
    target: toInput(p.targetSpend, p.currency),
    payday: String(p.payday),
    tone: p.tone,
  }
}

export interface DraftCheck {
  patch: ProfilePatch
  errors: Partial<Record<keyof ProfileDraft, string>>
}

/** Validate a draft against the saved profile: the changed fields as a patch, plus per-field errors. */
export function checkProfileDraft(d: ProfileDraft, p: Profile): DraftCheck {
  const errors: DraftCheck['errors'] = {}
  const patch: ProfilePatch = {}
  const name = d.name.trim()
  if (!name) errors.name = 'Tell Bun what to call you'
  else if (name.length > 40) errors.name = 'Keep it under 40 characters'
  else if (name !== p.name) patch.name = name
  const income = parseMoneyInput(d.income, p.currency)
  if (income === null) errors.income = 'Enter your monthly income, like 18500'
  else if (income !== p.monthlyIncome) patch.monthlyIncome = income
  const target = parseMoneyInput(d.target, p.currency)
  if (target === null) errors.target = 'Enter what you’re happy to spend, like 9500'
  else if (target !== p.targetSpend) patch.targetSpend = target
  const day = Number(d.payday)
  if (!/^\d{1,2}$/.test(d.payday.trim()) || day < 1 || day > 28) errors.payday = 'Pick a day from 1 to 28'
  else if (day !== p.payday) patch.payday = day
  if (d.tone !== p.tone) patch.tone = d.tone
  return { patch, errors }
}

export const TONE_OPTIONS: { value: Tone; label: string; blurb: string }[] = [
  { value: 'gentle', label: 'Gentle', blurb: 'Kind and encouraging. The default.' },
  { value: 'cheeky', label: 'Cheeky', blurb: 'Playful roasts. Opt-in only.' },
  { value: 'numbers', label: 'Just numbers', blurb: 'No commentary, only the facts.' },
]

/** Pick tone-specific copy. */
export function toneLine(tone: Tone | undefined, copy: Record<Tone, string>): string {
  return copy[tone ?? 'gentle'] ?? copy.gentle
}

/**
 * The Dream Mirror headline + subline this profile draft would produce — computed by the real mirror engine
 * with the draft's tone and target, so the preview is exactly what Home will say.
 */
export interface MirrorPreview {
  headline: string
  subline: string
  image?: string
  itemName?: string
  status: MirrorStatus
  mood: BunMood
}

export function mirrorPreview(ctx: FinanceContext | null, tone: Tone, targetSpend?: Minor): MirrorPreview | null {
  if (!ctx?.profile) return null
  try {
    const profile = { ...ctx.profile, tone, targetSpend: targetSpend ?? ctx.profile.targetSpend }
    const m = computeMirror({ ...ctx, profile })
    return { headline: m.headline, subline: m.subline, image: m.item?.image, itemName: m.item?.name, status: m.status, mood: m.mood }
  } catch {
    return null
  }
}

// ───────────────────────────── tripwires ─────────────────────────────

export interface TripwireKindMeta {
  kind: TripwireKind
  label: string
  /** 'pct' thresholds are percentages, 'money' thresholds are minor units */
  unit: 'pct' | 'money'
  hint: string
  /** default threshold for a new tripwire: percent, or major units */
  defaultValue: number
}

export const TRIPWIRE_KINDS: Record<TripwireKind, TripwireKindMeta> = {
  month_pct: { kind: 'month_pct', label: 'Month target', unit: 'pct', hint: 'When the month’s spending reaches this share of your target', defaultValue: 80 },
  pace_over: { kind: 'pace_over', label: 'Pace', unit: 'pct', hint: 'When your projected month-end passes this share of your target', defaultValue: 110 },
  category_pct: { kind: 'category_pct', label: 'Category', unit: 'pct', hint: 'When one category reaches this share of its budget', defaultValue: 100 },
  single_over: { kind: 'single_over', label: 'Big purchase', unit: 'money', hint: 'Any single purchase above this amount', defaultValue: 800 },
  daily_over: { kind: 'daily_over', label: 'Big day', unit: 'money', hint: 'When one day’s spending passes this amount', defaultValue: 500 },
}

export const TRIPWIRE_KIND_ORDER: readonly TripwireKind[] = ['month_pct', 'pace_over', 'category_pct', 'single_over', 'daily_over']

export function thresholdInput(t: Pick<Tripwire, 'kind' | 'threshold'>, currency: Currency): string {
  return TRIPWIRE_KINDS[t.kind].unit === 'pct' ? String(t.threshold) : toInput(t.threshold, currency)
}

/** A typed threshold → the stored value (percent or minor units), or an error message. */
export function parseThreshold(kind: TripwireKind, text: string, currency: Currency): { value: number } | { error: string } {
  if (TRIPWIRE_KINDS[kind].unit === 'pct') {
    const n = Number(text.trim().replace(/%$/, ''))
    if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: 'Enter a whole percentage from 1 to 1000' }
    return { value: n }
  }
  const m = parseMoneyInput(text, currency)
  if (m === null) return { error: `Enter an amount, like ${fmt(50 * MINOR_PER_MAJOR[currency], currency)}` }
  return { value: m }
}

/** How often a tripwire fired, and its most recent firing. */
export function tripwireFires(events: readonly TripwireEvent[], tripwireId: string): { total: number; last?: TripwireEvent } {
  const mine = events.filter((e) => e.tripwireId === tripwireId)
  const last = mine.reduce<TripwireEvent | undefined>((a, e) => (!a || e.firedAt > a.firedAt ? e : a), undefined)
  return { total: mine.length, last }
}

/** The plain-language promise shown while setting a tripwire ("Bun nudges you on any single purchase over ¥800."). */
export function tripwireSentence(kind: TripwireKind, value: number, category: CategoryId | undefined, currency: Currency): string {
  switch (kind) {
    case 'month_pct':
      return `Bun nudges you when the month’s spending reaches ${value}% of your target.`
    case 'pace_over':
      return `Bun nudges you when you’re on pace to end the month at ${value}% of your target.`
    case 'category_pct':
      return `Bun nudges you when ${category ? CATEGORIES[category].label : 'a category'} reaches ${value}% of its budget.`
    case 'single_over':
      return `Bun nudges you on any single purchase over ${fmt(value, currency)}.`
    case 'daily_over':
      return `Bun nudges you when a day’s spending passes ${fmt(value, currency)}.`
  }
}

/** Categories that can carry a budget (spending categories only). */
export function isBudgetCategory(c: CategoryId): boolean {
  return c !== 'income' && c !== 'transfer' && c !== 'savings'
}

// ───────────────────────────── security & data ─────────────────────────────

/** Typed confirmation for "Delete everything" (an irreversible wipe deserves more than a tap). */
export const DELETE_PHRASE = 'DELETE'

export function deleteConfirmed(text: string): boolean {
  return text.trim().toUpperCase() === DELETE_PHRASE
}

/** New-PIN rules, in the security module's own words: 4–6 digits, no repeats, no straight runs. */
export function newPinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'Use 4 to 6 digits'
  if (!isValidPinFormat(pin)) return 'Too easy to guess. Avoid repeats like 1111 and runs like 1234'
  return null
}

/** "Locked for 4 more minutes" when the PIN is locked after too many wrong tries, else null. */
export function pinLockText(lockedUntil: string | undefined, nowMs: number): string | null {
  if (!lockedUntil) return null
  const until = Date.parse(lockedUntil)
  if (!Number.isFinite(until) || until <= nowMs) return null
  const mins = Math.ceil((until - nowMs) / 60_000)
  return `PIN locked for ${mins} more minute${mins === 1 ? '' : 's'} after too many wrong tries`
}

// ───────────────────────────── about ─────────────────────────────

export const APP_VERSION = '1.0.0'

export interface Licence {
  name: string
  licence: string
  use: string
}

/** Third-party code and fonts shipped in the app (runtime dependencies only). */
export const LICENCES: readonly Licence[] = [
  { name: 'React & React DOM', licence: 'MIT', use: 'Interface' },
  { name: 'Lucide', licence: 'ISC', use: 'Icons' },
  { name: 'Zod', licence: 'MIT', use: 'Input validation' },
  { name: 'Anthropic TypeScript SDK', licence: 'MIT', use: 'Optional LLM gateway' },
  { name: 'Fraunces', licence: 'SIL OFL 1.1', use: 'Display type' },
  { name: 'DM Sans', licence: 'SIL OFL 1.1', use: 'Interface type' },
  { name: 'Fontsource', licence: 'MIT', use: 'Self-hosted fonts' },
]
