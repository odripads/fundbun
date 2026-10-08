/**
 * Onboarding view logic — pure functions only (no React, no DOM), unit-tested in logic.test.ts.
 * Validation per step, the live income hint, tripwire thresholds, the tone preview (rendered by the real Dream
 * Mirror engine so the preview says exactly what Home will), the permission matrix, CSV summaries and the final
 * OnboardingInput.
 */
import type { DataSource, OnboardingInput, TripwireInput } from '../../../core/app-api'
import { dateLabel } from '../../../core/dates'
import { computeMirror } from '../../../core/finance/mirror'
import { fmt, MINOR_PER_MAJOR, parseAmount } from '../../../core/money'
import { importCsv, type CsvImportResult } from '../../../core/sandbox/csv'
import { isValidPinFormat } from '../../../core/security/pin'
import type { Autonomy, BunMood, Currency, DreamItem, FinanceContext, Minor, Tier, Tone, TripwireKind } from '../../../core/types'
import { STEPS, type OnboardingDraft, type PersonaId, type StepId, type TripwireDraft, type TripwireKey } from './draft'

// ───────────────────────────── steps ─────────────────────────────

export interface StepMeta {
  title: string
  /** progress / summary label */
  short: string
  mood: BunMood
}

export const STEP_META: Record<StepId, StepMeta> = {
  welcome: { title: 'See what your spending could have been.', short: 'Welcome', mood: 'happy' },
  consent: { title: 'Your data, your call', short: 'Consent', mood: 'calm' },
  money: { title: 'Your month in numbers', short: 'Your money', mood: 'calm' },
  dreams: { title: 'What are you dreaming of?', short: 'Dreams', mood: 'happy' },
  tripwires: { title: 'Tripwires & tone', short: 'Tripwires & tone', mood: 'worried' },
  permissions: { title: 'What Bun may do', short: 'Permissions', mood: 'calm' },
  data: { title: 'Where should Bun look?', short: 'Your data', mood: 'sleepy' },
  done: { title: 'You’re all set', short: 'Done', mood: 'happy' },
}

/** The steps the progress bar counts (welcome and done sit outside it). */
export const FLOW: readonly StepId[] = ['consent', 'money', 'dreams', 'tripwires', 'permissions', 'data']

export function stepIndex(step: StepId): number {
  return STEPS.indexOf(step)
}

export function nextStep(step: StepId): StepId {
  return STEPS[Math.min(STEPS.length - 1, stepIndex(step) + 1)]
}

export function prevStep(step: StepId): StepId {
  return STEPS[Math.max(0, stepIndex(step) - 1)]
}

/** 1-based position within FLOW, or null for welcome/done. */
export function flowPosition(step: StepId): number | null {
  const i = FLOW.indexOf(step)
  return i === -1 ? null : i + 1
}

// ───────────────────────────── money fields ─────────────────────────────

export type MoneyParse = { ok: true; minor: Minor } | { ok: false; error: string }

const MAX_MAJOR = 999_999_999

