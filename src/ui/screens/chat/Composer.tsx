import { ArrowUp, FileText, FolderOpen, Paperclip, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { ChatAttachment } from '../../../core/types'
import { ModelChip } from '../../components/ai'
import { Spinner, cx } from '../../components/ds'
import { useSnapshot } from '../../state'
import { ATTACH_ACCEPT, MAX_FILES, leftOutNote, pickFiles, readForChat, type PendingFile } from './attach'
import styles from './Composer.module.css'

const selectToday = (s: AppSnapshot) => s.derived.today

export interface ComposerProps {
  onSend: (text: string, attachments?: ChatAttachment[]) => void
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
  const [files, setFiles] = useState<PendingFile[]>([])
  const [note, setNote] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLFormElement>(null)
  const filePick = useRef<HTMLInputElement>(null)
  const folderPick = useRef<HTMLInputElement>(null)
  const today = useSnapshot(selectToday)
  const id = useId()
  const hintId = useId()
  const reading = files.some((f) => f.status === 'reading')
  const ready = files.filter((f) => f.status === 'ready' && f.attachment).map((f) => f.attachment as ChatAttachment)
  const canSend = (text.trim().length > 0 || ready.length > 0) && !busy && !reading

  // the folder picker is a non-standard attribute: set it on the element, where React does not drop it
  useEffect(() => {
    folderPick.current?.setAttribute('webkitdirectory', '')
  }, [])

  const update = (fid: string, patch: Partial<PendingFile>) => setFiles((all) => all.map((f) => (f.id === fid ? { ...f, ...patch } : f)))

  function onPicked(e: ChangeEvent<HTMLInputElement>, fromFolder: boolean) {
    const picked = Array.from(e.currentTarget.files ?? [])
    e.currentTarget.value = ''
    if (!picked.length) return
    const { take, unreadable, overLimit } = pickFiles(picked, MAX_FILES - files.length)
    setNote(leftOutNote(fromFolder, take.length, unreadable, overLimit))
    const added: PendingFile[] = take.map((file, i) => ({ id: `${Date.now().toString(36)}-${i}-${file.name}`, name: file.name, status: 'reading' }))
    setFiles((all) => [...all, ...added])
    // one at a time: reading photos (OCR) is heavy
    void (async () => {
      for (let i = 0; i < take.length; i++) {
        const fid = added[i].id
        const r = await readForChat(take[i], today, (p) => update(fid, { progress: p })).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : 'Could not read it.' }))
        update(fid, r.ok ? { status: 'ready', attachment: r.attachment, name: r.attachment.name } : { status: 'error', error: r.error })
      }
    })()
  }

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
    if ((!value && !ready.length) || busy || reading) return
    onSend(value, ready.length ? ready : undefined)
    setText('')
    setFiles([])
    setNote(null)
  }, [busy, onSend, text, ready, reading])

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
      {files.length || note ? (
        <div className={styles.files}>
          {files.length ? (
            <ul className={styles.fileList} aria-label="Attached files">
              {files.map((f) => (
                <li key={f.id} className={styles.file} data-status={f.status} title={f.error ?? f.name}>
                  {f.status === 'reading' ? <Spinner size={14} /> : <FileText aria-hidden="true" />}
                  <span className={styles.fileName}>{f.name}</span>
                  {f.status === 'reading' && f.progress ? <span className={styles.fileMeta}>{Math.round(f.progress * 100)}%</span> : null}
                  {f.status === 'error' ? <span className={styles.fileMeta}>Can’t read</span> : null}
                  <button type="button" className={styles.fileX} aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((x) => x.id !== f.id))}>
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {note ? <p className={styles.fileNote} role="status">{note}</p> : null}
        </div>
      ) : null}
      <div className={cx(styles.box, busy && styles.busy)}>
        <div className={styles.attach}>
          <button type="button" className={styles.attachBtn} aria-label="Attach files" title="Attach files" onClick={() => filePick.current?.click()} disabled={files.length >= MAX_FILES}>
            <Paperclip aria-hidden="true" />
          </button>
          <button type="button" className={styles.attachBtn} aria-label="Attach a folder" title="Attach a folder" onClick={() => folderPick.current?.click()} disabled={files.length >= MAX_FILES}>
            <FolderOpen aria-hidden="true" />
          </button>
          <input ref={filePick} type="file" multiple accept={ATTACH_ACCEPT} hidden onChange={(e) => onPicked(e, false)} />
          <input ref={folderPick} type="file" multiple hidden onChange={(e) => onPicked(e, true)} />
        </div>
        <label htmlFor={id} className="sr-only">Message Bun</label>
        <textarea
          ref={area}
          id={id}
          rows={1}
          value={text}
          maxLength={MAX_LEN}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={engine === 'llm' ? 'Ask Bun anything…' : 'Ask about your money…'}
          enterKeyHint="send"
          autoComplete="off"
          aria-describedby={hintId}
          className={styles.input}
        />
        <button type="submit" className={styles.send} disabled={!canSend} aria-label={busy ? 'Bun is replying' : 'Send'}>
          {busy ? <Spinner size={18} /> : <ArrowUp aria-hidden="true" />}
        </button>
      </div>
      <div className={styles.foot}>
        <ModelChip />
        <p id={hintId} className={styles.hint}>
          <ShieldCheck aria-hidden="true" />
          {engine === 'llm' ? 'Redacted before it is sent' : 'Answered on this device'} · money only moves with your OK
        </p>
      </div>
    </form>
  )
}
