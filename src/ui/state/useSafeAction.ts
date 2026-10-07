import { useCallback } from 'react'
import type { Result } from '../../core/app-api'
import { useToast } from '../components/ds/Toast'
import { errorText } from './appInstance'

export interface SafeActionOptions {
  /** toast shown when the call succeeds */
  success?: string
  /** toast title when it fails (the error text becomes the message) */
  errorTitle?: string
}

export function isResult(value: unknown): value is Result {
  return typeof value === 'object' && value !== null && typeof (value as Result).ok === 'boolean'
}

/**
 * Run an AppApi call without crashing the screen: thrown errors and `{ ok: false }` results become a toast.
 * Resolves with the call's value, or undefined when it threw.
 *   const run = useSafeAction()
 *   await run(() => app.contributeToGoal(id, amount), { success: 'Stashed ¥300 in Birkin' })
 */
export function useSafeAction() {
  const toast = useToast()
  return useCallback(async <T,>(fn: () => T | Promise<T>, opts: SafeActionOptions = {}): Promise<T | undefined> => {
    const title = opts.errorTitle ?? 'That didn’t work'
    try {
      const value = await fn()
      if (isResult(value) && !value.ok) {
        toast.show({ tone: 'danger', title, message: value.error ?? 'Please try again.' })
      } else if (opts.success) {
        toast.show({ tone: 'success', title: opts.success })
      }
      return value
    } catch (e) {
      toast.show({ tone: 'danger', title, message: errorText(e) })
      return undefined
    }
  }, [toast])
}
