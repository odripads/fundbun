/**
 * Bun's mood kit: swappable parts on one fixed silhouette and pocket.
 * The ladder (core/finance/temper): happy — under budget · calm — on track · worried — heading over ·
 * angry — over budget (flushed, glaring) · furious — way over (bright red, shouting, shaking).
 * Also: sleepy — no data yet · burnt — an older "over budget" face, kept so saved cards still draw.
 */
import type { BunMood } from '../../../core/types'

export const BUN_MOODS = ['happy', 'calm', 'worried', 'angry', 'furious', 'burnt', 'sleepy'] as const satisfies readonly BunMood[]

export type EyeStyle = 'round' | 'sparkle' | 'dizzy' | 'closed' | 'glare'
export type MouthStyle = 'smile' | 'grin' | 'wobble' | 'omega' | 'snore' | 'frown' | 'shout'
/** worried — inner ends raised · angry — inner ends pulled down over the eyes */
export type BrowStyle = 'none' | 'worried' | 'angry'
/** what rises off the top: steam wisps, a smoke curl (burnt), sleepy z's, or hot fumes (angry) */
export type Vapour = 'steam' | 'smoke' | 'zzz' | 'fume'
/** vein — the comic-book anger mark */
export type Accessory = 'none' | 'sparkles' | 'sweat' | 'vein'
/** how red the dough runs: 0 none · 1 flushed (angry) · 2 bright red (furious) */
export type Flush = 0 | 1 | 2
/** bright — glowing, the ¥ hops (saving) · glow — normal · dim — glow off, the ¥ dulled (overspent or no data) */
export type PocketState = 'bright' | 'glow' | 'dim'

export interface MoodParts {
  eyes: EyeStyle
  brows: BrowStyle
  mouth: MouthStyle
  /** blush opacity, 0–1 */
  blush: number
  vapour: Vapour
  accessory: Accessory
  pocket: PocketState
  toasted: boolean
  flush: Flush
  /** a fast tremble on top of the bob */
  shake: boolean
  blink: boolean
  /** seconds per breath (bob) */
  breath: number
  /** default accessible description */
  label: string
}

export const MOODS: Readonly<Record<BunMood, MoodParts>> = {
  happy: {
    eyes: 'sparkle',
    brows: 'none',
    mouth: 'grin',
    blush: 0.62,
    vapour: 'steam',
    accessory: 'sparkles',
    pocket: 'bright',
    toasted: false,
    flush: 0,
    shake: false,
    blink: true,
    breath: 2.8,
    label: 'Bun is beaming — on target, with money left over',
  },
  calm: {
    eyes: 'round',
    brows: 'none',
    mouth: 'smile',
    blush: 0.45,
    vapour: 'steam',
    accessory: 'none',
    pocket: 'glow',
    toasted: false,
    flush: 0,
    shake: false,
    blink: true,
    breath: 3.6,
    label: 'Bun is content — on track',
  },
  worried: {
    eyes: 'round',
    brows: 'worried',
    mouth: 'wobble',
    blush: 0.3,
    vapour: 'steam',
    accessory: 'sweat',
    pocket: 'glow',
    toasted: false,
    flush: 0,
    shake: false,
    blink: true,
    breath: 2.4,
    label: 'Bun looks worried — spending pace is high',
  },
  angry: {
    eyes: 'glare',
    brows: 'angry',
    mouth: 'frown',
    blush: 0.7,
    vapour: 'fume',
    accessory: 'none',
    pocket: 'dim',
    toasted: false,
    flush: 1,
    shake: false,
    blink: false,
    breath: 1.9,
    label: 'Bun is cross — over budget',
  },
  furious: {
    eyes: 'glare',
    brows: 'angry',
    mouth: 'shout',
    blush: 0,
    vapour: 'fume',
    accessory: 'vein',
    pocket: 'dim',
    toasted: false,
    flush: 2,
    shake: true,
    blink: false,
    breath: 1.2,
    label: 'Bun is furious — way over budget',
  },
  burnt: {
    eyes: 'dizzy',
    brows: 'none',
    mouth: 'omega',
    blush: 0.5,
    vapour: 'smoke',
    accessory: 'none',
    pocket: 'dim',
    toasted: true,
    flush: 0,
    shake: false,
    blink: false,
    breath: 3.2,
    label: 'Bun got a little toasted — over budget',
  },
  sleepy: {
    eyes: 'closed',
    brows: 'none',
    mouth: 'snore',
    blush: 0.3,
    vapour: 'zzz',
    accessory: 'none',
    pocket: 'dim',
    toasted: false,
    flush: 0,
    shake: false,
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
