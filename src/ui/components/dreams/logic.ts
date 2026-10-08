/**
 * Pure helpers for the dream editor: preset labels, suggestion chips, a keyword → preset guess, price parsing
 * and form validation, plus the photo-resize geometry. No DOM, no React — unit-tested in logic.test.ts.
 */
import type { DreamInput } from '../../../core/app-api'
import { fmt, MINOR_PER_MAJOR, parseAmount } from '../../../core/money'
import type { Currency, DreamKind } from '../../../core/types'
import { ITEM_KEYS, type ItemKey } from '../../assets/items'

/** Screen-reader / tooltip names for the 16 preset illustrations. */
export const PRESET_LABELS: Record<ItemKey, string> = {
  bag: 'Bag',
  sneakers: 'Sneakers',
  earbuds: 'Earbuds',
  headphones: 'Headphones',
  plane: 'Trip',
  laptop: 'Laptop',
  phone: 'Phone',
  console: 'Game console',
  camera: 'Camera',
  watch: 'Watch',
  ticket: 'Ticket',
  ring: 'Ring',
  car: 'Car',
  home: 'Home',
  guitar: 'Guitar',
  gift: 'Gift',
}

export const PRESETS: readonly ItemKey[] = ITEM_KEYS

export const presetImage = (key: ItemKey): string => `preset:${key}`

export interface DreamSuggestion {
  name: string
  preset: ItemKey
  kind: DreamKind
}

/** One-tap starters. They prefill the name, picture and kind — the price is always the user's own. */
export const DREAM_SUGGESTIONS: readonly DreamSuggestion[] = [
  { name: 'Birkin', preset: 'bag', kind: 'goal' },
  { name: 'New sneakers', preset: 'sneakers', kind: 'treat' },
  { name: 'Weekend trip', preset: 'plane', kind: 'goal' },
  { name: 'Laptop', preset: 'laptop', kind: 'goal' },
]

export const KIND_COPY: Record<DreamKind, { label: string; hint: string }> = {
  goal: { label: 'Goal', hint: 'Saving toward it' },
  treat: { label: 'Treat', hint: 'A guilt-free reward' },
}

/**
 * Keyword → preset, checked in order (order matters: "flight home" is a trip, "headphones" is not a phone,
 * "AirPods" are earbuds). Latin keywords use word starts so "string" never reads as a ring.
 */
const GUESSES: readonly [ItemKey, RegExp][] = [
  ['plane', /\b(flight|fly|trip|travel|holiday|vacation|weekend|getaway|journey)|旅|机票/i],
  ['earbuds', /\b(airpods|earbuds?|buds)|耳塞/i],
  ['headphones', /\b(headphones?|headset|beats|sony wh)|耳机/i],
  ['laptop', /\b(laptop|macbook|notebook|thinkpad|computer|pc)\b|电脑/i],
  ['phone', /\b(i?phone|pixel|galaxy|huawei|xiaomi)|手机/i],
  ['console', /\b(console|switch|playstation|ps5|xbox|steam deck)|游戏机/i],
  ['camera', /\b(camera|fujifilm|leica|gopro|lens)|相机/i],
  ['watch', /\b(watch|rolex|omega|smartwatch)|手表/i],
  ['ticket', /\b(ticket|concert|gig|festival|show|match)|演唱会|门票/i],
  ['ring', /\b(ring|engagement|wedding)\b|戒指/i],
  ['car', /\b(car|tesla|scooter|motorbike|bike|bicycle)\b|汽车|电动车/i],
  ['home', /\b(home|house|flat|apartment|deposit|rent|sofa)\b|房/i],
  ['guitar', /\b(guitar|piano|ukulele|violin|keyboard|instrument)|吉他|钢琴/i],
  ['sneakers', /\b(sneakers?|shoes?|trainers?|nike|adidas|jordans?|boots?)|鞋/i],
  ['bag', /\b(bag|birkin|kelly|handbag|purse|tote|backpack|lv)\b|包/i],
  ['gift', /\b(gift|present|birthday)|礼物/i],
]

/** Best preset for a typed name, or undefined when nothing matches. */
export function guessPreset(name: string): ItemKey | undefined {
  const n = name.trim()
  if (!n) return undefined
  return GUESSES.find(([, re]) => re.test(n))?.[0]
}

/** The biggest price a dream may have, in major units (anything above is almost certainly a typo). */
export const MAX_PRICE_MAJOR = 99_999_999

export type PriceResult = { ok: true; minor: number } | { ok: false; error: string }

/** Parse a typed price ("2,400", "2.4k", "1.2万") into whole minor units. */
export function parsePrice(text: string, currency: Currency): PriceResult {
  const t = text.trim()
  if (!t) return { ok: false, error: 'Add a price, like 2,400' }
  if (t.startsWith('-') || t.startsWith('−')) return { ok: false, error: 'A price can’t be negative' }
  const minor = parseAmount(t, currency)
  if (minor === null || !Number.isFinite(minor)) return { ok: false, error: 'Enter a number, like 2,400' }
  if (minor <= 0) return { ok: false, error: 'A dream needs a price above zero' }
  if (minor > MAX_PRICE_MAJOR * MINOR_PER_MAJOR[currency]) return { ok: false, error: `Keep it under ${fmt(MAX_PRICE_MAJOR * MINOR_PER_MAJOR[currency], currency)}` }
  return { ok: true, minor: Math.round(minor) }
}

/** A price in minor units back to an editable string ("2400", "12.5"). */
export function priceText(minor: number | undefined, currency: Currency): string {
  if (!minor || minor <= 0) return ''
  const major = minor / MINOR_PER_MAJOR[currency]
  return Number.isInteger(major) ? String(major) : major.toFixed(2)
}

export interface DreamFormValues {
  name: string
  price: string
  kind: DreamKind
  image: string
}

export interface DreamFormErrors {
  name?: string
  price?: string
}

export const MAX_NAME = 80

export type DreamFormResult = { ok: true; input: DreamInput } | { ok: false; errors: DreamFormErrors }

/** Validate the editor; on success returns the DreamInput the controller expects. */
export function validateDreamForm(v: DreamFormValues, currency: Currency): DreamFormResult {
  const errors: DreamFormErrors = {}
  const name = v.name.trim().replace(/\s+/g, ' ')
  if (!name) errors.name = 'Give it a name, like “Weekend in Chengdu”'
  else if (name.length > MAX_NAME) errors.name = `Keep the name under ${MAX_NAME} characters`
  const price = parsePrice(v.price, currency)
  if (!price.ok) errors.price = price.error
  if (errors.name || errors.price || !price.ok) return { ok: false, errors }
  return { ok: true, input: { name, price: price.minor, kind: v.kind, image: v.image || presetImage('gift') } }
}

/** Scale (w, h) down to fit inside a max × max box, keeping the aspect ratio. Never upscales. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
