/**
 * The "check inbox, then new spendings" flow, shared by the settings UI and the tests.
 *
 * `checkInbox` is gated on consent: with AUTO off it never calls `fetch()`. `processInbox` is the pure,
 * deterministic core the UI also reuses on messages it fetched itself (the sandbox mailbox, or the user's own
 * mailbox through /api/email/check on this computer).
 */

import type { Currency, SpendingCandidate } from '../types'
import { isAllowedSender, relayPlatform } from './allowlist'
import { readEmail } from './parse'
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
  /** allowed, non-flagged messages that gave no spending: refunds, credits, top-ups, other currencies, unknown layouts */
  skipped?: number
  /** of the skipped, the ones in another currency than the user's (FundBun never converts currencies) */
  otherCurrency?: number
  /** of the ignored, the ones the user's own mail server marked as forged (DMARC failed): never read */
  forged?: number
  /** candidate id to the platform its email came through ('paypal.com'): a stranger may have written that text */
  relayed?: Record<string, string>
}

export interface InboxOptions {
  /** sender domains the user trusts beyond the built-in list; matched on the address domain only, like the list */
  extraDomains?: readonly string[]
}

/**
 * Allow-list, then injection scan, then parse. Flagged messages are never parsed, and neither is a message whose
 * sender the user's own mail server found forged, whatever address it shows.
 */
export function processInbox(messages: EmailMessage[], currency: Currency = 'CNY', opts: InboxOptions = {}): InboxResult {
  const list = Array.isArray(messages) ? messages : []
  const flagged = scanEmails(list)
  const flaggedIds = new Set(flagged.map((f) => f.message.id))
  const forged = list.filter((m) => m?.senderCheck === 'fail').length
  const allowed = list.filter((m) => m?.senderCheck !== 'fail' && isAllowedSender(m.from, opts.extraDomains))
  const toParse = allowed.filter((m) => !flaggedIds.has(m.id))
  const readings = toParse.map((m) => readEmail(m, currency))
  const relayed: Record<string, string> = {}
  toParse.forEach((m, i) => {
    const platform = relayPlatform(m.from)
    if (platform) for (const c of readings[i].candidates) relayed[c.id] = platform
  })
  return {
    total: list.length,
    allowed: allowed.length,
    ignored: list.length - allowed.length,
    candidates: readings.flatMap((r) => r.candidates),
    flagged,
    skipped: readings.filter((r) => r.candidates.length === 0).length,
    otherCurrency: readings.filter((r) => r.skip === 'other_currency').length,
    forged,
    relayed,
  }
}

/** Fetch a source's mailbox and process it. Returns null (and never fetches) when consent is off. */
export async function checkInbox(
  source: EmailSource,
  opts: { consent: boolean; currency?: Currency; extraDomains?: readonly string[] },
): Promise<InboxResult | null> {
  if (!opts.consent) return null
  return processInbox(await source.fetch(), opts.currency ?? 'CNY', { extraDomains: opts.extraDomains })
}
