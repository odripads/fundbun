/**
 * A small, read-only IMAP client over TLS, written on Node's own `tls` so FundBun needs no mail library.
 *
 * Read only, by construction: the only commands it can send are CAPABILITY, LOGIN, ID, EXAMINE (which opens the
 * inbox read only), SEARCH, FETCH with BODY.PEEK (which leaves mail unread) and LOGOUT. There is no code path
 * for SELECT, STORE, COPY, MOVE, APPEND, EXPUNGE or anything else that changes a mailbox.
 *
 * The address and password go over as IMAP literals (sized byte strings), so no character in them can end the
 * command early or add another. Neither is ever logged, and server text is cleaned of the password before it
 * reaches an error message. Tests drive it with an injected socket and DNS lookup, never the network.
 */
import { createHash } from 'node:crypto'
import { ADDRCONFIG } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { Duplex } from 'node:stream'
import { connect as tlsConnect, type ConnectionOptions } from 'node:tls'
import { CHECK_DAYS } from '../../src/core/email/account'
import { bodyText, decodeUnknown, headerDate, headerText, parseHeaders, senderCheckOf, senderOf } from './mime'

export const STEP_TIMEOUT_MS = 15_000
export const TOTAL_TIMEOUT_MS = 30_000
export const MAX_MESSAGES = 50
const LOGOUT_WAIT_MS = 2_000
const MAX_LITERAL_BYTES = 1024 * 1024
const MAX_PENDING_BYTES = 4 * 1024 * 1024
/** a whole conversation never needs more: 50 messages of about 17 KB each, plus the replies around them */
const MAX_SESSION_BYTES = 16 * 1024 * 1024

/** What a check reads of each message: a few headers and the first 16 KB of the body, without marking it read. */
export const FETCH_ITEMS = '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING AUTHENTICATION-RESULTS)] BODY.PEEK[TEXT]<0.16384>)'

export type ImapErrorCode = 'auth_failed' | 'imap_disabled' | 'connection_failed' | 'tls_failed' | 'timeout' | 'invalid_input' | 'protocol_error'

export class ImapError extends Error {
  constructor(
    public readonly code: ImapErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ImapError'
  }
}

const SAY = {
  auth: 'The mailbox did not accept this sign-in. Use an App Password or 授权码 (authorization code), not your normal password, and check that IMAP is switched on.',
  disabled: 'IMAP is switched off for this mailbox. Turn it on in your mail settings, then try again.',
  busy: 'The mail server is busy right now. Try again in a few minutes.',
  notFound: 'Could not find that mail server. Check the server name and your internet connection.',
  unreachable: 'Could not reach the mail server. Check the server name, the port and your internet connection.',
  closed: 'The mail server closed the connection.',
  tls: 'The mail server did not offer a secure connection FundBun could verify, so nothing was sent.',
  timeout: 'The mail server took too long to answer.',
  protocol: 'The mail server answered in a way FundBun did not understand.',
  badHost: 'Type the mail server name, like imap.example.com. Servers on this computer or a private network are not allowed.',
  privateHost: 'That server name points to this computer or a private network, so FundBun will not connect to it.',
  badPort: 'The port must be a whole number from 1 to 65535.',
  badLogin: 'The address and password must be filled in.',
  noInbox: 'The mail server would not open the inbox.',
  noSearch: 'The mail server could not search the inbox.',
  noFetch: 'The mail server could not send the messages.',
} as const

export interface ImapAccount {
  host: string
  port: number
  address: string
  password: string
}

export interface ImapMail {
  /** stable for one message in one mailbox: a hash of the server, the address and what was read */
  id: string
  from: string
  subject: string
  /** ISO 8601 */
  date: string
  body: string
  /** 'fail' when the receiving server's Authentication-Results says DMARC failed (a forged From) */
  senderCheck?: 'fail'
}

/** Where the socket goes: `host` is the checked address, `servername` the name the certificate must match. */
export interface ImapTarget {
  host: string
  port: number
  servername: string
}

export type SocketFactory = (target: ImapTarget) => Duplex
export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>

