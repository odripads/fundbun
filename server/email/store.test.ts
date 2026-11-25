import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SecretCodec } from '../ai/store'
import { createEmailService } from './service'
import { EMPTY_EMAIL, createEmailStore, createMemoryEmailStore, normaliseEmail, type StoredEmail, type StoredEmailAccount } from './store'

const POSIX = process.platform !== 'win32'

const account = (over: Partial<StoredEmailAccount> = {}): StoredEmailAccount => ({
  presetId: 'qq',
  label: 'QQ Mail',
  address: 'jing@qq.com',
  host: 'imap.qq.com',
  port: 993,
  secret: 'plain:not-a-real-code',
  trustedDomains: ['bank.example.com'],
  createdAt: '2026-11-25T08:00:00.000Z',
  ...over,
})
const saved = (a: StoredEmailAccount | null = account()): StoredEmail => ({ version: 1, account: a })

const dirs: string[] = []
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fundbun-email-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('normaliseEmail', () => {
  it('keeps a well-formed account exactly as stored', () => {
    const a = account({ okAt: '2026-11-25T09:00:00.000Z', lastError: 'The mail server took too long to answer.' })
    expect(normaliseEmail(saved(a))).toEqual(saved(a))
  })

  it.each([
    ['null', null],
    ['a list', [saved()]],
    ['a string', 'email'],
    ['no version', { account: account() }],
    ['a newer version', { version: 2, account: account() }],
    ['an unknown preset', saved(account({ presetId: 'yahoo' as never }))],
    ['a bad address', saved(account({ address: 'Jing <jing@qq.com>' }))],
    ['a bad host', saved(account({ host: 'imap.qq.com\r\nA1 LOGOUT' }))],
    ['an upper-case host', saved(account({ host: 'IMAP.QQ.COM' }))],
    ['an IP host', saved(account({ host: '10.0.0.1' }))],
    ['port 0', saved(account({ port: 0 }))],
    ['a text port', saved(account({ port: '993' as never }))],
    ['no secret', saved(account({ secret: '' }))],
    ['a huge secret', saved(account({ secret: 's'.repeat(8001) }))],
  ])('reads %s as no account', (_what, raw) => {
    expect(normaliseEmail(raw)).toEqual(EMPTY_EMAIL)
  })

  it('drops malformed optional fields and bad trusted domains but keeps the account', () => {
    const out = normaliseEmail({
      version: 1,
      account: { ...account(), label: 'L'.repeat(61), trustedDomains: ['good.example.com', 'good.example.com', 'not a domain', 7, 'UPPER.example.com'], okAt: 5, lastError: 'e'.repeat(301), createdAt: null },
    })
    expect(out.account).toEqual({ ...account(), label: 'QQ Mail', trustedDomains: ['good.example.com'], createdAt: '1970-01-01T00:00:00.000Z' })
  })

  it('never copies fields it does not know (a hand-edited file cannot smuggle a password in)', () => {
    const out = normaliseEmail({ version: 1, account: { ...account(), password: 'plain-text-password', hasPassword: true }, extra: 1 })
    expect(Object.keys(out)).toEqual(['version', 'account'])
    expect(JSON.stringify(out)).not.toContain('plain-text-password')
  })

  it('keeps at most 20 trusted domains', () => {
    const many = Array.from({ length: 30 }, (_, i) => `bank${i}.example.com`)
    expect(normaliseEmail(saved(account({ trustedDomains: many }))).account?.trustedDomains).toHaveLength(20)
  })
})

describe('createEmailStore', () => {
  it('loads as no account when nothing was saved, without creating anything', () => {
    const home = join(tempHome(), 'not-yet')
    const store = createEmailStore(home)
    expect(store.home).toBe(home)
    expect(store.load()).toEqual(EMPTY_EMAIL)
    expect(existsSync(home)).toBe(false)
  })

  it('round-trips through <home>/email.json and leaves no temporary file', () => {
    const home = tempHome()
    createEmailStore(home).save(saved())
    expect(createEmailStore(home).load()).toEqual(saved())
    expect(JSON.parse(readFileSync(join(home, 'email.json'), 'utf8'))).toEqual(saved())
    createEmailStore(home).save(EMPTY_EMAIL)
    expect(readdirSync(home)).toEqual(['email.json'])
    expect(createEmailStore(home).load()).toEqual(EMPTY_EMAIL)
  })

  it.runIf(POSIX)('writes the file for the user only (0600) in a folder for the user only (0700)', () => {
    const home = join(tempHome(), 'nested', 'fundbun')
    createEmailStore(home).save(saved())
    expect(statSync(home).mode & 0o777).toBe(0o700)
    expect(statSync(join(home, 'email.json')).mode & 0o777).toBe(0o600)
  })

  it.runIf(POSIX)('tightens a file that was left readable by others', () => {
    const home = tempHome()
    writeFileSync(join(home, 'email.json'), '{}', { mode: 0o644 })
    createEmailStore(home).save(saved())
    expect(statSync(join(home, 'email.json')).mode & 0o777).toBe(0o600)
  })

  it.each([
    ['not JSON', '{"version":1,"account":{'],
    ['empty', ''],
    ['JSON null', 'null'],
    ['binary noise', '\u0000\u0001�'],
    ['an unknown shape', '{"accounts":[1,2]}'],
  ])('a damaged file (%s) loads as no account without throwing', (_what, content) => {
    const home = tempHome()
    writeFileSync(join(home, 'email.json'), content)
    expect(() => createEmailStore(home).load()).not.toThrow()
    expect(createEmailStore(home).load()).toEqual(EMPTY_EMAIL)
  })

  it('does not share objects with the caller', () => {
    const store = createMemoryEmailStore(saved())
    const loaded = store.load()
    loaded.account!.label = 'changed'
    expect(store.load().account?.label).toBe('QQ Mail')
    expect(EMPTY_EMAIL.account).toBeNull()
  })
})

describe('the password on disk', () => {
  // stands in for the desktop app's keychain codec (safe: + ciphertext)
  const keychainLike: SecretCodec = {
    describe: 'Keys are encrypted with a test keychain.',
    encode: (plain) => `safe:${Buffer.from(plain, 'utf8').reverse().toString('base64')}`,
    decode: (stored) => (stored.startsWith('safe:') ? Buffer.from(stored.slice(5), 'base64').reverse().toString('utf8') : ''),
  }

  it('goes through the codec, so it is never in the file in plain text', async () => {
    const home = tempHome()
    const password = 'abcd efgh ijkl mnop'
    const seen: string[] = []
    const email = createEmailService({
      store: createEmailStore(home),
      codec: keychainLike,
      imap: {
        test: async (a) => {
          seen.push(a.password)
          return { messageCount: 1 }
        },
        fetch: async () => ({ messageCount: 0, mails: [] }),
      },
    })
    const r = await email.connect({ presetId: 'gmail', address: 'jing@gmail.com', password })
    expect(r.ok).toBe(true)
    const file = readFileSync(join(home, 'email.json'), 'utf8')
    expect(file).not.toContain(password)
    expect(file).toContain('"secret": "safe:')
    // a restart reads it back through the codec
    await createEmailService({ store: createEmailStore(home), codec: keychainLike, imap: { test: async (a) => (seen.push(a.password), { messageCount: 1 }), fetch: async () => ({ messageCount: 0, mails: [] }) } }).test()
    expect(seen).toEqual([password, password])
  })
})