/** Parse a typed amount ("18,500", "18.5k", "1.85万") in major units into whole minor units. */
export function parseMoney(text: string, currency: Currency, opts: { what: string; example: string; allowZero?: boolean }): MoneyParse {
  const t = text.trim()
  if (!t) return { ok: false, error: `Enter ${opts.what}, like ${opts.example}` }
  if (/^[-−]/.test(t)) return { ok: false, error: 'This can’t be negative' }
  const minor = parseAmount(t, currency)
  if (minor === null || !Number.isFinite(minor)) return { ok: false, error: `Enter a number, like ${opts.example}` }
  if (minor === 0 && !opts.allowZero) return { ok: false, error: `${capitalise(opts.what)} needs to be more than zero` }
  if (minor > MAX_MAJOR * MINOR_PER_MAJOR[currency]) return { ok: false, error: 'That number looks too big — check the zeros' }
  return { ok: true, minor: Math.round(minor) }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Tidy a typed amount once the field loses focus: "18500" → "18,500", "1.9k" → "1,900". Unparseable text is left alone. */
export function groupAmount(text: string, currency: Currency): string {
  const t = text.trim()
  if (!t || /^[-−]/.test(t)) return text
  const minor = parseAmount(t, currency)
  if (minor === null || !Number.isFinite(minor)) return text
  return (minor / MINOR_PER_MAJOR[currency]).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export const parseIncome = (d: Pick<OnboardingDraft, 'income' | 'currency'>) => parseMoney(d.income, d.currency, { what: 'your monthly take-home pay', example: '18,500' })
export const parseTarget = (d: Pick<OnboardingDraft, 'target' | 'currency'>) => parseMoney(d.target, d.currency, { what: 'a monthly spending target', example: '9,500' })

export interface IncomeHint {
  tone: 'save' | 'tight' | 'over'
  text: string
  /** target ÷ income, whole percent */
  spendPct: number
  /** income − target (negative when the target is above income) */
  save: Minor
}

/** "That's 51% of your income — leaves ¥9,000 to save." */
export function incomeHint(income: Minor, target: Minor, currency: Currency): IncomeHint | null {
  if (!(income > 0) || !(target > 0)) return null
  const spendPct = Math.round((target / income) * 100)
  const save = income - target
  const f = (m: Minor) => fmt(m, currency)
  if (save > 0) {
    return { tone: spendPct >= 90 ? 'tight' : 'save', spendPct, save, text: `That’s ${spendPct}% of your income — leaves ${f(save)} to save.` }
  }
  if (save === 0) return { tone: 'tight', spendPct, save, text: 'That’s all of your income — nothing left over to save.' }
  return { tone: 'over', spendPct, save, text: `That’s ${f(-save)} more than you earn — Bun will flag it every month.` }
}

export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

export type Errors = Record<string, string>

export function validateConsent(d: OnboardingDraft): Errors {
  return d.consent.financialData ? {} : { financialData: 'Bun needs this one to mirror your month. The other two are up to you.' }
}

export function validateMoney(d: OnboardingDraft): Errors {
  const e: Errors = {}
  const name = d.name.trim()
  if (!name) e.name = 'What should Bun call you?'
  else if (name.length > 40) e.name = 'Keep it under 40 characters'
  const income = parseIncome(d)
  if (!income.ok) e.income = income.error
  const target = parseTarget(d)
  if (!target.ok) e.target = target.error
  if (!Number.isInteger(d.payday) || d.payday < 1 || d.payday > 28) e.payday = 'Pick a day from 1 to 28'
  return e
}

export function validateDreams(d: OnboardingDraft): Errors {
  return d.dreams.length > 0 ? {} : { dreams: 'Add at least one dream — tap “Add to my list” to save it.' }
}

// ───────────────────────────── tripwires ─────────────────────────────

export interface TripwireMeta {
  key: TripwireKey
  kind: TripwireKind
  title: string
  unit: 'pct' | 'money'
}

export const TRIPWIRE_META: Record<TripwireKey, TripwireMeta> = {
  month80: { key: 'month80', kind: 'month_pct', title: 'Early heads-up', unit: 'pct' },
  month100: { key: 'month100', kind: 'month_pct', title: 'Target reached', unit: 'pct' },
  single: { key: 'single', kind: 'single_over', title: 'One big purchase', unit: 'money' },
  pace: { key: 'pace', kind: 'pace_over', title: 'Overspend forecast', unit: 'pct' },
}

/** Default target (¥9,500-ish) used only when the money step hasn't produced a valid one yet. */
const FALLBACK_TARGET_MAJOR = 9_500

export function targetOrFallback(d: Pick<OnboardingDraft, 'target' | 'currency'>): Minor {
  const t = parseTarget(d)
  return t.ok ? t.minor : FALLBACK_TARGET_MAJOR * MINOR_PER_MAJOR[d.currency]
}

/** Same rule as core defaultTripwires: 80% / 100% / single purchase = 10% of target (whole units) / pace 110%. */
export function defaultThreshold(key: TripwireKey, target: Minor, currency: Currency): number {
  if (key === 'month80') return 80
  if (key === 'month100') return 100
  if (key === 'pace') return 110
  const unit = MINOR_PER_MAJOR[currency]
  return Math.max(unit, Math.round(target / 10 / unit) * unit)
}

export function thresholdOf(t: TripwireDraft, target: Minor, currency: Currency): number {
  return t.threshold ?? defaultThreshold(t.key, target, currency)
}

/** A 1/2/5 × 10ⁿ step close to x (for the money stepper). */
export function niceStep(x: number): number {
  if (!(x > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(x))
  const m = x / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
}

export interface ThresholdRange {
  min: number
  max: number
  step: number
}

/** Allowed range and +/− step; money ranges are in minor units. */
export function thresholdRange(key: TripwireKey, target: Minor, currency: Currency): ThresholdRange {
  const unit = MINOR_PER_MAJOR[currency]
  if (key === 'single') return { min: unit, max: Math.max(unit, target * 2), step: niceStep(target / unit / 40) * unit }
  if (key === 'pace') return { min: 101, max: 300, step: 5 }
  return { min: 10, max: 200, step: 5 }
}

/** The changing line under each tripwire, with the user's own numbers. */
export function tripwireDetail(key: TripwireKey, threshold: number, target: Minor, currency: Currency, dreamName?: string): string {
  const f = (m: Minor) => fmt(m, currency)
  const at = Math.round((target * threshold) / 100)
  switch (key) {
    case 'month80':
    case 'month100':
      return threshold === 100 ? `The moment the month reaches ${f(target)}.` : `When the month passes ${f(at)} of your ${f(target)}.`
    case 'single':
      return dreamName ? `Any one purchase over ${f(threshold)}, shown as a slice of your ${dreamName}.` : `Any one purchase over ${f(threshold)}, shown with your dream’s picture.`
    case 'pace':
      return `When you’re on pace to end ${threshold - 100}% over — about ${f(at)}.`
  }
}

export function validateTripwires(d: OnboardingDraft): Errors {
  const target = targetOrFallback(d)
  const e: Errors = {}
  for (const t of d.tripwires) {
    if (!t.enabled) continue
    const v = thresholdOf(t, target, d.currency)
    const r = thresholdRange(t.key, target, d.currency)
    if (!Number.isInteger(v) || v < r.min || v > r.max) {
      e[t.key] = TRIPWIRE_META[t.key].unit === 'pct' ? `Pick ${r.min}–${r.max}%` : `Pick ${fmt(r.min, d.currency)}–${fmt(r.max, d.currency)}`
    }
  }
  return e
}

export function tripwireInputs(d: OnboardingDraft): TripwireInput[] {
  const target = targetOrFallback(d)
  return d.tripwires.map((t) => ({ kind: TRIPWIRE_META[t.key].kind, threshold: thresholdOf(t, target, d.currency), enabled: t.enabled }))
}

// ───────────────────────────── tone preview (real Mirror engine) ─────────────────────────────

export const TONE_COPY: Record<Tone, { label: string; hint: string }> = {
  gentle: { label: 'Gentle', hint: 'Kind and factual. Never shaming. The default.' },
  cheeky: { label: 'Cheeky', hint: 'Blunt and playful: “You could’ve gotten…”. Opt-in only.' },
  numbers: { label: 'Just numbers', hint: 'Plain figures, no commentary.' },
}

/** the fixed "today" the preview month uses: day 22 of 31, like the demo */
export const PREVIEW_TODAY = '2026-10-22'

export interface PreviewDream {
  name: string
  price: Minor
  image: string
  kind: DreamItem['kind']
}

export interface MirrorPreview {
  headline: string
  subline: string
  mood: BunMood
  dream: PreviewDream
  /** the example month's overspend */
  overspend: Minor
  target: Minor
}

/**
 * A believable example overspend: the whole dream when it fits inside one month's target ("You could've gotten
 * New sneakers."), otherwise ~30% of the target, rounded — the Mirror then speaks in slices of the goal.
 */
export function exampleOverspend(price: Minor, target: Minor, currency: Currency): Minor {
  if (price > 0 && price <= target) return price
  const unit = MINOR_PER_MAJOR[currency]
  const raw = target * 0.3
  const step = niceStep(raw / unit / 20) * unit
  return Math.max(unit, Math.round(raw / step) * step)
}

function fallbackDream(currency: Currency): PreviewDream {
  return { name: 'Weekend trip', price: 2_400 * MINOR_PER_MAJOR[currency], image: 'preset:plane', kind: 'goal' }
}

/** The Dream Mirror line for an example over-target month, in the chosen tone, about the user's first dream. */
export function previewMirror(d: OnboardingDraft): MirrorPreview {
  const currency = d.currency
  const target = targetOrFallback(d)
  const income = (() => {
    const i = parseIncome(d)
    return i.ok ? i.minor : target * 2
  })()
  const first = d.dreams[0]
  const dream: PreviewDream = first ? { name: first.name, price: first.price, image: first.image, kind: first.kind } : fallbackDream(currency)
  const overspend = exampleOverspend(dream.price, target, currency)
  const ctx: FinanceContext = {
    profile: {
      name: d.name.trim() || 'You',
      currency,
      monthlyIncome: income,
      targetSpend: target,
      payday: d.payday,
      workHoursPerMonth: 174,
      tone: d.tone,
      consent: { financialData: true, llmProcessing: false, notifications: false, grantedAt: '', version: 'preview' },
      onboardedAt: '',
    },
    bank: {
      accounts: [{ id: 'chk_preview', name: 'Checking', type: 'checking', balance: 0, currency }],
      transactions: [
        {
          id: 'txn_preview',
          accountId: 'chk_preview',
          date: '2026-10-03',
          amount: -(target + overspend),
          currency,
          merchant: 'Example month',
          description: 'Example month',
          category: 'shopping',
          categorySource: 'rule',
          categoryConfidence: 1,
        },
      ],
      payees: [],
      bills: [],
      disputes: [],
      cancelledMerchants: [],
      today: PREVIEW_TODAY,
      seed: 1,
    },
    dreams: [{ id: 'dream_preview', name: dream.name, price: dream.price, image: dream.image, kind: dream.kind, createdAt: PREVIEW_TODAY }],
    budget: null,
    tripwires: [],
  }
  try {
    const m = computeMirror(ctx)
    return { headline: m.headline, subline: m.subline, mood: m.mood, dream, overspend, target }
  } catch {
    const f = (x: Minor) => fmt(x, currency)
    const copy: Record<Tone, string> = {
      gentle: `This month’s extra ${f(overspend)} went past your target.`,
      cheeky: `You could’ve gotten ${dream.name}.`,
      numbers: `${f(overspend)} over target.`,
    }
    return { headline: copy[d.tone], subline: `You’re ${f(overspend)} over your ${f(target)} target.`, mood: d.tone === 'gentle' ? 'worried' : 'burnt', dream, overspend, target }
  }
}

// ───────────────────────────── permissions ─────────────────────────────

export const AUTONOMY_STEPS: { value: Autonomy; label: string; hint: string }[] = [
  { value: 'observe', label: 'Observe', hint: 'Bun only reads and explains. It can’t propose or do anything.' },
  { value: 'suggest', label: 'Suggest', hint: 'Bun proposes; nothing happens until you tap. A safe place to start.' },
  { value: 'copilot', label: 'Co-pilot', hint: 'Tidying up runs on its own; moving money still waits for your tap.' },
  { value: 'autopilot', label: 'Autopilot', hint: 'Also moves money between your own pots, within your caps.' },
]

export type Lane = 'auto' | 'tap' | 'pin' | 'off'

export interface Ability {
  id: string
  label: string
  tier: Tier
}

export const ABILITIES: readonly Ability[] = [
  { id: 'read', label: 'Read & explain your money', tier: 0 },
  { id: 'organize', label: 'Budgets, tripwires & categories', tier: 1 },
  { id: 'move', label: 'Move money between your own pots', tier: 2 },
  { id: 'pay', label: 'Pay a verified bill', tier: 3 },
  { id: 'cancel', label: 'Cancel a subscription', tier: 3 },
  { id: 'dispute', label: 'Dispute a charge', tier: 3 },
]

/** Things no autonomy level allows (T4 — denied by the policy engine, never shown to the LLM). */
export const NEVER: readonly string[] = ['Send money to other people', 'Add new payees', 'Invest your money', 'Borrow or apply for credit', 'Change its own limits']

/** Mirrors security/policy.ts tierMatrix + P-OBSERVE: where an ability lands at an autonomy level. */
export function laneFor(tier: Tier, autonomy: Autonomy): Lane {
  if (tier === 0) return 'auto'
  if (autonomy === 'observe') return 'off'
  if (tier === 1) return autonomy === 'copilot' || autonomy === 'autopilot' ? 'auto' : 'tap'
  if (tier === 2) return autonomy === 'autopilot' ? 'auto' : 'tap'
  return 'pin'
}

export function lanes(autonomy: Autonomy): Record<Lane, Ability[]> {
  const out: Record<Lane, Ability[]> = { auto: [], tap: [], pin: [], off: [] }
  for (const a of ABILITIES) out[laneFor(a.tier, autonomy)].push(a)
  return out
}

export type CapKey = 'perAction' | 'daily' | 'monthly'
export const CAP_LABEL: Record<CapKey, string> = { perAction: 'Per action', daily: 'Per day', monthly: 'Per month' }

export function parseCaps(d: OnboardingDraft): { values: Partial<Record<CapKey, Minor>>; errors: Errors } {
  const values: Partial<Record<CapKey, Minor>> = {}
  const errors: Errors = {}
  for (const k of ['perAction', 'daily', 'monthly'] as const) {
    const r = parseMoney(d.caps[k], d.currency, { what: 'an amount', example: '500' })
    if (r.ok) values[k] = r.minor
    else errors[k] = d.caps[k].trim() ? 'Check this amount' : 'Enter an amount'
  }
  const { perAction, daily, monthly } = values
  // short messages: the three fields sit side by side
  if (perAction !== undefined && daily !== undefined && perAction > daily) errors.daily = 'Can’t be below per action'
  if (daily !== undefined && monthly !== undefined && daily > monthly) errors.monthly = 'Can’t be below per day'
  return { values, errors }
}

export const PIN_RULES: readonly string[] = ['4 to 6 digits', 'Not one digit repeated (1111)', 'Not a straight run (1234, 9876)']

/** Why a new PIN isn't acceptable (null when it is). Mirrors security/pin.isValidPinFormat with friendlier copy. */
export function pinProblem(pin: string): string | null {
  if (!/^\d*$/.test(pin)) return 'Digits only, please.'
  if (pin.length < 4 || pin.length > 6) return 'Use 4 to 6 digits.'
  const d = [...pin].map(Number)
  const steps = d.slice(1).map((x, i) => x - d[i])
  if (steps.every((s) => s === 0)) return 'Too easy to guess — avoid one repeated digit like 1111.'
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Too easy to guess — avoid straight runs like 1234 or 9876.'
  return isValidPinFormat(pin) ? null : 'Pick a PIN that’s harder to guess.'
}

export function validatePermissions(d: OnboardingDraft, pinSet: boolean): Errors {
  const { errors } = parseCaps(d)
  return pinSet ? errors : { ...errors, pin: 'Create a PIN — it guards every payment and any loosening of these limits.' }
}

// ───────────────────────────── data source ─────────────────────────────

export interface LedgerInfo {
  id: PersonaId
  owner: string
  account: string
  blurb: string
}

export const SANDBOX_LEDGERS: readonly LedgerInfo[] = [
  { id: 'mei', owner: 'Mei’s ledger', account: 'Everyday •••• 4821', blurb: 'A designer’s month: delivery, milk tea, rent, a few subscriptions.' },
  { id: 'arif', owner: 'Arif’s ledger', account: 'Student •••• 3307', blurb: 'A student’s month: dorm, canteen, metro, bubble tea.' },
]

export interface CsvSummary {
  count: number
  from?: string
  to?: string
  format: CsvImportResult['format']
  skipped: number
  errors: string[]
}

export const CSV_FORMAT_LABEL: Record<CsvImportResult['format'], string> = {
  wechat_pay: 'WeChat Pay export',
  alipay: 'Alipay export',
  generic: 'Bank CSV',
  unknown: 'Unrecognised file',
}

/** Parse on-device (same importer the controller uses) to show what Bun will read before committing. */
export function summarizeCsv(text: string, currency: Currency): CsvSummary {
  if (!text.trim()) return { count: 0, format: 'unknown', skipped: 0, errors: ['The file is empty.'] }
  let r: CsvImportResult
  try {
    r = importCsv(text, { accountId: 'chk_main', currency })
  } catch {
    return { count: 0, format: 'unknown', skipped: 0, errors: ['That file couldn’t be read as a CSV.'] }
  }
  const dates = r.transactions.map((t) => t.date).sort()
  return {
    count: r.transactions.length,
    ...(dates.length ? { from: dateLabel(dates[0]), to: dateLabel(dates[dates.length - 1]) } : {}),
    format: r.format,
    skipped: r.skipped,
    errors: r.errors.slice(0, 3),
  }
}

/** Decode a CSV file's bytes: UTF-8 first; Alipay and many bank exports are GBK, so fall back to GB18030. */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view).replace(/^﻿/, '')
  } catch {
    try {
      return new TextDecoder('gb18030').decode(view)
    } catch {
      return new TextDecoder('utf-8').decode(view)
    }
  }
}

