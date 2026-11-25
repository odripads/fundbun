/**
 * Turns the raw bytes an IMAP server sends into plain text FundBun can read: MIME encoded-words in headers,
 * quoted-printable and base64 bodies, multipart messages, Chinese and Western charsets, and HTML mail.
 * Everything here works on UNTRUSTED input: it never throws on broken or cut-off mail, and it never runs or
 * fetches anything a message contains (scripts and styles are dropped, links are not followed).
 */
import { readMailbox } from '../../src/core/email/allowlist'

/** The longest body FundBun keeps for one email, in UTF-8 bytes. */
export const MAX_BODY_BYTES = 16_384
const MAX_HEADER_CHARS = 400
const MAX_DEPTH = 5
const MAX_PARTS = 60

// ───────────────────────────── charsets ─────────────────────────────

/** Labels mail software uses, mapped to the decoder that reads them best. */
const CHARSET_ALIASES: Record<string, string> = {
  utf8: 'utf-8',
  'us-ascii': 'utf-8',
  ascii: 'utf-8',
  gb2312: 'gb18030',
  gbk: 'gb18030',
  'x-gbk': 'gb18030',
  cp936: 'gb18030',
  ms936: 'gb18030',
  'euc-cn': 'gb18030',
  'gb_2312-80': 'gb18030',
  'big5-hkscs': 'big5',
  cp950: 'big5',
  latin1: 'iso-8859-1',
  cp1252: 'windows-1252',
}

function decoderFor(charset: string | undefined): TextDecoder {
  const label = String(charset ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase()
  try {
    return new TextDecoder(CHARSET_ALIASES[label] ?? (label || 'utf-8'))
  } catch {
    // an unknown charset is read as UTF-8 rather than failing the whole message
    return new TextDecoder('utf-8')
  }
}

/** Bytes in a named charset → text. A sequence cut off at the end is dropped, never an error. */
export function decodeCharset(bytes: Uint8Array, charset?: string): string {
  return decoderFor(charset).decode(bytes, { stream: true })
}

/** Bytes with no charset given: UTF-8 when they are valid UTF-8, else GB18030 (the usual Chinese mail charset). */
export function decodeUnknown(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true })
  } catch {
    return new TextDecoder('gb18030').decode(bytes, { stream: true })
  }
}

// ───────────────────────────── transfer encodings ─────────────────────────────

/** A "binary string" (one char per byte, as Buffer's latin1 gives) back to bytes. */
const bytesOf = (binary: string): Buffer => Buffer.from(binary, 'latin1')

export function decodeBase64(text: string): Buffer {
  return Buffer.from(text.replace(/[^A-Za-z0-9+/]/g, ''), 'base64')
}

/** Quoted-printable → bytes. Soft line breaks are joined; a cut-off "=" or "=X" at the very end is dropped. */
export function decodeQuotedPrintable(binary: string, underscoreIsSpace = false): Buffer {
  const out = Buffer.alloc(binary.length)
  let n = 0
  for (let i = 0; i < binary.length; i++) {
    const c = binary.charCodeAt(i)
    if (c === 0x5f && underscoreIsSpace) {
      out[n++] = 0x20
      continue
    }
    if (c !== 0x3d) {
      out[n++] = c & 0xff
      continue
    }
    const hex = binary.slice(i + 1, i + 3)
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out[n++] = parseInt(hex, 16)
      i += 2
    } else if (binary[i + 1] === '\r' && binary[i + 2] === '\n') {
      i += 2
    } else if (binary[i + 1] === '\n') {
      i += 1
    } else if (i + 2 >= binary.length) {
      break
    } else {
      out[n++] = c
    }
  }
  return out.subarray(0, n)
}

function transferDecode(encoding: string | undefined, binary: string): Buffer {
  const e = String(encoding ?? '').trim().toLowerCase()
  if (e === 'base64') return decodeBase64(binary)
  if (e === 'quoted-printable') return decodeQuotedPrintable(binary)
  return bytesOf(binary)
}

// ───────────────────────────── headers ─────────────────────────────

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g

/**
 * RFC 2047: "=?UTF-8?B?5oub5ZWG?= =?UTF-8?Q?=E9=93=B6=E8=A1=8C?=" → "招商银行". Adjacent words join without the space.
 * `decoded` may rewrite the text that came out of encoded-words (the plain text around them is left alone).
 */
