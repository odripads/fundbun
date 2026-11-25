/**
 * The allowlist of bank, wallet and receipt sender domains whose emails Bun will ever parse.
 *
 * Only an email whose sender ADDRESS matches this list is parsed. The display name is deliberately ignored: a
 * forged "招商银行 <attacker@evil.com>" fails because the address, not the label, is what is checked, and so does
 * a display name that itself looks like a bank address ("alerts@bca.co.id" <attacker@evil.com>).
 */
import { normaliseDomain } from './account'

// Lower-cased domains. A match is exact or on a sub-domain ("service.tenpay.com" matches "tenpay.com").
const ALLOWED_DOMAINS: readonly string[] = [
  // 招商银行 (China Merchants Bank)
  'cmbchina.com',
  'cmbchina.com.cn',
  // 工商银行 (ICBC)
  'icbc.com.cn',
  // 建设银行 (China Construction Bank)
  'ccb.com',
  'ccb.cn',
  'ccbchina.com',
  // 农业银行 (Agricultural Bank of China)
  'abchina.com',
  'abchina.com.cn',
  // 中国银行 (Bank of China)
  'boc.cn',
  'bankofchina.com',
  // 支付宝 (Alipay)
  'alipay.com',
  'alipay-inc.com',
  // 微信支付 (WeChat Pay) / 财付通 (Tenpay)
  'tenpay.com',
  'wechat.com',
  'wechatpay.com',
  // Western banks, for completeness (AUTO is not limited to mainland China)
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  // Indonesian banks
  'bca.co.id',
  'klikbca.com',
  'bankmandiri.co.id',
  'bri.co.id',
  'bni.co.id',
  'jago.com',
  'jenius.com',
  'seabank.co.id',
  // Indonesian wallets, ride hailing and shops
  'gopay.co.id',
  'gojek.com',
  'ovo.id',
  'dana.id',
  'shopee.co.id',
  'tokopedia.com',
  'grab.com',
  // Global payment and receipt issuers
  'apple.com',
  'google.com',
  'paypal.com',
  'stripe.com',
  'uber.com',
  'amazon.com',
  'wise.com',
  'revolut.com',
  'amex.com',
  'americanexpress.com',
  'citi.com',
  'hsbc.com',
  'dbs.com',
  'ocbc.com',
  'uob.com.sg',
  // Travel
  'airasia.com',
  'agoda.com',
  'booking.com',
  'trip.com',
  'klook.com',
]

/** Built-in sender domains, for the settings screen and the tests. */
export const ALLOWED_SENDER_DOMAINS: readonly string[] = ALLOWED_DOMAINS

// Anyone can open a mailbox on these, so trusting one would trust strangers.
const OPEN_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.id', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com',
  'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sohu.com', 'aliyun.com',
])

// "co.id", "com.cn", "ac.uk": a whole country's companies or schools, never one sender.
const SHARED_SUFFIX = /^(?:co|com|net|org|ac|go|gov|edu|or|ne|web|my|biz|sch|mil|id|ltd|plc)\.[a-z]{2}$/

/**
 * A domain the user may add to the list: a plain domain name that names one organisation. Open webmail
 * providers and shared suffixes such as "co.id" are refused, because anyone could send from them.
 */
export function isTrustableDomain(text: unknown): boolean {
  const d = normaliseDomain(text)
  return d !== null && !OPEN_MAIL_DOMAINS.has(d) && !SHARED_SUFFIX.test(d)
}

/** The user's extra domains, cleaned: invalid or untrustable entries are dropped. */
export function trustedExtras(extraDomains: readonly string[] | undefined): string[] {
  if (!Array.isArray(extraDomains)) return []
  const out: string[] = []
  for (const raw of extraDomains) {
    const d = normaliseDomain(raw)
    if (d && isTrustableDomain(d) && !out.includes(d)) out.push(d)
  }
  return out
}

const ADDRESS_RE = /^[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})$/
/** the longest address mail allows */
const MAX_ADDRESS = 254
/** a From field longer than this is not a real sender: it is refused, never cut (a cut could leave another address) */
export const MAX_FROM_CHARS = 2000

