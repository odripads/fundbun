// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BunMood } from '../../../core/types'
import { BunMascot, type BunMascotProps } from './BunMascot'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const animate = vi.fn()

function render(props: BunMascotProps) {
  act(() => root.render(h(BunMascot, props)))
  return host.querySelector('svg') as SVGSVGElement
}

function mockReducedMotion(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  animate.mockReset()
  ;(Element.prototype as unknown as { animate: unknown }).animate = animate
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.documentElement.removeAttribute('data-motion')
  delete (window as Partial<Window>).matchMedia
  delete (Element.prototype as unknown as { animate?: unknown }).animate
})

describe('BunMascot in the browser', () => {
  it('idles by default and plays a squash + face pop only when the mood changes', () => {
    let svg = render({ mood: 'calm' })
    expect(svg.dataset.animated).toBe('true')
    expect(animate).not.toHaveBeenCalled()

    svg = render({ mood: 'burnt' })
    expect(svg.dataset.mood).toBe('burnt')
    expect(svg.dataset.toasted).toBe('true')
    expect(animate).toHaveBeenCalledTimes(2)

    render({ mood: 'burnt', size: 120 })
    expect(animate).toHaveBeenCalledTimes(2)
  })

  it('treats an unknown mood as calm without animating a non-change', () => {
    render({ mood: 'calm' })
    const svg = render({ mood: 'grumpy' as BunMood })
    expect(svg.dataset.mood).toBe('calm')
    expect(animate).not.toHaveBeenCalled()
  })

  it('stays completely still with animated={false}', () => {
    render({ mood: 'happy', animated: false })
    const svg = render({ mood: 'worried', animated: false })
    expect(svg.dataset.animated).toBeUndefined()
    expect(svg.dataset.mood).toBe('worried')
    expect(animate).not.toHaveBeenCalled()
  })

  it('honours the OS reduced-motion preference', () => {
    mockReducedMotion(true)
    render({ mood: 'happy' })
    const svg = render({ mood: 'sleepy' })
    expect(svg.dataset.animated).toBeUndefined()
    expect(animate).not.toHaveBeenCalled()
  })

  it('follows the in-app "Reduce motion" setting live', async () => {
    let svg = render({ mood: 'calm' })
    expect(svg.dataset.animated).toBe('true')
    await act(async () => {
      document.documentElement.setAttribute('data-motion', 'reduce')
      await Promise.resolve()
    })
    svg = host.querySelector('svg') as SVGSVGElement
    expect(svg.dataset.animated).toBeUndefined()
    await act(async () => {
      document.documentElement.removeAttribute('data-motion')
      await Promise.resolve()
    })
    expect((host.querySelector('svg') as SVGSVGElement).dataset.animated).toBe('true')
  })

  it('does not crash where the Web Animations API is missing', () => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate
    render({ mood: 'calm' })
    expect(() => render({ mood: 'happy' })).not.toThrow()
  })
})
