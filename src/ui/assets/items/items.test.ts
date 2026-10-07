import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FALLBACK_ITEM, ITEM_KEYS, isItemKey, itemUrl, presetImageUrl, presetKey } from './index'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const MAX_BYTES = 6 * 1024
const INK = '#3A2A1F'
const BLOB = 'M60 9C88 8 111 30 110 59C111 88 88 111 59 110C30 110 9 89 10 60C9 31 32 9 60 9Z'
const BACKDROPS = ['#FBDCD2', '#D5EEE2', '#FCEBC4', '#E6E0F5', '#DBE6F5', '#F5E5C8']
const SPARKLE = 'M0-6Q1-1 6 0Q1 1 0 6Q-1 1-6 0Q-1-1 0-6Z'
const FORBIDDEN_TAGS = ['text', 'tspan', 'textPath', 'image', 'foreignObject', 'script', 'style', 'a', 'iframe']

const read = (key: string) => readFileSync(join(DIR, `${key}.svg`), 'utf8')
const svgFiles = () => readdirSync(DIR).filter((f) => f.endsWith('.svg'))

function tagNames(svg: string): string[] {
  return [...svg.matchAll(/<([a-zA-Z][\w:-]*)/g)].map((m) => m[1])
}

/** null when every element is closed in order; otherwise a description of the first problem */
function unbalancedTag(svg: string): string | null {
  const stack: string[] = []
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m
    if (selfClosing) continue
    if (!closing) {
      stack.push(name)
      continue
    }
    const open = stack.pop()
    if (open !== name) return `</${name}> closes <${open ?? 'nothing'}>`
  }
  return stack.length ? `unclosed <${stack.join('>, <')}>` : null
}

function ids(svg: string): string[] {
  return [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
}

function localRefs(svg: string): string[] {
  const hrefs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
  const urls = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
  return [...hrefs, ...urls]
}

describe('unbalancedTag (test helper)', () => {
  it('accepts nested and self-closing elements', () => {
    expect(unbalancedTag('<svg><g><path d="M0 0"/></g></svg>')).toBeNull()
  })

  it('reports crossed and unclosed elements', () => {
    expect(unbalancedTag('<svg><g></svg></g>')).toBe('</svg> closes <g>')
    expect(unbalancedTag('<svg><g>')).toBe('unclosed <svg>, <g>')
  })
})

describe('dream item illustrations', () => {
  it('ships exactly one SVG per preset key', () => {
    expect(svgFiles().sort()).toEqual(ITEM_KEYS.map((k) => `${k}.svg`).sort())
  })

  it('uses ids that are unique across all files, so inlining several on one page cannot collide', () => {
    const all = ITEM_KEYS.flatMap((k) => ids(read(k)))
    expect(new Set(all).size).toBe(all.length)
  })

  describe.each(ITEM_KEYS)('%s.svg', (key) => {
    const svg = read(key)

    it('stays under 6 KB', () => {
      expect(Buffer.byteLength(svg)).toBeLessThan(MAX_BYTES)
    })

    it('is a well-formed 120×120 SVG root', () => {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"')).toBe(true)
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
      expect(unbalancedTag(svg)).toBeNull()
    })

    it('contains no text, raster, script or styling hooks', () => {
      const tags = tagNames(svg)
      for (const tag of FORBIDDEN_TAGS) expect(tags).not.toContain(tag)
      expect(svg).not.toMatch(/\son[a-z]+=/i)
      expect(svg).not.toMatch(/class=/)
    })

    it('references nothing outside the file', () => {
      expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:|data:|file:|xlink:href|@import/i)
      for (const m of svg.matchAll(/href="([^"]*)"/g)) expect(m[1].startsWith('#')).toBe(true)
    })

    it('resolves every local reference to an id in the same file', () => {
      const defined = new Set(ids(svg))
      for (const ref of localRefs(svg)) expect(defined, `#${ref}`).toContain(ref)
    })

    it('prefixes its ids so they cannot clash with app markup', () => {
      const prefixes = new Set(ids(svg).map((id) => id.split('-')[0]))
      expect(prefixes.size).toBeLessThanOrEqual(1)
      for (const id of ids(svg)) expect(id).toMatch(/^[a-z]+-[a-z]$/)
    })

    it('follows the shared style: pastel blob backdrop first, soy-ink 2.5px outline, gold sparkles', () => {
      const blob = svg.match(/<path d="([^"]+)" fill="(#[0-9A-F]{6})"\/>/)
      expect(blob?.[1]).toBe(BLOB)
      expect(BACKDROPS).toContain(blob?.[2])
      expect(svg).toContain(`stroke="${INK}" stroke-width="2.5"`)
      expect(svg).toContain(SPARKLE)
    })
  })
})

describe('preset helpers', () => {
  it('recognises exactly the preset keys', () => {
    for (const key of ITEM_KEYS) expect(isItemKey(key)).toBe(true)
    for (const key of ['', 'Bag', 'bags', 'gift ', '__proto__', 'constructor', 'toString']) expect(isItemKey(key)).toBe(false)
  })

  // Vite inlines small assets as data URIs and emits a hashed file otherwise; either must point at the right SVG.
  it('resolves a distinct URL for every key that points at that key’s SVG', () => {
    const resolved = ITEM_KEYS.map((key) => {
      const url = itemUrl(key)
      const ownId = ids(read(key))[0]
      if (url.startsWith('data:image/svg+xml')) expect(decodeURIComponent(url)).toContain(`id='${ownId}'`)
      else expect(url).toMatch(new RegExp(`${key}(-[\\w-]+)?\\.svg$`))
      return url
    })
    expect(new Set(resolved).size).toBe(ITEM_KEYS.length)
  })

  it('reads the key from a preset image string', () => {
    expect(presetKey('preset:bag')).toBe('bag')
    expect(presetKey('preset: ring ')).toBe('ring')
  })

  it('returns undefined for images that are not presets', () => {
    expect(presetKey('data:image/png;base64,iVBORw0KGgo=')).toBeUndefined()
    expect(presetKey('')).toBeUndefined()
    expect(presetKey('PRESET:bag')).toBeUndefined()
    expect(presetKey('https://example.com/bag.svg')).toBeUndefined()
  })

  it('falls back to the gift for unknown or hostile preset keys', () => {
    for (const image of ['preset:', 'preset:yacht', 'preset:../../etc/passwd', 'preset:__proto__', 'preset:bag.svg']) {
      expect(presetKey(image)).toBe(FALLBACK_ITEM)
    }
  })

  it('maps preset images to their illustration URL', () => {
    expect(presetImageUrl('preset:ring')).toBe(itemUrl('ring'))
    expect(presetImageUrl('preset:nope')).toBe(itemUrl('gift'))
    expect(presetImageUrl('data:image/jpeg;base64,/9j/')).toBeUndefined()
  })
})
