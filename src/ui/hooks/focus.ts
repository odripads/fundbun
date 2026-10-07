const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

function isHidden(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return true
  // checkVisibility also sees display:none ancestors; older engines fall back to the element's own style
  if (typeof el.checkVisibility === 'function') return !el.checkVisibility({ visibilityProperty: true })
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null
  return style ? style.visibility === 'hidden' || style.display === 'none' : false
}

/** Tabbable descendants in DOM order (tabindex >= 0, enabled, not hidden). */
export function tabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !isHidden(el))
}

/**
 * Where Tab should go next inside a trap, or null to let the browser handle it.
 * Wraps from last → first (and first → last with Shift) and pulls stray focus back inside.
 */
export function nextTrapTarget(items: HTMLElement[], active: Element | null, shift: boolean, container: HTMLElement): HTMLElement | null {
  if (items.length === 0) return container
  const first = items[0]
  const last = items[items.length - 1]
  const inside = active !== null && container.contains(active)
  if (!inside) return shift ? last : first
  if (shift && (active === first || active === container)) return last
  if (!shift && active === last) return first
  return null
}
