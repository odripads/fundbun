/**
 * Step ↔ URL: `#/onboarding?step=money`. Moving forward pushes a history entry tagged as ours, so the browser /
 * Android back gesture walks back through the steps; the in-app Back button pops our own entries and only
 * replaces the URL when the user arrived on this step from outside (a reload or a deep link).
 */
import { buildHash, setHash } from '../../router'
import type { StepId } from './draft'

const MARK = 'fundbunOnboarding'

export function stepHash(step: StepId): string {
  return buildHash('onboarding', [], step === 'welcome' ? {} : { step })
}

export function pushStep(step: StepId): void {
  if (typeof window === 'undefined') return
  const hash = stepHash(step)
  if (window.location.hash === hash) return
  window.history.pushState({ ...(window.history.state ?? {}), [MARK]: true }, '', hash)
  // pushState doesn't fire hashchange; the router listens for it
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function replaceStep(step: StepId): void {
  setHash(stepHash(step), true)
}

/** True when the entry before this one is an onboarding step we pushed (so history.back() stays in the flow). */
export function canPopStep(): boolean {
  if (typeof window === 'undefined') return false
  const state = window.history.state as Record<string, unknown> | null
  return Boolean(state && state[MARK])
}

export function backTo(fallback: StepId): void {
  if (canPopStep()) window.history.back()
  else replaceStep(fallback)
}
