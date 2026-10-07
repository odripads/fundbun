/**
 * Bun's mood kit: swappable parts on one fixed silhouette and pocket.
 * happy — under budget · calm — on track · worried — pace warning · burnt — over budget · sleepy — no data yet
 */
import type { BunMood } from '../../../core/types'

export const BUN_MOODS = ['happy', 'calm', 'worried', 'burnt', 'sleepy'] as const satisfies readonly BunMood[]

export type EyeStyle = 'round' | 'sparkle' | 'dizzy' | 'closed'
export type MouthStyle = 'smile' | 'grin' | 'wobble' | 'omega' | 'snore'
/** what rises off the top: steam wisps, a smoke curl (burnt) or sleepy z's */
export type Vapour = 'steam' | 'smoke' | 'zzz'
export type Accessory = 'none' | 'sparkles' | 'sweat'
/** bright — glowing, the ¥ hops (saving) · glow — normal · dim — glow off, the ¥ dulled (overspent or no data) */
export type PocketState = 'bright' | 'glow' | 'dim'

export interface MoodParts {
  eyes: EyeStyle
  brows: boolean
  mouth: MouthStyle
  /** blush opacity, 0–1 */
  blush: number
  vapour: Vapour
  accessory: Accessory
  pocket: PocketState
  toasted: boolean
  blink: boolean
  /** seconds per breath (bob) */
  breath: number
  /** default accessible description */
  label: string
}

export const MOODS: Readonly<Record<BunMood, MoodParts>> = {
  happy: {
    eyes: 'sparkle',
    brows: false,
    mouth: 'grin',
    blush: 0.62,
    vapour: 'steam',
    accessory: 'sparkles',
    pocket: 'bright',
    toasted: false,
    blink: true,
    breath: 2.8,
    label: 'Bun is beaming — under budget',
  },
  calm: {
    eyes: 'round',
    brows: false,
    mouth: 'smile',
    blush: 0.45,
    vapour: 'steam',
    accessory: 'none',
    pocket: 'glow',
    toasted: false,
    blink: true,
    breath: 3.6,
    label: 'Bun is content — on track',
  },
  worried: {
    eyes: 'round',
    brows: true,
    mouth: 'wobble',
    blush: 0.3,
    vapour: 'steam',
    accessory: 'sweat',
    pocket: 'glow',
    toasted: false,
    blink: true,
    breath: 2.4,
    label: 'Bun looks worried — spending pace is high',
  },
  burnt: {
    eyes: 'dizzy',
    brows: false,
    mouth: 'omega',
    blush: 0.5,
    vapour: 'smoke',
    accessory: 'none',
    pocket: 'dim',
    toasted: true,
    blink: false,
    breath: 3.2,
    label: 'Bun got a little toasted — over budget',
  },
  sleepy: {
    eyes: 'closed',
    brows: false,
    mouth: 'snore',
    blush: 0.3,
    vapour: 'zzz',
    accessory: 'none',
    pocket: 'dim',
    toasted: false,
    blink: false,
    breath: 5.2,
    label: 'Bun is napping — no data yet',
  },
}

export const DEFAULT_MOOD: BunMood = 'calm'

export function isBunMood(value: unknown): value is BunMood {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOODS, value)
}

/** Parts for a mood; anything unrecognised (e.g. stale persisted data) falls back to calm rather than breaking the UI. */
export function moodParts(mood: unknown): MoodParts {
  return MOODS[isBunMood(mood) ? mood : DEFAULT_MOOD]
}