export function decodeWords(value: string, decoded: (text: string) => string = (t) => t): string {
  const text = String(value ?? '')
  let out = ''
  let last = 0
  // bytes of the encoded-words read so far in one charset: a character may be split across two words
  let charset = ''
  let chunks: Buffer[] = []
  const flush = () => {
    if (chunks.length) out += decoded(decodeCharset(Buffer.concat(chunks), charset))
    chunks = []
  }
  for (const m of text.matchAll(ENCODED_WORD)) {
    const between = text.slice(last, m.index)
    if (!chunks.length || /\S/.test(between)) {
      flush()
      out += between
    }
    // "utf-8*en" carries a language tag after the star
    const wordCharset = m[1].split('*')[0].toLowerCase()
    const bytes = m[2].toUpperCase() === 'B' ? decodeBase64(m[3]) : decodeQuotedPrintable(m[3], true)
    if (wordCharset !== charset) flush()
    charset = wordCharset
    chunks.push(bytes)
    last = (m.index ?? 0) + m[0].length
  }
  flush()
  return out + text.slice(last)
}

/** Header block → every [lower-case name, value] in order. Folded lines are unfolded. */
function headerFields(text: string): [string, string][] {
  const fields: [string, string][] = []
  for (const line of String(text ?? '').replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    fields.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()])
  }
  return fields
}

/** Header block → lower-case name to value (the first one wins). Folded lines are unfolded. */
export function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>()
  for (const [name, value] of headerFields(text)) if (!headers.has(name)) headers.set(name, value)
  return headers
}

/** Every value one header has in a header block, in order ("From" twice gives two). */
export function headerValues(text: string, name: string): string[] {
  const key = name.toLowerCase()
  return headerFields(text)
    .filter(([n]) => n === key)
    .map(([, value]) => value)
}

export interface ContentType {
  type: string
  subtype: string
  params: Record<string, string>
}

/** 'text/plain; charset="gb2312"' → { type: 'text', subtype: 'plain', params: { charset: 'gb2312' } }. */
export function parseContentType(value: string | undefined): ContentType {
  const text = String(value ?? '')
  const m = /^\s*([^/\s;]+)\s*\/\s*([^\s;]+)/.exec(text)
  const params: Record<string, string> = {}
  for (const p of text.matchAll(/;\s*([^\s=;]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]*))/g)) {
    let name = p[1].toLowerCase()
    let val = p[2] !== undefined ? p[2].replace(/\\(.)/g, '$1') : p[3]
    // RFC 2231: charset*=utf-8''%E2%82%AC
    if (name.endsWith('*')) {
      name = name.replace(/\*(?:\d+\*?)?$/, '')
      const quote = val.indexOf("''")
      if (quote >= 0) val = val.slice(quote + 2)
      try {
        val = decodeURIComponent(val)
      } catch {
        // keep it as it was
      }
    }
    if (!(name in params)) params[name] = val
  }
  return { type: (m?.[1] ?? '').toLowerCase(), subtype: (m?.[2] ?? '').toLowerCase(), params }
}

// ───────────────────────────── HTML ─────────────────────────────

const SKIP_TAGS = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'svg', 'object', 'iframe'])
const BLOCK_TAGS = new Set([
  'br', 'p', 'div', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'pre', 'blockquote', 'address', 'center', 'section', 'article',
  'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'form', 'fieldset', 'body', 'html',
])
const CELL_TAGS = new Set(['td', 'th'])
/** marks a table cell edge while converting; never left in the output */
const CELL = '\u001f'

const ENTITIES: Record<string, string> = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  yen: '¥', euro: '€', pound: '£', cent: '¢', copy: '©', reg: '®', trade: '™', deg: '°', middot: '·',
  bull: '•', hellip: '...', ndash: '-', mdash: '-', minus: '-', times: '×', divide: '÷', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', zwnj: '', zwj: '', shy: '', lrm: '', rlm: '',
}

/** "&yen;12&#46;50&amp;" → "¥12.50&". Unknown names stay as they are; control characters are dropped. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? whole
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    if (code === 0x09 || code === 0x0a) return ' '
    if (!Number.isFinite(code) || code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return ''
    return code === 0xa0 ? ' ' : String.fromCodePoint(code)
  })
}

/** Where a tag that starts at `start` ends (the index after its ">"), or -1 when the text stops first. */
function tagEnd(html: string, start: number): number {
  let quote = ''
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '>') {
      return i + 1
    } else if ((c === '"' || c === "'") && /=\s*$/.test(html.slice(Math.max(start, i - 8), i))) {
      quote = c
    }
  }
  return -1
}

function closingTagEnd(html: string, from: number, name: string): number {
  const re = new RegExp(`</${name}\\s*>`, 'gi')
  re.lastIndex = from
  const m = re.exec(html)
  return m ? m.index + m[0].length : -1
}

/**
 * HTML mail → plain text, in one pass. Scripts, styles and the head are dropped; blocks become lines; table
 * cells become "a | b" so a bank's statement table still reads as a table. A cut-off document ends cleanly.
 */