export interface ImapOptions {
  /** opens the connection; defaults to TLS with certificate checks (test seam) */
  connect?: SocketFactory
  /** resolves the server name; defaults to the system resolver (test seam) */
  lookup?: LookupFn
  /** tests only: allow a server on this computer or a private network, and skip the name lookup */
  allowLocal?: boolean
  stepTimeoutMs?: number
  totalTimeoutMs?: number
  now?: () => Date
  maxMessages?: number
}

export interface ImapClient {
  /** sign in, open the inbox read only, sign out: proves the account works */
  test(account: ImapAccount): Promise<{ messageCount: number }>
  /** the newest messages from the last `days` days, read only */
  fetch(account: ImapAccount, opts?: { days?: number }): Promise<{ messageCount: number; mails: ImapMail[] }>
}

export function createImapClient(opts: ImapOptions = {}): ImapClient {
  return {
    test: (account) => imapTest(account, opts),
    fetch: (account, f) => imapFetch(account, f?.days, opts),
  }
}

// ───────────────────────────── where to connect ─────────────────────────────

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOCAL_NAME = /(?:^|\.)(?:localhost|local|internal|localdomain|home\.arpa)$/

/**
 * A mail server name, lower-cased, or null. Only letters, digits, hyphens and dots, with at least one dot: no
 * spaces, line breaks, "@", "/" or ":". Unless `allowLocal`, IP addresses and local names are refused too.
 */
export function checkHost(host: unknown, allowLocal = false): string | null {
  if (typeof host !== 'string') return null
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!HOST_RE.test(h)) return null
  if (allowLocal) return h
  if (isIP(h) || LOCAL_NAME.test(h) || /^\d+$/.test(h.slice(h.lastIndexOf('.') + 1))) return null
  return h
}

const BLOCKED = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4')
  // the same networks inside an IPv6 address: NAT64 (64:ff9b::10.0.0.1) and 6to4 (2002:0a00:0001::)
  const [a, b, c, d] = net.split('.').map(Number)
  const hi = ((a << 8) | b).toString(16)
  const lo = ((c << 8) | d).toString(16)
  BLOCKED.addSubnet(`64:ff9b::${hi}:${lo}`, 96 + prefix, 'ipv6')
  BLOCKED.addSubnet(`2002:${hi}:${lo}::`, 16 + prefix, 'ipv6')
}
// :: and ::1 sit inside ::/96; IPv4-mapped addresses (::ffff:10.0.0.1) are checked against the IPv4 rules.
// Teredo (2001::/32) and local-use NAT64 (64:ff9b:1::/48) can lead anywhere, so they are refused whole.
for (const [net, prefix] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001::', 32], ['64:ff9b:1::', 48],
] as const) BLOCKED.addSubnet(net, prefix, 'ipv6')

/** True only for an address on the public internet: not loopback, private, link-local, CGNAT, multicast or unspecified. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (!family) return false
  try {
    return !BLOCKED.check(address, family === 6 ? 'ipv6' : 'ipv4')
  } catch {
    return false
  }
}

// only the address families this computer has a route for (no IPv6 answers on an IPv4-only network)
const systemLookup: LookupFn = (host) => dnsLookup(host, { all: true, hints: ADDRCONFIG })

/** at most this many of a name's addresses are tried, one after another */
const MAX_TARGETS = 4

/**
 * Resolve the name once and connect only to those checked addresses, so a second lookup cannot swap in a private
 * one. IPv4 comes first: a network with broken IPv6 still reaches the server, and the next address is tried when
 * one does not answer.
 */
async function resolveTargets(host: string, port: number, opts: ImapOptions): Promise<ImapTarget[]> {
  if (opts.allowLocal) return [{ host, port, servername: host }]
  let found: { address: string }[]
  try {
    found = await (opts.lookup ?? systemLookup)(host)
  } catch {
    throw new ImapError('connection_failed', SAY.notFound)
  }
  const addresses = (Array.isArray(found) ? found : []).map((f) => f?.address).filter((a): a is string => typeof a === 'string')
  if (!addresses.length) throw new ImapError('connection_failed', SAY.notFound)
  // every answer must be public: a name that also points inside the network is refused outright
  if (!addresses.every(isPublicAddress)) throw new ImapError('invalid_input', SAY.privateHost)
  return [...new Set(addresses)]
    .sort((a, b) => isIP(a) - isIP(b))
    .slice(0, MAX_TARGETS)
    .map((address) => ({ host: address, port, servername: host }))
}

