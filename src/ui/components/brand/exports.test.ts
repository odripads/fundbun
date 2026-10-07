import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const PNG_SIGNATURE = '89504e470d0a1a0a'

interface PngInfo {
  width: number
  height: number
  alpha: boolean
}

function png(path: string): PngInfo {
  const buf = readFileSync(join(ROOT, path))
  expect(buf.subarray(0, 8).toString('hex'), `${path} is not a PNG`).toBe(PNG_SIGNATURE)
  const colourType = buf[25]
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 }
}

/** path → [width, height, has alpha] */
const EXPORTS: Record<string, [number, number, boolean]> = {
  'public/icon-192.png': [192, 192, false],
  'public/icon-512.png': [512, 512, false],
  'public/apple-touch-icon.png': [180, 180, false],
  'public/og-image.png': [1200, 630, false],
  'docs/assets/brand/fundbun-logo-1024.png': [1024, 1024, true],
  'docs/assets/brand/fundbun-logo-512.png': [512, 512, true],
  'docs/assets/brand/fundbun-logo-256.png': [256, 256, true],
  'docs/assets/brand/fundbun-logo-1024-cream.png': [1024, 1024, false],
  'docs/assets/brand/fundbun-logo-512-cream.png': [512, 512, false],
  'docs/assets/brand/fundbun-logo-256-cream.png': [256, 256, false],
  'docs/assets/brand/fundbun-logo-dark-512.png': [512, 512, true],
  'docs/assets/brand/fundbun-logo-mono-512.png': [512, 512, true],
  'docs/assets/brand/fundbun-mark-sm-16.png': [16, 16, true],
  'docs/assets/brand/fundbun-mark-sm-32.png': [32, 32, true],
  'docs/assets/brand/fundbun-mark-sm-48.png': [48, 48, true],
  'docs/assets/brand/fundbun-mark-sm-180.png': [180, 180, true],
  'docs/assets/brand/fundbun-mark-sm-192.png': [192, 192, true],
  'docs/assets/brand/fundbun-mark-sm-512.png': [512, 512, true],
  'docs/assets/brand/fundbun-app-icon-1024.png': [1024, 1024, false],
}

describe('raster brand exports', () => {
  it.each(Object.entries(EXPORTS))('%s has the right size and background', (path, [width, height, alpha]) => {
    expect(png(path)).toEqual({ width, height, alpha })
  })

  it('ships the wordmark lockups (transparent, wide) and a full-page brand sheet', () => {
    for (const path of ['docs/assets/brand/fundbun-wordmark.png', 'docs/assets/brand/fundbun-wordmark-dark.png']) {
      const info = png(path)
      expect(info.alpha).toBe(true)
      expect(info.width / info.height).toBeGreaterThan(3)
    }
    const sheet = png('docs/assets/brand/fundbun-brand-sheet.png')
    expect(sheet.width).toBeGreaterThanOrEqual(1600)
  })

  it('keeps the app icons opaque, as iOS and Android launchers require', () => {
    for (const path of ['public/icon-192.png', 'public/icon-512.png', 'public/apple-touch-icon.png']) expect(png(path).alpha).toBe(false)
  })
})

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8')) as {
    name: string
    icons: { src: string; sizes: string; type: string; purpose: string }[]
    start_url: string
  }

  it('names the app and uses base-relative URLs (works under /fundbun/ on Pages)', () => {
    expect(manifest.name).toBe('FundBun')
    expect(manifest.start_url.startsWith('/')).toBe(false)
  })

  it('points every icon at an existing file of the declared size', () => {
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(false)
      expect(existsSync(join(ROOT, 'public', icon.src))).toBe(true)
      const { width, height } = png(join('public', icon.src))
      expect(`${width}x${height}`).toBe(icon.sizes)
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true)
  })
})
