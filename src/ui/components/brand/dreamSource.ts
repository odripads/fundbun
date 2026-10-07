/**
 * Resolves a DreamItem.image string to something an <img> can show. Only on-device sources are ever used:
 * a `preset:<key>` illustration or a `data:image/*` photo. Anything else (remote URLs, blob:, javascript:,
 * unknown presets) falls back to the gift, so a card never renders empty and never fetches from the network.
 */
import { FALLBACK_ITEM, itemUrl, presetKey, type ItemKey } from '../../assets/items'

export type DreamSource = { kind: 'photo'; src: string } | { kind: 'preset'; key: ItemKey; src: string }

const PHOTO = /^data:image\/(png|jpe?g|webp|gif|avif|bmp|heic|heif)[;,]/i

export function isPhotoDataUrl(image: string): boolean {
  return PHOTO.test(image)
}

export function dreamSource(image: unknown): DreamSource {
  if (typeof image === 'string') {
    const value = image.trim()
    if (isPhotoDataUrl(value)) return { kind: 'photo', src: value }
    const key = presetKey(value)
    if (key) return { kind: 'preset', key, src: itemUrl(key) }
  }
  return { kind: 'preset', key: FALLBACK_ITEM, src: itemUrl(FALLBACK_ITEM) }
}
