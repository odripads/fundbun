import { CATEGORIES } from '../categories'
import { CURRENCY_SYMBOL } from '../money'
import { defaultMandate } from '../security/policy'
import type {
  Account,
  AppSettings,
  AppState,
  BankState,
  BudgetPlan,
  CategoryBudget,
  Consent,
  Currency,
  FinanceContext,
  ISODate,
  Mandate,
  Minor,
  Profile,
  Tone,
  TripwireKind,
} from '../types'
import { CHECKING_ID, DEFAULT_SEED } from './constants'
import { isRecord, safely } from './util'

/** Used only if security/policy.defaultMandate is unavailable: the most restrictive sane mandate. */
const LOCKED_DOWN_MANDATE: Mandate = {
  autonomy: 'observe',
  perActionCap: 50_000,
  dailyCap: 100_000,
  monthlyCap: 500_000,
  disabledTools: [],
  frozen: false,
  undoWindowSec: 30,
  maxActionsPerHour: 20,
  failedPinAttempts: 0,
}

export function safeDefaultMandate(): Mandate {
  return safely('defaultMandate', () => defaultMandate(), { ...LOCKED_DOWN_MANDATE, disabledTools: [] })
}

export function defaultSettings(): AppSettings {
  return { glassBox: true, llmEnabled: true, notificationsEnabled: false, reducedMotion: false, vault: false }
}

export function emptyBank(today: ISODate, seed = DEFAULT_SEED): BankState {
  return { accounts: [], transactions: [], payees: [], bills: [], disputes: [], cancelledMerchants: [], today, seed }
}

/** A bank with a single checking account (real-data onboarding: CSV or empty). */
export function freshBank(today: ISODate, currency: Currency, startingBalance: Minor): BankState {
  const checking: Account = { id: CHECKING_ID, name: 'Checking', type: 'checking', balance: startingBalance, currency }
  return { ...emptyBank(today), accounts: [checking] }
}

export function emptyState(today: ISODate): AppState {
  return {
    version: 1,
    profile: null,
    bank: emptyBank(today),
    dreams: [],
    budget: null,
    tripwires: [],
    tripwireEvents: [],
    mandate: safeDefaultMandate(),
    pending: [],
    chat: [],
    audit: [],
    categoryRules: {},
    billReminders: {},
    plans: [],
    dialogue: {},
    settings: defaultSettings(),
  }
}

export function ctxOf(state: AppState): FinanceContext | null {
  if (!state.profile) return null
  const { profile, bank, dreams, budget, tripwires } = state
  return { profile, bank, dreams, budget, tripwires }
}

export function checkingAccountId(bank: BankState): string {
  return bank.accounts.find((a) => a.type === 'checking')?.id ?? CHECKING_ID
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
const rec = <T>(x: unknown): T => (isRecord(x) ? (x as T) : ({} as T))
/** only the records of an array (anything else in a damaged save is dropped) */
const records = <T>(x: unknown, ok: (r: Record<string, unknown>) => boolean = () => true): T[] =>
  arr<unknown>(x).filter((r): r is Record<string, unknown> => isRecord(r) && ok(r)) as unknown as T[]
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isStr = (x: unknown): x is string => typeof x === 'string'

const TONES: readonly Tone[] = ['cheeky', 'gentle', 'numbers']
const TRIPWIRE_KINDS: readonly TripwireKind[] = ['month_pct', 'category_pct', 'single_over', 'daily_over', 'pace_over']
const DEFAULT_WORK_HOURS = 174

/**
 * The profile of a save, or null when it can't be one: consent, currency and the money targets are what every screen
 * and the policy engine read, so without them the save is treated as unreadable (never half-loaded). Cosmetic fields
 * get their defaults.
 */
function parseProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null
  const c = raw.consent
  if (!isRecord(c) || typeof c.financialData !== 'boolean') return null
  if (!isStr(raw.currency) || !(raw.currency in CURRENCY_SYMBOL)) return null
  if (!isNum(raw.targetSpend) || raw.targetSpend < 0 || !isNum(raw.monthlyIncome) || raw.monthlyIncome < 0) return null
  const consent: Consent = {
    financialData: c.financialData,
    llmProcessing: c.llmProcessing === true,
    notifications: c.notifications === true,
    grantedAt: isStr(c.grantedAt) ? c.grantedAt : '',
    version: isStr(c.version) ? c.version : '',
  }
  return {
    ...(raw as unknown as Profile),
    name: isStr(raw.name) ? raw.name : '',
    tone: TONES.includes(raw.tone as Tone) ? (raw.tone as Tone) : 'gentle',
    payday: isNum(raw.payday) && raw.payday >= 1 && raw.payday <= 28 ? raw.payday : 1,
    workHoursPerMonth: isNum(raw.workHoursPerMonth) && raw.workHoursPerMonth > 0 ? raw.workHoursPerMonth : DEFAULT_WORK_HOURS,
    consent,
  }
}