/** TLS with the certificate checked against the server's name (never turned off). */
export function tlsOptions(target: ImapTarget): ConnectionOptions {
  return {
    host: target.host,
    port: target.port,
    ...(isIP(target.servername) ? {} : { servername: target.servername }),
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  }
}

const connectTls: SocketFactory = (target) => tlsConnect(tlsOptions(target))

// ───────────────────────────── reading responses ─────────────────────────────

export interface Piece {
  literal: boolean
  bytes: Buffer
}

/** One server response. Literals ({size} then that many bytes) are kept as exact bytes. */
export interface ImapResponse {
  /** the response as text, each literal shown as {size} */
  text: string
  pieces: Piece[]
}

const CRLF = Buffer.from('\r\n')
const LITERAL_AT_END = /\{(\d{1,10})\}$/

/** One complete response from the front of `buf`, or how many bytes must be there first (0: a line end). */
function takeResponse(buf: Buffer): { response: ImapResponse; used: number } | { wantBytes: number } {
  const pieces: Piece[] = []
  let at = 0
  for (;;) {
    const eol = buf.indexOf(CRLF, at)
    if (eol < 0) return { wantBytes: 0 }
    const line = buf.subarray(at, eol)
    const m = LITERAL_AT_END.exec(line.subarray(Math.max(0, line.length - 13)).toString('latin1'))
    if (!m) {
      pieces.push({ literal: false, bytes: Buffer.from(line) })
      const text = pieces.map((p) => (p.literal ? `{${p.bytes.length}}` : p.bytes.toString('utf8'))).join('')
      return { response: { text, pieces }, used: eol + 2 }
    }
    const size = Number(m[1])
    if (size > MAX_LITERAL_BYTES) throw new ImapError('protocol_error', SAY.protocol)
    const start = eol + 2
    if (buf.length < start + size) return { wantBytes: start + size }
    pieces.push({ literal: false, bytes: Buffer.from(line.subarray(0, line.length - m[0].length)) })
    pieces.push({ literal: true, bytes: Buffer.from(buf.subarray(start, start + size)) })
    at = start + size
  }
}

/**
 * Collects bytes as they arrive (in any split) and hands back each complete response. Bytes are only joined and
 * scanned when a response could have finished (a line end arrived, or a literal is complete), so a server that
 * trickles data a byte at a time costs little.
 */
export function createResponseReader(): { push(chunk: Uint8Array): ImapResponse[] } {
  let chunks: Buffer[] = []
  let total = 0
  let wantBytes = 0
  return {
    push(chunk) {
      const bytes = Buffer.from(chunk)
      chunks.push(bytes)
      total += bytes.length
      if (total > MAX_PENDING_BYTES) throw new ImapError('protocol_error', SAY.protocol)
      if (wantBytes ? total < wantBytes : !bytes.includes(0x0a)) return []
      let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total)
      const out: ImapResponse[] = []
      for (;;) {
        const taken = takeResponse(buf)
        if (!('response' in taken)) {
          wantBytes = taken.wantBytes
          break
        }
        out.push(taken.response)
        buf = buf.subarray(taken.used)
      }
      chunks = buf.length ? [buf] : []
      total = buf.length
      return out
    },
  }
}

/** A parsed value: an atom (string), a quoted string or literal (bytes), NIL (null) or a parenthesised list. */
export type Token = string | Buffer | null | Token[]

