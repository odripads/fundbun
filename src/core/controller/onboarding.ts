import type { DataSource, OnboardingInput } from '../app-api'
import { CURRENCY_SYMBOL } from '../money'
import { diffDays, ym } from '../dates'
import { defaultTripwires, proposeBudget } from '../finance'
import { SandboxBank } from '../sandbox/bank'
import { importCsv } from '../sandbox/csv'
import { loadPersona } from '../sandbox/personas'
import { createPin } from '../security/pin'
import type {
  AppState,
  BankState,
  BudgetPlan,
  DreamItem,
  FinanceContext,
  ISODate,
  ISODateTime,
  Mandate,
  Profile,
  Tone,
  Tripwire,
} from '../types'
import { appendAudit } from './audit'
import { AUTONOMY_ORDER, CHECKING_ID, CONSENT_VERSION, DEMO_TODAY } from './constants'
import { makeDream, dreamInputError } from './dreams'
import { welcomeMessage } from './messages'
import { pinFormatOk } from './safety'
import { defaultSettings, emptyState, freshBank, safeDefaultMandate } from './state'
import { buildTripwire, tripwireInputError } from './tripwires'
import { errorMessage, isIntIn, isNonEmptyString, isNonNegInt, isPosInt, isRecord, safely } from './util'

const TONES: readonly Tone[] = ['cheeky', 'gentle', 'numbers']
const DEFAULT_WORK_HOURS = 174

/** All problems with an onboarding input (empty when valid). Consent is checked first: nothing is pre-ticked. */
export function validateOnboarding(input: OnboardingInput): string[] {
  if (!isRecord(input)) return ['Missing onboarding details']
  const errors: string[] = []
  if (input.consent?.financialData !== true) errors.push('Consent to process your financial data is required to continue')
  if (!isNonEmptyString(input.name)) errors.push('Please tell us your name')
  if (!(input.currency in CURRENCY_SYMBOL)) errors.push(`Unsupported currency "${String(input.currency)}"`)
  if (!isPosInt(input.monthlyIncome)) errors.push('Monthly income must be a positive whole amount')
  if (!isPosInt(input.targetSpend)) errors.push('Your monthly spending target must be a positive whole amount')
  if (!isIntIn(input.payday, 1, 28)) errors.push('Payday must be a day between 1 and 28')
  if (input.workHoursPerMonth !== undefined && !isIntIn(input.workHoursPerMonth, 1, 744)) errors.push('Work hours per month must be 1–744')
  if (!TONES.includes(input.tone)) errors.push(`Unknown tone "${String(input.tone)}"`)
  if (!AUTONOMY_ORDER.includes(input.autonomy)) errors.push(`Unknown autonomy level "${String(input.autonomy)}"`)
  if (!pinFormatOk(input.pin)) errors.push('PIN must be 4–6 digits and not easy to guess (no 1111 or 1234)')
  for (const [k, v] of Object.entries(input.caps ?? {})) if (v !== undefined && !isPosInt(v)) errors.push(`${k} must be a positive whole amount`)
  errors.push(...dreamErrors(input.dreams))
  for (const t of input.tripwires ?? []) {
    const err = tripwireInputError(t)
    if (err) errors.push(err)
  }
  const ds = dataSourceError(input.dataSource)
  if (ds) errors.push(ds)
  return errors
}

function dreamErrors(dreams: OnboardingInput['dreams']): string[] {
  if (!Array.isArray(dreams) || dreams.length === 0) return ['Add at least one dream item']
  return dreams.map((d) => dreamInputError(d)).filter((e): e is string => e !== null)
}

function dataSourceError(ds: DataSource | undefined): string | null {
  if (!isRecord(ds)) return 'Choose where your data comes from'
  switch (ds.kind) {
    case 'persona': return isNonEmptyString(ds.personaId) ? null : 'Choose a sandbox persona'
    case 'csv':
      if (!isNonEmptyString(ds.text)) return 'The CSV file is empty'
      return isNonNegInt(ds.startingBalance) ? null : 'Starting balance must be a whole amount of 0 or more'
    case 'empty': return isNonNegInt(ds.startingBalance) ? null : 'Starting balance must be a whole amount of 0 or more'
    default: return 'Unknown data source'
  }
}

