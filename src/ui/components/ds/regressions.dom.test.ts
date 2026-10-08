// @vitest-environment jsdom
/** Regression tests for the UI findings fixed in the design system (F39, F40, F42, F56, F62, F63). */
import { readFileSync } from 'node:fs'
import { act, createElement as h, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Segmented, Sheet, ToastProvider, ToastViewport, toastInset, useToast, useToastClearance, type ToastApi } from './index'
import { byText, cleanup, flush, render } from './testing'

afterEach(async () => {
  vi.useRealTimers()
  await cleanup()
})

const css = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** Advance fake timers, then once more for the timers the re-render scheduled (a toast's exit animation). */
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

describe('Toasts never cover an open sheet (F39)', () => {
  let api: ToastApi
  function Grab() {
    api = useToast()
    return null
  }
  function Harness({ sheet }: { sheet: boolean }) {
    return h(ToastProvider, null, h(Grab), h(Sheet, { open: sheet, onClose: () => {}, title: 'Enter your PIN' }), h(ToastViewport))
  }
  const viewport = () => document.body.querySelector<HTMLElement>('section[aria-label="Notifications"]')!

  it('steps behind the modal layer while a sheet is open and holds its timer until it closes', async () => {
    vi.useFakeTimers()
    const r = await render(h(Harness, { sheet: false }))
    await act(async () => {
      api.show({ title: 'Stashed', duration: 1000 })
    })
    expect(viewport().hasAttribute('data-under-modal')).toBe(false)
    await r.rerender(h(Harness, { sheet: true }))
    expect(viewport().hasAttribute('data-under-modal')).toBe(true)
    expect(viewport().querySelector('ol')!.getAttribute('aria-hidden')).toBe('true')
    // the timer holds: a toast that arrived under a sheet is still there when the sheet closes
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(byText(document.body, 'Stashed', 'p')).not.toBeNull()
    await r.rerender(h(Harness, { sheet: false }))
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(viewport().hasAttribute('data-under-modal')).toBe(false)
    expect(byText(document.body, 'Stashed', 'p')).not.toBeNull()
    await tick(1300)
    expect(byText(document.body, 'Stashed', 'p')).toBeNull()
  })

  it('the stylesheet puts the held stack below the modal layer (z 60)', () => {
    const toast = css('./Toast.module.css')
    const modal = css('./Modal.module.css')
    const layerZ = Number(/\.layer \{[^}]*z-index: (\d+)/.exec(modal)![1])
    const heldZ = Number(/\.viewport\[data-under-modal\] \{[^}]*z-index: (\d+)/.exec(toast)![1])
    expect(heldZ).toBeLessThan(layerZ)
  })

  it('a touch tap does not pause the countdown (no sticky "hover" on phones)', async () => {
    vi.useFakeTimers()
    await render(h(Harness, { sheet: false }))
    await act(async () => {
      api.show({ title: 'Tapped', duration: 1000 })
    })
    const li = byText(document.body, 'Tapped', 'p')!.closest('li')!
    await act(async () => {
      li.dispatchEvent(Object.assign(new Event('pointerover', { bubbles: true }), { pointerType: 'touch' }))
      li.dispatchEvent(Object.assign(new Event('pointerenter', { bubbles: false }), { pointerType: 'touch' }))
    })
    await tick(1300)
    expect(byText(document.body, 'Tapped', 'p')).toBeNull()
  })

  it('a screen with its own bottom bar (the chat composer) lifts the toasts above it', async () => {
    function Composer({ px }: { px: number }) {
      useToastClearance(px)
      return null
    }
    function Page() {
      const [on] = useState(true)
      return h(ToastProvider, null, on ? h(Composer, { px: 96 }) : null, h(ToastViewport))
    }
    const r = await render(h(Page))
    await flush()
    expect(toastInset()).toBe(96)
    expect(viewport().style.getPropertyValue('--toast-inset')).toBe('96px')
    expect(css('./Toast.module.css')).toMatch(/bottom: max\(calc\(var\(--chrome-bottom\) \+ 12px\), calc\(var\(--toast-inset, 0px\) \+ 8px\)\)/)
    await r.unmount()
    expect(toastInset()).toBe(0)
  })
})

describe('Buttons (F40, F42)', () => {
  const button = css('./Button.module.css')

  it('every variant keeps a visible focus ring: the default shadow is a real (empty) shadow, never `none`', () => {
    const base = /\.button \{[^}]*--btn-shadow: ([^;]+);/.exec(button)![1].trim()
    expect(base).not.toBe('none')
    expect(button).toMatch(/\.button:focus-visible \{[^}]*box-shadow: var\(--btn-shadow\), var\(--ring\)/)
    // a ghost button must not reset the shadow to `none` either
    expect(/\.ghost \{[^}]*--btn-shadow: none/.test(button)).toBe(false)
  })

  it('primary and danger labels wrap instead of ending in an ellipsis', () => {
    expect(button).toMatch(/\.primary \.label,\s*\.danger \.label \{[^}]*white-space: normal;[^}]*text-overflow: clip;/)
  })

  it('the action-card primary never shrinks below its label (it takes its own row instead)', () => {
    const card = css('../agent/ActionCard.module.css')
    expect(card).toMatch(/\.buttons > :last-child \{[^}]*min-width: fit-content;/)
  })
})

describe('Segmented: the selected option is visible in dark mode too (F56)', () => {
  it('marks the selected option with a check and a gold ring, not only the surface colour', async () => {
    const { container } = await render(
      h(Segmented<string>, {
        label: 'Tone',
        value: 'cheeky',
        onChange: () => {},
        options: [
          { value: 'gentle', label: 'Gentle' },
          { value: 'cheeky', label: 'Cheeky' },
        ],
      }),
    )
    const radios = Array.from(container.querySelectorAll('[role="radio"]'))
    expect(radios[1].querySelector('[data-check]')).not.toBeNull()
    expect(radios[0].querySelector('[data-check]')).toBeNull()
    expect(css('./Segmented.module.css')).toMatch(/\.thumb \{[^}]*inset 0 0 0 1\.5px var\(--accent\)/)
  })
})

describe('Text that used to be cut short (F62, F63)', () => {
  it('list subtitles get two lines instead of an ellipsis', () => {
    expect(css('./ListItem.module.css')).toMatch(/\.subtitle \{[^}]*-webkit-line-clamp: 2;/)
  })

  it('search fields hide the browser’s own clear button (ours is the only ×)', () => {
    expect(css('./TextField.module.css')).toMatch(/\.input\[type='search'\]::-webkit-search-cancel-button[\s\S]*?display: none;/)
  })
})
