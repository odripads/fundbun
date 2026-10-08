import type { AppSettings, Autonomy, ISODate } from '../types'

export const STORAGE_KEY = 'fundbun.v1'
/** suffix of the storage key holding the audit head anchor (`fundbun.v1.audit-head`) */
export const AUDIT_HEAD_SUFFIX = '.audit-head'
/** sandbox "today" for the demo personas (CONTRACT §4) */
export const DEMO_TODAY: ISODate = '2026-10-22'
export const DEMO_PIN = '2580'
export const DEFAULT_SEED = 20261020
export { CONSENT_VERSION } from '../consent'
export const CHECKING_ID = 'chk_main'
/** fixed clock used by createTestApp() (tests, scenarios, evidence) */
export const TEST_NOW = '2026-10-22T10:00:00+08:00'
export const VAULT_PREFIX = 'fbv1:'
/** tripwire events kept in state (oldest dropped first) */
export const MAX_TRIPWIRE_EVENTS = 200

/** least → most autonomous; raising needs the PIN, lowering never does */
export const AUTONOMY_ORDER: readonly Autonomy[] = ['observe', 'suggest', 'copilot', 'autopilot']

export const DEMO_SETTINGS: AppSettings = {
  glassBox: true,
  llmEnabled: true,
  notificationsEnabled: false,
  reducedMotion: false,
  vault: false,
}

export const WARMING_UP = 'Bun is still warming up — chat isn\'t ready yet, but Home, bills and goals work as usual.'
export const STATIC_BUILD_REASON = 'Static build — on-device engine only'
