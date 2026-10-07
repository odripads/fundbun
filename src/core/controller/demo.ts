import { loadPersona } from '../sandbox/personas'
import { createPin } from '../security/pin'
import type { AppState, ISODateTime } from '../types'
import { appendAudit } from './audit'
import { DEMO_PIN, DEMO_SETTINGS, DEMO_TODAY } from './constants'
import { welcomeMessage } from './messages'
import { emptyState, safeDefaultMandate } from './state'
import { errorMessage } from './util'

/**
 * One-tap demo: a sandbox persona fully onboarded on the sandbox date, copilot autonomy, PIN 2580.
 * The demo starts a fresh audit chain (session_start → onboarding → consent).
 */
export function buildDemoState(personaId: string, now: ISODateTime): AppState {
  let bundle
  try {
    bundle = loadPersona(personaId, DEMO_TODAY)
  } catch (e) {
    throw new Error(`Could not load demo persona "${personaId}": ${errorMessage(e)}`)
  }
  const { profile, bank, dreams, budget, tripwires } = bundle
  const state: AppState = {
    ...emptyState(bank.today),
    profile,
    bank,
    dreams,
    budget,
    tripwires,
    mandate: { ...safeDefaultMandate(), autonomy: 'copilot', ...createPin(DEMO_PIN), failedPinAttempts: 0 },
    settings: { ...DEMO_SETTINGS },
    chat: [welcomeMessage(profile, now)],
  }
  appendAudit(state, now, 'system', 'session_start', `Demo session started (${profile.name})`, {
    personaId, sandboxToday: bank.today, seed: bank.seed,
  })
  appendAudit(state, now, 'user', 'onboarding', `Demo persona loaded: ${profile.name}`, {
    dataSource: 'persona', personaId, transactions: bank.transactions.length, dreams: dreams.length,
    tripwires: tripwires.length, autonomy: 'copilot',
  })
  appendAudit(state, now, 'user', 'consent', 'Consent recorded', {
    financialData: profile.consent.financialData,
    llmProcessing: profile.consent.llmProcessing,
    notifications: profile.consent.notifications,
    version: profile.consent.version,
  })
  return state
}
