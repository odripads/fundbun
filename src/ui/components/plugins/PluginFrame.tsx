import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { buildPluginSnapshot } from '../../../core/plugins/snapshot'
import { useSnapshot } from '../../state'
import styles from './Plugins.module.css'

/** The design tokens a widget may use, read from the page so a widget follows light and dark mode. */
const THEME_VARS = [
  '--bg', '--bg-sunken', '--surface', '--surface-2', '--border', '--text', '--text-2', '--text-3',
  '--accent', '--accent-text', '--accent-soft', '--under', '--under-text', '--under-soft',
  '--over', '--over-text', '--over-soft', '--warn', '--font-ui', '--font-display', '--r-sm', '--r-md',
] as const

const MIN_H = 48
const MAX_H = 900

function readTheme(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) {
    const val = cs.getPropertyValue(v).trim()
    if (val) out[v] = val
  }
  return out
}

function newToken(): string {
  const c = globalThis.crypto
  return c?.randomUUID ? c.randomUUID().replace(/-/g, '') : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

const selectAll = (s: AppSnapshot) => s

export interface PluginFrameProps {
  /** the frame's address without the token, e.g. /api/plugins/installed/<id>/frame */
  src: string
  title: string
}

/**
 * One widget, in an iframe with `sandbox="allow-scripts"` and nothing else: its origin is opaque, so it cannot read
 * this page, its storage or its cookies, and the frame's CSP blocks every network request. It gets one thing: a
 * read-only summary of the numbers (no names, account numbers or notes), sent again whenever they change.
 */
export function PluginFrame({ src, title }: PluginFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const token = useMemo(newToken, [src])
  const [height, setHeight] = useState(120)
  const [ready, setReady] = useState(false)
  const snap = useSnapshot(selectAll)
  const data = useMemo(() => buildPluginSnapshot(snap), [snap])

  useEffect(() => {
    setReady(false)
    const onMessage = (ev: MessageEvent) => {
      // only this frame's own messages, carrying the token it was given
      if (ev.source !== ref.current?.contentWindow) return
      const msg: unknown = ev.data
      if (!msg || typeof msg !== 'object') return
      const m = msg as { type?: unknown; token?: unknown; height?: unknown }
      if (m.token !== token) return
      if (m.type === 'fundbun:ready') setReady(true)
      if (m.type === 'fundbun:resize' && typeof m.height === 'number' && Number.isFinite(m.height)) {
        setHeight(Math.max(MIN_H, Math.min(MAX_H, Math.ceil(m.height))))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [token])

  useEffect(() => {
    if (!ready) return
    // the frame's origin is opaque ("null"), so a target origin cannot be named; the token ties the reply to it
    ref.current?.contentWindow?.postMessage({ type: 'fundbun:snapshot', token, snapshot: data, theme: readTheme() }, '*')
  }, [ready, data, token])

  const sep = src.includes('?') ? '&' : '?'
  return (
    <iframe
      ref={ref}
      className={styles.frame}
      title={title}
      src={`${src}${sep}token=${token}`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ height }}
    />
  )
}