/** Splits a response into tokens. An atom like BODY[HEADER.FIELDS (FROM)]<0> stays one token. */
export function tokenize(pieces: Piece[]): Token[] {
  const root: Token[] = []
  const stack: Token[][] = [root]
  const top = () => stack[stack.length - 1]
  for (const piece of pieces) {
    if (piece.literal) {
      top().push(piece.bytes)
      continue
    }
    const s = piece.bytes.toString('latin1')
    let i = 0
    while (i < s.length) {
      const c = s[i]
      if (c === ' ') {
        i++
      } else if (c === '(') {
        const list: Token[] = []
        top().push(list)
        stack.push(list)
        i++
      } else if (c === ')') {
        if (stack.length > 1) stack.pop()
        i++
      } else if (c === '"') {
        let j = i + 1
        let value = ''
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && j + 1 < s.length) j++
          value += s[j++]
        }
        top().push(Buffer.from(value, 'latin1'))
        i = j + 1
      } else {
        let j = i
        while (j < s.length && s[j] !== ' ' && s[j] !== '(' && s[j] !== ')') {
          if (s[j] === '[') {
            const close = s.indexOf(']', j)
            j = close < 0 ? s.length : close + 1
          } else j++
        }
        const atom = s.slice(i, j)
        top().push(atom.toUpperCase() === 'NIL' ? null : atom)
        i = j
      }
    }
  }
  return root
}

// ───────────────────────────── one conversation ─────────────────────────────

interface Tagged {
  status: 'OK' | 'NO' | 'BAD'
  text: string
  untagged: ImapResponse[]
}

interface Session {
  next(waitMs?: number): Promise<ImapResponse>
  /** sends one command; strings go as they are, buffers as synchronizing literals */
  run(parts: (string | Buffer)[], waitMs?: number): Promise<Tagged>
}

const TAGGED = /^(\S+) (OK|NO|BAD)\b ?(.*)$/i

function socketError(err: unknown): ImapError {
  const e = (err ?? {}) as { code?: unknown; message?: unknown }
  const code = String(e.code ?? '')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new ImapError('connection_failed', SAY.notFound)
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_|HOSTNAME|ALTNAME|HANDSHAKE/i.test(code) || /\b(?:SSL|TLS|certificate)\b/i.test(String(e.message ?? ''))) {
    return new ImapError('tls_failed', SAY.tls)
  }
  return new ImapError('connection_failed', SAY.unreachable)
}

function createSession(socket: Duplex, stepMs: number, deadline: number): Session {
  const reader = createResponseReader()
  const queue: ImapResponse[] = []
  let failure: ImapError | null = null
  let wake: (() => void) | null = null
  let tags = 0
  let received = 0
  const notify = () => {
    const w = wake
    wake = null
    w?.()
  }
  socket.on('data', (chunk: Buffer | string) => {
    if (failure) return
    try {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      received += bytes.length
      if (received > MAX_SESSION_BYTES) throw new ImapError('protocol_error', SAY.protocol)
      for (const r of reader.push(bytes)) queue.push(r)
    } catch (err) {
      failure = err instanceof ImapError ? err : new ImapError('protocol_error', SAY.protocol)
      socket.destroy()
    }
    notify()
  })
  socket.on('error', (err: unknown) => {
    failure ??= socketError(err)
    notify()
  })
  const closed = () => {
    failure ??= new ImapError('connection_failed', SAY.closed)
    notify()
  }
  socket.on('end', closed)
  socket.on('close', closed)

  async function next(waitMs = stepMs): Promise<ImapResponse> {
    for (;;) {
      const r = queue.shift()
      if (r) return r
      if (failure) throw failure
      const left = Math.min(waitMs, deadline - Date.now())
      if (left <= 0) throw new ImapError('timeout', SAY.timeout)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          wake = null
          reject(new ImapError('timeout', SAY.timeout))
        }, left)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  }

  async function finish(tag: string, untagged: ImapResponse[], waitMs: number): Promise<Tagged> {
    for (;;) {
      const r = await next(waitMs)
      const m = TAGGED.exec(r.text)
      if (m && m[1] === tag) return { status: m[2].toUpperCase() as Tagged['status'], text: m[3], untagged }
      if (r.text.startsWith('*')) untagged.push(r)
    }
  }

  async function run(parts: (string | Buffer)[], waitMs = stepMs): Promise<Tagged> {
    const tag = `A${++tags}`
    const untagged: ImapResponse[] = []
    let head = `${tag} `
    for (const part of parts) {
      if (typeof part === 'string') {
        head += part
        continue
      }
      socket.write(`${head}{${part.length}}\r\n`)
      head = ''
      // a synchronizing literal: the server must say "+" before the bytes are sent
      for (;;) {
        const r = await next(waitMs)
        if (r.text.startsWith('+')) break
        const m = TAGGED.exec(r.text)
        if (m && m[1] === tag) return { status: m[2].toUpperCase() as Tagged['status'], text: m[3], untagged }
        if (r.text.startsWith('*')) untagged.push(r)
      }
      socket.write(part)
    }
    socket.write(`${head}\r\n`)
    return finish(tag, untagged, waitMs)
  }

  return { next, run }
}

