import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EMAIL_PRESETS } from '../../src/core/email/account'
import type { SecretCodec } from '../ai/store'
import { ImapError, type ImapAccount, type ImapClient, type ImapMail } from './imap'
import { createEmailService } from './service'
import { createEmailStore, createMemoryEmailStore, type StoredEmail } from './store'

const PASSWORD = 'qq-auth-code-1234'
const NOW = new Date('2026-11-25T12:00:00.000Z')

const codec: SecretCodec = {
  describe: 'Test encrypted codec',
  encode: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decode: (stored) => (stored.startsWith('enc:') ? Buffer.from(stored.slice(4), 'base64').toString('utf8') : ''),
}

const MAIL: ImapMail = { id: '0123456789abcdef01234567', from: '微信支付 <service@tenpay.com>', subject: '微信支付凭证', date: '2026-11-21T00:15:00.000Z', body: '付款金额：¥23.50' }

function fakeImap(over: Partial<ImapClient> = {}) {
  const calls: { kind: 'test' | 'fetch'; account: ImapAccount; days?: number }[] = []
  const imap: ImapClient = {
    test: vi.fn(async (account: ImapAccount) => {
      calls.push({ kind: 'test', account })
      return { messageCount: 12 }
    }),
    fetch: vi.fn(async (account: ImapAccount, opts?: { days?: number }) => {
      calls.push({ kind: 'fetch', account, days: opts?.days })
      return { messageCount: 12, mails: [MAIL] }
    }),
    ...over,
  }
  return { imap, calls }
}

function setup(initial?: StoredEmail, over: Partial<ImapClient> = {}) {
  const store = createMemoryEmailStore(initial)
  const { imap, calls } = fakeImap(over)
  const email = createEmailService({ store, codec, imap, now: () => NOW })
  return { store, email, imap, calls }
}

const QQ = { presetId: 'qq', address: 'jing@qq.com', password: PASSWORD }

async function connected(over: Partial<ImapClient> = {}) {
  const s = setup(undefined, over)
  const r = await s.email.connect(QQ)
  expect(r.ok).toBe(true)
  return s
}

describe('state', () => {
  it('lists the presets, no account and how the password is kept', () => {
    const { email } = setup()
    expect(email.state()).toEqual({ local: true, presets: EMAIL_PRESETS.map((p) => ({ ...p })), account: null, keyStorage: 'Test encrypted codec' })
  })
})

