/**
 * The onboarding draft: everything the user has entered so far, kept in sessionStorage so a reload or an
 * accidental back-swipe doesn't lose it. The PIN is deliberately NOT part of the draft — it lives in memory only
 * and is re-entered after a reload. Every storage call is wrapped: private mode or blocked storage just means
 * no persistence, never a crash.
 */
import type { DreamInput } from '../../../core/app-api'
import { CURRENCY_SYMBOL } from '../../../core/money'
import type { Autonomy, Currency, Tone } from '../../../core/types'

export const STEPS = ['welcome', 'consent', 'money', 'dreams', 'tripwires', 'permissions', 'data', 'done'] as const
export type StepId = (typeof STEPS)[number]

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEPS as readonly string[]).includes(value)
}

export type TripwireKey = 'month80' | 'month100' | 'single' | 'pace'

export interface TripwireDraft {
  key: TripwireKey
  enabled: boolean
  /** null → the default for the current target (so changing the target keeps it sensible) */
  threshold: number | null
}

export interface DreamDraft extends DreamInput {
  /** local list key */
  key: string
}

export type DataKind = 'persona' | 'csv' | 'empty'
export type PersonaId = 'mei' | 'arif'

export interface OnboardingDraft {
  v: 1
  consent: { financialData: boolean; llmProcessing: boolean; notifications: boolean }
  name: string
  currency: Currency
  /** money fields hold what the user typed (major units); parsed at validation time */
  income: string
  target: string
  payday: number
  dreams: DreamDraft[]
  tripwires: TripwireDraft[]
  tone: Tone
  autonomy: Autonomy
  caps: { perAction: string; daily: string; monthly: string }
  data: { kind: DataKind | null; personaId: PersonaId | null; csvName: string; csvText: string; balance: string }
}

export const TRIPWIRE_KEYS: readonly TripwireKey[] = ['month80', 'month100', 'single', 'pace']
const TONES: readonly Tone[] = ['gentle', 'cheeky', 'numbers']
const AUTONOMIES: readonly Autonomy[] = ['observe', 'suggest', 'copilot', 'autopilot']
const DATA_KINDS: readonly DataKind[] = ['persona', 'csv', 'empty']
const PERSONA_IDS: readonly PersonaId[] = ['mei', 'arif']

/** Nothing pre-ticked, gentle tone, low autonomy (Suggest), the contract's default caps. */
export function emptyDraft(): OnboardingDraft {
  return {
    v: 1,
    consent: { financialData: false, llmProcessing: false, notifications: false },
    name: '',
    currency: 'CNY',
    income: '',
    target: '',
    payday: 10,
    dreams: [],
    tripwires: TRIPWIRE_KEYS.map((key) => ({ key, enabled: true, threshold: null })),
    tone: 'gentle',
    autonomy: 'suggest',
    caps: { perAction: '500', daily: '1,000', monthly: '5,000' },
    data: { kind: null, personaId: null, csvName: '', csvText: '', balance: '' },
  }
}

// ───────────────────────────── sanitising (storage is untrusted) ─────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback: string, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : fallback)
const bool = (v: unknown): boolean => v === true
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback)

function sanitizeDream(v: unknown, i: number): DreamDraft | null {
  if (!isRecord(v)) return null
  const price = v.price
  if (typeof v.name !== 'string' || !v.name.trim() || typeof price !== 'number' || !Number.isInteger(price) || price <= 0) return null
  const image = typeof v.image === 'string' && (v.image.startsWith('preset:') || v.image.startsWith('data:image/')) ? v.image : 'preset:gift'
  return {
    key: str(v.key, `d${i}`, 40),
    name: v.name.slice(0, 80),
    price,
    image,
    kind: v.kind === 'treat' ? 'treat' : 'goal',
  }
}

function sanitizeTripwires(v: unknown): TripwireDraft[] {
  const saved = Array.isArray(v) ? v.filter(isRecord) : []
  return TRIPWIRE_KEYS.map((key) => {
    const t = saved.find((x) => x.key === key)
    const threshold = t && typeof t.threshold === 'number' && Number.isInteger(t.threshold) && t.threshold > 0 ? t.threshold : null
    return { key, enabled: t ? t.enabled !== false : true, threshold }
  })
}

