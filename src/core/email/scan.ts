/**
 * Scan an email (subject + sender + body) for instructions aimed at AI assistants: "ignore your rules",
 * "transfer ¥5000 to …", role spoofing, secrecy, etc. Reuses the existing security/injection scanner.
 */

import { scanForInjection } from '../security/injection'
import type { InjectionReport } from '../types'
import { readableText } from './parse'
import type { EmailMessage } from './types'

export interface EmailFlag {
  message: EmailMessage
  report: InjectionReport
}

/**
 * Scan one message. The body is UNTRUSTED; a `suspicious` report means the message must be quarantined. The body
 * is scanned as sent AND as the parser reads it (tags removed, entities like &#105; decoded), so an instruction
 * hidden behind HTML cannot pass the scan and then reach a spending record.
 */
export function scanEmail(message: EmailMessage): InjectionReport {
  const head = `${message.from}\n${message.subject}\n`
  const body = String(message.body ?? '')
  const raw = scanForInjection(head + body)
  const readable = readableText(body)
  return readable === body ? raw : merge(raw, scanForInjection(head + readable))
}

function merge(a: InjectionReport, b: InjectionReport): InjectionReport {
  return {
    suspicious: a.suspicious || b.suspicious,
    score: Math.max(a.score, b.score),
    signals: [...new Set([...a.signals, ...b.signals])],
    excerpts: [...new Set([...a.excerpts, ...b.excerpts])].slice(0, Math.max(a.excerpts.length, b.excerpts.length)),
  }
}

/** Return only the messages whose bodies look like they carry AI-directed instructions. */
export function scanEmails(messages: EmailMessage[]): EmailFlag[] {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({ message, report: scanEmail(message) }))
    .filter((f) => f.report.suspicious)
}
