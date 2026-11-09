/**
 * The "check inbox → new spendings" flow, shared by the settings UI and the tests.
 *
 * `checkInbox` is gated on consent: with AUTO off it never calls `fetch()`. `processInbox` is the pure,
 * deterministic core the UI also reuses on messages it fetched itself (e.g. via /api/email/fetch).
 */

import type { Currency, SpendingCandidate } from '../types'
import { isAllowedSender } from './allowlist'
import { parseEmails } from './parse'
import { scanEmails, type EmailFlag } from './scan'
import type { EmailMessage, EmailSource } from './types'

export interface InboxResult {
  /** messages the source returned */
  total: number
  /** messages from allow-listed senders */
  allowed: number
  /** messages dropped because their sender is not allow-listed */
  ignored: number
  /** spending items parsed from allowed, non-flagged messages (still awaiting the user's Confirm) */
  candidates: SpendingCandidate[]
  /** messages whose bodies look like AI-directed instructions */
  flagged: EmailFlag[]
}

/** Allow-list → injection-scan → parse. Flagged messages are never parsed. */
export function processInbox(messages: EmailMessage[], currency: Currency = 'CNY'): InboxResult {
  const list = Array.isArray(messages) ? messages : []
  const flagged = scanEmails(list)
  const flaggedIds = new Set(flagged.map((f) => f.message.id))
  const allowed = list.filter((m) => isAllowedSender(m.from))
  const toParse = allowed.filter((m) => !flaggedIds.has(m.id))
  return {
    total: list.length,
    allowed: allowed.length,
    ignored: list.length - allowed.length,
    candidates: parseEmails(toParse, currency),
    flagged,
  }
}

/** Fetch a source's mailbox and process it. Returns null (and never fetches) when consent is off. */
export async function checkInbox(source: EmailSource, opts: { consent: boolean; currency?: Currency }): Promise<InboxResult | null> {
  if (!opts.consent) return null
  return processInbox(await source.fetch(), opts.currency ?? 'CNY')
}
