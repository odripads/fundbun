import { ArrowUp, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Spinner, cx } from '../../components/ds'
import styles from './Composer.module.css'

export interface ComposerProps {
  onSend: (text: string) => void
  /** Bun is replying: sending waits, typing ahead is fine */
  busy: boolean
  engine: 'offline' | 'llm'
  /** the composer's rendered height, so the list can keep its last message clear of it */
  onHeight?: (px: number) => void
}

const MAX_LEN = 2000
const MAX_H = 132

/** Autosizing message box: Enter sends, Shift+Enter adds a line (IME composition never sends). */
export function Composer({ onSend, busy, engine, onHeight }: ComposerProps) {
  const [text, setText] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLFormElement>(null)
  const id = useId()
  const hintId = useId()
  const canSend = text.trim().length > 0 && !busy

  // grow with the text up to MAX_H, then scroll inside
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`
  }, [text])

  useEffect(() => {
    const el = root.current
    if (!el || !onHeight) return
    onHeight(el.offsetHeight)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [onHeight])

  const submit = useCallback(() => {
    const value = text.trim()
    if (!value || busy) return
    onSend(value)
    setText('')
  }, [busy, onSend, text])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  return (
    <form ref={root} className={styles.composer} onSubmit={onSubmit} aria-busy={busy || undefined}>
      <div className={cx(styles.box, busy && styles.busy)}>
        <label htmlFor={id} className="sr-only">Message Bun</label>
        <textarea
          ref={area}
          id={id}
          rows={1}
          value={text}
          maxLength={MAX_LEN}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your money…"
          enterKeyHint="send"
          autoComplete="off"
          aria-describedby={hintId}
          className={styles.input}
        />
        <button type="submit" className={styles.send} disabled={!canSend} aria-label={busy ? 'Bun is replying' : 'Send'}>
          {busy ? <Spinner size={18} /> : <ArrowUp aria-hidden="true" />}
        </button>
      </div>
      <p id={hintId} className={styles.hint}>
        <ShieldCheck aria-hidden="true" />
        {engine === 'llm' ? 'AI via LLM, redacted context' : 'On-device AI'} · money only moves with your OK
      </p>
    </form>
  )
}