export function parseBalance(d: OnboardingDraft): MoneyParse {
  return parseMoney(d.data.balance, d.currency, { what: 'your current balance', example: '6,500', allowZero: true })
}

export function validateData(d: OnboardingDraft, csv: CsvSummary | null): Errors {
  const k = d.data.kind
  if (!k) return { source: 'Choose where Bun should look — a sandbox bank is the quickest.' }
  if (k === 'persona') return d.data.personaId ? {} : { persona: 'Pick one of the two sandbox ledgers' }
  const e: Errors = {}
  if (k === 'csv') {
    if (!d.data.csvText) e.csv = 'Choose a CSV file to import'
    else if (!csv || csv.count === 0) e.csv = csv?.errors[0] ?? 'No transactions could be read from that file'
  }
  const bal = parseBalance(d)
  if (!bal.ok) e.balance = bal.error
  return e
}

export function dataSource(d: OnboardingDraft): DataSource | null {
  const bal = parseBalance(d)
  switch (d.data.kind) {
    case 'persona':
      return d.data.personaId ? { kind: 'persona', personaId: d.data.personaId } : null
    case 'csv':
      return bal.ok && d.data.csvText ? { kind: 'csv', text: d.data.csvText, startingBalance: bal.minor } : null
    case 'empty':
      return bal.ok ? { kind: 'empty', startingBalance: bal.minor } : null
    default:
      return null
  }
}

