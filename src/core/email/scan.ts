/**
 * Scan an email (subject + sender + body) for instructions aimed at AI assistants — "ignore your rules",
 * "transfer ¥5000 to …", role spoofing, secrecy, etc. Reuses the existing security/injection scanner.
 */

import { scanForInjection } from '../security/injection'
import type { InjectionReport } from '../types'
import type { EmailMessage } from './types'

export interface EmailFlag {
  message: EmailMessage
  report: InjectionReport
}

/** Scan one message. The body is UNTRUSTED; a `suspicious` report means the message must be quarantined. */
export function scanEmail(message: EmailMessage): InjectionReport {
  return scanForInjection(`${message.from}\n${message.subject}\n${message.body}`)
}

/** Return only the messages whose bodies look like they carry AI-directed instructions. */
export function scanEmails(messages: EmailMessage[]): EmailFlag[] {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({ message, report: scanEmail(message) }))
    .filter((f) => f.report.suspicious)
}