/** A budget the finance engine can read (categories with numeric limits), or null — a plan without them is dropped. */
function parseBudget(raw: unknown): BudgetPlan | null {
  if (!isRecord(raw) || !Array.isArray(raw.categories) || !isStr(raw.month)) return null
  const categories = records<CategoryBudget>(raw.categories, (c) => isStr(c.category) && c.category in CATEGORIES && isNum(c.limit) && c.limit >= 0)
  return { ...(raw as unknown as BudgetPlan), categories, total: isNum(raw.total) ? raw.total : categories.reduce((t, c) => t + c.limit, 0) }
}

/**
 * Validate + normalise persisted data. Returns null when the shape is not a FundBun v1 state — including a profile
 * without consent, currency or targets (it would crash boot and every screen). Missing optional collections are
 * filled with defaults so older saves keep loading; damaged entries inside collections (a budget without categories,
 * a tripwire of an unknown kind, a non-record pending action) are dropped rather than taking a whole screen down.
 */
export function parseState(raw: unknown): AppState | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  const bank = raw.bank
  if (!isRecord(bank) || !Array.isArray(bank.accounts) || !Array.isArray(bank.transactions)) return null
  if (typeof bank.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bank.today)) return null
  if (!isRecord(raw.mandate) || !Array.isArray(raw.audit)) return null
  if (raw.profile !== null && raw.profile !== undefined && !isRecord(raw.profile)) return null
  const profile = raw.profile ? parseProfile(raw.profile) : null
  if (raw.profile && !profile) return null
  const base = emptyState(bank.today)
  const mandate = { ...base.mandate, ...(raw.mandate as Partial<Mandate>) }
  const bankState: BankState = {
    ...base.bank,
    ...(bank as Partial<BankState>),
    accounts: records(bank.accounts, (a) => isStr(a.id) && isNum(a.balance)),
    transactions: records(bank.transactions, (t) => isStr(t.id) && isStr(t.date) && isNum(t.amount)),
    payees: records(bank.payees),
    bills: records(bank.bills, (b) => isStr(b.id) && isStr(b.dueDate) && isNum(b.amountDue)),
    disputes: records(bank.disputes),
    cancelledMerchants: arr<unknown>(bank.cancelledMerchants).filter(isStr),
    today: bank.today,
    seed: isNum(bank.seed) ? bank.seed : base.bank.seed,
  }
  return {
    version: 1,
    profile,
    bank: bankState,
    dreams: records(raw.dreams, (d) => isStr(d.id) && isStr(d.name) && isNum(d.price)),
    budget: parseBudget(raw.budget),
    tripwires: records(raw.tripwires, (t) => isStr(t.id) && TRIPWIRE_KINDS.includes(t.kind as TripwireKind) && isNum(t.threshold)),
    tripwireEvents: records(raw.tripwireEvents, (e) => isStr(e.id) && isStr(e.tripwireId)),
    mandate: { ...mandate, disabledTools: arr(mandate.disabledTools) },
    pending: records(raw.pending, (p) => isStr(p.id) && isStr(p.status) && isRecord(p.call) && isRecord(p.decision) && isRecord(p.preview)),
    chat: records(raw.chat),
    audit: arr(raw.audit),
    categoryRules: rec(raw.categoryRules),
    billReminders: rec(raw.billReminders),
    plans: records(raw.plans, (p) => Array.isArray(p.steps)),
    dialogue: rec(raw.dialogue),
    settings: { ...base.settings, ...rec<Partial<AppSettings>>(raw.settings) },
  }
}
