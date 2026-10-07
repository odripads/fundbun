import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRAND_SVG_FILES } from './brandFiles'
import { PALETTE } from './geometry'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const UPDATE = process.env.UPDATE_BRAND === '1'

function ids(svg: string): string[] {
  return [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
}

function refs(svg: string): string[] {
  return [...svg.matchAll(/href="#([^"]+)"/g), ...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1])
}

/** null when every element closes in order */
function unbalanced(svg: string): string | null {
  const stack: string[] = []
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m
    if (selfClosing) continue
    if (!closing) stack.push(name)
    else if (stack.pop() !== name) return `</${name}>`
  }
  return stack.length ? `unclosed <${stack.join('>, <')}>` : null
}

describe('static brand SVG files', () => {
  if (UPDATE) {
    it('rewrites every file from its recipe', () => {
      for (const [path, svg] of Object.entries(BRAND_SVG_FILES)) {
        mkdirSync(dirname(join(ROOT, path)), { recursive: true })
        writeFileSync(join(ROOT, path), svg)
      }
    })
  }

  describe.each(Object.entries(BRAND_SVG_FILES))('%s', (path, svg) => {
    it('matches its markSvg() recipe (regenerate with UPDATE_BRAND=1)', () => {
      expect(existsSync(join(ROOT, path)), `${path} is missing`).toBe(true)
      expect(readFileSync(join(ROOT, path), 'utf8')).toBe(svg)
    })

    it('is a well-formed, self-contained 512 SVG with an accessible name', () => {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img"')).toBe(true)
      expect(svg).toMatch(/<title>FundBun<\/title>/)
      expect(unbalanced(svg)).toBeNull()
      expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:|data:|file:|xlink:|@import|<script|<image|<text|<foreignObject/i)
    })

    it('resolves every local reference and never repeats an id', () => {
      const defined = ids(svg)
      expect(new Set(defined).size).toBe(defined.length)
      for (const ref of refs(svg)) expect(defined).toContain(ref)
    })

    it('stays small', () => {
      expect(Buffer.byteLength(svg)).toBeLessThan(8 * 1024)
    })

    it('keeps the gold roles: ¥ in yen gold, never a rim-gold field', () => {
      expect(svg).not.toContain(`fill="${PALETTE.rim}"`)
      if (!path.includes('mono')) expect(svg).toContain(`stroke="${PALETTE.yen}"`)
    })
  })

  it('uses CSS only for the favicon dark-scheme keyline', () => {
    for (const [path, svg] of Object.entries(BRAND_SVG_FILES)) {
      const styled = /<style|class=/.test(svg)
      expect(styled, path).toBe(path === 'public/favicon.svg')
    }
    expect(BRAND_SVG_FILES['public/favicon.svg']).toContain('@media (prefers-color-scheme: dark)')
  })

  it('ships the full drawing as the logo and the bold small cut as the favicon', () => {
    expect(BRAND_SVG_FILES['src/ui/assets/logo.svg']).toBe(BRAND_SVG_FILES['docs/assets/brand/fundbun-mark.svg'])
    expect(BRAND_SVG_FILES['src/ui/assets/logo.svg']).toContain('stroke="#B9874B" stroke-width="14"')
    expect(BRAND_SVG_FILES['public/favicon.svg']).toContain('matrix(1.12 0 0 1.12')
  })

  it('makes the mono files truly one colour', () => {
    for (const path of ['src/ui/assets/logo-mono.svg', 'docs/assets/brand/fundbun-mark-mono.svg']) {
      const colours = new Set([...BRAND_SVG_FILES[path].matchAll(/(?:fill|stroke)="(#[0-9A-Fa-f]{3,6})"/g)].map((m) => m[1].toUpperCase()))
      colours.delete('#FFF')
      colours.delete('#000') // mask luminance, not paint
      expect([...colours]).toEqual([PALETTE.ink])
    }
  })
})
