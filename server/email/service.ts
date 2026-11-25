import {
  EMAIL_PRESETS,
  IMAP_TLS_PORT,
  MAX_TRUSTED_DOMAINS,
  isEmailAddress,
  normaliseDomain,
  presetById,
  type EmailAccountState,
  type EmailAccountView,
  type EmailCheckResult,
  type EmailTestResult,
} from '../../src/core/email/account'
import { isTrustableDomain } from '../../src/core/email/allowlist'
import type { EmailMessage } from '../../src/core/email/types'
import { PLAIN_CODEC, type SecretCodec } from '../ai/store'
import { ImapError, checkHost, clampDays, createImapClient, type ImapAccount, type ImapClient } from './imap'
import { EMPTY_EMAIL, type EmailStore, type StoredEmailAccount } from './store'

/**
 * The user's mailbox on this computer: connect it (after one live, read-only test), check it for receipts and
 * bank alerts, and forget it. The password is only ever decoded here, to sign in; the app sees `hasPassword`.
 * Message bodies pass straight through to the app (which filters and scans them) and are never stored or logged.
 */
export interface EmailServiceOptions {
  store: EmailStore
  codec?: SecretCodec
  /** the IMAP client (test seam); defaults to the real one over TLS */
  imap?: ImapClient
  now?: () => Date
}

export type EmailFailure = { ok: false; status: 400 | 404 | 502; error: string; message: string }

export interface EmailService {
  state(): EmailAccountState
  connect(input: unknown): Promise<{ ok: true; account: EmailAccountView; ms: number; messageCount: number } | EmailFailure>
  setTrustedDomains(input: unknown): { ok: true; account: EmailAccountView } | EmailFailure
  /** forgets the mailbox and its password; safe to call when none is saved */
  remove(): void
  test(): Promise<EmailTestResult>
  check(input: unknown): Promise<{ ok: true; value: EmailCheckResult } | EmailFailure>
}

const MAX_PASSWORD = 256
const MAX_LABEL = 60

const NO_ACCOUNT = 'No mailbox is connected yet.'
/** a password saved by the desktop app cannot be read by a server started without its keychain */
const LOCKED = 'The saved password could not be unlocked on this computer. Connect the mailbox again.'
const invalid = (message: string): EmailFailure => ({ ok: false, status: 400, error: 'invalid_input', message })

function view(a: StoredEmailAccount): EmailAccountView {
  return {
    presetId: a.presetId, label: a.label, address: a.address, host: a.host, port: a.port, hasPassword: Boolean(a.secret),
    trustedDomains: [...a.trustedDomains], createdAt: a.createdAt,
    ...(a.okAt ? { okAt: a.okAt } : {}), ...(a.lastError ? { lastError: a.lastError } : {}),
  }
}

/**
 * The extra sender domains the user trusts: every entry must be a plain domain name that names one sender. Open
 * webmail (gmail.com, qq.com) and shared suffixes (co.id) are refused, as the app would never trust them anyway.
 */
function readDomains(value: unknown): { ok: true; value: string[] } | EmailFailure {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) return invalid('Trusted senders must be a list of domain names.')
  if (value.length > MAX_TRUSTED_DOMAINS) return invalid(`At most ${MAX_TRUSTED_DOMAINS} trusted sender domains.`)
  const domains: string[] = []
  for (const item of value) {
    const d = normaliseDomain(item)
    if (!d) return invalid(`"${String(item).slice(0, 60)}" is not a domain name, like bank.example.com.`)
    if (!isTrustableDomain(d)) return invalid(`Anyone can send email from ${d}, so it cannot be a trusted sender.`)
    if (!domains.includes(d)) domains.push(d)
  }
  return { ok: true, value: domains }
}

type Checked = Omit<StoredEmailAccount, 'secret' | 'createdAt'> & { password: string }

/** Validates a new mailbox before anything is sent anywhere. */
function readInput(input: unknown): { ok: true; value: Checked } | EmailFailure {
  const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const preset = presetById(body.presetId)
  if (!preset) return invalid('Pick your mail provider.')
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!isEmailAddress(address)) return invalid('Type your full email address, like name@example.com.')
  const password = body.password
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD || /[\r\n\u0000]/.test(password)) {
    return invalid('Paste the App Password or 授权码 (one line, at most 256 characters).')
  }
  let host = preset.host
  let port = preset.port
  if (preset.id === 'custom') {
    const h = checkHost(typeof body.host === 'string' ? body.host.trim() : '')
    if (!h || !normaliseDomain(h)) return invalid('Type the IMAP server name, like imap.example.com. Servers on this computer or a private network are not allowed.')
    host = h
    port = body.port === undefined || body.port === null ? IMAP_TLS_PORT : (body.port as number)
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return invalid('The port must be a whole number from 1 to 65535.')
  }
  if (body.label !== undefined && body.label !== null && (typeof body.label !== 'string' || body.label.trim().length > MAX_LABEL)) {
    return invalid(`The name must be at most ${MAX_LABEL} characters.`)
  }
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : preset.id === 'custom' ? host : preset.name
  const domains = readDomains(body.trustedDomains)
  if (!domains.ok) return domains
  return { ok: true, value: { presetId: preset.id, label, address, host, port, password, trustedDomains: domains.value } }
}

