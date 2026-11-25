import { readFileSync } from 'node:fs'
import { Duplex } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { fakeImap, mailboxServer, type FakeImap, type FakeImapOptions, type MailboxScript } from './fake-imap'
import {
  FETCH_ITEMS,
  ImapError,
  checkHost,
  clampDays,
  cleanServerText,
  createImapClient,
  createResponseReader,
  imapDate,
  imapFetch,
  imapTest,
  isPublicAddress,
  sequenceSet,
  tlsOptions,
  tokenize,
  type ImapAccount,
  type ImapOptions,
  type ImapTarget,
} from './imap'

const NOW = new Date('2026-11-25T12:00:00.000Z')
const PASSWORD = 'pa"ss\\\r\nwörd 密码'
const ACCOUNT: ImapAccount = { host: 'imap.example.com', port: 993, address: 'jing@example.com', password: PASSWORD }
const PUBLIC_IP = '142.250.4.108'
const publicLookup = vi.fn(async () => [{ address: PUBLIC_IP, family: 4 }])

/** The read-only commands the client may send, and some it must never send. */
const ALLOWED = new Set(['CAPABILITY', 'LOGIN', 'ID', 'EXAMINE', 'SEARCH', 'FETCH', 'LOGOUT'])
const WRITES = ['SELECT', 'STORE', 'COPY', 'MOVE', 'APPEND', 'EXPUNGE', 'DELETE', 'CREATE', 'RENAME', 'UID', 'SUBSCRIBE', 'SETACL', 'IDLE']

const b64 = (text: string | Buffer) => Buffer.from(text).toString('base64')
/** RFC 2047 Q-encoding of UTF-8 text */
const q = (text: string) => [...Buffer.from(text, 'utf8')].map((b) => (b < 0x80 && b !== 0x3d && b !== 0x3f && b !== 0x5f && b !== 0x20 ? String.fromCharCode(b) : `=${b.toString(16).toUpperCase().padStart(2, '0')}`)).join('')
const gbk = (hex: string) => Buffer.from(hex, 'hex')

const WECHAT_BODY = '微信支付凭证\n付款金额：¥23.50\n收款方：瑞幸咖啡\n支付时间：2026-11-21 08:15'
const MAIL_3 = {
  header: [
    `From: =?UTF-8?B?${b64('微信支付')}?= <service@tenpay.com>`,
    `Subject: =?UTF-8?Q?${q('微信支付凭证')}?=`,
    'Date: Sat, 21 Nov 2026 08:15:00 +0800',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    '',
  ].join('\r\n'),
  text: `${b64(WECHAT_BODY).replace(/(.{76})/g, '$1\r\n')}\r\n`,
}

// 招商银行 / 交易提醒 / 消费金额：128.40 in GB2312 (GBK) bytes
const CMB_GBK = 'd5d0c9ccd2f8d0d0'
const SUBJECT_GBK = 'bdbbd2d7cce1d0d1'
const AMOUNT_GBK = 'cffbb7d1bdf0b6eea3ba'
const MAIL_2 = {
  header: [
    `From: "=?gb2312?B?${b64(gbk(CMB_GBK))}?=" <e-statement@cmbchina.com>`,
    // one character split across two encoded-words on a folded line
    `Subject: =?gb2312?B?${b64(gbk(SUBJECT_GBK).subarray(0, 3))}?=`,
    ` =?gb2312?B?${b64(gbk(SUBJECT_GBK).subarray(3))}?=`,
    'Date: Tue, 24 Nov 2026 10:00:00 +0800',
    'Content-Type: multipart/alternative;',
    '\tboundary="==B1=="',
    '',
    '',
  ].join('\r\n'),
  text: Buffer.concat([
    Buffer.from('--==B1==\r\nContent-Type: text/plain; charset=gb2312\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n'),
    Buffer.from([...gbk(AMOUNT_GBK)].map((b) => `=${b.toString(16).toUpperCase()}`).join('') + '128.40=\r\n CNY\r\n'),
    Buffer.from('--==B1==\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>HTML copy</p>\r\n--==B1==--\r\n'),
  ]),
}

const MAILBOX: MailboxScript = { exists: 3, search: [2, 3], messages: { 2: MAIL_2, 3: MAIL_3 } }