/** Rebuild a draft from anything (old versions, tampered storage): unknown fields drop to their defaults. */
export function sanitizeDraft(raw: unknown): OnboardingDraft {
  const base = emptyDraft()
  if (!isRecord(raw) || raw.v !== 1) return base
  const consent = isRecord(raw.consent) ? raw.consent : {}
  const caps = isRecord(raw.caps) ? raw.caps : {}
  const data = isRecord(raw.data) ? raw.data : {}
  const payday = typeof raw.payday === 'number' && Number.isInteger(raw.payday) && raw.payday >= 1 && raw.payday <= 28 ? raw.payday : base.payday
  return {
    v: 1,
    consent: { financialData: bool(consent.financialData), llmProcessing: bool(consent.llmProcessing), notifications: bool(consent.notifications) },
    name: str(raw.name, '', 60),
    currency: typeof raw.currency === 'string' && raw.currency in CURRENCY_SYMBOL ? (raw.currency as Currency) : base.currency,
    income: str(raw.income, '', 24),
    target: str(raw.target, '', 24),
    payday,
    dreams: (Array.isArray(raw.dreams) ? raw.dreams : []).map(sanitizeDream).filter((d): d is DreamDraft => d !== null).slice(0, 24),
    tripwires: sanitizeTripwires(raw.tripwires),
    tone: oneOf(raw.tone, TONES, base.tone),
    autonomy: oneOf(raw.autonomy, AUTONOMIES, base.autonomy),
    caps: { perAction: str(caps.perAction, base.caps.perAction, 24), daily: str(caps.daily, base.caps.daily, 24), monthly: str(caps.monthly, base.caps.monthly, 24) },
    data: {
      kind: DATA_KINDS.includes(data.kind as DataKind) ? (data.kind as DataKind) : null,
      personaId: PERSONA_IDS.includes(data.personaId as PersonaId) ? (data.personaId as PersonaId) : null,
      csvName: str(data.csvName, '', 120),
      csvText: str(data.csvText, '', MAX_CSV_CHARS),
      balance: str(data.balance, '', 24),
    },
  }
}

/** True once the user has entered anything worth resuming. */
export function hasProgress(d: OnboardingDraft): boolean {
  return d.consent.financialData || d.name.trim() !== '' || d.dreams.length > 0 || d.income.trim() !== ''
}

// ───────────────────────────── storage ─────────────────────────────

export const DRAFT_KEY = 'fundbun.onboarding.v1'
/** CSV text above this is not persisted (sessionStorage is ~5 MB); the user re-picks the file after a reload */
export const MAX_CSV_CHARS = 1_000_000

export function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function loadDraft(store: Storage | null = sessionStore()): OnboardingDraft {
  try {
    const raw = store?.getItem(DRAFT_KEY)
    return raw ? sanitizeDraft(JSON.parse(raw)) : emptyDraft()
  } catch {
    return emptyDraft()
  }
}

/** Persist the draft; photos or a big CSV that overflow the quota are dropped before giving up. */
export function saveDraft(d: OnboardingDraft, store: Storage | null = sessionStore()): boolean {
  if (!store) return false
  const lean = d.data.csvText.length > MAX_CSV_CHARS ? { ...d, data: { ...d.data, csvText: '', csvName: '' } } : d
  const attempts = [lean, { ...lean, data: { ...lean.data, csvText: '', csvName: '' } }, { ...lean, data: { ...lean.data, csvText: '', csvName: '' }, dreams: lean.dreams.map((x) => (x.image.startsWith('data:') ? { ...x, image: 'preset:gift' } : x)) }]
  for (const attempt of attempts) {
    try {
      store.setItem(DRAFT_KEY, JSON.stringify(attempt))
      return true
    } catch {
      // quota exceeded or storage blocked — try a leaner copy
    }
  }
  return false
}

export function clearDraft(store: Storage | null = sessionStore()): void {
  try {
    store?.removeItem(DRAFT_KEY)
  } catch {
    // nothing to clear
  }
}
