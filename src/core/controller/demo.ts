import { loadPersona, primeTripwires } from '../sandbox/personas'
import { createPin } from '../security/pin'
import type { AppState, ISODateTime } from '../types'
import { appendAudit } from './audit'
import { DEMO_PIN, DEMO_SETTINGS, DEMO_TODAY } from './constants'
import { welcomeMessage } from './messages'
import { emptyState, safeDefaultMandate } from './state'
import { errorMessage, safely } from './util'

/**
 * One-tap demo: a sandbox persona fully onboarded on the sandbox date, copilot autonomy, PIN 2580.
 * The demo starts a fresh audit chain (session_start → onboarding → consent). Tripwires are primed against the
 * persona's history (see primeTripwires), so Home opens with the latest alerts and nothing re-fires.
 */
export function buildDemoState(personaId: string, now: ISODateTime): AppState {
  let bundle
  try {
    bundle = loadPersona(personaId, DEMO_TODAY)
  } catch (e) {
    throw new Error(`Could not load demo persona "${personaId}": ${errorMessage(e)}`)
  }
  const { profile, bank, dreams, budget } = bundle
  // alerts that are already true at load are recorded now (the latest few unseen) instead of all firing on
  // the first purchase; a finance failure leaves the tripwires unprimed rather than failing the demo
  const primed = safely('primeTripwires', () => primeTripwires(bundle, now), { tripwires: bundle.tripwires, events: [] })
  const tripwires = primed.tripwires
  const state: AppState = {
    ...emptyState(bank.today),
    profile,
    bank,
    dreams,
    budget,
    tripwires,
    tripwireEvents: primed.events,
    mandate: { ...safeDefaultMandate(), autonomy: 'copilot', ...createPin(DEMO_PIN), failedPinAttempts: 0 },
    settings: { ...DEMO_SETTINGS },
    chat: [welcomeMessage(profile, now)],
  }
  appendAudit(state, now, 'system', 'session_start', `Demo session started (${profile.name})`, {
    personaId, sandboxToday: bank.today, seed: bank.seed,
  })
  appendAudit(state, now, 'user', 'onboarding', `Demo persona loaded: ${profile.name}`, {
    dataSource: 'persona', personaId, transactions: bank.transactions.length, dreams: dreams.length,
    tripwires: tripwires.length, tripwireEvents: primed.events.length, autonomy: 'copilot',
  })
  appendAudit(state, now, 'user', 'consent', 'Consent recorded', {
    financialData: profile.consent.financialData,
    llmProcessing: profile.consent.llmProcessing,
    notifications: profile.consent.notifications,
    version: profile.consent.version,
  })
  return state
}
