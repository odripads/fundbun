/**
 * Email data-source types — pure, framework-free (no DOM, no Node imports), so the same code runs in the
 * browser app, the Node server and the tests. Everything here is READ-ONLY ingestion: an email can only ever
 * become a `SpendingCandidate` that the user confirms; it can never become an action or a payment.
 */

export type EmailSourceKind = 'qq' | '163' | 'sandbox' | 'gmail' | 'outlook'

/** One transaction email fetched from a source. `body` is UNTRUSTED content. */
export interface EmailMessage {
  id: string
  from: string
  subject: string
  /** ISO-8601 timestamp the message was received/dated */
  date: string
  body: string
  /** the id of the `EmailSource` that returned this message */
  source: string
}

/** A read-only mailbox connector behind one interface. */
export interface EmailSource {
  id: string
  name: string
  kind: EmailSourceKind
  available: boolean
  fetch(): Promise<EmailMessage[]>
}