describe('connect', () => {
  it('tests the mailbox live, then saves it with the password encoded and never shown', async () => {
    const { email, store, calls } = setup()
    const r = await email.connect({ ...QQ, trustedDomains: ['@Bank.Example.COM', 'bank.example.com', 'grab.com'] })
    expect(r).toMatchObject({ ok: true, messageCount: 12 })
    if (!r.ok) return
    expect(r.ms).toBeGreaterThanOrEqual(0)
    expect(r.account).toEqual({
      presetId: 'qq', label: 'QQ Mail', address: 'jing@qq.com', host: 'imap.qq.com', port: 993, hasPassword: true,
      trustedDomains: ['bank.example.com', 'grab.com'], createdAt: NOW.toISOString(), okAt: NOW.toISOString(),
    })
    expect(calls).toEqual([{ kind: 'test', account: { host: 'imap.qq.com', port: 993, address: 'jing@qq.com', password: PASSWORD } }])
    const stored = store.load().account!
    expect(stored.secret).toBe(codec.encode(PASSWORD))
    expect(JSON.stringify([r, email.state()])).not.toContain(PASSWORD)
    expect(JSON.stringify([r, email.state()])).not.toContain(stored.secret)
  })

  it('uses the preset server, whatever host the app sends for a preset', async () => {
    const { email, calls } = setup()
    await email.connect({ ...QQ, presetId: 'gmail', host: 'evil.example.com', port: 25 })
    expect(calls[0].account).toMatchObject({ host: 'imap.gmail.com', port: 993 })
  })

  it('takes the server and port for "custom", defaulting to 993 and naming it after the server', async () => {
    const { email, calls } = setup()
    const r = await email.connect({ presetId: 'custom', address: 'me@example.org', password: 'pw', host: ' Mail.Example.ORG ' })
    expect(r).toMatchObject({ ok: true, account: { host: 'mail.example.org', port: 993, label: 'mail.example.org' } })
    await email.connect({ presetId: 'custom', address: 'me@example.org', password: 'pw', host: 'mail.example.org', port: 1993, label: ' Work mail ' })
    expect(calls[1].account).toMatchObject({ host: 'mail.example.org', port: 1993 })
    expect(email.state().account).toMatchObject({ label: 'Work mail', port: 1993 })
  })

  it.each([
    ['no body', undefined],
    ['an unknown preset', { ...QQ, presetId: 'yahoo' }],
    ['no address', { ...QQ, address: '' }],
    ['an address with a display name', { ...QQ, address: 'Jing <jing@qq.com>' }],
    ['an address with a line break', { ...QQ, address: 'jing@qq.com\r\nA1 LOGOUT' }],
    ['no password', { ...QQ, password: '' }],
    ['a password that is not text', { ...QQ, password: 1234 }],
    ['a password with a line break', { ...QQ, password: 'abc\r\nA9 DELETE INBOX' }],
    ['a password with NUL', { ...QQ, password: 'abc\u0000' }],
    ['a password over 256 characters', { ...QQ, password: 'p'.repeat(257) }],
    ['a custom server that is an IP address', { ...QQ, presetId: 'custom', host: '127.0.0.1' }],
    ['a custom server on this computer', { ...QQ, presetId: 'custom', host: 'localhost' }],
    ['a custom server on the local network', { ...QQ, presetId: 'custom', host: 'nas.local' }],
    ['a custom server with a port in it', { ...QQ, presetId: 'custom', host: 'mail.example.org:993' }],
    ['a custom server with no name', { ...QQ, presetId: 'custom' }],
    ['port 0', { ...QQ, presetId: 'custom', host: 'mail.example.org', port: 0 }],
    ['port 65536', { ...QQ, presetId: 'custom', host: 'mail.example.org', port: 65536 }],
    ['a text port', { ...QQ, presetId: 'custom', host: 'mail.example.org', port: '993' }],
    ['a label over 60 characters', { ...QQ, label: 'L'.repeat(61) }],
    ['a label that is not text', { ...QQ, label: 7 }],
    ['trusted domains that are not a list', { ...QQ, trustedDomains: 'bank.com' }],
    ['a trusted domain that is not a domain', { ...QQ, trustedDomains: ['bank.com', 'not a domain'] }],
    ['more than 20 trusted domains', { ...QQ, trustedDomains: Array.from({ length: 21 }, (_, i) => `b${i}.example.com`) }],
  ])('refuses %s with 400 invalid_input, before any connection', async (_what, input) => {
    const { email, store, calls } = setup()
    const r = await email.connect(input)
    expect(r).toMatchObject({ ok: false, status: 400, error: 'invalid_input' })
    expect(calls).toEqual([])
    expect(store.load().account).toBeNull()
  })

  it('saves nothing when the live test fails, and keeps the mailbox that was there', async () => {
    const { email, store, imap } = await connected()
    const before = store.load()
    vi.mocked(imap.test).mockRejectedValueOnce(new ImapError('auth_failed', 'The mailbox did not accept this sign-in.'))
    const r = await email.connect({ presetId: 'gmail', address: 'jing@gmail.com', password: 'wrong-password' })
    expect(r).toEqual({ ok: false, status: 502, error: 'auth_failed', message: 'The mailbox did not accept this sign-in.' })
    expect(store.load()).toEqual(before)
  })

  it('a server that resolves to a private address is invalid input (400)', async () => {
    const { email, store } = setup(undefined, { test: async () => { throw new ImapError('invalid_input', 'That server name points to this computer or a private network.') } })
    const r = await email.connect({ presetId: 'custom', address: 'me@example.org', password: 'pw', host: 'rebind.example.org' })
    expect(r).toMatchObject({ ok: false, status: 400, error: 'invalid_input' })
    expect(store.load().account).toBeNull()
  })

  it('an unexpected failure is a protocol error with a plain message', async () => {
    const { email } = setup(undefined, { test: async () => { throw new Error(`socket said ${PASSWORD}`) } })
    const r = await email.connect(QQ)
    expect(r).toEqual({ ok: false, status: 502, error: 'protocol_error', message: 'The mailbox could not be read.' })
  })

  it('a new mailbox replaces the old one', async () => {
    const { email, store } = await connected()
    await email.connect({ presetId: '163', address: 'jing@163.com', password: 'other-code' })
    expect(store.load().account).toMatchObject({ presetId: '163', address: 'jing@163.com', secret: codec.encode('other-code') })
  })
})

