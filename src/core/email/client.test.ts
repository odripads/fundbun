import { describe, expect, it, vi } from 'vitest'
import { EMAIL_PRESETS, type EmailAccountView } from './account'
import { isAllowedSender } from './allowlist'
import { EMAIL_UNAVAILABLE, EmailClient, messagesOf } from './client'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ACCOUNT: EmailAccountView = {
  presetId: 'gmail',
  label: 'Gmail',
  address: 'me@example.com',
  host: 'imap.gmail.com',
  port: 993,
  hasPassword: true,
  trustedDomains: ['kopikenangan.com'],
  createdAt: '2026-11-25T10:00:00.000Z',
}

/** A fetch double that records each call and answers from `reply`. */
function fake(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = []
  const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> })
    return reply(url, init)
  })
  return { client: new EmailClient('/api', impl as unknown as typeof fetch), calls }
}

describe('EmailClient.state', () => {
  it('returns the local state from GET /api/email/account, keeping only what the app may see', async () => {
    const { client, calls } = fake(() => json({ local: true, presets: EMAIL_PRESETS, account: { ...ACCOUNT, password: 'never-shown' }, keyStorage: 'Keys are encrypted with your Mac’s Keychain and kept on this computer.' }))
    const s = await client.state()
    expect(calls[0]).toMatchObject({ url: '/api/email/account', method: 'GET' })
    expect(s).toEqual({ local: true, presets: [...EMAIL_PRESETS], account: ACCOUNT, keyStorage: 'Keys are encrypted with your Mac’s Keychain and kept on this computer.' })
    expect(JSON.stringify(s)).not.toContain('never-shown')
  })

  it('treats 404, 403, non-JSON, a non-local answer and a network failure as { local: false }', async () => {
    const replies: (() => Response | Promise<Response>)[] = [
      () => json({ error: 'not_found', message: 'Unknown API route.' }, 404),
      () => json({ error: 'forbidden_origin', message: 'Only this computer may use this route.' }, 403),
      () => new Response('<!doctype html><title>FundBun</title>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      () => json({ local: false }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]
    for (const reply of replies) {
      const { client } = fake(reply)
      expect(await client.state()).toEqual(EMAIL_UNAVAILABLE)
    }
  })

  it('falls back to the built-in presets when the server sends none', async () => {
    const { client } = fake(() => json({ local: true, presets: 'nope', account: null }))
    expect(await client.state()).toEqual({ local: true, presets: [...EMAIL_PRESETS], account: null, keyStorage: '' })
  })
})

describe('EmailClient routes', () => {
  it('connect: POST /api/email/account with JSON, then the account and its test', async () => {
    const { client, calls } = fake(() => json({ ok: true, account: ACCOUNT, ms: 812, messageCount: 1432 }))
    const r = await client.connect({ presetId: 'gmail', address: 'me@example.com', password: 'app-password' })
    expect(calls[0].url).toBe('/api/email/account')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers['Content-Type']).toBe('application/json')
    expect(calls[0].body).toEqual({ presetId: 'gmail', address: 'me@example.com', password: 'app-password' })
    expect(r).toEqual({ ok: true, account: ACCOUNT, test: { ok: true, ms: 812, messageCount: 1432 } })
  })

  it('connect: a failed sign-in (502) or bad input (400) comes back with the server’s message', async () => {
    const bad = fake(() => json({ ok: false, error: 'auth_failed', message: 'The mailbox did not accept this App Password.' }, 502))
    expect(await bad.client.connect({ presetId: 'gmail', address: 'me@example.com', password: 'wrong' })).toEqual({
      ok: false,
      local: true,
      error: 'auth_failed',
      message: 'The mailbox did not accept this App Password.',
    })
    const invalid = fake(() => json({ ok: false, error: 'invalid_input', message: 'Type your full email address, like name@example.com.' }, 400))
    expect(await invalid.client.connect({ presetId: 'gmail', address: 'me', password: 'x' })).toEqual({
      ok: false,
      local: true,
      error: 'invalid_input',
      message: 'Type your full email address, like name@example.com.',
    })
  })

  it('update: PATCH /api/email/account with the trusted domains', async () => {
    const { client, calls } = fake(() => json({ ok: true, account: { ...ACCOUNT, trustedDomains: ['bca.co.id', 'grab.com'] } }))
    const r = await client.update({ trustedDomains: ['bca.co.id', 'grab.com'] })
    expect(calls[0]).toMatchObject({ url: '/api/email/account', method: 'PATCH', body: { trustedDomains: ['bca.co.id', 'grab.com'] } })
    expect(r.ok && r.account?.trustedDomains).toEqual(['bca.co.id', 'grab.com'])
    // a mailbox that is gone is a local answer, not "no FundBun here"
    const gone = fake(() => json({ ok: false, error: 'no_account', message: 'No mailbox is connected yet.' }, 404))
    expect(await gone.client.update({ trustedDomains: [] })).toEqual({ ok: false, local: true, error: 'no_account', message: 'No mailbox is connected yet.' })
  })

  it('disconnect: DELETE /api/email/account', async () => {
    const { client, calls } = fake(() => json({ ok: true }))
    expect(await client.disconnect()).toEqual({ ok: true })
    expect(calls[0]).toMatchObject({ url: '/api/email/account', method: 'DELETE' })
    expect(calls[0].headers['Content-Type']).toBeUndefined()
  })

  it('test: POST /api/email/account/test returns the test result', async () => {
    const ok = fake(() => json({ ok: true, ms: 640, messageCount: 12 }))
    expect(await ok.client.test()).toEqual({ ok: true, ms: 640, messageCount: 12 })
    expect(ok.calls[0]).toMatchObject({ url: '/api/email/account/test', method: 'POST' })
    const no = fake(() => json({ ok: false, ms: 0, error: 'no_account', message: 'No mailbox is connected yet.' }))
    expect(await no.client.test()).toEqual({ ok: false, ms: 0, error: 'no_account', message: 'No mailbox is connected yet.' })
  })

  it('check: POST /api/email/check with days, and the messages shape-checked', async () => {
    const { client, calls } = fake(() =>
      json({
        source: 'gmail',
        scanned: 3,
        messages: [
          { id: 'm1', from: 'OVO <noreply@ovo.id>', subject: 'Pembayaran Berhasil', date: '2026-09-23T10:16:00+07:00', body: 'Total Pembayaran: Rp 52.300', source: 'gmail' },
          { id: 'm2', from: 42, body: 'no sender' },
          'junk',
        ],
      }),
    )
    const r = await client.check(30)
    expect(calls[0]).toMatchObject({ url: '/api/email/check', method: 'POST', body: { days: 30 } })
    expect(r).toEqual({
      ok: true,
      source: 'gmail',
      scanned: 3,
      messages: [{ id: 'm1', from: 'OVO <noreply@ovo.id>', subject: 'Pembayaran Berhasil', date: '2026-09-23T10:16:00+07:00', body: 'Total Pembayaran: Rp 52.300', source: 'gmail' }],
    })
  })

  it('every route reads 404, 403, offline and non-JSON as local: false', async () => {
    const replies: (() => Response | Promise<Response>)[] = [
      () => json({ error: 'not_found', message: 'Unknown API route.' }, 404),
      () => json({ error: 'forbidden_origin', message: 'Only this computer may use this route.' }, 403),
      () => new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]
    for (const reply of replies) {
      const { client } = fake(reply)
      const results = [
        await client.connect({ presetId: 'qq', address: 'me@qq.com', password: 'x' }),
        await client.update({ trustedDomains: [] }),
        await client.disconnect(),
        await client.check(),
      ]
      for (const r of results) expect(r).toMatchObject({ ok: false, local: false })
      expect((await client.test()).ok).toBe(false)
    }
  })

  it('a server error keeps local: true and its message', async () => {
    const { client } = fake(() => json({ error: 'connection_failed', message: 'Could not reach imap.qq.com.' }, 502))
    expect(await client.check()).toEqual({ ok: false, local: true, error: 'connection_failed', message: 'Could not reach imap.qq.com.' })
    const none = fake(() => json({ error: 'no_account', message: 'No mailbox is connected yet.' }, 404))
    expect(await none.client.check()).toEqual({ ok: false, local: true, error: 'no_account', message: 'No mailbox is connected yet.' })
  })

  it('the hosted gateway’s exact 404 reads as local: false, with the desktop app note', async () => {
    const { client } = fake(() => json({ error: 'not_found', message: 'Email connections need the FundBun desktop app or the local server.' }, 404))
    expect(await client.state()).toEqual(EMAIL_UNAVAILABLE)
    expect(await client.check()).toMatchObject({ ok: false, local: false, error: 'not_found' })
  })
})

describe('messagesOf', () => {
  it('bounds what one check may hand the parser', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: `m${i}`, from: 'a@ovo.id', subject: 's', date: 'd', body: 'x'.repeat(10) }))
    expect(messagesOf(many)).toHaveLength(500)
    expect(messagesOf([{ from: 'a@ovo.id', body: 'y'.repeat(300_000) }])[0].body).toHaveLength(200_000)
    expect(messagesOf([{ from: 'a@ovo.id', body: 'b' }])[0]).toMatchObject({ id: 'mail-0', subject: '', date: '', source: 'imap' })
    expect(messagesOf('nope')).toEqual([])
  })

  it('passes a forged-sender mark through, and nothing else in its place', () => {
    const [failed, passed, junk] = messagesOf([
      { id: 'a', from: 'a@bca.co.id', body: 'b', senderCheck: 'fail' },
      { id: 'b', from: 'a@bca.co.id', body: 'b', senderCheck: 'pass' },
      { id: 'c', from: 'a@bca.co.id', body: 'b', senderCheck: { trusted: true } },
    ])
    expect(failed.senderCheck).toBe('fail')
    expect(passed).not.toHaveProperty('senderCheck')
    expect(junk).not.toHaveProperty('senderCheck')
  })

  it('never cuts a sender: one too long to be real is dropped, so the email is not read', () => {
    // cut at 500 characters, this address would end in "@bca.co.id"; kept whole, it is refused
    const long = `${'a'.repeat(490)}@bca.co.id.evil.example`
    const [kept] = messagesOf([{ id: 'x', from: long, body: 'Nominal: Rp 1.500.000' }])
    expect(kept.from).toBe(long)
    expect(isAllowedSender(kept.from)).toBe(false)
    const [huge] = messagesOf([{ id: 'y', from: `${'A'.repeat(700)} <alerts@bca.co.id>`, body: 'b' }])
    expect(huge.from).toBe('')
    expect(isAllowedSender(huge.from)).toBe(false)
    const named = `${'N'.repeat(200)} <alerts@bca.co.id>`
    expect(messagesOf([{ from: named, body: 'b' }])[0].from).toBe(named)
  })
})