/** One sender out of a From field: its address, and the text around it (a display name, comments) as written. */
export interface Mailbox {
  address: string
  name: string
}

/** Where the quoted string or (comment) that opens at `start` closes, or -1. Backslash escapes and nesting count. */
function closeAt(text: string, start: number): number {
  const quote = text[start] === '"'
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (quote) {
      if (c === '"' && i > start) return i
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

/** Address syntax that has no place in a display name outside quotes: "@", a group's ":", "\" and "[ ]". */
const NOT_IN_NAME = /[@:\\[\]]/

/**
 * The one mailbox in a From field, read the way mail servers read it (RFC 5322): a "<...>" inside a quoted
 * display name or a (comment) is text, never the address. Null for anything that is not exactly one plain
 * address: two mailboxes, a group, an unclosed quote, comment or bracket, words after the address, address
 * syntax in an unquoted display name ("x@evil.example <alerts@bank>", which other readers take as the
 * address), or a field too long to be real.
 */
export function readMailbox(from: unknown): Mailbox | null {
  if (typeof from !== 'string' || from.length > MAX_FROM_CHARS) return null
  let angle: string | null = null
  let quoted = false
  let bare = ''
  let name = ''
  for (let i = 0; i < from.length; i++) {
    const c = from[i]
    if (c === '"' || c === '(') {
      const end = closeAt(from, i)
      if (end < 0 || (c === '"' && angle !== null)) return null
      quoted ||= c === '"'
      name += from.slice(i, end + 1)
      i = end
    } else if (c === '<') {
      const end = from.indexOf('>', i)
      if (angle !== null || end < 0) return null
      angle = from.slice(i + 1, end)
      i = end
    } else if (c === '>' || c === ')' || c === ',' || c === ';') {
      return null
    } else if (angle !== null) {
      if (/\S/.test(c)) return null
    } else {
      bare += c
      name += c
    }
  }
  // the bare form ("service@paypal.com (PayPal)") has no display name of its own
  if (angle === null && quoted) return null
  const address = (angle ?? bare).trim()
  if (address.length > MAX_ADDRESS || !ADDRESS_RE.test(address)) return null
  // a name that only repeats the address ("alerts@bank <alerts@bank>") reads the same either way
  if (angle !== null && NOT_IN_NAME.test(bare) && bare.trim().toLowerCase() !== address.toLowerCase()) return null
  return { address, name: angle === null ? name.replace(address, ' ') : name }
}

/** The domain of the sender's own address (see `readMailbox`), lower-cased; '' when there is not exactly one. */
export function senderDomain(from: string): string {
  const box = readMailbox(from)
  return box ? box.address.slice(box.address.lastIndexOf('@') + 1).toLowerCase() : ''
}

/**
 * Platforms whose real emails can carry text a stranger wrote: an invoice or money request anyone can send
 * (PayPal, Stripe), a shared form or calendar invite (Google, Apple), a marketplace seller or a property's
 * message (Amazon, Booking). Their senders pass the check, but what they say is not the platform's own word, so
 * the review shows where each one came from and never ticks them in bulk.
 */
export const RELAY_SENDER_DOMAINS: readonly string[] = ['google.com', 'apple.com', 'paypal.com', 'stripe.com', 'amazon.com', 'booking.com']

/** The relay platform a sender belongs to ('paypal.com'), or '' when it is not one. Address domain only. */
export function relayPlatform(from: string): string {
  const domain = typeof from === 'string' ? senderDomain(from) : ''
  return (domain && RELAY_SENDER_DOMAINS.find((d) => domain === d || domain.endsWith(`.${d}`))) || ''
}

function matches(domain: string, list: readonly string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/**
 * True when `from` carries a sender address whose domain is allow-listed (built in, or one of the user's
 * `extraDomains`). The free-text display name is never trusted: only the address counts.
 */
export function isAllowedSender(from: string, extraDomains?: readonly string[]): boolean {
  if (typeof from !== 'string' || !from.trim()) return false
  const domain = senderDomain(from)
  if (!domain) return false
  return matches(domain, ALLOWED_DOMAINS) || matches(domain, trustedExtras(extraDomains))
}
