import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_TRUSTED_DOMAINS, isEmailAddress, normaliseDomain, presetById, type EmailPresetId } from '../../src/core/email/account'

/**
 * The one mailbox the user connected, kept on this computer in <home>/email.json next to the AI connections,
 * readable only by the user's account. The password goes through the same SecretCodec as the AI keys: the
 * desktop app encrypts it with the system keychain; the plain local server relies on the file's permissions.
 */
export interface StoredEmailAccount {
  presetId: EmailPresetId
  label: string
  address: string
  host: string
  port: number
  /** the password encoded by the SecretCodec; never sent to the app */
  secret: string
  trustedDomains: string[]
  createdAt: string
  okAt?: string
  lastError?: string
}

export interface StoredEmail {
  version: 1
  account: StoredEmailAccount | null
}

export const EMPTY_EMAIL: StoredEmail = { version: 1, account: null }

export interface EmailStore {
  readonly home: string
  load(): StoredEmail
  save(next: StoredEmail): void
}

/** File store: atomic writes (temp + rename), folder 0700, file 0600. A damaged file reads as no account, never throws. */
export function createEmailStore(home: string): EmailStore {
  const file = join(home, 'email.json')
  return {
    home,
    load() {
      try {
        if (!existsSync(file)) return structuredClone(EMPTY_EMAIL)
        return normaliseEmail(JSON.parse(readFileSync(file, 'utf8')))
      } catch {
        return structuredClone(EMPTY_EMAIL)
      }
    },
    save(next) {
      mkdirSync(home, { recursive: true, mode: 0o700 })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(normaliseEmail(next), null, 2), { mode: 0o600 })
      renameSync(tmp, file)
      try {
        chmodSync(file, 0o600)
      } catch {
        // best effort on file systems without POSIX modes
      }
    },
  }
}

export function createMemoryEmailStore(initial: StoredEmail = EMPTY_EMAIL, home = '/tmp/fundbun-test'): EmailStore {
  let state = structuredClone(initial)
  return { home, load: () => structuredClone(state), save: (next) => void (state = structuredClone(next)) }
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)

/** Keep only a well-formed account: a hand-edited, half-written or newer file must not crash the server. */
export function normaliseEmail(raw: unknown): StoredEmail {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as { version?: unknown; account?: unknown }
  if (r.version !== 1 || !r.account || typeof r.account !== 'object') return structuredClone(EMPTY_EMAIL)
  const a = r.account as Record<string, unknown>
  const preset = presetById(a.presetId)
  const address = a.address
  const host = normaliseDomain(a.host)
  const port = a.port
  const secret = str(a.secret, 8000)
  if (!preset || !isEmailAddress(address) || !host || host !== a.host || !secret) return structuredClone(EMPTY_EMAIL)
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return structuredClone(EMPTY_EMAIL)
  const domains: string[] = []
  for (const d of Array.isArray(a.trustedDomains) ? a.trustedDomains : []) {
    const clean = normaliseDomain(d)
    if (clean && clean === d && !domains.includes(clean) && domains.length < MAX_TRUSTED_DOMAINS) domains.push(clean)
  }
  const label = str(a.label, 60)?.trim()
  const account: StoredEmailAccount = {
    presetId: preset.id,
    label: label || preset.name,
    address,
    host,
    port,
    secret,
    trustedDomains: domains,
    createdAt: str(a.createdAt, 40) ?? new Date(0).toISOString(),
  }
  const okAt = str(a.okAt, 40)
  const lastError = str(a.lastError, 300)
  if (okAt) account.okAt = okAt
  if (lastError) account.lastError = lastError
  return { version: 1, account }
}