/** The bank behind a data source. Throws with a user-readable message when the source cannot be used. */
export function bankFor(input: OnboardingInput, realToday: ISODate): BankState {
  const ds = input.dataSource
  if (ds.kind === 'persona') {
    try {
      return loadPersona(ds.personaId, DEMO_TODAY).bank
    } catch (e) {
      throw new Error(`Sandbox persona "${ds.personaId}" is not available (${errorMessage(e)})`)
    }
  }
  const bank = freshBank(realToday, input.currency, ds.startingBalance)
  if (ds.kind === 'empty') return bank
  const parsed = importCsv(ds.text, { accountId: CHECKING_ID, currency: input.currency })
  if (!parsed.transactions.length) {
    const why = parsed.errors.length ? `: ${parsed.errors.slice(0, 3).join('; ')}` : ''
    throw new Error(`No transactions could be read from that CSV${why}`)
  }
  const txns = [...parsed.transactions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { ...bank, transactions: txns }
}

function buildProfile(input: OnboardingInput, now: ISODateTime): Profile {
  const profile: Profile = {
    name: input.name.trim(),
    currency: input.currency,
    monthlyIncome: input.monthlyIncome,
    targetSpend: input.targetSpend,
    payday: input.payday,
    workHoursPerMonth: input.workHoursPerMonth ?? DEFAULT_WORK_HOURS,
    tone: input.tone,
    consent: {
      financialData: true,
      llmProcessing: input.consent.llmProcessing === true,
      notifications: input.consent.notifications === true,
      grantedAt: now,
      version: CONSENT_VERSION,
    },
    onboardedAt: now,
  }
  if (input.dataSource.kind === 'persona') profile.personaId = input.dataSource.personaId
  return profile
}

function buildDreams(input: OnboardingInput, bankState: BankState): DreamItem[] {
  const bank = new SandboxBank(bankState)
  const out: DreamItem[] = []
  for (const d of input.dreams) out.push(makeDream(d, bank, out.map((x) => x.id), bankState.today))
  return out
}

/** history-based budget when there are >= 30 days of transactions, otherwise 50/30/20. */
function buildBudget(ctx: FinanceContext): BudgetPlan | null {
  const first = ctx.bank.transactions[0]?.date
  const method: BudgetPlan['method'] = first && diffDays(first, ctx.bank.today) >= 30 ? 'history' : 'fifty_thirty_twenty'
  return safely('proposeBudget', () => proposeBudget(ctx, method, ym(ctx.bank.today)), null)
}

function buildMandate(input: OnboardingInput): Mandate {
  const caps = Object.fromEntries(Object.entries(input.caps ?? {}).filter(([, v]) => v !== undefined))
  return { ...safeDefaultMandate(), ...caps, autonomy: input.autonomy, ...createPin(input.pin), failedPinAttempts: 0 }
}

/**
 * Build the onboarded state. Keeps the existing audit chain (append-only) and appends 'onboarding' + 'consent'.
 * Throws with a readable message when the data source cannot be used.
 */
export function buildOnboardedState(input: OnboardingInput, prev: AppState, now: ISODateTime, realToday: ISODate): AppState {
  const bank = bankFor(input, realToday)
  const profile = buildProfile(input, now)
  const dreams = buildDreams(input, bank)
  const base: FinanceContext = { profile, bank, dreams, budget: null, tripwires: [] }
  const tripwires: Tripwire[] = input.tripwires
    ? input.tripwires.map((t) => buildTripwire(t, profile.currency, 'user'))
    : safely('defaultTripwires', () => defaultTripwires(profile), [])
  const budget = buildBudget({ ...base, tripwires })
  const state: AppState = {
    ...emptyState(bank.today),
    profile,
    bank,
    dreams,
    budget,
    tripwires,
    mandate: buildMandate(input),
    audit: [...prev.audit],
    chat: [welcomeMessage(profile, now)],
    settings: { ...defaultSettings(), notificationsEnabled: profile.consent.notifications },
  }
  appendAudit(state, now, 'user', 'onboarding', 'Onboarding completed', {
    dataSource: input.dataSource.kind,
    personaId: profile.personaId,
    transactions: bank.transactions.length,
    dreams: dreams.length,
    tripwires: tripwires.length,
    budgetMethod: budget?.method ?? null,
    autonomy: input.autonomy,
  })
  appendAudit(state, now, 'user', 'consent', 'Consent recorded', {
    financialData: true,
    llmProcessing: profile.consent.llmProcessing,
    notifications: profile.consent.notifications,
    version: CONSENT_VERSION,
  })
  return state
}
