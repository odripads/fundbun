/**
 * The app's side of "Connect your email": talks to the FundBun server on this computer (/api/email/account,
 * /api/email/check). On the hosted web app those routes do not exist (404) and a page from anywhere else is
 * refused (403); both read as `local: false`, and the app then offers the synthetic sandbox mailbox only.
 *
 * The password travels once, inside the connect request, and is never read back: the server only ever answers
 * `hasPassword`. Bodies of fetched messages are UNTRUSTED; the caller runs `processInbox` on them.
 */
import {
  EMAIL_PRESETS,
  IMAP_TLS_PORT,
  type EmailAccountState,
  type EmailAccountView,
  type EmailCheckResult,
  type EmailPreset,
  type EmailPresetId,
  type EmailTestResult,
  type NewEmailAccountInput,
} from './account'
import type { EmailMessage } from './types'

export type EmailState = EmailAccountState | { local: false }

export const EMAIL_UNAVAILABLE: EmailState = { local: false }

/** `local: false` when FundBun on this computer could not be reached at all (hosted web, offline, refused). */
export type EmailResult<T> = ({ ok: true } & T) | { ok: false; local: boolean; error: string; message: string }

// what one check may hand the parser, at most
const MAX_MESSAGES = 500
const MAX_BODY = 200_000
/** the server sends "name <address>": a name of at most 120 characters and an address of at most 254 */
const MAX_FROM = 640

const NOT_HERE = 'Email connections run in the FundBun desktop app, so your password stays on your computer.'
const NO_ANSWER = 'FundBun on this computer is not answering.'

type Json = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function deadline(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

function isJson(res: Response): boolean {
  return /json/i.test(res.headers?.get?.('content-type') ?? '')
}

function presetsOf(v: unknown): EmailPreset[] {
  if (!Array.isArray(v)) return [...EMAIL_PRESETS]
  const list = v.filter((p): p is EmailPreset => {
    const o = p as Json | null
    return !!o && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.host === 'string' && typeof o.port === 'number' && typeof o.help === 'string'
  })
  return list.length ? list.map((p) => ({ id: p.id, name: p.name, host: p.host, port: p.port, help: p.help, ...(str(p.helpUrl) ? { helpUrl: p.helpUrl } : {}) })) : [...EMAIL_PRESETS]
}

/** The saved mailbox as the app may see it. Anything else the server sends is dropped. */
export function accountView(v: unknown): EmailAccountView | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Json
  if (typeof a.address !== 'string' || typeof a.presetId !== 'string') return null
  const okAt = str(a.okAt)
  const lastError = str(a.lastError)
  return {
    presetId: a.presetId as EmailPresetId,
    label: str(a.label) || a.address,
    address: a.address,
    host: str(a.host) ?? '',
    port: typeof a.port === 'number' ? a.port : IMAP_TLS_PORT,
    hasPassword: a.hasPassword === true,
    trustedDomains: Array.isArray(a.trustedDomains) ? a.trustedDomains.filter((d): d is string => typeof d === 'string') : [],
    createdAt: str(a.createdAt) ?? '',
    ...(okAt ? { okAt } : {}),
    ...(lastError ? { lastError } : {}),
  }
}

function testOf(v: unknown): EmailTestResult | null {
  if (!v || typeof v !== 'object' || typeof (v as Json).ok !== 'boolean') return null
  const t = v as Json
  const error = str(t.error)
  const message = str(t.message)
  return {
    ok: t.ok === true,
    ms: typeof t.ms === 'number' ? t.ms : 0,
    ...(typeof t.messageCount === 'number' ? { messageCount: t.messageCount } : {}),
    ...(error ? { error } : {}),
    ...(message ? { message: message.slice(0, 300) } : {}),
  }
}

/** Fetched messages, shape-checked and bounded. Their contents stay untrusted. */
export function messagesOf(v: unknown): EmailMessage[] {
  if (!Array.isArray(v)) return []
  const out: EmailMessage[] = []
  v.slice(0, MAX_MESSAGES).forEach((raw, i) => {
    const m = raw as Json | null
    if (!m || typeof m !== 'object' || typeof m.from !== 'string' || typeof m.body !== 'string') return
    out.push({
      id: (str(m.id) || `mail-${i}`).slice(0, 200),
      // never cut a sender: the cut could end on another address. One too long to be real is refused instead.
      from: m.from.length <= MAX_FROM ? m.from : '',
      subject: (str(m.subject) ?? '').slice(0, 500),
      date: (str(m.date) ?? '').slice(0, 64),
      body: m.body.slice(0, MAX_BODY),
      source: str(m.source) || 'imap',
      // only a failure travels: nothing the server sends can make a message more trusted
      ...(m.senderCheck === 'fail' ? { senderCheck: 'fail' as const } : {}),
    })
  })
  return out
}