// ───────────────────────────── errors the user can act on ─────────────────────────────

const DISABLED_TEXT = /not enabled for IMAP|enable (?:your account for )?IMAP|IMAP (?:access )?is (?:disabled|not enabled|turned off)|Unsafe Login/i
const BUSY_TEXT = /\[(?:UNAVAILABLE|LIMIT|INUSE|SERVERBUG)\]|too many|try again later|temporarily/i

const CONTROL = /[\u0000-\u001f\u007f]+/g

/** Server text fit to show: no password (in any letter case), no control characters or line breaks, short. */
export function cleanServerText(text: string, password: string): string {
  // the password as typed, and as it would look once its line breaks became spaces
  const forms = [...new Set([password, String(password ?? '').replace(CONTROL, ' ')])].filter(Boolean)
  const patterns = forms.map((f) => new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))
  const hide = (s: string) => patterns.reduce((acc, re) => acc.replace(re, '***'), s)
  return hide(hide(String(text ?? '')).replace(CONTROL, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function withServerText(base: string, text: string, password: string): string {
  const said = cleanServerText(text, password)
  return said ? `${base} The server said: "${said}"` : base
}

function loginError(text: string, password: string): ImapError {
  if (DISABLED_TEXT.test(text)) return new ImapError('imap_disabled', withServerText(SAY.disabled, text, password))
  if (BUSY_TEXT.test(text)) return new ImapError('connection_failed', withServerText(SAY.busy, text, password))
  return new ImapError('auth_failed', withServerText(SAY.auth, text, password))
}

// ───────────────────────────── the read-only conversation ─────────────────────────────

function capabilitiesIn(text: string): string[] | null {
  const code = /\[CAPABILITY ([^\]]*)\]/i.exec(text) ?? /^\* CAPABILITY (.*)$/i.exec(text)
  return code ? code[1].toUpperCase().split(/\s+/).filter(Boolean) : null
}

function checkAccount(account: ImapAccount, allowLocal: boolean): string {
  const a = (account ?? {}) as Partial<ImapAccount>
  const host = checkHost(a.host, allowLocal)
  if (!host) throw new ImapError('invalid_input', SAY.badHost)
  if (!Number.isInteger(a.port) || (a.port as number) < 1 || (a.port as number) > 65535) throw new ImapError('invalid_input', SAY.badPort)
  const address = a.address
  const password = a.password
  // a literal may hold any byte but NUL; the address must also stay on one line
  if (typeof address !== 'string' || !address || address.length > 254 || /[\u0000\r\n]/.test(address)) throw new ImapError('invalid_input', SAY.badLogin)
  if (typeof password !== 'string' || !password || password.length > 1024 || password.includes('\u0000')) throw new ImapError('invalid_input', SAY.badLogin)
  return host
}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ImapError('timeout', SAY.timeout)), Math.max(0, ms))
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** a retry on the next address needs at least this much of the overall budget left */
const MIN_RETRY_MS = 1_000

/**
 * Connect, greet, sign in, identify when asked to, open INBOX read only, do `work`, sign out. When an address does
 * not answer before the greeting (refused, unreachable, silent), the next checked address is tried; nothing has
 * been sent by then. A TLS or certificate failure is never retried. Every socket is destroyed at the end.
 */
