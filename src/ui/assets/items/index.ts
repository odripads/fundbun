/**
 * Dream-item preset illustrations. `DreamItem.image` is either `preset:<key>` (one of these SVGs) or a
 * `data:` URL of a user photo. All 16 share one style: 120×120 viewBox, pastel blob backdrop, soy-ink outline.
 */

export const ITEM_KEYS = [
  'bag',
  'sneakers',
  'earbuds',
  'headphones',
  'plane',
  'laptop',
  'phone',
  'console',
  'camera',
  'watch',
  'ticket',
  'ring',
  'car',
  'home',
  'guitar',
  'gift',
] as const

export type ItemKey = (typeof ITEM_KEYS)[number]

export const FALLBACK_ITEM: ItemKey = 'gift'

const PRESET_PREFIX = 'preset:'

const urls = import.meta.glob<string>('./*.svg', { eager: true, query: '?url', import: 'default' })

export function isItemKey(key: string): key is ItemKey {
  return (ITEM_KEYS as readonly string[]).includes(key)
}

export function itemUrl(key: ItemKey): string {
  return urls[`./${key}.svg`]
}

/** Key named by a `preset:<key>` image string; unknown keys fall back to the gift so a card never renders empty. */
export function presetKey(image: string): ItemKey | undefined {
  if (!image.startsWith(PRESET_PREFIX)) return undefined
  const key = image.slice(PRESET_PREFIX.length).trim()
  return isItemKey(key) ? key : FALLBACK_ITEM
}

/** URL for a `preset:<key>` image, or undefined when the image is not a preset (e.g. a user photo). */
export function presetImageUrl(image: string): string | undefined {
  const key = presetKey(image)
  return key ? itemUrl(key) : undefined
}