export function htmlToText(html: string): string {
  const src = String(html ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const out: string[] = []
  const text = (chunk: string) => {
    if (chunk) out.push(decodeEntities(chunk.replace(/\s+/g, ' ')))
  }
  // tags already known to have no closing tag further on: never search for them twice
  const unclosed = new Set<string>()
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      text(src.slice(i))
      break
    }
    text(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      if (end < 0) break
      i = end + 3
      continue
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)|^<[!?]/.exec(src.slice(lt, lt + 40))
    if (!m) {
      // a "<" that does not open a tag ("price < 5") is text
      text('<')
      i = lt + 1
      continue
    }
    const end = tagEnd(src, lt)
    if (end < 0) break
    i = end
    const name = (m[2] ?? '').toLowerCase()
    if (!name) continue
    const closing = m[1] === '/'
    if (!closing && SKIP_TAGS.has(name) && !unclosed.has(name) && !/\/\s*>$/.test(src.slice(lt, end))) {
      const after = closingTagEnd(src, end, name)
      // an unclosed script or style runs to the end; an unclosed head is only a sloppy page, so read on
      if (after >= 0) i = after
      else if (name === 'script' || name === 'style') break
      else unclosed.add(name)
    } else if (BLOCK_TAGS.has(name)) {
      out.push('\n')
    } else if (CELL_TAGS.has(name) && !closing) {
      // marked where a cell opens, so an empty cell still holds its column
      out.push(CELL)
    }
  }
  return tidyLines(out.join(''))
}

/**
 * One line per block or table row; empty lines (layout markup leaves many) are dropped. Empty cells inside a row
 * are kept, so a statement row with a blank 摘要 still lines up with its header; only empty cells at the end go.
 */
function tidyLines(text: string): string {
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
  return text
    .split('\n')
    .map((line) => {
      if (!line.includes(CELL)) return tidy(line)
      const [before, ...cells] = line.split(CELL).map(tidy)
      const row = before ? [before, ...cells] : cells
      while (row.length && !row[row.length - 1]) row.pop()
      return row.join(' | ').trim()
    })
    .filter(Boolean)
    .join('\n')
}

// ───────────────────────────── bodies ─────────────────────────────

interface Found {
  plain?: string
  html?: string
}

const LOOKS_LIKE_HTML = /^\s*(?:<!doctype html|<html\b|<head\b|<body\b|<table\b|<div\b|<p\b)/i

/** One leaf part: decode it and remember it when it is the first plain or HTML text seen. */
function leaf(type: ContentType, encoding: string | undefined, binary: string, found: Found): void {
  const known = Boolean(type.type)
  if (known && type.type !== 'text') return
  const bytes = transferDecode(encoding, binary)
  const text = type.params.charset ? decodeCharset(bytes, type.params.charset) : decodeUnknown(bytes)
  const plainish = !known || type.subtype === 'plain'
  // some banks send HTML labelled as plain text
  if (type.subtype === 'html' || (plainish && LOOKS_LIKE_HTML.test(text))) found.html ??= text
  else if (plainish && text.trim()) found.plain ??= text
}

/** The parts of a multipart body, each as its header block and its body (binary strings). */
export function splitMultipart(binary: string, boundary: string): { headers: string; body: string }[] {
  const delim = `--${boundary}`
  const parts: { headers: string; body: string }[] = []
  let current: string[] | null = null
  for (const line of binary.split(/\r?\n/)) {
    if (line.startsWith(delim)) {
      const rest = line.slice(delim.length)
      if (/^--\s*$/.test(rest)) {
        if (current) parts.push(splitPart(current))
        current = null
        break
      }
      if (/^\s*$/.test(rest)) {
        if (current) parts.push(splitPart(current))
        if (parts.length >= MAX_PARTS) return parts
        current = []
        continue
      }
    }
    current?.push(line)
  }
  // a body cut off at the size limit still gives its last part
  if (current) parts.push(splitPart(current))
  return parts
}

function splitPart(lines: string[]): { headers: string; body: string } {
  const blank = lines.findIndex((l) => l === '')
  if (blank < 0) return { headers: lines.join('\r\n'), body: '' }
  return { headers: lines.slice(0, blank).join('\r\n'), body: lines.slice(blank + 1).join('\r\n') }
}

function walk(type: ContentType, encoding: string | undefined, binary: string, found: Found, depth: number): void {
  if (type.type !== 'multipart') return leaf(type, encoding, binary, found)
  const boundary = type.params.boundary
  if (!boundary || depth >= MAX_DEPTH) return
  for (const part of splitMultipart(binary, boundary)) {
    const headers = parseHeaders(decodeUnknown(bytesOf(part.headers)))
    if (/^\s*attachment\b/i.test(headers.get('content-disposition') ?? '')) continue
    walk(parseContentType(headers.get('content-type')), headers.get('content-transfer-encoding'), part.body, found, depth + 1)
    if (found.plain) return
  }
}

