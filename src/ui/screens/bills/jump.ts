/** In-page navigation between the Bills sections (hash routing owns `#`, so no anchor links). */

export const SECTION_IDS = {
  upcoming: 'bills-upcoming',
  findings: 'bills-findings',
  subscriptions: 'bills-subscriptions',
  xray: 'bills-xray',
  import: 'bills-import',
} as const

export type SectionKey = keyof typeof SECTION_IDS

export function isSectionKey(value: string | undefined): value is SectionKey {
  return value !== undefined && Object.prototype.hasOwnProperty.call(SECTION_IDS, value)
}

/**
 * Scroll a section into view and (for in-page jumps) move focus to its `[data-jump-focus]` target or heading,
 * so keyboard and screen-reader users land where the page scrolled to.
 */
export function jumpTo(key: SectionKey, smooth: boolean, focus = true): void {
  if (typeof document === 'undefined') return
  const section = document.getElementById(SECTION_IDS[key])
  if (!section) return
  section.scrollIntoView?.({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  if (!focus) return
  const target = section.querySelector<HTMLElement>('[data-jump-focus]') ?? section.querySelector<HTMLElement>('h2')
  if (!target) return
  if (!target.hasAttribute('tabindex') && !/^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/.test(target.tagName)) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}
