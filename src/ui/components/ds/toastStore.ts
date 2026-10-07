import type { ReactNode } from 'react'

export type ToastTone = 'neutral' | 'success' | 'warn' | 'danger' | 'ai'

export interface ToastAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'ghost'
  /** keep the toast open after the action runs (default: dismiss) */
  keepOpen?: boolean
}

export interface ToastOptions {
  /** pass an id to replace an existing toast instead of stacking a new one */
  id?: string
  title: string
  message?: ReactNode
  tone?: ToastTone
  /** image slot, e.g. <DreamImage image={dream.image} alt="" size={56}/> for tripwire reminders */
  image?: ReactNode
  icon?: ReactNode
  actions?: ToastAction[]
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 5000 (8000 with actions). */
  duration?: number
  /** show the countdown bar (e.g. an undo window) */
  showProgress?: boolean
  onDismiss?: () => void
}

export interface Toast extends Required<Pick<ToastOptions, 'id' | 'title' | 'tone' | 'duration'>> {
  message?: ReactNode
  image?: ReactNode
  icon?: ReactNode
  actions: ToastAction[]
  showProgress: boolean
  onDismiss?: () => void
  /** bumps when a toast with the same id is re-shown, restarting its timer */
  version: number
  /** playing its exit animation; removed afterwards */
  leaving: boolean
}

export type ToastStoreAction =
  | { type: 'show'; toast: Toast }
  | { type: 'update'; id: string; patch: Partial<Omit<Toast, 'id'>> }
  /** start the exit animation */
  | { type: 'leave'; id: string }
  /** remove immediately (after the exit animation) */
  | { type: 'remove'; id: string }
  | { type: 'clear' }

/** Older toasts beyond this are dropped so the stack never covers the screen. */
export const MAX_TOASTS = 3

export const DEFAULT_DURATION = 5000
export const DEFAULT_DURATION_WITH_ACTIONS = 8000

export function normalizeToast(opts: ToastOptions, id: string, version = 0): Toast {
  const actions = opts.actions ?? []
  return {
    id,
    title: opts.title,
    message: opts.message,
    tone: opts.tone ?? 'neutral',
    image: opts.image,
    icon: opts.icon,
    actions,
    duration: Math.max(0, opts.duration ?? (actions.length ? DEFAULT_DURATION_WITH_ACTIONS : DEFAULT_DURATION)),
    showProgress: opts.showProgress ?? false,
    onDismiss: opts.onDismiss,
    version,
    leaving: false,
  }
}

export function toastReducer(state: Toast[], action: ToastStoreAction): Toast[] {
  switch (action.type) {
    case 'show': {
      const existing = state.find((t) => t.id === action.toast.id)
      if (existing) return state.map((t) => (t.id === action.toast.id ? { ...action.toast, version: existing.version + 1, leaving: false } : t))
      return [...state.filter((t) => !t.leaving), action.toast].slice(-MAX_TOASTS)
    }
    case 'update':
      return state.map((t) => (t.id === action.id ? { ...t, ...action.patch, id: t.id } : t))
    case 'leave':
      return state.map((t) => (t.id === action.id ? { ...t, leaving: true } : t))
    case 'remove':
      return state.filter((t) => t.id !== action.id)
    case 'clear':
      return []
  }
}

/** Text for the live region: title + plain-text message (ReactNode messages announce the title only). */
export function announcement(t: Pick<Toast, 'title' | 'message'>): string {
  return typeof t.message === 'string' || typeof t.message === 'number' ? `${t.title}. ${t.message}` : t.title
}
