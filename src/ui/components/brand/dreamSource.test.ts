import { describe, expect, it } from 'vitest'
import { ITEM_KEYS, itemUrl } from '../../assets/items'
import { dreamSource, isPhotoDataUrl } from './dreamSource'

const gift = { kind: 'preset', key: 'gift', src: itemUrl('gift') }

describe('dreamSource', () => {
  it('maps every preset key to its illustration', () => {
    for (const key of ITEM_KEYS) expect(dreamSource(`preset:${key}`)).toEqual({ kind: 'preset', key, src: itemUrl(key) })
  })

  it('tolerates surrounding whitespace', () => {
    expect(dreamSource('  preset:bag ')).toMatchObject({ kind: 'preset', key: 'bag' })
  })

  it('shows on-device photo data URLs as they are', () => {
    for (const src of ['data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,/9j/4AAQ', 'data:image/webp;base64,UklGR', 'data:IMAGE/JPG;base64,abc']) {
      expect(dreamSource(src)).toEqual({ kind: 'photo', src })
    }
  })

  it('falls back to the gift for unknown presets', () => {
    for (const image of ['preset:', 'preset:yacht', 'preset:../../etc/passwd', 'preset:__proto__']) expect(dreamSource(image)).toEqual(gift)
  })

  it('never loads remote, script or non-image sources', () => {
    for (const image of [
      'https://example.com/birkin.jpg',
      'http://127.0.0.1/x.png',
      '//cdn.example.com/x.png',
      'javascript:alert(1)',
      'blob:https://example.com/123',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml,<svg onload="alert(1)"/>',
      'file:///etc/passwd',
      '',
      'bag',
    ]) {
      expect(dreamSource(image), image).toEqual(gift)
    }
  })

  it('survives non-string input from untyped persisted data', () => {
    for (const image of [undefined, null, 42, {}, ['preset:bag']]) expect(dreamSource(image)).toEqual(gift)
  })
})

describe('isPhotoDataUrl', () => {
  it('accepts raster image data URLs only', () => {
    expect(isPhotoDataUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isPhotoDataUrl('data:image/heic;base64,AAAA')).toBe(true)
    expect(isPhotoDataUrl('data:image/svg+xml;base64,AAAA')).toBe(false)
    expect(isPhotoDataUrl('data:image/pngx;base64,AAAA')).toBe(false)
    expect(isPhotoDataUrl(' data:image/png;base64,AAAA')).toBe(false)
  })
})
