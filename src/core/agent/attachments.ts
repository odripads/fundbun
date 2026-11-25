import { wrapUntrusted } from '../security/injection'
import type { ChatAttachment, ChatMessage } from '../types'

/** At most this many files in one message (a folder is cut to it). */
export const MAX_ATTACHMENTS = 20
/** Text kept per file, and per message in all: enough for a statement or a long receipt, small enough to store. */
export const MAX_ATTACHMENT_CHARS = 12_000
export const MAX_ATTACHMENTS_CHARS = 60_000
/** User messages this far back that carried files still make a turn untrusted (their text is in the model's context). */
export const ATTACHMENT_TAINT_WINDOW = 9

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/**
 * Attachments as the engine accepts them: strings only, NULs and control characters dropped, each file and the
 * whole message capped. Whatever the UI sent, nothing larger or stranger gets stored or sent to a model.
 */
export function cleanAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: ChatAttachment[] = []
  let total = 0
  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const name = clip(String(a.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim(), 120) || 'file'
    const kind = clip(String(a.kind ?? 'file').replace(/[^a-z]/gi, ''), 12) || 'file'
    const full = String(a.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    if (!full.trim()) continue
    const room = Math.min(MAX_ATTACHMENT_CHARS, MAX_ATTACHMENTS_CHARS - total)
    if (room <= 0) break
    const text = clip(full, room)
    total += text.length
    out.push({ name, kind, text, ...(text.length < full.length || a.truncated === true ? { truncated: true } : {}) })
  }
  return out
}

/** The files of one message as the model sees them: each one wrapped as untrusted data, never instructions. */
export function attachmentBlocks(files: readonly ChatAttachment[]): string {
  return files
    .map((f) => wrapUntrusted('attached-file', `File: ${f.name} (${f.kind})${f.truncated ? ', cut short' : ''}\n${f.text}`, { maxChars: MAX_ATTACHMENT_CHARS + 200 }))
    .join('\n')
}

/** A short line naming the files, for messages whose contents are not sent again. */
export function attachmentNote(files: readonly ChatAttachment[]): string {
  return `[attached earlier: ${files.map((f) => f.name).join(', ')}]`
}

/** True when a recent user message carried files: their text may still steer the model, so the turn is untrusted. */
export function recentAttachments(chat: readonly ChatMessage[]): boolean {
  const users = chat.filter((m) => m.role === 'user').slice(-ATTACHMENT_TAINT_WINDOW)
  return users.some((m) => (m.attachments?.length ?? 0) > 0)
}
