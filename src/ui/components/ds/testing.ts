/** Minimal React test harness for jsdom tests (no extra dependencies). Test-only. */
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export interface Rendered {
  container: HTMLElement
  rerender(el: ReactElement): Promise<void>
  unmount(): Promise<void>
}

const mounted = new Set<{ root: Root; container: HTMLElement }>()

export async function render(el: ReactElement): Promise<Rendered> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const entry = { root, container }
  mounted.add(entry)
  await act(async () => root.render(el))
  return {
    container,
    rerender: async (next) => act(async () => root.render(next)),
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
      mounted.delete(entry)
    },
  }
}

/** Unmount everything rendered so far (call from afterEach). */
export async function cleanup(): Promise<void> {
  for (const { root, container } of [...mounted]) {
    await act(async () => root.unmount())
    container.remove()
  }
  mounted.clear()
  document.body.innerHTML = ''
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('click: element not found')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

export async function key(el: Element | null, k: string, init: KeyboardEventInit = {}): Promise<void> {
  if (!el) throw new Error('key: element not found')
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

/** Set a form control's value the way React's onChange expects. */
export async function changeValue(el: HTMLInputElement | null, value: string): Promise<void> {
  if (!el) throw new Error('changeValue: element not found')
  const proto = Object.getPrototypeOf(el) as object
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  await act(async () => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** First element whose text matches; with no selector, the deepest such element. */
export function byText(root: ParentNode, text: string | RegExp, selector?: string): HTMLElement | null {
  const match = (s: string) => (typeof text === 'string' ? s.trim() === text : text.test(s))
  const all = Array.from(root.querySelectorAll<HTMLElement>(selector ?? '*')).filter((el) => match(el.textContent ?? ''))
  if (selector) return all[0] ?? null
  return all.find((el) => Array.from(el.children).every((c) => !match(c.textContent ?? ''))) ?? null
}

export function byLabel(root: ParentNode, label: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[aria-label="${label.replace(/"/g, '\\"')}"]`)
}

export async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}
