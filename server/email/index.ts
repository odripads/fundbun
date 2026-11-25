/**
 * The public email sources behind ONE interface (src/core/email/types.EmailSource), for GET /api/email/sources
 * and GET /api/email/fetch on every gateway, hosted or local:
 *   - `sandbox`: the synthetic demo mailbox from src/core/email/sandbox (no account needed).
 *   - QQ Mail, 163 Mail, Gmail, Outlook: listed as unavailable. These public routes never take a password.
 *
 * The user's OWN mailbox is a separate, local-only path: on the desktop app or `npm run local` the user connects
 * any IMAP mailbox through /api/email/account and reads it, read only, through /api/email/check (routes.ts,
 * service.ts, imap.ts). Its password is kept like the AI keys, in <home>/email.json, never here.
 *
 * No credentials are ever stored here or returned by any route.
 */

import { sandboxEmailSource } from '../../src/core/email/sandbox'
import type { EmailMessage, EmailSource, EmailSourceKind } from '../../src/core/email/types'

export interface EmailSourceMeta {
  id: string
  name: string
  kind: EmailSourceKind
  available: boolean
  note: string
}

const NOTES: Record<EmailSource['id'], string> = {
  sandbox: 'Synthetic demo mailbox. No account needed.',
  qq: 'Not live-tested. Needs your QQ Mail 授权码 (never your password).',
  '163': 'Not live-tested. Needs your 163 Mail 授权码 (never your password).',
  gmail: 'After pilot (unreliable in mainland China).',
  outlook: 'After pilot (unreliable in mainland China).',
}

function unavailableStub(id: EmailSource['id'], name: string, kind: EmailSourceKind): EmailSource {
  return {
    id,
    name,
    kind,
    available: false,
    fetch: async () => {
      throw new Error(NOTES[id])
    },
  }
}

/**
 * The connectors, in priority order. Only `sandbox` is fetchable today; the IMAP paths are honest stubs that
 * refuse to run until a 授权码 is provided in memory (a future step — never committed to the repo).
 */
export const EMAIL_SOURCES: readonly EmailSource[] = [
  sandboxEmailSource,
  unavailableStub('qq', 'QQ Mail', 'qq'),
  unavailableStub('163', '163 Mail', '163'),
  unavailableStub('gmail', 'Gmail', 'gmail'),
  unavailableStub('outlook', 'Outlook', 'outlook'),
]

export function emailSourcesMeta(): EmailSourceMeta[] {
  return EMAIL_SOURCES.map((s) => ({ id: s.id, name: s.name, kind: s.kind, available: s.available, note: NOTES[s.id] }))
}

export type EmailFetchResult =
  | { ok: true; source: string; messages: EmailMessage[] }
  | { ok: false; status: 404 | 501; error: string; message: string }

/** Fetch one source's mailbox (metadata only for the demo: just the sandbox mailbox today). */
export async function fetchEmailMessages(sourceId: string): Promise<EmailFetchResult> {
  const source = EMAIL_SOURCES.find((s) => s.id === sourceId)
  if (!source) return { ok: false, status: 404, error: 'unknown_source', message: `Unknown email source "${sourceId}".` }
  if (!source.available) return { ok: false, status: 501, error: 'source_unavailable', message: NOTES[source.id] }
  try {
    return { ok: true, source: source.id, messages: await source.fetch() }
  } catch (e) {
    return { ok: false, status: 501, error: 'source_unavailable', message: e instanceof Error ? e.message : 'The mailbox could not be read.' }
  }
}
