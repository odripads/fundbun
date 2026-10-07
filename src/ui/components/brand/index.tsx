/** FundBun brand components: the Bun mascot (with moods), the logo lockup and dream-item pictures. */
import { ITEM_KEYS } from '../../assets/items'

export { BunMascot, type BunMascotProps } from './BunMascot'
export { BRAND_NAME, Logo, type LogoProps } from './Logo'
export { DreamImage, type DreamImageProps } from './DreamImage'
export { dreamSource, isPhotoDataUrl, type DreamSource } from './dreamSource'
export { BUN_MOODS, DEFAULT_MOOD, MOODS, isBunMood, moodParts, type MoodParts } from './moods'
export { PALETTE as BRAND_PALETTE, SMALL_CUT_MAX, cutForSize, type Cut } from './geometry'
export { markSvg, type MarkOptions, type MarkVariant, type KeylineMode } from './markSvg'

export const PRESET_KEYS = ITEM_KEYS
export type PresetKey = (typeof PRESET_KEYS)[number]
