import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BunMood } from '../../../core/types'
import { itemUrl } from '../../assets/items'
import { SPARKLE, SWEAT_DROP } from './geometry'
import { BUN_MOODS, BunMascot, DreamImage, Logo, PRESET_KEYS } from './index'

const mascot = (props: Parameters<typeof BunMascot>[0] = {}) => renderToStaticMarkup(h(BunMascot, props))
const decode = (v: string) => v.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attr = (html: string, name: string) => {
  const raw = html.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
  return raw === undefined ? undefined : decode(raw)
}

function ids(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
}

function refs(html: string): string[] {
  return [...html.matchAll(/href="#([^"]+)"/g), ...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
}

describe('BunMascot', () => {
  it('is decorative by default and calm, animated, full-detail at 96px', () => {
    const html = mascot()
    expect(attr(html, 'aria-hidden')).toBe('true')
    expect(html).not.toContain('role="img"')
    expect(attr(html, 'data-mood')).toBe('calm')
    expect(attr(html, 'data-cut')).toBe('full')
    expect(attr(html, 'data-animated')).toBe('true')
    expect(attr(html, 'width')).toBe('96')
  })

  it('becomes an image with an accessible name when titled', () => {
    const html = mascot({ title: 'Bun is happy' })
    expect(html).toContain('role="img"')
    expect(attr(html, 'aria-label')).toBe('Bun is happy')
    expect(html).toContain('<title>Bun is happy</title>')
    expect(html).not.toContain('aria-hidden')
  })

  it('switches to the bold small cut at icon sizes, or on request', () => {
    expect(attr(mascot({ size: 32 }), 'data-cut')).toBe('small')
    expect(attr(mascot({ size: 56 }), 'data-cut')).toBe('small')
    expect(attr(mascot({ size: 57 }), 'data-cut')).toBe('full')
    expect(attr(mascot({ size: 200, detail: 'small' }), 'data-cut')).toBe('small')
    expect(attr(mascot({ size: 24, detail: 'full' }), 'data-cut')).toBe('full')
  })

  it('drops all motion when animated={false}', () => {
    const html = mascot({ animated: false })
    expect(html).not.toContain('data-animated')
  })

  it('falls back to a sane size and to calm for bad input', () => {
    const html = mascot({ size: Number.NaN, mood: 'furious' as BunMood })
    expect(attr(html, 'width')).toBe('96')
    expect(attr(html, 'data-mood')).toBe('calm')
    expect(attr(mascot({ size: -4 }), 'width')).toBe('96')
  })

  it('swaps parts per mood on the same silhouette', () => {
    const by = Object.fromEntries(BUN_MOODS.map((m) => [m, mascot({ mood: m, size: 160 })])) as Record<BunMood, string>
    expect(by.happy).toContain(SPARKLE)
    expect(attr(by.happy, 'data-pocket')).toBe('bright')
    expect(by.worried).toContain(SWEAT_DROP)
    expect(attr(by.burnt, 'data-toasted')).toBe('true')
    expect(attr(by.burnt, 'data-pocket')).toBe('dim')
    expect(by.sleepy).toMatch(/d="M\d+ \d+H\d+L\d+ \d+H\d+"/) // a z
    for (const m of ['calm', 'worried', 'sleepy'] as const) expect(by[m]).not.toContain('data-toasted')
    // the body path is shared by every mood
    const body = (html: string) => html.match(/<path id="[^"]+" d="([^"]+)"/)?.[1]
    expect(new Set(BUN_MOODS.map((m) => body(by[m]))).size).toBe(1)
  })

  it('renders every mood in both cuts', () => {
    for (const mood of BUN_MOODS) for (const size of [28, 120]) expect(() => mascot({ mood, size })).not.toThrow()
  })

  it('gives each instance its own ids and resolves every reference', () => {
    const html = renderToStaticMarkup(h('div', null, h(BunMascot, { mood: 'happy' }), h(BunMascot, { mood: 'happy' })))
    const all = ids(html)
    expect(new Set(all).size).toBe(all.length)
    for (const ref of refs(html)) expect(all).toContain(ref)
    for (const id of all) expect(id).toMatch(/^[\w-]+$/)
  })
})

describe('Logo', () => {
  it('announces "FundBun" once, with the mark hidden from assistive tech', () => {
    const html = renderToStaticMarkup(h(Logo, { withWordmark: true }))
    expect(html.match(/role="img"/g)).toHaveLength(1)
    expect(attr(html, 'aria-label')).toBe('FundBun')
    expect(html).toContain('aria-hidden="true"')
    expect(html.replace(/<[^>]+>/g, '')).toBe('FundBun')
  })

  it('splits the wordmark so "Bun" can carry the gold accent', () => {
    const html = renderToStaticMarkup(h(Logo, { withWordmark: true }))
    expect(html).toMatch(/Fund<span[^>]*>Bun<\/span>/)
  })

  it('renders the mark alone without a wordmark, sized and with the small cut at top-bar size', () => {
    const html = renderToStaticMarkup(h(Logo, { size: 30 }))
    expect(html).not.toContain('Fund<')
    expect(html).toContain('width="30"')
    expect(attr(html, 'data-cut')).toBe('small')
    expect(attr(html, 'aria-label')).toBe('FundBun')
  })

  it('passes className through and can be still', () => {
    const html = renderToStaticMarkup(h(Logo, { className: 'x-logo', animated: false }))
    expect(html).toContain('x-logo')
    expect(html).not.toContain('data-animated')
  })
})

describe('DreamImage', () => {
  const img = (props: Parameters<typeof DreamImage>[0]) => renderToStaticMarkup(h(DreamImage, props))

  it('shows a preset illustration with the given alt text', () => {
    const html = img({ image: 'preset:bag', alt: 'Birkin 25', size: 80 })
    expect(attr(html, 'src')).toBe(itemUrl('bag'))
    expect(attr(html, 'alt')).toBe('Birkin 25')
    expect(attr(html, 'data-kind')).toBe('preset')
    expect(attr(html, 'data-preset')).toBe('bag')
    expect(html).toContain('--dream-size:80px')
  })

  it('shows a user photo data URL directly', () => {
    const src = 'data:image/jpeg;base64,/9j/4AAQ'
    const html = img({ image: src, alt: 'my shoes' })
    expect(attr(html, 'src')).toBe(src)
    expect(attr(html, 'data-kind')).toBe('photo')
  })

  it('falls back to the gift for unknown or remote images', () => {
    for (const image of ['preset:yacht', 'https://evil.example/x.png', 'javascript:alert(1)']) {
      expect(attr(img({ image, alt: '' }), 'src')).toBe(itemUrl('gift'))
    }
  })

  it('keeps decorative images silent', () => {
    expect(img({ image: 'preset:ring', alt: '' })).toContain('alt=""')
  })

  it('never lets the browser drag or eagerly block on the picture', () => {
    const html = img({ image: 'preset:ring', alt: 'ring', glow: true })
    expect(html).toContain('draggable="false"')
    expect(html).toContain('loading="lazy"')
  })

  it('covers every preset key', () => {
    for (const key of PRESET_KEYS) expect(attr(img({ image: `preset:${key}`, alt: key }), 'src')).toBe(itemUrl(key))
  })
})
