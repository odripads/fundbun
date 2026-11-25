/**
 * Files attached in the chat: read on this device with the same reader as "Receipt or file" (photos by OCR, PDF,
 * Excel, Word, CSV, text). Only the text goes into the message, and from there only to the user's own AI.
 */
import type { ChatAttachment, ISODate } from '../../../core/types'

/** What the file picker offers (the reader's own list, kept here so the chat does not load it up front). */
export const ATTACH_ACCEPT = 'image/*,.pdf,.csv,.tsv,.txt,.md,.json,.xlsx,.docx'
/** At most this many files per message; a bigger folder is cut to its first files. */
export const MAX_FILES = 20
const MAX_BYTES = 20 * 1024 * 1024

const EXT_OK = new Set(['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'bmp', 'pdf', 'csv', 'tsv', 'txt', 'md', 'json', 'xlsx', 'docx'])

export interface PendingFile {
  id: string
  name: string
  status: 'reading' | 'ready' | 'error'
  /** 0..1 while a photo or scan is read */
  progress?: number
  attachment?: ChatAttachment
  error?: string
}

function extOf(name: string): string {
  const n = name.toLowerCase()
  return n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : ''
}

/** A file the chat can read: a supported type, not hidden, not too big. */
export function canAttach(file: Pick<File, 'name' | 'size'>): boolean {
  const base = file.name.split('/').pop() ?? file.name
  return !base.startsWith('.') && EXT_OK.has(extOf(base)) && file.size > 0 && file.size <= MAX_BYTES
}

/** The name shown for a file: its path inside a picked folder, or just its name. */
export function displayName(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return rel && rel.length <= 120 ? rel : file.name
}

/** Splits a picked set of files into the ones to read (at most `room`), and counts the ones left out and why. */
export function pickFiles(files: readonly File[], room: number): { take: File[]; unreadable: number; overLimit: number } {
  const ok = files.filter(canAttach).sort((a, b) => displayName(a).localeCompare(displayName(b)))
  const take = ok.slice(0, Math.max(0, room))
  return { take, unreadable: files.length - ok.length, overLimit: ok.length - take.length }
}

/** One line about what was left out, or null. */
export function leftOutNote(fromFolder: boolean, taken: number, unreadable: number, overLimit: number): string | null {
  if (!taken) return fromFolder ? 'Nothing in that folder Bun can read: photos, PDF, Excel, Word, CSV or text.' : 'Bun reads photos, PDF, Excel (.xlsx), Word (.docx), CSV and text files.'
  const parts: string[] = []
  if (overLimit) parts.push(`${overLimit} more left out: up to ${MAX_FILES} files at a time`)
  if (unreadable && fromFolder) parts.push(`${unreadable} skipped that Bun can't read`)
  else if (unreadable) parts.push(`${unreadable} skipped: Bun reads photos, PDF, Excel, Word, CSV and text`)
  return parts.length ? `${parts.join('. ')}.` : null
}

const PLAIN = new Set(['txt', 'md', 'json'])

/** Reads one file into an attachment, or says why it could not. */
export async function readForChat(file: File, today: ISODate, onProgress?: (p: number) => void): Promise<{ ok: true; attachment: ChatAttachment } | { ok: false; error: string }> {
  const name = displayName(file)
  const ext = extOf(file.name)
  if (PLAIN.has(ext)) {
    const text = (await file.text()).trim()
    return text ? { ok: true, attachment: { name, kind: ext === 'md' ? 'text' : ext, text } } : { ok: false, error: 'The file is empty.' }
  }
  const { readAnyFile, fileKind } = await import('../receipt/readFile')
  const r = await readAnyFile(file, { today, base: import.meta.env.BASE_URL, ...(onProgress ? { onProgress } : {}) })
  if (r.kind === 'error') return { ok: false, error: r.error }
  const kind = fileKind(file)
  return { ok: true, attachment: { name, kind, text: r.kind === 'statement' ? r.csv : r.text } }
}