describe('trusted sender domains', () => {
  it('replaces the list, normalised and deduplicated', async () => {
    const { email } = await connected()
    const r = email.setTrustedDomains({ trustedDomains: ['BCA.co.id', '@grab.com', 'bca.co.id'] })
    expect(r).toMatchObject({ ok: true, account: { trustedDomains: ['bca.co.id', 'grab.com'] } })
    expect(email.setTrustedDomains({ trustedDomains: [] })).toMatchObject({ ok: true, account: { trustedDomains: [] } })
  })

  it('refuses a bad list with 400 and changes nothing', async () => {
    const { email } = await connected()
    email.setTrustedDomains({ trustedDomains: ['grab.com'] })
    const open = [{ trustedDomains: ['gmail.com'] }, { trustedDomains: ['grab.com', 'QQ.com'] }, { trustedDomains: ['co.id'] }]
    for (const body of [{}, { trustedDomains: 'grab.com' }, { trustedDomains: ['x y'] }, { trustedDomains: Array.from({ length: 21 }, (_, i) => `b${i}.com`) }, ...open]) {
      expect(email.setTrustedDomains(body)).toMatchObject({ ok: false, status: 400, error: 'invalid_input' })
    }
    expect(email.state().account?.trustedDomains).toEqual(['grab.com'])
  })

  it('answers 404 no_account when no mailbox is saved', () => {
    expect(setup().email.setTrustedDomains({ trustedDomains: ['grab.com'] })).toMatchObject({ ok: false, status: 404, error: 'no_account' })
  })
})

