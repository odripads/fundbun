// @vitest-environment jsdom
/** Layout regressions: focus not obscured by the fixed chrome (F47), the hero CTA clear of the raised Ask Bun (F48),
 *  and the tap-target fixes (F70). Geometry is verified in a real browser (scripts/shot.ts); these pin the rules. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '../ds/testing'
import { ThresholdStepper } from '../../screens/onboarding/steps/ThresholdStepper'
import { TopBar } from './TopBar'

const css = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

afterEach(cleanup)

describe('keyboard focus never lands under the tab bar or the top bar (F47)', () => {
  const frame = css('src/ui/components/layout/AppFrame.module.css')

  it('the phone layout (document scroll) reserves the tab bar and the raised Ask Bun button', () => {
    expect(frame).toMatch(/:global\(html:has\(\[data-tabbar\]\)\) \{\s*scroll-padding-bottom: calc\(var\(--tabbar-h\) \+ var\(--safe-bottom\) \+ 36px\);/)
    // the same sum the device frame uses for --chrome-bottom
    expect(frame).toMatch(/--chrome-bottom: calc\(var\(--tabbar-h\) \+ var\(--safe-bottom\) \+ 36px\);/)
    expect(css('src/ui/styles/global.css')).toMatch(/html \{[^}]*scroll-padding-top: calc\(var\(--topbar-h\)/)
  })

  it('the desktop device screen (its own scroller) pads for both bars', () => {
    expect(frame).toMatch(/\.screen \{[^}]*overflow-y: auto;[^}]*scroll-padding-top: calc\(var\(--topbar-h\) \+ var\(--safe-top\) \+ 8px\);[^}]*scroll-padding-bottom: calc\(var\(--chrome-bottom\) \+ 8px\);/)
  })
})

describe('the hero’s primary CTA clears the raised Ask Bun button on short screens (F48)', () => {
  const hero = css('src/ui/screens/home/MirrorHero.module.css')

  it('short phones and the desktop frame on short laptops get a smaller mirror', () => {
    expect(hero).toMatch(/@media \(max-height: 808px\), \(min-width: 1024px\) and \(max-height: 940px\) \{[\s\S]*?\.mirrorWrap \{\s*width: min\(148px, 42cqi\);/)
  })

  it('very short screens move the CTA above the evidence tiles', () => {
    const block = /@media \(max-height: 700px\), \(min-width: 1024px\) and \(max-height: 820px\) \{([\s\S]*?)\n\}/.exec(hero)![1]
    const order = (cls: string) => Number(new RegExp(`\\.${cls} \\{\\s*order: (\\d+);`).exec(block)![1])
    expect(order('actions')).toBeLessThan(order('stats'))
  })
})

describe('tap targets (F70)', () => {
  it('the tripwire threshold box is a label for its field, so the whole 64×44 box focuses it', async () => {
    const { container } = await render(
      h(ThresholdStepper, { id: 'ob-pace', label: 'Pace alert', value: 100, unit: 'pct', currency: 'CNY', range: { min: 50, max: 200, step: 5 }, onChange: () => {} }),
    )
    const input = container.querySelector('#ob-pace')!
    const label = input.closest('label')!
    expect(label).not.toBeNull()
    expect(label.getAttribute('for')).toBe('ob-pace')
    expect(css('src/ui/screens/onboarding/steps/ThresholdStepper.module.css')).toMatch(/\.box \{[^}]*min-width: 64px;[^}]*min-height: 44px;/)
  })

  it('the agent pill’s hit area is at least 44px tall', () => {
    const pill = css('src/ui/components/layout/ShellActions.module.css')
    const height = Number(/\.pill \{[^}]*height: (\d+)px;/.exec(pill)![1])
    const inset = Number(/\.pill::after \{[^}]*inset: -(\d+)px/.exec(pill)![1])
    expect(height + 2 * inset).toBeGreaterThanOrEqual(44)
  })
})

describe('the top bar after a deep link (F64 follow-up)', () => {
  it('takes the newest intersection entry, so a page that jumps on open gets its glass bar', async () => {
    let cb: ((entries: { isIntersecting: boolean }[]) => void) | null = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(fn: typeof cb) {
        cb = fn
      }
      observe() {}
      disconnect() {}
    })
    const { container } = await render(h(TopBar, { title: 'Settings' }))
    await act(async () => {
      cb!([{ isIntersecting: true }, { isIntersecting: false }])
    })
    expect(container.querySelector('header')!.className).toMatch(/scrolled/)
    vi.unstubAllGlobals()
  })
})
