import { Bell, CircleCheck, OctagonAlert, Sparkles, TriangleAlert, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'
import { Portal } from './overlay'
import { announcement, normalizeToast, toastReducer, type Toast, type ToastOptions, type ToastTone } from './toastStore'
import styles from './Toast.module.css'

export interface ToastApi {
  /** returns the toast id */
  show(opts: ToastOptions): string
  update(id: string, patch: Partial<ToastOptions>): void
  dismiss(id: string): void
  clear(): void
}

const ToastStateContext = createContext<Toast[]>([])
const ToastApiContext = createContext<ToastApi | null>(null)
const RemoveContext = createContext<(id: string) => void>(() => {})

const EXIT_MS = 200
let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, [])
  const api = useMemo<ToastApi>(() => ({
    show(opts) {
      const id = opts.id ?? `toast-${++seq}`
      dispatch({ type: 'show', toast: normalizeToast(opts, id) })
      return id
    },
    update(id, patch) {
      const { id: _id, ...rest } = patch
      dispatch({ type: 'update', id, patch: rest })
    },
    dismiss: (id) => dispatch({ type: 'leave', id }),
    clear: () => dispatch({ type: 'clear' }),
  }), [])

  // onDismiss fires once for every toast that leaves the list, however it left
  const previous = useRef<Toast[]>([])
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id))
    for (const t of previous.current) if (!live.has(t.id)) t.onDismiss?.()
    previous.current = toasts
  }, [toasts])

  const remove = useCallback((id: string) => dispatch({ type: 'remove', id }), [])
  return (
    <ToastApiContext.Provider value={api}>
      <ToastStateContext.Provider value={toasts}>
        <RemoveContext.Provider value={remove}>{children}</RemoveContext.Provider>
      </ToastStateContext.Provider>
    </ToastApiContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastApiContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  neutral: <Bell />,
  success: <CircleCheck />,
  warn: <TriangleAlert />,
  danger: <OctagonAlert />,
  ai: <Sparkles />,
}

/** Renders the toast stack + live regions. AppFrame mounts one inside the phone frame. */
export function ToastViewport({ className }: { className?: string }) {
  const toasts = useContext(ToastStateContext)
  const latest = toasts.filter((t) => !t.leaving).at(-1)
  const urgent = latest?.tone === 'danger'
  return (
    <Portal>
      <section className={cx(styles.viewport, className)} aria-label="Notifications">
        <ol className={styles.list}>
          {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
        </ol>
        {/* persistent live regions: announcements land reliably because the regions pre-exist */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {latest && !urgent ? <span key={`${latest.id}:${latest.version}`}>{announcement(latest)}</span> : null}
        </div>
        <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
          {latest && urgent ? <span key={`${latest.id}:${latest.version}`}>{announcement(latest)}</span> : null}
        </div>
      </section>
    </Portal>
  )
}

function ToastItem({ toast: t }: { toast: Toast }) {
  const api = useToast()
  const remove = useContext(RemoveContext)
  const [paused, setPaused] = useState(false)
  const remaining = useRef(t.duration)

  useEffect(() => {
    remaining.current = t.duration
  }, [t.version, t.duration])

  useEffect(() => {
    if (t.duration === 0 || paused || t.leaving) return
    const started = Date.now()
    const timer = setTimeout(() => api.dismiss(t.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [api, t.id, t.duration, t.version, t.leaving, paused])

  useEffect(() => {
    if (!t.leaving) return
    const timer = setTimeout(() => remove(t.id), EXIT_MS)
    return () => clearTimeout(timer)
  }, [t.leaving, t.id, remove])

  return (
    <li
      className={cx(styles.toast, styles[t.tone], t.leaving && styles.leaving)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false)
      }}
    >
      {t.image ? <div className={styles.image}>{t.image}</div> : <span className={styles.icon} aria-hidden="true">{t.icon ?? TONE_ICON[t.tone]}</span>}
      <div className={styles.content}>
        <p className={styles.title}>{t.title}</p>
        {t.message != null ? <div className={styles.message}>{t.message}</div> : null}
        {t.actions.length ? (
          <div className={styles.actions}>
            {t.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={cx(styles.action, a.variant === 'primary' && styles.actionPrimary)}
                onClick={() => {
                  a.onClick()
                  if (!a.keepOpen) api.dismiss(t.id)
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button type="button" className={styles.close} aria-label={`Dismiss: ${t.title}`} onClick={() => api.dismiss(t.id)}>
        <X aria-hidden="true" />
      </button>
      {t.showProgress && t.duration > 0 ? (
        <span
          key={t.version}
          className={styles.progress}
          style={{ animationDuration: `${t.duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
          aria-hidden="true"
        />
      ) : null}
    </li>
  )
}