describe('remove', () => {
  it('forgets the mailbox and its password, and is safe to repeat', async () => {
    const { email, store } = await connected()
    email.remove()
    expect(store.load().account).toBeNull()
    expect(() => email.remove()).not.toThrow()
    expect(email.state().account).toBeNull()
  })

  it('rewrites the file even when it cannot read it, so a password left in it is gone', () => {
    const home = mkdtempSync(join(tmpdir(), 'fundbun-email-remove-'))
    try {
      const file = join(home, 'email.json')
      const account = { presetId: 'gmail', label: 'Gmail', address: 'me@example.com', host: 'imap.gmail.com', port: 993, secret: 'enc:c2VjcmV0', trustedDomains: [], createdAt: NOW.toISOString() }
      // written by a newer FundBun, and hand-edited: this build reads both as "no account"
      for (const unreadable of [{ version: 2, account }, { version: 1, account: { ...account, host: 'IMAP.GMAIL.COM' } }]) {
        writeFileSync(file, JSON.stringify(unreadable), { mode: 0o600 })
        const email = createEmailService({ store: createEmailStore(home), codec })
        expect(email.state().account).toBeNull()
        email.remove()
        const text = readFileSync(file, 'utf8')
        expect(text).not.toContain('enc:')
        expect(JSON.parse(text)).toEqual({ version: 1, account: null })
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('test', () => {
  it('says no_account when none is saved', async () => {
    expect(await setup().email.test()).toEqual({ ok: false, ms: 0, error: 'no_account', message: 'No mailbox is connected yet.' })
  })

  it('signs in with the decoded password and records when it worked', async () => {
    const { email, calls, store } = await connected()
    store.save({ version: 1, account: { ...store.load().account!, okAt: undefined, lastError: 'old error' } })
    const r = await email.test()
    expect(r).toMatchObject({ ok: true, messageCount: 12 })
    expect(calls.at(-1)?.account.password).toBe(PASSWORD)
    expect(email.state().account).toMatchObject({ okAt: NOW.toISOString() })
    expect(email.state().account).not.toHaveProperty('lastError')
  })

  it('records the error when it fails', async () => {
    const { email, imap } = await connected()
    vi.mocked(imap.test).mockRejectedValueOnce(new ImapError('timeout', 'The mail server took too long to answer.'))
    expect(await email.test()).toMatchObject({ ok: false, error: 'timeout', message: 'The mail server took too long to answer.' })
    expect(email.state().account?.lastError).toBe('The mail server took too long to answer.')
  })

  it('does not record on a mailbox that was replaced while the test ran', async () => {
    let release: () => void = () => undefined
    const { email, store, imap } = await connected()
    vi.mocked(imap.test).mockImplementationOnce(() => new Promise((done) => (release = () => done({ messageCount: 1 }))))
    const running = email.test()
    email.remove()
    release()
    await running
    expect(store.load().account).toBeNull()
  })

  it('a password the keychain cannot unlock asks to connect again, and records it', async () => {
    const { email, store, calls } = await connected()
    store.save({ version: 1, account: { ...store.load().account!, secret: 'safe:from-another-codec' } })
    const before = calls.length
    expect(await email.test()).toMatchObject({ ok: false, error: 'auth_failed', message: expect.stringMatching(/Connect the mailbox again/) })
    expect(calls).toHaveLength(before)
    expect(email.state().account?.lastError).toMatch(/Connect the mailbox again/)
  })
})

describe('check', () => {
  it('answers 404 no_account when none is saved', async () => {
    expect(await setup().email.check({})).toMatchObject({ ok: false, status: 404, error: 'no_account' })
  })

  it('returns the messages as EmailMessage, marked with the provider', async () => {
    const { email } = await connected()
    const r = await email.check({ days: 14 })
    expect(r).toEqual({
      ok: true,
      value: {
        source: 'qq',
        messages: [{ id: `qq-${MAIL.id}`, from: MAIL.from, subject: MAIL.subject, date: MAIL.date, body: MAIL.body, source: 'qq' }],
        scanned: 1,
      },
    })
  })

  it.each([
    [{}, 30], [{ days: 7 }, 7], [{ days: 0 }, 1], [{ days: -5 }, 1], [{ days: 365 }, 90], [{ days: 7.6 }, 8], [{ days: '14' }, 30], [null, 30],
  ])('looks back %j → %i days', async (body, days) => {
    const { email, calls } = await connected()
    await email.check(body)
    expect(calls.at(-1)).toMatchObject({ kind: 'fetch', days })
  })

  it('a password the keychain cannot unlock fails the check without signing in, and records it', async () => {
    const { email, store, calls } = await connected()
    store.save({ version: 1, account: { ...store.load().account!, okAt: NOW.toISOString(), secret: 'safe:from-another-codec' } })
    const before = calls.length
    expect(await email.check({})).toMatchObject({ ok: false, status: 502, error: 'auth_failed', message: expect.stringMatching(/Connect the mailbox again/) })
    expect(calls).toHaveLength(before)
    expect(email.state().account?.lastError).toMatch(/Connect the mailbox again/)
  })

  it('reports an IMAP failure as 502 with its code, and records it', async () => {
    const { email, imap } = await connected()
    vi.mocked(imap.fetch).mockRejectedValueOnce(new ImapError('imap_disabled', 'IMAP is switched off for this mailbox.'))
    expect(await email.check({})).toEqual({ ok: false, status: 502, error: 'imap_disabled', message: 'IMAP is switched off for this mailbox.' })
    expect(email.state().account?.lastError).toBe('IMAP is switched off for this mailbox.')
  })
})