async function withInbox<T>(account: ImapAccount, opts: ImapOptions, work: (session: Session, count: number) => Promise<T>): Promise<T> {
  const allowLocal = opts.allowLocal === true
  const host = checkAccount(account, allowLocal)
  const stepMs = opts.stepTimeoutMs ?? STEP_TIMEOUT_MS
  const deadline = Date.now() + (opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)
  const targets = await within(resolveTargets(host, account.port, opts), Math.min(stepMs, deadline - Date.now()))
  const tryNext = (err: ImapError, i: number) =>
    (err.code === 'connection_failed' || err.code === 'timeout') && i + 1 < targets.length && deadline - Date.now() >= MIN_RETRY_MS
  for (let i = 0; ; i++) {
    let socket: Duplex
    try {
      socket = (opts.connect ?? connectTls)(targets[i])
    } catch (err) {
      const failed = socketError(err)
      if (tryNext(failed, i)) continue
      throw failed
    }
    let greeted = false
    const onGreeting = () => {
      greeted = true
    }
    try {
      return await conversation(socket, account, stepMs, deadline, onGreeting, work)
    } catch (err) {
      if (!greeted && err instanceof ImapError && tryNext(err, i)) continue
      throw err
    } finally {
      if (!socket.destroyed) socket.end()
      socket.destroy()
    }
  }
}

/** One conversation on an open socket, from the greeting to LOGOUT. `onGreeting` runs once the server has said hello. */
async function conversation<T>(
  socket: Duplex,
  account: ImapAccount,
  stepMs: number,
  deadline: number,
  onGreeting: () => void,
  work: (session: Session, count: number) => Promise<T>,
): Promise<T> {
  const { password } = account
  try {
    const session = createSession(socket, stepMs, deadline)
    const greeting = await session.next()
    onGreeting()
    const hello = /^\* (OK|PREAUTH|BYE)\b ?(.*)$/i.exec(greeting.text)
    if (!hello) throw new ImapError('protocol_error', SAY.protocol)
    const kind = hello[1].toUpperCase()
    if (kind === 'BYE') throw new ImapError('connection_failed', withServerText(SAY.closed, hello[2], password))
    let caps = capabilitiesIn(greeting.text)
    if (!caps) {
      const asked = await session.run(['CAPABILITY'])
      caps = asked.untagged.map((r) => capabilitiesIn(r.text)).find(Boolean) ?? []
    }
    if (kind !== 'PREAUTH') {
      if (caps.includes('LOGINDISABLED')) throw new ImapError('imap_disabled', SAY.disabled)
      const login = await session.run(['LOGIN ', Buffer.from(account.address, 'utf8'), ' ', Buffer.from(password, 'utf8')])
      if (login.status !== 'OK') throw loginError(login.text, password)
      caps = capabilitiesIn(login.text) ?? login.untagged.map((r) => capabilitiesIn(r.text)).find(Boolean) ?? caps
    }
    // identification only (some providers, like 163 Mail, refuse to open the inbox without it)
    if (caps.includes('ID')) await session.run(['ID ("name" "FundBun" "version" "1.0")'])
    const inbox = await session.run(['EXAMINE INBOX'])
    if (inbox.status !== 'OK') {
      if (DISABLED_TEXT.test(inbox.text)) throw new ImapError('imap_disabled', withServerText(SAY.disabled, inbox.text, password))
      throw new ImapError('protocol_error', withServerText(SAY.noInbox, inbox.text, password))
    }
    const exists = inbox.untagged.map((r) => /^\* (\d+) EXISTS\b/i.exec(r.text)).find(Boolean)
    const result = await work(session, exists ? Number(exists[1]) : 0)
    try {
      await session.run(['LOGOUT'], LOGOUT_WAIT_MS)
    } catch {
      // the server may simply hang up after BYE
    }
    return result
  } catch (err) {
    // every ImapError message is one of the sentences above, plus server text already cleaned of the password
    if (err instanceof ImapError) throw err
    throw new ImapError('protocol_error', SAY.protocol)
  }
}