function setup(script: MailboxScript = MAILBOX, fake: FakeImapOptions = {}) {
  const server = fakeImap({ onCommand: mailboxServer(script), ...fake })
  const targets: ImapTarget[] = []
  const opts: ImapOptions = {
    connect: (target) => {
      targets.push(target)
      return server.socket
    },
    lookup: publicLookup,
    now: () => NOW,
  }
  return { server, targets, opts }
}

const words = (server: ReturnType<typeof fakeImap>) => server.commands.map((c) => c.text.split(' ')[0].toUpperCase())

async function failure(work: Promise<unknown>): Promise<ImapError> {
  try {
    await work
  } catch (err) {
    expect(err).toBeInstanceOf(ImapError)
    return err as ImapError
  }
  throw new Error('expected the IMAP call to fail')
}

describe('a read-only check against a scripted server', () => {
  it('sends exactly the read-only commands, in order, with the login as literals', async () => {
    const { server, targets, opts } = setup(MAILBOX, { greeting: '* OK FakeImap ready', chunk: 7 })
    const result = await imapFetch(ACCOUNT, 30, opts)

    expect(server.commands.map((c) => c.text)).toEqual([
      'CAPABILITY',
      `LOGIN {16} {${Buffer.byteLength(PASSWORD)}}`,
      'ID ("name" "FundBun" "version" "1.0")',
      'EXAMINE INBOX',
      'SEARCH SINCE 26-Oct-2026',
      `FETCH 2:3 ${FETCH_ITEMS}`,
      'LOGOUT',
    ])
    expect(server.commands.map((c) => c.tag)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'])
    // the address and password went over byte for byte as literals: quotes, backslashes and line breaks are inert
    expect(server.commands[1].literals).toEqual([Buffer.from('jing@example.com'), Buffer.from(PASSWORD, 'utf8')])
    expect(server.received().includes(Buffer.from('A2 LOGIN {16}\r\n'))).toBe(true)

    for (const word of words(server)) expect(ALLOWED.has(word), word).toBe(true)
    const wire = server.received().toString('latin1')
    for (const write of WRITES) expect(wire, write).not.toMatch(new RegExp(`^A\\d+ ${write}\\b`, 'm'))
    expect(wire).toContain('BODY.PEEK[HEADER.FIELDS')
    expect(wire).not.toMatch(/ BODY\[/)

    expect(targets).toEqual([{ host: PUBLIC_IP, port: 993, servername: 'imap.example.com' }])
    expect(server.socket.destroyed).toBe(true)
    expect(result.messageCount).toBe(3)
    expect(result.mails.map((m) => m.subject)).toEqual(['微信支付凭证', '交易提醒'])
    expect(result.mails[0]).toMatchObject({ from: '微信支付 <service@tenpay.com>', date: '2026-11-21T00:15:00.000Z', body: WECHAT_BODY })
    expect(result.mails[1]).toMatchObject({ from: '招商银行 <e-statement@cmbchina.com>', date: '2026-11-24T02:00:00.000Z', body: '消费金额：128.40 CNY' })
    expect(result.mails[0].id).toMatch(/^[0-9a-f]{24}$/)
    expect(result.mails[0].id).not.toBe(result.mails[1].id)
  })

  it('gives the same id to the same message on every check', async () => {
    const first = await imapFetch(ACCOUNT, 30, setup().opts)
    const second = await imapFetch(ACCOUNT, 30, setup().opts)
    expect(second.mails.map((m) => m.id)).toEqual(first.mails.map((m) => m.id))
    const other = await imapFetch({ ...ACCOUNT, address: 'mei@example.com' }, 30, setup().opts)
    expect(other.mails[0].id).not.toBe(first.mails[0].id)
  })

  it('skips CAPABILITY when the greeting lists them, and ID when the server does not offer it', async () => {
    const { server, opts } = setup({ ...MAILBOX, caps: 'IMAP4rev1' }, { greeting: '* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] ready' })
    await imapFetch(ACCOUNT, 7, opts)
    expect(words(server)).toEqual(['LOGIN', 'EXAMINE', 'SEARCH', 'FETCH', 'LOGOUT'])
    expect(server.commands[2].text).toBe('SEARCH SINCE 18-Nov-2026')
  })

  it('learns ID from the capabilities sent after login', async () => {
    const { server, opts } = setup({ ...MAILBOX, caps: 'IMAP4rev1 ID' }, { greeting: '* OK [CAPABILITY IMAP4rev1] ready' })
    await imapTest(ACCOUNT, opts)
    expect(words(server)).toEqual(['LOGIN', 'ID', 'EXAMINE', 'LOGOUT'])
  })

  it('a test signs in, opens the inbox read only and signs out', async () => {
    const { server, opts } = setup({ exists: 42 })
    expect(await imapTest(ACCOUNT, opts)).toEqual({ messageCount: 42 })
    expect(words(server)).toEqual(['LOGIN', 'ID', 'EXAMINE', 'LOGOUT'])
    expect(server.socket.destroyed).toBe(true)
  })

  it('does not FETCH when SEARCH finds nothing', async () => {
    const { server, opts } = setup({ exists: 5, search: [] })
    expect(await imapFetch(ACCOUNT, 30, opts)).toEqual({ messageCount: 5, mails: [] })
    expect(words(server)).toEqual(['LOGIN', 'ID', 'EXAMINE', 'SEARCH', 'LOGOUT'])
  })

  it('reads only the newest 50 matches', async () => {
    const search = Array.from({ length: 120 }, (_, i) => i + 1)
    const { server, opts } = setup({ exists: 120, search, messages: { 120: MAIL_3 } })
    const result = await imapFetch(ACCOUNT, 30, opts)
    expect(server.commands.find((c) => c.text.startsWith('FETCH'))?.text).toBe(`FETCH 71:120 ${FETCH_ITEMS}`)
    expect(result.mails).toHaveLength(1)
  })

  it('bounds the days it looks back to 1..90', async () => {
    const a = setup()
    await imapFetch(ACCOUNT, 365, a.opts)
    expect(a.server.commands.find((c) => c.text.startsWith('SEARCH'))?.text).toBe('SEARCH SINCE 27-Aug-2026')
    const b = setup()
    await imapFetch(ACCOUNT, 0, b.opts)
    expect(b.server.commands.find((c) => c.text.startsWith('SEARCH'))?.text).toBe('SEARCH SINCE 24-Nov-2026')
  })

  it('reads literals split byte by byte, across multi-byte characters', async () => {
    const { opts } = setup(MAILBOX, { chunk: 1 })
    const result = await imapFetch(ACCOUNT, 30, opts)
    expect(result.mails[0].body).toBe(WECHAT_BODY)
  })

  it('goes through createImapClient the same way', async () => {
    const { server, opts } = setup()
    const client = createImapClient(opts)
    expect((await client.fetch(ACCOUNT, { days: 30 })).mails).toHaveLength(2)
    expect(words(server).at(-1)).toBe('LOGOUT')
  })

  it('never sends a command outside the read-only set (source check)', () => {
    const src = readFileSync(new URL('./imap.ts', import.meta.url), 'utf8')
    const sent = [...src.matchAll(/\.run\(\[\s*[`'"]([A-Z]+)/g)].map((m) => m[1])
    expect(sent.length).toBeGreaterThanOrEqual(6)
    for (const word of sent) expect(ALLOWED.has(word), word).toBe(true)
    expect(FETCH_ITEMS).not.toMatch(/BODY\[/)
  })
})

describe('errors the user can act on', () => {
  it.each([
    ['[AUTHENTICATIONFAILED] Invalid credentials (Failure)', 'auth_failed'],
    ['[ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)', 'auth_failed'],
    ['LOGIN failed.', 'auth_failed'],
    ['[ALERT] Your account is not enabled for IMAP use. Please visit your Gmail settings page and enable your account for IMAP access. (Failure)', 'imap_disabled'],
    ['IMAP access is disabled for this account', 'imap_disabled'],
    ['[UNAVAILABLE] Too many simultaneous connections', 'connection_failed'],
  ])('LOGIN refused with %j is %s', async (text, code) => {
    const { server, opts } = setup({ login: text })
    const err = await failure(imapTest(ACCOUNT, opts))
    expect(err.code).toBe(code)
    expect(words(server)).not.toContain('EXAMINE')
    expect(server.socket.destroyed).toBe(true)
  })

  it('says to use an App Password or 授权码 when sign-in fails', async () => {
    const err = await failure(imapTest(ACCOUNT, setup({ login: '[AUTHENTICATIONFAILED] Invalid credentials' }).opts))
    expect(err.message).toMatch(/App Password/)
    expect(err.message).toContain('授权码')
    expect(err.message).toContain('Invalid credentials')
  })

  it('163 Mail refusing EXAMINE with "Unsafe Login" means IMAP is not allowed yet', async () => {
    const err = await failure(imapTest(ACCOUNT, setup({ examine: 'SELECT Unsafe Login. Please contact kefu@188.com for help' }).opts))
    expect(err.code).toBe('imap_disabled')
  })

  it('another EXAMINE refusal is a protocol error', async () => {
    const err = await failure(imapTest(ACCOUNT, setup({ examine: 'Mailbox does not exist' }).opts))
    expect(err.code).toBe('protocol_error')
  })

  it('never puts the password in a message, even when the server repeats it', async () => {
    const password = 'Secret-App-Pass-1234'
    const { opts } = setup({ login: `Login failed for jing with password ${password} and ${password.toLowerCase()}` })
    const err = await failure(imapTest({ ...ACCOUNT, password }, opts))
    expect(err.message).not.toContain(password)
    expect(err.message.toLowerCase()).not.toContain(password.toLowerCase())
    expect(err.message).toContain('***')
    expect(err.message).not.toMatch(/[\r\n]/)
  })

  it('cleanServerText strips line breaks, caps the length and hides the password', () => {
    expect(cleanServerText('a\r\nb\u0000c', 'pw')).toBe('a b c')
    expect(cleanServerText('x'.repeat(500), 'pw')).toHaveLength(160)
    expect(cleanServerText('your pass is hunter2!', 'HUNTER2')).toBe('your pass is ***!')
    expect(cleanServerText('echo pa ss', 'pa\nss')).toBe('echo ***')
  })

  it('refuses LOGIN when the server says LOGINDISABLED, without sending the password', async () => {
    const { server, opts } = setup(MAILBOX, { greeting: '* OK [CAPABILITY IMAP4rev1 LOGINDISABLED] ready' })
    expect((await failure(imapTest(ACCOUNT, opts))).code).toBe('imap_disabled')
    expect(words(server)).not.toContain('LOGIN')
  })

  it('a BYE greeting fails to connect; an unknown greeting is a protocol error', async () => {
    expect((await failure(imapTest(ACCOUNT, setup(MAILBOX, { greeting: '* BYE Too busy' }).opts))).code).toBe('connection_failed')
    expect((await failure(imapTest(ACCOUNT, setup(MAILBOX, { greeting: 'HTTP/1.1 400 Bad Request' }).opts))).code).toBe('protocol_error')
  })

  it('PREAUTH skips LOGIN', async () => {
    const { server, opts } = setup(MAILBOX, { greeting: '* PREAUTH [CAPABILITY IMAP4rev1] welcome' })
    await imapTest(ACCOUNT, opts)
    expect(words(server)).toEqual(['EXAMINE', 'LOGOUT'])
  })

  it('a server that hangs up mid-way is a connection failure', async () => {
    const server = fakeImap({ onCommand: (cmd, _reply, s) => (cmd.text.startsWith('LOGIN') ? s.hangUp() : undefined) })
    const err = await failure(imapTest(ACCOUNT, { connect: () => server.socket, lookup: publicLookup }))
    expect(err.code).toBe('connection_failed')
    expect(server.socket.destroyed).toBe(true)
  })

  it.each([
    ['ECONNREFUSED', 'connection_failed'],
    ['EHOSTUNREACH', 'connection_failed'],
    ['ENOTFOUND', 'connection_failed'],
    ['CERT_HAS_EXPIRED', 'tls_failed'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_failed'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls_failed'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls_failed'],
  ])('a socket error %s is %s', async (code, expected) => {
    const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb() } })
    setTimeout(() => socket.destroy(Object.assign(new Error(`boom ${code}`), { code })), 5)
    const err = await failure(imapTest(ACCOUNT, { connect: () => socket, lookup: publicLookup }))
    expect(err.code).toBe(expected)
    expect(socket.destroyed).toBe(true)
  })

  it('a factory that throws is a connection failure', async () => {
    const err = await failure(imapTest(ACCOUNT, { connect: () => { throw Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }) }, lookup: publicLookup }))
    expect(err.code).toBe('connection_failed')
  })
})

describe('timeouts', () => {
  it('gives up when the server never greets, and destroys the socket', async () => {
    const server = fakeImap({ greeting: null })
    const started = Date.now()
    const err = await failure(imapTest(ACCOUNT, { connect: () => server.socket, lookup: publicLookup, stepTimeoutMs: 40 }))
    expect(err.code).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(2000)
    expect(server.socket.destroyed).toBe(true)
  })

  it('gives up when a command gets no answer', async () => {
    const server = fakeImap({ onCommand: () => undefined })
    const err = await failure(imapTest(ACCOUNT, { connect: () => server.socket, lookup: publicLookup, stepTimeoutMs: 40 }))
    expect(err.code).toBe('timeout')
    expect(server.socket.destroyed).toBe(true)
  })

  it('keeps to the overall budget even when every step is quick enough', async () => {
    const { server, opts } = setup(MAILBOX, { delayMs: 30 })
    const err = await failure(imapFetch(ACCOUNT, 30, { ...opts, stepTimeoutMs: 1000, totalTimeoutMs: 80 }))
    expect(err.code).toBe('timeout')
    expect(server.socket.destroyed).toBe(true)
  })

  it('a name lookup that hangs times out too', async () => {
    const connect = vi.fn()
    const err = await failure(imapTest(ACCOUNT, { connect, lookup: () => new Promise(() => undefined), stepTimeoutMs: 40 }))
    expect(err.code).toBe('timeout')
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('where it may connect (SSRF hygiene)', () => {
  it.each(['imap.gmail.com', 'imap.mail.me.com', 'outlook.office365.com', 'imap.qq.com', 'imap.163.com', 'IMAP.Example.COM.', 'mail-1.example.co.id'])('accepts the public name %s', (host) => {
    expect(checkHost(host)).toBe(host.toLowerCase().replace(/\.$/, ''))
  })

  it.each([
    '127.0.0.1', '10.0.0.5', '::1', '[::1]', 'localhost', 'mail.localhost', 'printer.local', 'imap.corp.internal', 'nas.home.arpa',
    'imap.example.com\r\nA1 LOGOUT', 'imap.example.com ', ' imap.example.com', 'user@imap.example.com', 'imap.example.com/x', 'imap.example.com:993',
    'nodot', '', 'a..b.com', '-bad.example.com', 'imap.example.com\u0000', 'x'.repeat(250) + '.com', '0x7f.1', '127.1',
  ])('refuses %j', (host) => {
    expect(checkHost(host)).toBeNull()
  })

  it('allows a local test server only when asked', () => {
    expect(checkHost('127.0.0.1', true)).toBe('127.0.0.1')
    expect(checkHost('localhost', true)).toBeNull()
  })

  it.each([
    ['0.0.0.0', false], ['0.1.2.3', false], ['10.1.2.3', false], ['100.64.0.1', false], ['100.127.255.255', false], ['127.0.0.1', false],
    ['169.254.169.254', false], ['172.16.0.1', false], ['172.31.255.255', false], ['192.168.1.1', false], ['224.0.0.1', false], ['255.255.255.255', false],
    ['::', false], ['::1', false], ['fc00::1', false], ['fd12:3456::1', false], ['fe80::1', false], ['ff02::1', false], ['::ffff:127.0.0.1', false],
    ['::ffff:10.0.0.1', false], ['::ffff:7f00:1', false], ['not-an-ip', false],
    // a private IPv4 address inside IPv6: NAT64, 6to4, Teredo and local-use NAT64
    ['64:ff9b::7f00:1', false], ['64:ff9b::a00:1', false], ['64:ff9b::c0a8:101', false], ['64:ff9b::a9fe:a9fe', false], ['64:ff9b::6440:1', false],
    ['2002:7f00:1::', false], ['2002:a00:1::1', false], ['2002:c0a8:101::', false], ['2001:0:4136:e378::1', false], ['64:ff9b:1::a00:1', false],
    ['142.250.4.108', true], ['100.128.0.1', true], ['172.32.0.1', true], ['8.8.8.8', true], ['2607:f8b0:4005:80a::200a', true], ['2a00:1450::1', true],
    // a public server reached over NAT64 (an IPv6-only network) is still allowed
    ['64:ff9b::808:808', true], ['64:ff9b::8efa:46c', true], ['2001:4860:4860::8888', true],
  ])('isPublicAddress(%s) is %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected)
  })

  it('refuses a name that resolves to a private address, before connecting', async () => {
    const connect = vi.fn()
    for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '::1', 'fd00::5']) {
      const err = await failure(imapTest(ACCOUNT, { connect, lookup: async () => [{ address, family: address.includes(':') ? 6 : 4 }] }))
      expect(err.code).toBe('invalid_input')
    }
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses a name when any of its addresses is private', async () => {
    const connect = vi.fn()
    const err = await failure(imapTest(ACCOUNT, { connect, lookup: async () => [{ address: PUBLIC_IP, family: 4 }, { address: '192.168.0.10', family: 4 }] }))
    expect(err.code).toBe('invalid_input')
    expect(connect).not.toHaveBeenCalled()
  })

  it('a name that does not resolve is a connection failure', async () => {
    const connect = vi.fn()
    const notFound = await failure(imapTest(ACCOUNT, { connect, lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }) } }))
    expect(notFound.code).toBe('connection_failed')
    const empty = await failure(imapTest(ACCOUNT, { connect, lookup: async () => [] }))
    expect(empty.code).toBe('connection_failed')
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses IP literals and bad input before any lookup', async () => {
    const lookup = vi.fn(publicLookup)
    const connect = vi.fn()
    for (const bad of [{ host: '127.0.0.1' }, { host: 'localhost' }, { port: 0 }, { port: 70000 }, { port: 99.5 }, { address: '' }, { address: 'a@b.com\r\nA1 LOGOUT' }, { password: '' }, { password: 'a\u0000b' }]) {
      const err = await failure(imapTest({ ...ACCOUNT, ...bad } as ImapAccount, { connect, lookup }))
      expect(err.code).toBe('invalid_input')
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('tries IPv4 first, and the next checked address when one refuses before the greeting', async () => {
    const server = fakeImap({ onCommand: mailboxServer(MAILBOX) })
    const targets: ImapTarget[] = []
    const connect = (target: ImapTarget) => {
      targets.push(target)
      if (targets.length === 1) {
        const dead = new Duplex({ read() {}, write(_c, _e, cb) { cb() } })
        setTimeout(() => dead.destroy(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })), 5)
        return dead
      }
      return server.socket
    }
    const lookup = async () => [{ address: '2607:f8b0:4005:80a::200a', family: 6 }, { address: PUBLIC_IP, family: 4 }, { address: '142.250.4.109', family: 4 }]
    expect(await imapTest(ACCOUNT, { connect, lookup })).toEqual({ messageCount: 3 })
    expect(targets.map((t) => t.host)).toEqual([PUBLIC_IP, '142.250.4.109'])
    expect(targets.every((t) => t.servername === 'imap.example.com')).toBe(true)
    // the login went only to the server that answered
    expect(words(server)).toEqual(['LOGIN', 'ID', 'EXAMINE', 'LOGOUT'])
  })

  it('tries the next address when one stays silent, within the overall budget', async () => {
    const silent = fakeImap({ greeting: null })
    const server = fakeImap({ onCommand: mailboxServer(MAILBOX) })
    const sockets = [silent.socket, server.socket]
    const lookup = async () => [{ address: PUBLIC_IP, family: 4 }, { address: '2a00:1450::1', family: 6 }]
    expect(await imapTest(ACCOUNT, { connect: () => sockets.shift()!, lookup, stepTimeoutMs: 40, totalTimeoutMs: 5_000 })).toEqual({ messageCount: 3 })
    expect(silent.socket.destroyed).toBe(true)
    expect(silent.commands).toEqual([])
  })

  it('never retries a certificate failure, or a failure after the greeting', async () => {
    const connect = vi.fn(() => {
      const socket = new Duplex({ read() {}, write(_c, _e, cb) { cb() } })
      setTimeout(() => socket.destroy(Object.assign(new Error('bad cert'), { code: 'CERT_HAS_EXPIRED' })), 5)
      return socket
    })
    const lookup = async () => [{ address: PUBLIC_IP, family: 4 }, { address: '142.250.4.109', family: 4 }]
    expect((await failure(imapTest(ACCOUNT, { connect, lookup }))).code).toBe('tls_failed')
    expect(connect).toHaveBeenCalledTimes(1)

    const servers: FakeImap[] = []
    const hangUp = () => {
      const s = fakeImap({ onCommand: (cmd, _reply, srv) => (cmd.text.startsWith('LOGIN') ? srv.hangUp() : undefined) })
      servers.push(s)
      return s.socket
    }
    expect((await failure(imapTest(ACCOUNT, { connect: hangUp, lookup }))).code).toBe('connection_failed')
    expect(servers).toHaveLength(1)
  })

  it('connects with TLS, verifying the certificate against the server name', () => {
    expect(tlsOptions({ host: PUBLIC_IP, port: 993, servername: 'imap.example.com' })).toEqual({
      host: PUBLIC_IP, port: 993, servername: 'imap.example.com', rejectUnauthorized: true, minVersion: 'TLSv1.2',
    })
    // TLS forbids an IP address as the server name; the address itself is then checked
    expect(tlsOptions({ host: '127.0.0.1', port: 993, servername: '127.0.0.1' })).not.toHaveProperty('servername')
  })
})

describe('reading responses', () => {
  it('keeps literals exact, whatever way the bytes arrive', () => {
    const body = Buffer.from('金额 ¥58.00 "quoted" (paren) {7}\r\nnot a new line', 'utf8')
    const wire = Buffer.concat([Buffer.from(`* 1 FETCH (BODY[TEXT]<0> {${body.length}}\r\n`), body, Buffer.from(')\r\nA1 OK done\r\n')])
    const reader = createResponseReader()
    const responses = [...wire].flatMap((byte) => reader.push(Buffer.from([byte])))
    expect(responses.map((r) => r.text)).toEqual([`* 1 FETCH (BODY[TEXT]<0> {${body.length}})`, 'A1 OK done'])
    const list = tokenize(responses[0].pieces)[3] as unknown[]
    expect(list[0]).toBe('BODY[TEXT]<0>')
    expect(Buffer.compare(list[1] as Buffer, body)).toBe(0)
  })

  it('tokenizes quoted strings, NIL, lists and sections with spaces', () => {
    const reader = createResponseReader()
    const [r] = reader.push(Buffer.from('* 2 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT)] "a \\"b\\" \\\\c" FLAGS (\\Seen) X NIL)\r\n'))
    const list = tokenize(r.pieces)[3] as unknown[]
    expect(list[0]).toBe('BODY[HEADER.FIELDS (FROM SUBJECT)]')
    expect((list[1] as Buffer).toString()).toBe('a "b" \\c')
    expect(list[2]).toBe('FLAGS')
    expect(list[3]).toEqual(['\\Seen'])
    expect(list[5]).toBeNull()
  })

  it('stays cheap when a server trickles a large literal one byte at a time', () => {
    const body = Buffer.alloc(300_000, 0x61)
    const wire = Buffer.concat([Buffer.from(`* 1 FETCH (BODY[TEXT]<0> {${body.length}}\r\n`), body, Buffer.from(')\r\n')])
    const reader = createResponseReader()
    const started = Date.now()
    const out = []
    for (let i = 0; i < wire.length; i++) out.push(...reader.push(wire.subarray(i, i + 1)))
    expect(out).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('refuses a literal larger than it will hold', () => {
    const reader = createResponseReader()
    expect(() => reader.push(Buffer.from('* 1 FETCH (BODY[TEXT] {99999999}\r\n'))).toThrow(ImapError)
  })

  it('refuses a never-ending line', () => {
    const reader = createResponseReader()
    expect(() => reader.push(Buffer.alloc(5 * 1024 * 1024, 0x41))).toThrow(ImapError)
  })

  it('a server sending a too-large literal ends as a protocol error', async () => {
    const server = fakeImap({ onCommand: (cmd, reply) => reply(`* 1 FETCH (BODY[TEXT] {99999999}\r\n${cmd.tag} OK\r\n`) })
    const err = await failure(imapTest(ACCOUNT, { connect: () => server.socket, lookup: publicLookup }))
    expect(err.code).toBe('protocol_error')
    expect(server.socket.destroyed).toBe(true)
  })
})

describe('small helpers', () => {
  it('imapDate writes DD-Mon-YYYY in UTC', () => {
    expect(imapDate(new Date('2026-01-05T23:59:00Z'))).toBe('05-Jan-2026')
    expect(imapDate(new Date('2026-12-31T00:00:00Z'))).toBe('31-Dec-2026')
  })

  it('sequenceSet compresses runs', () => {
    expect(sequenceSet([9, 3, 4, 5, 5, 11, 12])).toBe('3:5,9,11:12')
    expect(sequenceSet([7])).toBe('7')
  })

  it('clampDays keeps 1..90 and defaults to 30', () => {
    expect([clampDays(undefined), clampDays('7'), clampDays(Number.NaN), clampDays(0), clampDays(-3), clampDays(7.4), clampDays(91), clampDays(1e9)]).toEqual([30, 30, 30, 1, 1, 7, 90, 90])
  })
})
