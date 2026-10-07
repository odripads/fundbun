import { describe, expect, it } from 'vitest'
import { PALETTE } from './geometry'
import { escapeXml, markSvg } from './markSvg'

const ids = (svg: string) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])

describe('markSvg', () => {
  it('is decorative without a title', () => {
    const svg = markSvg()
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).not.toContain('<title>')
    expect(svg).not.toContain('role="img"')
  })

  it('names the image and escapes the title and description', () => {
    const svg = markSvg({ title: 'Bun & <Co>', desc: '"quoted"' })
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title>Bun &amp; &lt;Co&gt;</title><desc>&quot;quoted&quot;</desc>')
  })

  it('prefixes every id so several inlined marks cannot collide', () => {
    const a = ids(markSvg({ idPrefix: 'a' }))
    const b = ids(markSvg({ idPrefix: 'b' }))
    expect(a.every((id) => id.startsWith('a-'))).toBe(true)
    expect(a.filter((id) => b.includes(id))).toEqual([])
  })

  it('draws steam, a crumb rim and the lit pocket only in the full cut', () => {
    const full = markSvg({ cut: 'full' })
    const small = markSvg({ cut: 'small' })
    expect(full).toContain('radialGradient')
    expect(small).not.toContain('radialGradient')
    expect(full).toContain('stroke="#B9874B" stroke-width="14"')
    expect(small).not.toContain('stroke="#B9874B" stroke-width="14"')
    expect(full).toContain(`fill="${PALETTE.crumb}"`)
    expect(small).not.toContain(`fill="${PALETTE.crumb}"`)
    expect(small).toContain('transform="matrix(1.12')
  })

  it('adds the cream keyline always, only for dark schemes, or never', () => {
    expect(markSvg({ keyline: 'always' })).toContain(`stroke="${PALETTE.dough}" stroke-width="30"`)
    const media = markSvg({ keyline: 'media' })
    expect(media).toContain('class="fb-keyline" fill="none" stroke="none"')
    expect(media).toContain('@media (prefers-color-scheme: dark)')
    expect(markSvg()).not.toContain('stroke-width="30"')
  })

  it('renders the mono variant in a single chosen ink with the ¥ knocked out', () => {
    const svg = markSvg({ variant: 'mono', ink: '#000000' })
    expect(svg).toContain('<mask')
    expect(svg).not.toContain(PALETTE.yen)
    expect(svg).not.toContain(PALETTE.dough)
    expect(svg).toContain('stroke="#000000"')
    // the keyline is a colour-mark feature only
    expect(markSvg({ variant: 'mono', keyline: 'media' })).not.toContain('<style')
  })
})

describe('escapeXml', () => {
  it('escapes all five XML specials', () => {
    expect(escapeXml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&apos;y&apos;&gt;&amp;&lt;/a&gt;')
  })
})