export class EmailClient {
  constructor(public baseUrl = '/api', private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  /** GET /api/email/account. Anything but a local FundBun answer is `{ local: false }`. */
  async state(timeoutMs = 4000): Promise<EmailState> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/email/account`, { headers: { Accept: 'application/json' }, signal: deadline(timeoutMs) })
      if (!res.ok || !isJson(res)) return EMAIL_UNAVAILABLE
      const body = (await res.json()) as Json | null
      if (body?.local !== true) return EMAIL_UNAVAILABLE
      return { local: true, presets: presetsOf(body.presets), account: accountView(body.account), keyStorage: str(body.keyStorage) ?? '' }
    } catch {
      return EMAIL_UNAVAILABLE
    }
  }

  /**
   * POST /api/email/account: save the mailbox after one live, read-only sign-in test. The server answers
   * 200 { ok: true, account, ms, messageCount }, 400 invalid_input, or 502 with the test's error; only a test
   * that passed saves anything.
   */
  async connect(input: NewEmailAccountInput): Promise<EmailResult<{ account: EmailAccountView | null; test: EmailTestResult | null }>> {
    const r = await this.send('POST', '/email/account', input, 60_000)
    if (!r.ok) return r
    return { ok: true, account: accountView(r.json.account), test: testOf(r.json) }
  }

  /** PATCH /api/email/account { trustedDomains }: 200 { ok: true, account }, 400 invalid_input, 404 no_account. */
  async update(patch: { trustedDomains: string[] }): Promise<EmailResult<{ account: EmailAccountView | null }>> {
    const r = await this.send('PATCH', '/email/account', patch)
    if (!r.ok) return r
    return { ok: true, account: accountView(r.json.account) }
  }

  /** DELETE /api/email/account: forget the mailbox and its password on this computer. */
  async disconnect(): Promise<EmailResult<object>> {
    const r = await this.send('DELETE', '/email/account')
    return r.ok ? { ok: true } : r
  }

  /** POST /api/email/account/test: sign in again and count the inbox (EXAMINE only). Always 200 with the result. */
  async test(): Promise<EmailTestResult> {
    const r = await this.send('POST', '/email/account/test', {}, 60_000)
    if (!r.ok) return { ok: false, ms: 0, error: r.error, message: r.message }
    return testOf(r.json) ?? { ok: false, ms: 0, error: 'protocol_error', message: 'FundBun gave an answer this app does not understand.' }
  }

  /** POST /api/email/check { days }: 200 EmailCheckResult (bodies untrusted), 404 no_account, 502 on an IMAP error. */
  async check(days?: number): Promise<EmailResult<EmailCheckResult>> {
    const r = await this.send('POST', '/email/check', days === undefined ? {} : { days }, 120_000)
    if (!r.ok) return r
    const messages = messagesOf(r.json.messages)
    return {
      ok: true,
      source: (str(r.json.source) ?? 'custom') as EmailPresetId,
      messages,
      scanned: typeof r.json.scanned === 'number' ? r.json.scanned : messages.length,
    }
  }

  private async send(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<EmailResult<{ json: Json }>> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: deadline(timeoutMs),
      })
    } catch {
      return { ok: false, local: false, error: 'network', message: NO_ANSWER }
    }
    const json = isJson(res) ? ((await res.json().catch(() => null)) as Json | null) : null
    const error = str(json?.error)
    const message = str(json?.message)?.slice(0, 300)
    // no local server here (hosted web, an older FundBun) or not allowed from this page
    if (!json || res.status === 403 || (res.status === 404 && (!error || error === 'not_found'))) {
      return { ok: false, local: false, error: error ?? `http_${res.status}`, message: NOT_HERE }
    }
    if (!res.ok || json.ok === false) return { ok: false, local: true, error: error ?? `http_${res.status}`, message: message ?? `FundBun answered HTTP ${res.status}.` }
    return { ok: true, json }
  }
}
