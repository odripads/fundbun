/**
 * A real mailbox the user connects to read receipts and bank alerts (read only). Shared by the local server and
 * the app: pure, no DOM and no Node imports. The password never reaches the app: the view only says `hasPassword`.
 */
import type { EmailMessage } from './types'

export type EmailPresetId = 'gmail' | 'icloud' | 'outlook' | 'qq' | '163' | 'custom'

export interface EmailPreset {
  id: EmailPresetId
  name: string
  /** empty for 'custom': the user types the server */
  host: string
  port: number
  /** which password to use (an App Password, a 授权码) and where IMAP is switched on */
  help: string
  /** the page where that password is made, when there is one */
  helpUrl?: string
}

/** What the app may see of the saved mailbox. */
export interface EmailAccountView {
  presetId: EmailPresetId
  label: string
  address: string
  host: string
  port: number
  hasPassword: boolean
  /** extra sender domains the user trusts beyond the built-in bank and wallet list */
  trustedDomains: string[]
  createdAt: string
  okAt?: string
  lastError?: string
}

/** GET /api/email/account */
export interface EmailAccountState {
  local: true
  presets: EmailPreset[]
  account: EmailAccountView | null
  /** how the password is kept, for example "Keys are encrypted with your Mac's Keychain and kept on this computer." */
  keyStorage: string
}

/** POST /api/email/account */
export interface NewEmailAccountInput {
  presetId: EmailPresetId
  address: string
  /** an App Password or 授权码; used for one live test, then kept encrypted on this computer */
  password: string
  /** 'custom' only */
  host?: string
  port?: number
  label?: string
  trustedDomains?: string[]
}

/** POST /api/email/account/test, and the test inside POST /api/email/account */
export interface EmailTestResult {
  ok: boolean
  ms: number
  /** messages in INBOX, from EXAMINE */
  messageCount?: number
  /** a stable code: 'auth_failed', 'imap_disabled', 'connection_failed', 'tls_failed', 'timeout', 'invalid_input', 'no_account', 'protocol_error' */
  error?: string
  /** a plain sentence for the user; never holds the password */
  message?: string
}

/** POST /api/email/check { days?: number } */
export interface EmailCheckResult {
  source: EmailPresetId
  /** bodies are UNTRUSTED: the app runs processInbox (allowlist, injection scan, parser) before showing anything */
  messages: EmailMessage[]
  scanned: number
}

export const IMAP_TLS_PORT = 993
export const MAX_TRUSTED_DOMAINS = 20
/** how far back "Check my inbox" looks, in days */
export const CHECK_DAYS = { min: 1, max: 90, default: 30 } as const

export const EMAIL_PRESETS: readonly EmailPreset[] = [
  {
    id: 'gmail', name: 'Gmail', host: 'imap.gmail.com', port: IMAP_TLS_PORT,
    help: 'Use an App Password, not your Google password: turn on 2-Step Verification, then create one. IMAP must be on in Gmail settings.',
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  {
    id: 'icloud', name: 'iCloud Mail', host: 'imap.mail.me.com', port: IMAP_TLS_PORT,
    help: 'Use an app-specific password from your Apple Account (Sign-In and Security). Your Apple Account password will not work.',
    helpUrl: 'https://account.apple.com/',
  },
  {
    id: 'outlook', name: 'Outlook', host: 'outlook.office365.com', port: IMAP_TLS_PORT,
    help: 'Use an app password if your account has two-step verification. Microsoft may refuse password sign-in for IMAP on some accounts; if it does, Outlook cannot be connected this way yet.',
    helpUrl: 'https://account.live.com/proofs/AppPassword',
  },
  {
    id: 'qq', name: 'QQ Mail', host: 'imap.qq.com', port: IMAP_TLS_PORT,
    help: 'Use the 授权码 (authorization code), not your QQ password. In QQ Mail: 设置, 账户, turn on the IMAP/SMTP service, then generate the 授权码.',
  },
  {
    id: '163', name: '163 Mail', host: 'imap.163.com', port: IMAP_TLS_PORT,
    help: 'Use the 授权码 (authorization code), not your password. In 163 Mail: 设置, POP3/SMTP/IMAP, turn on the IMAP service, then create the 授权码.',
  },
  {
    id: 'custom', name: 'Another mailbox (IMAP)', host: '', port: IMAP_TLS_PORT,
    help: "Type your provider's IMAP server. It must accept TLS, usually on port 993.",
  },
]

export function presetById(id: unknown): EmailPreset | undefined {
  return EMAIL_PRESETS.find((p) => p.id === id)
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** "@Bank.Example.COM " → "bank.example.com"; null when it is not a plain domain name. */
export function normaliseDomain(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const d = text.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '')
  return DOMAIN_RE.test(d) ? d : null
}

/** "bca.co.id, grab.com" → the valid domains (deduplicated, at most MAX_TRUSTED_DOMAINS) and what was not one. */
export function parseDomainList(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = []
  const invalid: string[] = []
  for (const part of String(text ?? '').split(/[\s,;，、]+/).filter(Boolean)) {
    const d = normaliseDomain(part)
    if (!d) invalid.push(part)
    else if (!domains.includes(d) && domains.length < MAX_TRUSTED_DOMAINS) domains.push(d)
  }
  return { domains, invalid }
}

/** A plain mailbox address (no display name, no spaces, no line breaks). */
export function isEmailAddress(text: unknown): text is string {
  return typeof text === 'string' && text.length <= 254 && /^[^\s@<>()",;:\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(text)
}
