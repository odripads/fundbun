import { defaultMandate } from '../security/policy'
import type { Account, AppSettings, AppState, BankState, Currency, FinanceContext, ISODate, Mandate, Minor } from '../types'
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

/**
 * Validate + normalise persisted data. Returns null when the shape is not a FundBun v1 state.
 * Missing optional collections are filled with defaults so older saves keep loading.
 */
export function parseState(raw: unknown): AppState | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  const bank = raw.bank
  if (!isRecord(bank) || !Array.isArray(bank.accounts) || !Array.isArray(bank.transactions)) return null
  if (typeof bank.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bank.today)) return null
  if (!isRecord(raw.mandate) || !Array.isArray(raw.audit)) return null
  if (raw.profile !== null && !isRecord(raw.profile)) return null
  const base = emptyState(bank.today)
  const mandate = { ...base.mandate, ...(raw.mandate as Partial<Mandate>) }
  return {
    version: 1,
    profile: (raw.profile as AppState['profile']) ?? null,
    bank: { ...base.bank, ...(bank as Partial<BankState>) } as BankState,
    dreams: arr(raw.dreams),
    budget: isRecord(raw.budget) ? (raw.budget as unknown as AppState['budget']) : null,
    tripwires: arr(raw.tripwires),
    tripwireEvents: arr(raw.tripwireEvents),
    mandate: { ...mandate, disabledTools: arr(mandate.disabledTools) },
    pending: arr(raw.pending),
    chat: arr(raw.chat),
    audit: arr(raw.audit),
    categoryRules: rec(raw.categoryRules),
    billReminders: rec(raw.billReminders),
    plans: arr(raw.plans),
    dialogue: rec(raw.dialogue),
    settings: { ...base.settings, ...rec<Partial<AppSettings>>(raw.settings) },
  }
}
