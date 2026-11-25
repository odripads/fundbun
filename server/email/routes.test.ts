import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_PRESETS, type EmailAccountState, type EmailCheckResult } from '../../src/core/email/account'
import { PLAIN_CODEC } from '../ai/store'
import { createGatewayServer, type GatewayOptions } from '../app'
import { startLocal } from '../local'
import { fakeImap, mailboxServer } from './fake-imap'
import { ImapError, createImapClient, type ImapClient } from './imap'
import { createEmailService } from './service'
import { createMemoryEmailStore } from './store'

const PASSWORD = 'imap-app-password-9876'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const running: { close: () => Promise<void> }[] = []
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function start(opts: Partial<GatewayOptions> = {}) {
  const server = createGatewayServer({ provider: null, rateLimitRpm: 1000, log: () => undefined, ...opts })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  running.push({
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  })
  return { base: `http://127.0.0.1:${port}`, port }
}

function rawHttp(port: number, method: string, path: string, headers: Record<string, string>, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function fakeClient(): ImapClient & { test: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> } {
  return {
    test: vi.fn(async () => ({ messageCount: 3 })),
    fetch: vi.fn(async () => ({
      messageCount: 3,
      mails: [{ id: 'abcdefabcdefabcdefabcdef', from: '支付宝 <service@alipay.com>', subject: '交易提醒', date: '2026-11-24T02:00:00.000Z', body: '付款金额：¥12.00' }],
    })),
  }
}

const ROUTES: [string, string][] = [
  ['GET', '/api/email/account'],
  ['POST', '/api/email/account'],
  ['PATCH', '/api/email/account'],
  ['DELETE', '/api/email/account'],
  ['POST', '/api/email/account/test'],
  ['POST', '/api/email/check'],
]

describe('on the hosted gateway (no email service)', () => {
  it('every mailbox route answers 404 and points to the desktop app', async () => {
    const { base } = await start()
    for (const [method, path] of ROUTES) {
      const res = await fetch(`${base}${path}`, { method, headers: JSON_HEADERS, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' })
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found', message: 'Email connections need the FundBun desktop app or the local server.' })
    }
  })

  it('the public sandbox routes still work', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/api/email/sources`)).status).toBe(200)
    const sandbox = await fetch(`${base}/api/email/fetch?source=sandbox`)
    expect(sandbox.status).toBe(200)
    expect(((await sandbox.json()) as { messages: unknown[] }).messages).toHaveLength(7)
  })
})

describe('local only: same origin and a local Host', () => {
  it('refuses a foreign Origin, a cross-site fetch and a forged Host with 403', async () => {
    const email = createEmailService({ store: createMemoryEmailStore(), imap: fakeClient() })
    const { base, port } = await start({ email })
    for (const [method, path] of ROUTES) {
      const body = method === 'GET' || method === 'DELETE' ? undefined : '{}'
      expect((await fetch(`${base}${path}`, { method, headers: { ...JSON_HEADERS, Origin: 'https://evil.example' }, body })).status, `${method} ${path}`).toBe(403)
      expect((await fetch(`${base}${path}`, { method, headers: { ...JSON_HEADERS, 'Sec-Fetch-Site': 'cross-site' }, body })).status).toBe(403)
      const forged = await rawHttp(port, method, path, { ...JSON_HEADERS, Host: `evil.example:${port}` }, body)
      expect(forged.status).toBe(403)
      expect(JSON.parse(forged.body)).toEqual({ error: 'forbidden_origin', message: 'Only this computer may use this route.' })
    }
  })

  it('accepts a same-origin request from the page itself', async () => {
    const email = createEmailService({ store: createMemoryEmailStore(), imap: fakeClient() })
    const { base } = await start({ email })
    const res = await fetch(`${base}/api/email/account`, { headers: { Origin: base, 'Sec-Fetch-Site': 'same-origin' } })
    expect(res.status).toBe(200)
  })
})

describe('the mailbox routes', () => {
  it('connect, read, change, test, check and forget: shapes match the contract and no response holds the password', async () => {
    const imap = fakeClient()
    const store = createMemoryEmailStore()
    const email = createEmailService({ store, imap, codec: PLAIN_CODEC })
    const { base } = await start({ email })
    const bodies: string[] = []
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await res.text()
      bodies.push(text)
      expect(res.headers.get('cache-control')).toBe('no-store')
      return { status: res.status, json: JSON.parse(text) }
    }

    const empty = await call('GET', '/api/email/account')
    expect(empty).toEqual({ status: 200, json: { local: true, presets: [...EMAIL_PRESETS], account: null, keyStorage: PLAIN_CODEC.describe } satisfies EmailAccountState })

    expect(await call('POST', '/api/email/account/test')).toEqual({ status: 200, json: { ok: false, ms: 0, error: 'no_account', message: 'No mailbox is connected yet.' } })
    expect(await call('POST', '/api/email/check', {})).toMatchObject({ status: 404, json: { error: 'no_account' } })
    expect(await call('PATCH', '/api/email/account', { trustedDomains: [] })).toMatchObject({ status: 404, json: { ok: false, error: 'no_account' } })

    const bad = await call('POST', '/api/email/account', { presetId: 'qq', address: 'not-an-address', password: PASSWORD })
    expect(bad).toMatchObject({ status: 400, json: { ok: false, error: 'invalid_input' } })
    expect(Object.keys(bad.json).sort()).toEqual(['error', 'message', 'ok'])

    imap.test.mockRejectedValueOnce(new ImapError('auth_failed', 'The mailbox did not accept this sign-in.'))
    const refused = await call('POST', '/api/email/account', { presetId: 'qq', address: 'jing@qq.com', password: PASSWORD })
    expect(refused).toEqual({ status: 502, json: { ok: false, error: 'auth_failed', message: 'The mailbox did not accept this sign-in.' } })
    expect((await call('GET', '/api/email/account')).json.account).toBeNull()

    const added = await call('POST', '/api/email/account', { presetId: 'qq', address: 'jing@qq.com', password: PASSWORD, trustedDomains: ['bank.example.com'] })
    expect(added.status).toBe(200)
    expect(Object.keys(added.json).sort()).toEqual(['account', 'messageCount', 'ms', 'ok'])
    expect(added.json).toMatchObject({ ok: true, messageCount: 3, account: { presetId: 'qq', address: 'jing@qq.com', host: 'imap.qq.com', port: 993, hasPassword: true, trustedDomains: ['bank.example.com'] } })
    expect(store.load().account?.secret).toBe(`plain:${PASSWORD}`)

    const patched = await call('PATCH', '/api/email/account', { trustedDomains: ['grab.com', '@BCA.co.id'] })
    expect(patched).toMatchObject({ status: 200, json: { ok: true, account: { trustedDomains: ['grab.com', 'bca.co.id'] } } })
    expect(await call('PATCH', '/api/email/account', { trustedDomains: ['not a domain'] })).toMatchObject({ status: 400, json: { ok: false, error: 'invalid_input' } })

    const tested = await call('POST', '/api/email/account/test')
    expect(tested).toMatchObject({ status: 200, json: { ok: true, messageCount: 3 } })

    const checked = await call('POST', '/api/email/check', { days: 500 })
    expect(checked.status).toBe(200)
    expect(checked.json).toEqual({
      source: 'qq',
      messages: [{ id: 'qq-abcdefabcdefabcdefabcdef', from: '支付宝 <service@alipay.com>', subject: '交易提醒', date: '2026-11-24T02:00:00.000Z', body: '付款金额：¥12.00', source: 'qq' }],
      scanned: 1,
    } satisfies EmailCheckResult)
    expect(imap.fetch.mock.calls.at(-1)?.[1]).toEqual({ days: 90 })

    // the body is optional for a check
    expect((await call('POST', '/api/email/check')).status).toBe(200)
    expect(imap.fetch.mock.calls.at(-1)?.[1]).toEqual({ days: 30 })
    expect((await fetch(`${base}/api/email/check`, { method: 'POST', headers: { ...JSON_HEADERS, 'Content-Length': '0' } })).status).toBe(200)

    imap.fetch.mockRejectedValueOnce(new ImapError('timeout', 'The mail server took too long to answer.'))
    expect(await call('POST', '/api/email/check', {})).toEqual({ status: 502, json: { error: 'timeout', message: 'The mail server took too long to answer.' } })

    expect(await call('DELETE', '/api/email/account')).toEqual({ status: 200, json: { ok: true } })
    expect(await call('DELETE', '/api/email/account')).toEqual({ status: 200, json: { ok: true } })
    expect((await call('GET', '/api/email/account')).json.account).toBeNull()
    expect(store.load().account).toBeNull()

    for (const text of bodies) expect(text).not.toContain(PASSWORD)
  })

  it('answers 405 with Allow for a wrong method, 415 for a body that is not JSON, 404 for an unknown path', async () => {
    const email = createEmailService({ store: createMemoryEmailStore(), imap: fakeClient() })
    const { base } = await start({ email })
    const put = await fetch(`${base}/api/email/account`, { method: 'PUT' })
    expect(put.status).toBe(405)
    expect(put.headers.get('allow')).toBe('GET, POST, PATCH, DELETE')
    const getTest = await fetch(`${base}/api/email/account/test`)
    expect(getTest.status).toBe(405)
    expect(getTest.headers.get('allow')).toBe('POST')
    expect((await fetch(`${base}/api/email/check`)).status).toBe(405)
    expect((await fetch(`${base}/api/email/account`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await fetch(`${base}/api/email/check`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'days=5' })).status).toBe(415)
    expect((await fetch(`${base}/api/email/account`, { method: 'POST', headers: JSON_HEADERS, body: '[1]' })).status).toBe(400)
    const unknown = await fetch(`${base}/api/email/account/other`)
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'not_found', message: 'Unknown API route.' })
  })

  it('reads a scripted mailbox end to end through the real IMAP client', async () => {
    const header = 'From: =?UTF-8?B?5pSv5LuY5a6d?= <service@alipay.com>\r\nSubject: =?UTF-8?Q?=E4=BA=A4=E6=98=93=E6=8F=90=E9=86=92?=\r\nDate: Tue, 24 Nov 2026 10:00:00 +0800\r\nContent-Type: text/html; charset=utf-8\r\n\r\n'
    const text = '<html><body><table><tr><td>付款金额：</td><td>&yen;12.00</td></tr></table><script>steal()</script></body></html>'
    const sockets: ReturnType<typeof fakeImap>[] = []
    const imap = createImapClient({
      connect: () => {
        const server = fakeImap({ onCommand: mailboxServer({ exists: 1, search: [1], messages: { 1: { header, text } } }), chunk: 5 })
        sockets.push(server)
        return server.socket
      },
      lookup: async () => [{ address: '203.0.113.7', family: 4 }],
    })
    const email = createEmailService({ store: createMemoryEmailStore(), imap })
    const { base } = await start({ email })
    const added = await fetch(`${base}/api/email/account`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ presetId: 'custom', host: 'mail.example.org', address: 'jing@example.org', password: PASSWORD }) })
    expect(added.status).toBe(200)
    const checked = (await (await fetch(`${base}/api/email/check`, { method: 'POST', headers: JSON_HEADERS, body: '{"days":7}' })).json()) as EmailCheckResult
    expect(checked.messages).toHaveLength(1)
    expect(checked.messages[0]).toMatchObject({ from: '支付宝 <service@alipay.com>', subject: '交易提醒', date: '2026-11-24T02:00:00.000Z', body: '付款金额： | ¥12.00', source: 'custom' })
    expect(checked.messages[0].id).toMatch(/^custom-[0-9a-f]{24}$/)
    expect(sockets.map((s) => s.commands.map((c) => c.text.split(' ')[0]))).toEqual([
      ['LOGIN', 'ID', 'EXAMINE', 'LOGOUT'],
      ['LOGIN', 'ID', 'EXAMINE', 'SEARCH', 'FETCH', 'LOGOUT'],
    ])
    expect(sockets.every((s) => s.socket.destroyed)).toBe(true)
  })
})

describe('startLocal', () => {
  it('serves the mailbox routes with the same home and codec as the AI connections', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fundbun-local-email-'))
    dirs.push(home)
    const imap = fakeClient()
    const local = await startLocal({ port: 0, home, distDir: null, env: {}, imap, log: () => undefined })
    running.push(local)
    expect(local.port).not.toBe(47600)
    expect(local.email).toBeDefined()

    const state = (await (await fetch(`${local.url}/api/email/account`)).json()) as EmailAccountState
    expect(state).toMatchObject({ local: true, account: null, keyStorage: PLAIN_CODEC.describe })

    const added = await fetch(`${local.url}/api/email/account`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ presetId: 'icloud', address: 'jing@icloud.com', password: PASSWORD }) })
    expect(added.status).toBe(200)
    expect(imap.test).toHaveBeenCalledWith({ host: 'imap.mail.me.com', port: 993, address: 'jing@icloud.com', password: PASSWORD })
    const file = join(home, 'email.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, account: { presetId: 'icloud', secret: `plain:${PASSWORD}` } })
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)

    expect((await fetch(`${local.url}/api/email/account`, { method: 'DELETE' })).status).toBe(200)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, account: null })
  })
})