const failureOf = (err: unknown): { error: string; message: string } =>
  err instanceof ImapError ? { error: err.code, message: err.message } : { error: 'protocol_error', message: 'The mailbox could not be read.' }

export function createEmailService(opts: EmailServiceOptions): EmailService {
  const { store } = opts
  const codec = opts.codec ?? PLAIN_CODEC
  const imap = opts.imap ?? createImapClient()
  const now = () => opts.now?.() ?? new Date()

  const saved = (): StoredEmailAccount | null => store.load().account
  const passwordOf = (a: StoredEmailAccount): string => {
    try {
      return codec.decode(a.secret)
    } catch {
      return ''
    }
  }
  const imapAccount = (a: StoredEmailAccount): ImapAccount | null => {
    const password = passwordOf(a)
    return password ? { host: a.host, port: a.port, address: a.address, password } : null
  }
  /** Records how the last use went, only if the same mailbox is still the saved one (it may have changed meanwhile). */
  const record = (a: StoredEmailAccount, outcome: { ok: true } | { ok: false; message: string }) => {
    const data = store.load()
    const current = data.account
    if (!current || current.createdAt !== a.createdAt || current.address !== a.address || current.host !== a.host) return
    if (outcome.ok) {
      current.okAt = now().toISOString()
      delete current.lastError
    } else current.lastError = outcome.message.slice(0, 300)
    store.save(data)
  }

  return {
    state() {
      const account = saved()
      return { local: true, presets: EMAIL_PRESETS.map((p) => ({ ...p })), account: account ? view(account) : null, keyStorage: codec.describe }
    },

    async connect(input) {
      const checked = readInput(input)
      if (!checked.ok) return checked
      const { password, ...rest } = checked.value
      const started = Date.now()
      let messageCount: number
      try {
        messageCount = (await imap.test({ host: rest.host, port: rest.port, address: rest.address, password })).messageCount
      } catch (err) {
        const f = failureOf(err)
        // nothing was saved: a mailbox is only kept once it has worked
        return { ok: false, status: f.error === 'invalid_input' ? 400 : 502, ...f }
      }
      const at = now().toISOString()
      const account: StoredEmailAccount = { ...rest, secret: codec.encode(password), createdAt: at, okAt: at }
      store.save({ version: 1, account })
      return { ok: true, account: view(account), ms: Date.now() - started, messageCount }
    },

    setTrustedDomains(input) {
      const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
      if (!Array.isArray(body.trustedDomains)) return invalid('Send { trustedDomains: [...] }.')
      const domains = readDomains(body.trustedDomains)
      if (!domains.ok) return domains
      const data = store.load()
      if (!data.account) return { ok: false, status: 404, error: 'no_account', message: NO_ACCOUNT }
      data.account.trustedDomains = domains.value
      store.save(data)
      return { ok: true, account: view(data.account) }
    },

    remove() {
      // always rewritten: a file this build cannot read (newer, hand-edited) may still hold a password
      store.save(structuredClone(EMPTY_EMAIL))
    },

    async test() {
      const account = saved()
      if (!account) return { ok: false, ms: 0, error: 'no_account', message: NO_ACCOUNT }
      const login = imapAccount(account)
      if (!login) {
        record(account, { ok: false, message: LOCKED })
        return { ok: false, ms: 0, error: 'auth_failed', message: LOCKED }
      }
      const started = Date.now()
      try {
        const { messageCount } = await imap.test(login)
        record(account, { ok: true })
        return { ok: true, ms: Date.now() - started, messageCount }
      } catch (err) {
        const f = failureOf(err)
        record(account, { ok: false, message: f.message })
        return { ok: false, ms: Date.now() - started, ...f }
      }
    },

    async check(input) {
      const account = saved()
      if (!account) return { ok: false, status: 404, error: 'no_account', message: NO_ACCOUNT }
      const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
      const days = clampDays(body.days)
      const login = imapAccount(account)
      if (!login) {
        record(account, { ok: false, message: LOCKED })
        return { ok: false, status: 502, error: 'auth_failed', message: LOCKED }
      }
      try {
        const { mails } = await imap.fetch(login, { days })
        record(account, { ok: true })
        const messages: EmailMessage[] = mails.map((m) => ({
          id: `${account.presetId}-${m.id}`, from: m.from, subject: m.subject, date: m.date, body: m.body, source: account.presetId,
          ...(m.senderCheck === 'fail' ? { senderCheck: 'fail' as const } : {}),
        }))
        return { ok: true, value: { source: account.presetId, messages, scanned: messages.length } }
      } catch (err) {
        const f = failureOf(err)
        record(account, { ok: false, message: f.message })
        return { ok: false, status: 502, ...f }
      }
    },
  }
}
