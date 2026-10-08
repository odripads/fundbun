/**
 * Shared agent hooks: the ticking clock for undo countdowns, the approve/reject flow used by both the inline
 * action card and the approval sheet, and the toasts that follow an executed action (with a real Undo).
 */
import { PiggyBank, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FundBunApp } from '../../../core/app'
import type { PendingAction } from '../../../core/types'
import { useApp } from '../../state'
import { BunMascot } from '../brand'
import { useToast, type ToastApi } from '../ds/Toast'
import { secondsLeft } from './logic'

/** Date.now(), re-rendered every `intervalMs` while `active` (undo countdowns, PIN lockouts). */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [active, intervalMs])
  return now
}

const GOAL_TOOLS = new Set(['transfer_to_goal'])

/** Undo through the controller, then say what happened — the undo is real (the bank reverses it). */
export function undoWithToast(app: FundBunApp, toast: ToastApi, p: Pick<PendingAction, 'id' | 'preview'>): boolean {
  const r = app.undoAction(p.id)
  if (r.ok) {
    toast.show({ id: `action-${p.id}`, tone: 'neutral', icon: <Undo2 />, title: 'Undone', message: `${p.preview.title} — back exactly as it was.` })
    return true
  }
  toast.show({ id: `action-${p.id}`, tone: 'danger', title: 'Couldn’t undo that', message: r.error ?? 'The undo window has passed.' })
  return false
}

/** Success toast for an executed action; reversible ones get an Undo button that lives as long as the window. */
export function announceExecuted(app: FundBunApp, toast: ToastApi, p: PendingAction): void {
  const left = secondsLeft(p.undoUntil, Date.now())
  const saving = GOAL_TOOLS.has(p.call.tool)
  toast.show({
    id: `action-${p.id}`,
    tone: 'success',
    title: saving ? 'Stashed — nice one' : 'Done',
    message: left > 1 ? `${p.preview.title}. You can undo for ${left} s.` : `${p.preview.title}. It’s in your activity log.`,
    image: saving ? <BunMascot mood="happy" size={44} /> : undefined,
    icon: saving ? <PiggyBank /> : undefined,
    duration: left > 1 ? Math.min(left * 1000, 60_000) : 5000,
    showProgress: left > 1,
    actions: left > 1 ? [{ label: 'Undo', onClick: () => void undoWithToast(app, toast, p) }] : [],
  })
}

export interface ApprovalFlowOptions {
  /**
   * How success is announced. 'toast' (default): a toast with Undo — for flows with no card on screen (the approval
   * sheet). 'card': the inline action card shows the result and its own Undo countdown, so no toast repeats it.
   */
  announce?: 'toast' | 'card'
}

export interface ApprovalFlow {
  approve: (pin?: string) => Promise<boolean>
  reject: () => void
  busy: boolean
  /** the last refusal while the action is still pending (e.g. a wrong PIN) */
  error: string | null
  /** bumps on every new error so the PIN pad shakes even when the text repeats */
  errorKey: number
}

/**
 * Approve / reject one pending action through the controller (policy re-check, binding hash, PIN).
 * A refusal that leaves the action pending (wrong PIN) stays in `error`; anything final becomes a toast.
 */
export function useApprovalFlow(pendingId: string | null, onSettled?: (ok: boolean) => void, opts: ApprovalFlowOptions = {}): ApprovalFlow {
  const app = useApp()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)
  const inFlight = useRef(false)
  const settled = useRef(onSettled)
  settled.current = onSettled
  const toastOnSuccess = opts.announce !== 'card'

  useEffect(() => {
    setError(null)
  }, [pendingId])

  const find = useCallback((id: string) => app.getSnapshot().state.pending.find((x) => x.id === id), [app])

  const approve = useCallback(async (pin?: string) => {
    if (!pendingId || inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    try {
      const r = await app.approveAction(pendingId, pin)
      const after = find(pendingId)
      if (r.ok) {
        setError(null)
        if (after && toastOnSuccess) announceExecuted(app, toast, after)
        settled.current?.(true)
        return true
      }
      if (after?.status === 'pending') {
        setError(r.error ?? 'Not approved')
        setErrorKey((k) => k + 1)
      } else {
        toast.show({ tone: 'danger', title: after?.status === 'expired' ? 'That offer expired' : 'Nothing ran', message: r.error ?? 'Blocked by your safety rules.' })
        settled.current?.(false)
      }
      return false
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [app, find, pendingId, toast, toastOnSuccess])

  const reject = useCallback(() => {
    if (!pendingId) return
    app.rejectAction(pendingId)
    settled.current?.(false)
  }, [app, pendingId])

  return { approve, reject, busy, error, errorKey }
}