// ───────────────────────────── whole flow ─────────────────────────────

export interface FlowContext {
  pinSet: boolean
  csv: CsvSummary | null
}

export function stepErrors(step: StepId, d: OnboardingDraft, ctx: FlowContext): Errors {
  switch (step) {
    case 'consent': return validateConsent(d)
    case 'money': return validateMoney(d)
    case 'dreams': return validateDreams(d)
    case 'tripwires': return validateTripwires(d)
    case 'permissions': return validatePermissions(d, ctx.pinSet)
    case 'data': return validateData(d, ctx.csv)
    default: return {}
  }
}

/** The first step that still needs something; 'done' when everything is valid. */
export function firstInvalidStep(d: OnboardingDraft, ctx: FlowContext): StepId {
  return FLOW.find((s) => Object.keys(stepErrors(s, d, ctx)).length > 0) ?? 'done'
}

/** The furthest step the user may open: anything up to the first one that still needs input. */
export function clampStep(requested: StepId, d: OnboardingDraft, ctx: FlowContext): StepId {
  const limit = firstInvalidStep(d, ctx)
  return stepIndex(requested) > stepIndex(limit) ? limit : requested
}

export interface Problem {
  step: StepId
  message: string
}

export type BuildResult = { ok: true; input: OnboardingInput } | { ok: false; problems: Problem[] }

/** Assemble the controller's OnboardingInput, or list what's missing per step. */
export function buildOnboardingInput(d: OnboardingDraft, pin: string | null, csv: CsvSummary | null): BuildResult {
  const ctx: FlowContext = { pinSet: pin !== null && pinProblem(pin) === null, csv }
  const problems: Problem[] = FLOW.flatMap((step) => Object.values(stepErrors(step, d, ctx)).map((message) => ({ step, message })))
  const income = parseIncome(d)
  const target = parseTarget(d)
  const { values: caps } = parseCaps(d)
  const source = dataSource(d)
  if (problems.length || !income.ok || !target.ok || !source || pin === null) return { ok: false, problems }
  return {
    ok: true,
    input: {
      name: d.name.trim(),
      currency: d.currency,
      monthlyIncome: income.minor,
      targetSpend: target.minor,
      payday: d.payday,
      tone: d.tone,
      consent: { ...d.consent },
      dreams: d.dreams.map(({ name, price, image, kind }) => ({ name, price, image, kind })),
      tripwires: tripwireInputs(d),
      autonomy: d.autonomy,
      caps: { perActionCap: caps.perAction, dailyCap: caps.daily, monthlyCap: caps.monthly },
      pin,
      dataSource: source,
    },
  }
}