/** Sign in and open the inbox read only. Resolves with how many messages it holds. */
export function imapTest(account: ImapAccount, opts: ImapOptions = {}): Promise<{ messageCount: number }> {
  return withInbox(account, opts, async (_session, count) => ({ messageCount: count }))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** IMAP's date form for SEARCH: 05-Nov-2026 (UTC). */
export function imapDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`
}

/** 3,4,5,9 → "3:5,9" */
export function sequenceSet(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const ranges: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    ranges.push(i === j ? String(sorted[i]) : `${sorted[i]}:${sorted[j]}`)
    i = j + 1
  }
  return ranges.join(',')
}

export function clampDays(days: unknown): number {
  const n = typeof days === 'number' && Number.isFinite(days) ? Math.round(days) : CHECK_DAYS.default
  return Math.min(CHECK_DAYS.max, Math.max(CHECK_DAYS.min, n))
}

function searchNumbers(untagged: ImapResponse[]): number[] {
  const out: number[] = []
  for (const r of untagged) {
    const m = /^\* SEARCH\b(.*)$/i.exec(r.text)
    if (!m) continue
    for (const n of m[1].match(/\d+/g) ?? []) {
      const v = Number(n)
      if (Number.isSafeInteger(v) && v > 0) out.push(v)
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

interface Fetched {
  header?: Buffer
  text?: Buffer
}

const asBytes = (t: Token | undefined): Buffer => (Buffer.isBuffer(t) ? t : Buffer.alloc(0))

/** Merges the FETCH responses by message number (a server may split one message's data over several). */
function fetchedBySeq(untagged: ImapResponse[]): Map<number, Fetched> {
  const out = new Map<number, Fetched>()
  for (const r of untagged) {
    const m = /^\* (\d+) FETCH\b/i.exec(r.text)
    if (!m) continue
    const list = tokenize(r.pieces).find((t): t is Token[] => Array.isArray(t))
    if (!list) continue
    const entry = out.get(Number(m[1])) ?? {}
    for (let i = 0; i + 1 < list.length; i += 2) {
      const key = typeof list[i] === 'string' ? (list[i] as string).toUpperCase() : ''
      if (key.startsWith('BODY[HEADER')) entry.header = asBytes(list[i + 1])
      else if (key.startsWith('BODY[TEXT]')) entry.text = asBytes(list[i + 1])
    }
    out.set(Number(m[1]), entry)
  }
  return out
}

function toMail(account: ImapAccount, header: Buffer, text: Buffer, now: Date): ImapMail {
  const headers = parseHeaders(decodeUnknown(header))
  const id = createHash('sha256')
    .update(`${account.host.toLowerCase()}\n${account.address.toLowerCase()}\n`)
    .update(header)
    .update('\n')
    .update(text)
    .digest('hex')
    .slice(0, 24)
  return {
    id,
    // read from the bytes, never from the decoded text: a charset could change what the From says
    from: senderOf(header),
    subject: headerText(headers.get('subject')),
    date: headerDate(headers.get('date')) ?? now.toISOString(),
    body: bodyText(headers, text),
    ...(senderCheckOf(header) === 'fail' ? { senderCheck: 'fail' as const } : {}),
  }
}

/** The newest messages (at most 50) received in the last `days` days, newest first. Nothing is marked read. */
export function imapFetch(account: ImapAccount, days: unknown, opts: ImapOptions = {}): Promise<{ messageCount: number; mails: ImapMail[] }> {
  const now = opts.now?.() ?? new Date()
  const since = new Date(now.getTime() - clampDays(days) * 86_400_000)
  const max = Math.max(1, Math.min(MAX_MESSAGES, opts.maxMessages ?? MAX_MESSAGES))
  return withInbox(account, opts, async (session, count) => {
    const search = await session.run([`SEARCH SINCE ${imapDate(since)}`])
    if (search.status !== 'OK') throw new ImapError('protocol_error', withServerText(SAY.noSearch, search.text, account.password))
    const newest = searchNumbers(search.untagged).slice(-max)
    if (!newest.length) return { messageCount: count, mails: [] }
    const fetched = await session.run([`FETCH ${sequenceSet(newest)} ${FETCH_ITEMS}`])
    const bySeq = fetchedBySeq(fetched.untagged)
    // NO can still come with the messages that were there; only fail when nothing usable came back
    if (fetched.status === 'BAD' || (fetched.status === 'NO' && !bySeq.size)) {
      throw new ImapError('protocol_error', withServerText(SAY.noFetch, fetched.text, account.password))
    }
    const mails: ImapMail[] = []
    for (const seq of [...newest].reverse()) {
      const got = bySeq.get(seq)
      if (got?.header) mails.push(toMail(account, got.header, got.text ?? Buffer.alloc(0), now))
    }
    return { messageCount: count, mails }
  })
}