/**
 * The readable text of a message body (raw bytes, as BODY[TEXT] gives them) under its top-level headers:
 * the text/plain part when there is one, else the HTML part as text. Never throws.
 */
export function bodyText(headers: Map<string, string>, raw: Uint8Array): string {
  try {
    const found: Found = {}
    walk(parseContentType(headers.get('content-type')), headers.get('content-transfer-encoding'), Buffer.from(raw).toString('latin1'), found, 0)
    const text = found.plain ?? (found.html !== undefined ? htmlToText(found.html) : '')
    return capBytes(cleanText(text), MAX_BODY_BYTES)
  } catch {
    return ''
  }
}

/** Plain line endings, no control characters, no long runs of blank lines. Spaces are kept: tables use them. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cuts text to at most `max` UTF-8 bytes without splitting a character. */
export function capBytes(text: string, max: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= max) return text
  return bytes.subarray(0, max).toString('utf8').replace(/�+$/, '')
}

/** One header value as plain text: encoded-words decoded, control characters gone, length capped. */
export function headerText(value: string | undefined, decoded?: (text: string) => string): string {
  return decodeWords(String(value ?? ''), decoded)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_HEADER_CHARS)
}

const MAX_NAME_CHARS = 120

/** Address syntax in a display name becomes look-alikes, so the name can never read as a second address. */
const NAME_ONLY: Record<string, string> = {
  '<': '‹', '>': '›', '@': '＠', '(': '（', ')': '）', ',': '，', ';': '；', ':': '：', '[': '［', ']': '］', '"': '', '\\': '',
}
const nameOnly = (text: string): string => text.replace(/[<>@(),;:[\]"\\]/g, (c) => NAME_ONLY[c])

/** Control characters a From value never holds (a tab is plain white space); a bare CR could split it for another reader. */
const FROM_CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/

/**
 * One raw From value as "name <address>", for the sender check. `raw` holds ONE CHARACTER PER BYTE (latin1, as
 * `senderOf` gives it), so no charset can join a byte with the "\" or "@" after it: the address is read from
 * exactly what was sent, by the same reader the app uses, and it is never cut. Only then is the display name
 * decoded (its charset, then encoded-words); it loses every bit of address syntax ("<", "@", brackets, quotes,
 * commas) and only the name is capped. A value that is not exactly one plain address gives '', so the app
 * refuses that email.
 */
export function senderText(raw: string | undefined): string {
  const value = String(raw ?? '')
  if (FROM_CONTROL.test(value)) return ''
  const box = readMailbox(value)
  if (!box) return ''
  const decoded = decodeWords(decodeUnknown(bytesOf(box.name)))
  const name = Array.from(nameOnly(decoded).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_NAME_CHARS)
    .join('')
    .trim()
  return name ? `${name} <${box.address}>` : box.address
}

/**
 * The sender of a raw header block (its bytes, as BODY[HEADER.FIELDS] gives them), as `senderText` gives it.
 * '' (refused) when the block has no From or more than one, or when reading the block as text (UTF-8, else
 * GB18030, where a byte can swallow the "\" after it) would name a different address than its bytes do.
 */
export function senderOf(header: Uint8Array): string {
  const bytes = Buffer.from(header)
  const raw = headerValues(bytes.toString('latin1'), 'from')
  if (raw.length !== 1) return ''
  const from = senderText(raw[0])
  if (!from) return ''
  const text = headerValues(decodeUnknown(bytes), 'from')
  if (text.length !== 1 || readMailbox(text[0])?.address !== readMailbox(raw[0])?.address) return ''
  return from
}

/**
 * What the user's own mail server found when it received the message: 'fail' when its Authentication-Results
 * header says DMARC failed, meaning the From domain was forged. Only the TOPMOST header counts: the receiving
 * server adds its own above anything the sender wrote, so a sender's fake "dmarc=pass" lower down changes nothing.
 * Only a failure is acted on, so a server that adds no such header (or a forged one on top of nothing) can never
 * make a message more trusted than the sender check alone. undefined when there is nothing to act on.
 */
export function senderCheckOf(header: Uint8Array): 'fail' | undefined {
  const [top] = headerValues(Buffer.from(header).toString('latin1'), 'authentication-results')
  return top !== undefined && /(?:^|[\s;])dmarc\s*=\s*fail\b/i.test(top) ? 'fail' : undefined
}

/** The Date header as ISO 8601, or null when it cannot be read. */
export function headerDate(value: string | undefined): string | null {
  const t = Date.parse(String(value ?? '').trim())
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
