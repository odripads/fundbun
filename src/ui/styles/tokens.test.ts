import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Minimal parser for tokens.css: rule blocks (selector list → custom properties), media-wrapped ones tagged. */
interface Block {
  selectors: string[]
  media?: string
  props: Map<string, string>
}

function parseBlocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Block[] = []
  const walk = (src: string, media?: string) => {
    let i = 0
    while (i < src.length) {
      const open = src.indexOf('{', i)
      if (open < 0) break
      const head = src.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      const body = src.slice(open + 1, j - 1)
      if (head.startsWith('@media')) walk(body, head)
      else {
        const props = new Map<string, string>()
        for (const m of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) props.set(m[1], m[2].trim())
        out.push({ selectors: head.split(',').map((s) => s.trim()), media, props })
      }
      i = j
    }
  }
  walk(text)
  return out
}

const blocks = parseBlocks(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'))
const find = (selector: string, media?: boolean) => blocks.find((b) => b.selectors.includes(selector) && !!b.media === !!media)

describe('tokens.css theme scopes', () => {
  const light = find("[data-theme='light']")
  const dark = find("[data-theme='dark']")
  const osDark = find(":root:not([data-theme='light'])", true)

  it('light and dark overrides apply to any [data-theme] element, not only :root', () => {
    expect(light?.selectors).toEqual([':root', "[data-theme='light']"])
    expect(dark?.selectors).toEqual([":root[data-theme='dark']", "[data-theme='dark']"])
    expect(osDark?.media).toMatch(/prefers-color-scheme: dark/)
    expect(light?.props.get('color-scheme')).toBe('light')
    expect(dark?.props.get('color-scheme')).toBe('dark')
  })

  it('a forced light subtree resets every token the dark theme changes', () => {
    for (const key of dark!.props.keys()) expect(light!.props.has(key), key).toBe(true)
  })

  it('OS-preferred dark and forced dark declare exactly the same values', () => {
    expect([...osDark!.props]).toEqual([...dark!.props])
  })

  it('carries the chart palette and permission-tier colours for both themes', () => {
    for (const key of ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--tier-4']) {
      expect(light!.props.get(key), key).toBeTruthy()
      expect(dark!.props.get(key), key).toBeTruthy()
      expect(dark!.props.get(key)).not.toBe(light!.props.get(key))
    }
    const derived = find('[data-theme]')
    expect(derived?.selectors).toEqual([':root', '[data-theme]'])
    expect([...derived!.props.keys()]).toEqual(['--tier-0', '--tier-1', '--tier-2', '--tier-3'])
  })

  it('theme-independent primitives stay on :root only', () => {
    const root = blocks.find((b) => b.selectors.length === 1 && b.selectors[0] === ':root' && !b.media)
    expect(root?.props.get('--c-yuan-500')).toBe('#e3a21a')
    expect(root?.props.has('--bg')).toBe(false)
  })
})

/** WCAG 2.x contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('tokens.css contrast (WCAG AA, F57)', () => {
  const root = blocks.find((b) => b.selectors.length === 1 && b.selectors[0] === ':root' && !b.media)!
  const light = find("[data-theme='light']")!
  const dark = find("[data-theme='dark']")!
  /** a token's value in a theme, following var(--primitive) references to a hex colour */
  const resolve = (theme: Block, key: string): string => {
    let v = theme.props.get(key) ?? root.props.get(key) ?? ''
    for (let i = 0; i < 4 && v.startsWith('var('); i++) {
      const ref = v.slice(4, -1).trim()
      v = theme.props.get(ref) ?? root.props.get(ref) ?? ''
    }
    expect(v, `${key} resolves to a hex colour`).toMatch(/^#[0-9a-f]{6}$/i)
    return v
  }

  for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
    it(`${name}: small text tokens reach 4.5:1 on the page, cards and sunken panels`, () => {
      for (const text of ['--text-3', '--accent-text', '--over-text', '--under-text', '--warn-text']) {
        for (const bg of ['--bg', '--surface', '--bg-sunken']) {
          expect(contrast(resolve(theme, text), resolve(theme, bg)), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${name}: text on a solid danger fill reaches 4.5:1`, () => {
      expect(contrast(resolve(theme, '--on-danger'), resolve(theme, '--danger'))).toBeGreaterThanOrEqual(4.5)
    })
  }
})
