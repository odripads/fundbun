/**
 * Template-based, on-device (NO AI) parser of transaction emails into `SpendingCandidate[]`.
 *
 * Every body is UNTRUSTED: the parser can only ever produce a `SpendingCandidate` (a record awaiting the user's
 * Confirm), never an action or a payment. Parsing is defensive: any input that does not match a supported
 * template yields nothing, and anything that smells like a refund, credit or inflow is skipped.
 *
 * Supported formats:
 *   - a Chinese bank e-statement table (交易日期 / 商户 / 交易金额 / 摘要), pipe- or tab- or wide-space-delimited
 *   - WeChat Pay / Alipay / bank "account change" notification emails (付款金额 / 收款方 / 支付时间 …)
 *   - English and Indonesian bank, wallet and receipt emails: labelled lines (Total, Amount paid, Nominal,
 *     Total Pembayaran, Merchant, Paid to, Penerima, Tanggal …) or a sentence ("You paid Rp25.000 to …")
 *
 * Amounts are never converted between currencies: an email in another currency than the user's gives nothing,
 * and `readEmail` says so (`skip: 'other_currency'`) so the app can count it.
 */

import { categorize, normalizeMerchant } from '../finance/categorize'
import { MINOR_PER_MAJOR } from '../money'
import { parseDateCell, parseMoney } from '../sandbox/csv'
import type { Currency, ISODate, Minor, SpendingCandidate } from '../types'
import { senderDomain } from './allowlist'
import type { EmailMessage } from './types'

/** Why an email gave no spending: a refund, credit or failed payment; another currency; or no known layout. */
export type EmailSkipReason = 'not_spending' | 'other_currency' | 'no_match'

export interface EmailReading {
  candidates: SpendingCandidate[]
  /** set only when `candidates` is empty */
  skip?: EmailSkipReason
}

const nothing = (skip: EmailSkipReason): EmailReading => ({ candidates: [], skip })

// a bound on the work done per message: receipts are a few kilobytes, an HTML newsletter a few hundred
const MAX_BODY = 300_000

/** Drops <script>, <style> and <head> blocks in one pass (an unclosed one ends the text). */
function dropBlocks(html: string): string {
  const open = /<(script|style|head)\b/gi
  let out = ''
  let at = 0
  for (let m = open.exec(html); m; m = open.exec(html)) {
    out += `${html.slice(at, m.index)} `
    const close = new RegExp(`</${m[1]}\\s*>`, 'gi')
    close.lastIndex = open.lastIndex
    const end = close.exec(html)
    if (!end) return out
    at = close.lastIndex
    open.lastIndex = at
  }
  return out + html.slice(at)
}

/** A light HTML to text pass for HTML-only emails: block ends become new lines, table cells become " | ". */
function htmlText(body: string): string {
  if (!/<(?:html|body|div|table|tr|td|p|br|span)\b/i.test(body)) return body
  return dropBlocks(body)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|table)\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' | ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d{1,5});/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/** The text the parser reads from a body (HTML turned into text, entities decoded, NFKC). The injection scan reads it too. */
export function readableText(text: string): string {
  return norm(text)
}

function norm(text: string): string {
  return htmlText(String(text ?? '').slice(0, MAX_BODY))
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
}

const trim = (s: string): string => s.trim()

// ───────────────────────────── currencies ─────────────────────────────

/** A currency as written in an email; 'YEN' is the bare ¥ sign, which is either CNY or JPY. */
type Mark = Currency | 'YEN'

const MARKS: Record<string, Mark> = {
  rp: 'IDR', 'rp.': 'IDR', idr: 'IDR',
  $: 'USD', us$: 'USD', usd: 'USD',
  s$: 'SGD', sg$: 'SGD', sgd: 'SGD',
  hk$: 'HKD', hkd: 'HKD',
  a$: 'AUD', au$: 'AUD', aud: 'AUD',
  rm: 'MYR', myr: 'MYR',
  '€': 'EUR', eur: 'EUR',
  '£': 'GBP', gbp: 'GBP',
  '¥': 'YEN', cny: 'CNY', rmb: 'CNY', 元: 'CNY',
  jpy: 'JPY',
}

function markOf(token: string | undefined): Mark | null {
  if (!token) return null
  const key = token.toLowerCase().replace(/\s+/g, '')
  return Object.hasOwn(MARKS, key) ? MARKS[key] : null
}

/** ¥ is the user's own currency when that is CNY or JPY; for anyone else it reads as CNY. */
function resolveMark(mark: Mark, user: Currency): Currency {
  if (mark === 'YEN') return user === 'JPY' ? 'JPY' : 'CNY'
  return mark
}

const PRE = String.raw`US\$|SG?\$|HK\$|AU?\$|Rp\.?|RM|IDR|USD|SGD|HKD|AUD|MYR|EUR|GBP|CNY|RMB|JPY|\$|€|£|¥`
const POST = String.raw`IDR|USD|SGD|HKD|AUD|MYR|EUR|GBP|CNY|RMB|JPY|€|元`
// "150.000,00", "1,234.56", "1.500.000", "25000", "12.5"; never a run like "1.2345"
const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
const MONEY_RE = new RegExp(String.raw`^\s*([+\-\u2212])?\s*(${PRE})?\s*([+\-\u2212])?\s*(${NUM})(?!\d|[.,]\d)(?:\s*(${POST})(?![A-Za-z]))?`, 'i')

interface MoneyText {
  num: string
  /** the currency written next to the number, if any */
  mark: Mark | null
  /** written with a "+": money coming in */
  plus: boolean
  /** characters read from the start of the text */
  length: number
}

/** An amount at the very start of `text` ("Rp 150.000", "$12.34 USD", "-Rp25.000", "€12,50"). */
function readMoney(text: string): MoneyText | null {
  const m = MONEY_RE.exec(text)
  if (!m) return null
  return { num: m[4], mark: markOf(m[5]) ?? markOf(m[2]), plus: m[1] === '+' || m[3] === '+', length: m[0].length }
}

/**
 * "150.000,00" (Indonesian: "." for thousands, "," for decimals) and "1,234.56" (the other way) both into minor
 * units, without floating point. With both marks the last one is the decimal point; with one mark, three digits
 * after it are thousands and one or two are decimals, which reads Rp 150.000 and $12.50 right.
 */
export function amountToMinor(num: string, currency: Currency): Minor | null {
  const lastDot = num.lastIndexOf('.')
  const lastComma = num.lastIndexOf(',')
  const marks = num.match(/[.,]/g)?.length ?? 0
  let decimalAt = -1
  if (lastDot >= 0 && lastComma >= 0) decimalAt = Math.max(lastDot, lastComma)
  else if (marks === 1) {
    const at = Math.max(lastDot, lastComma)
    if (num.length - at - 1 <= 2) decimalAt = at
  }
  const whole = (decimalAt >= 0 ? num.slice(0, decimalAt) : num).replace(/[.,]/g, '')
  const frac = decimalAt >= 0 ? num.slice(decimalAt + 1) : ''
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac)) return null
  const k = MINOR_PER_MAJOR[currency]
  const decimals = Math.round(Math.log10(k))
  const padded = frac.padEnd(decimals + 1, '0')
  const minor = Number(whole) * k + Number(padded.slice(0, decimals) || '0') + (Number(padded[decimals]) >= 5 ? 1 : 0)
  return Number.isSafeInteger(minor) ? minor : null
}

// ───────────────────────────── dates ─────────────────────────────

interface When {
  date: ISODate
  time?: string
}

// English and Indonesian month names, by their first three letters
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8,
  sep: 9, oct: 10, okt: 10, nov: 11, nop: 11, dec: 12, des: 12,
}

const WEEKDAY = /^(?:mon|tue|wed|thu|fri|sat|sun|senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|ahad)[a-z]*\.?,?\s+/i

function timeIn(text: string): string | undefined {
  const m = text.match(/(?:^|[^\d])(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?\.?m?\.?(?![a-z])/i)
  if (!m) return undefined
  let h = Number(m[1])
  const min = Number(m[2])
  const half = m[3]?.toLowerCase()
  if (half && (h < 1 || h > 12)) return undefined
  if (half === 'p' && h < 12) h += 12
  if (half === 'a' && h === 12) h = 0
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : undefined
}

function dayOf(y: string, month: number | undefined, d: string): ISODate | null {
  if (!month) return null
  return parseDateCell(`${y}-${String(month).padStart(2, '0')}-${d.padStart(2, '0')}`)?.date ?? null
}

/**
 * "2026-09-21 08:15", "21/09/2026", "21 Sep 2026, 08.15 WIB", "Sep 21, 2026 at 8:15 PM", "Senin, 21 September 2026",
 * "Mon, 21 Sep 2026 08:15:00 +0700" (an email header). Null when it is not a date.
 */
export function parseEmailDate(text: string): When | null {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80).replace(WEEKDAY, '')
  if (!s) return null
  const cell = parseDateCell(s) ?? parseDateCell(s, 'mdy')
  if (cell) return cell.time ? cell : { date: cell.date, time: timeIn(s.replace(/^[\d\-/.年月日]+/, '')) }
  let m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3,9})\.?,?[\s\-/]+(\d{4})(.*)$/)
  if (m) {
    const date = dayOf(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1])
    return date ? { date, time: timeIn(m[4]) } : null
  }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(.*)$/)
  if (m) {
    const date = dayOf(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2])
    return date ? { date, time: timeIn(m[4]) } : null
  }
  return null
}

// one moment in time: "2026-09-20T23:30:00.000Z" (what the server sends), or a Date header with its zone
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i
const HEADER_INSTANT = /^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[+-]\d{4}|GMT|UTC|UT|Z)(?:\s*\([^()]{0,20}\))?$/i

/**
 * An email's own date (its Date header) as the user's day and time on this device. It is a moment in time, so
 * "2026-09-20T23:30:00Z" is 21 Sep 06:30 for a user in Jakarta: read as written, an early-morning purchase
 * would land on the day before (sometimes in last month's budget). Anything else is read as written.
 */
export function messageWhen(text: string): When | null {
  const s = String(text ?? '').trim()
  if (!INSTANT.test(s) && !HEADER_INSTANT.test(s)) return parseEmailDate(s)
  const t = new Date(s)
  if (!Number.isFinite(t.getTime())) return parseEmailDate(s)
  const two = (n: number) => String(n).padStart(2, '0')
  return { date: `${t.getFullYear()}-${two(t.getMonth() + 1)}-${two(t.getDate())}`, time: `${two(t.getHours())}:${two(t.getMinutes())}` }
}

// ───────────────────────────── shared ─────────────────────────────

/** Credit / refund / inflow rows are not spending. */
const SKIP_ROW = /还款|退款|存入|收入|利息|溢缴|退货|冲正|入账|收款成功|转入/

/** English and Indonesian refunds, credits, incoming money, top-ups and cashback: money coming in, not spending. */
const INFLOW = new RegExp(
  [
    String.raw`\brefund(?:ed|s)?\b`, String.raw`\bcredited\b`, String.raw`\breceived\b`, String.raw`\btop[\s-]?up\b`, String.raw`\bcash\s?back\b`,
    String.raw`\breimburs`, String.raw`\bincoming\b`, String.raw`\breturned\s+to\s+your\b`, String.raw`\bdirect\s+deposit\b`,
    // within one sentence ("$500.00" does not end it)
    String.raw`\bdeposit(?:ed)?\b(?:[^.\n]|\.(?=\d)){0,60}\b(?:to|into|in)\s+your\s+(?:account|balance|wallet|card)\b`,
    String.raw`\bsent\s+you\s+(?:a\s+payment|money|(?:US|S|HK|A)?\$|€|£|¥|Rp|IDR|USD|SGD|\d)`, String.raw`\byou(?:'ve|\s+have)?\s+got\s+(?:money|paid)\b`,
    String.raw`pengembalian\s+dana`, String.raw`dana\s+pengembalian`, String.raw`\bdikembalikan\b`, String.raw`\b(?:dana|uang|transfer|saldo)\s+masuk\b`,
    String.raw`\b(?:telah|sudah)\s+masuk\s+ke\b`, String.raw`\bditerima\b`, String.raw`isi\s+saldo`, String.raw`\bsaldo\s+(?:\S+\s+){0,2}bertambah\b`,
  ].join('|'),
  'i',
)
/** "we received your payment", "your order has been received", "pembayaran berhasil diterima": a purchase, not an inflow. */
const PURCHASE_RECEIVED =
  /\b(?:we(?:'ve|\s+have)?\s+)?received\s+your\s+(?:payment|order|purchase|booking|deposit)\b|\byour\s+(?:payment|order|purchase|booking|deposit)\s+(?:has\s+been\s+|was\s+|is\s+)?(?:successfully\s+)?received\b|\b(?:pembayaran|pesanan)(?:mu|\s+(?:anda|kamu))?\s+(?:(?:telah|sudah|berhasil)\s+)*diterima\b/gi
/** Inflow words that are not about money coming in: a footer ("You received this email because"), a promo, a cashback line item. */
const NOT_INFLOW =
  /\b(?:you|we)(?:'ve|\s+have)?\s+(?:received|sent\s+you)\s+this\b|\byou(?:'re|\s+are)\s+receiving\s+this\b|\b(?:dapatkan|nikmati|raih|get|earn|enjoy)\s+(?:extra\s+|ekstra\s+)?cash\s?back\b|\bcash\s?back\s+(?:hingga\s+|up\s+to\s+|s\.?d\.?\s+|sampai\s+)?\d{1,3}\s*%|^cash\s?back\s*[:：].*$/gim
/** A payment that did not go through. */
const FAILED = /\b(?:payment|transaction|order|transaksi|pembayaran)\s+(?:has\s+been\s+|was\s+|is\s+|telah\s+|sudah\s+)?(?:failed|declined|unsuccessful|cancell?ed|reversed|gagal|dibatalkan|ditolak)\b|\b(?:failed|declined|unsuccessful)\s+(?:payment|transaction)\b/i
/** "Jenis Transaksi: Kredit", "Transaction type: Credit": the line that says which way the money went. */
const CREDIT_TYPE = /^(?:(?:jenis|tipe)\s+(?:transaksi|mutasi)|mutasi|(?:transaction\s+)?type)\s*[:：]?\s*(?:kredit|credit|cr|masuk|incoming|deposit|refund)\b(?!\s*(?:card|kartu))/im
/** "Rp 1.000.000,00 CR" or "(CR)" after an amount: a credit on a bank alert. */
const CREDIT_MARK = /\d\s*\(?CR\)?(?:\s|$)/

/** Money coming in: inflow words, once footers, promos and purchase confirmations are taken out. */
function isInflow(text: string): boolean {
  return INFLOW.test(text.replace(PURCHASE_RECEIVED, ' ').replace(NOT_INFLOW, ' '))
}

function buildCandidate(
  message: EmailMessage,
  n: number,
  merchant: string,
  amount: Minor,
  currency: Currency,
  date: ISODate,
  time: string | undefined,
  description: string,
): SpendingCandidate {
  return {
    id: `em_${message.id}_${n}`,
    merchant,
    amount,
    currency,
    date,
    ...(time ? { time } : {}),
    category: categorize(merchant, description, -amount).category,
    description,
    source: 'email',
  }
}

/** A currency written in a table or label cell that is not the user's (an unmarked amount counts as theirs). */
const CELL_MARK = new RegExp(String.raw`(${PRE})\s*[+\-\u2212]?\s*\d|\d\s*(${POST})(?![A-Za-z])`, 'i')

function foreignCell(cell: string, currency: Currency): boolean {
  const m = CELL_MARK.exec(cell)
  const mark = m ? markOf(m[2] ?? m[1]) : null
  return mark !== null && resolveMark(mark, currency) !== currency
}

// ───────────────────────────── bank e-statement table ─────────────────────────────

interface Columns {
  date: number
  amount: number
  merchant: number
  desc: number
}

const HEADER_DATE = /日期/
const HEADER_AMOUNT = /金额/
const HEADER_MERCHANT = /(商户|对方|户名)/
const HEADER_DESC = /(摘要|说明|用途|备注)/

function mapColumns(cells: readonly string[]): Columns | null {
  const cols: Columns = { date: -1, amount: -1, merchant: -1, desc: -1 }
  cells.forEach((c, i) => {
    if (cols.date === -1 && HEADER_DATE.test(c)) cols.date = i
    if (cols.amount === -1 && HEADER_AMOUNT.test(c)) cols.amount = i
    if (cols.merchant === -1 && HEADER_MERCHANT.test(c)) cols.merchant = i
    if (cols.desc === -1 && HEADER_DESC.test(c)) cols.desc = i
  })
  return cols.date >= 0 && cols.amount >= 0 ? cols : null
}

function splitRow(line: string, delim: string): string[] {
  if (delim === ' ') return line.split(/\s{2,}/).map(trim).filter(Boolean)
  return line.split(delim).map(trim)
}

interface Header {
  index: number
  delim: string
  cols: Columns
}

function findHeader(lines: readonly string[]): Header | null {
  for (let i = 0; i < lines.length; i++) {
    for (const delim of ['|', '\t']) {
      if (!lines[i].includes(delim)) continue
      const cols = mapColumns(lines[i].split(delim).map(trim))
      if (cols) return { index: i, delim, cols }
    }
    const cells = lines[i].split(/\s{2,}/).map(trim).filter(Boolean)
    if (cells.length >= 2) {
      const cols = mapColumns(cells)
      if (cols) return { index: i, delim: ' ', cols }
    }
  }
  return null
}

function parseTable(body: string, message: EmailMessage, currency: Currency): EmailReading | null {
  const lines = body.split('\n')
  const header = findHeader(lines)
  if (!header) return null
  const out: SpendingCandidate[] = []
  let foreign = 0
  for (let i = header.index + 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], header.delim)
    const parsed = parseDateCell(cells[header.cols.date] ?? '')
    if (!parsed) continue
    const amountCell = cells[header.cols.amount] ?? ''
    const amount = parseMoney(amountCell, currency)
    if (amount === null) continue
    const merchantCell = header.cols.merchant >= 0 ? cells[header.cols.merchant] : ''
    const descCell = header.cols.desc >= 0 ? cells[header.cols.desc] : ''
    if (SKIP_ROW.test(`${merchantCell} ${descCell}`)) continue
    if (foreignCell(amountCell, currency)) {
      foreign++
      continue
    }
    const rawMerchant = merchantCell || descCell || 'Unknown'
    const amountAbs = Math.abs(amount)
    if (amountAbs === 0) continue
    const merchant = normalizeMerchant(rawMerchant)
    out.push(buildCandidate(message, out.length, merchant, amountAbs, currency, parsed.date, parsed.time, descCell || rawMerchant))
  }
  if (out.length) return { candidates: out }
  return foreign ? nothing('other_currency') : null
}

// ───────────────────────────── notification emails (WeChat / Alipay / bank) ─────────────────────────────

const LABEL = {
  amount: /(?:付款金额|交易金额|实付金额|应付金额|消费金额|金额)\s*[:：]\s*([¥￥]?\s*[\d,]+(?:\.\d{1,2})?)/,
  merchant: /(?:收款方|收款商户|交易商户|商户名称|商户|交易对方|对方)\s*[:：]\s*([^\n]+)/,
  time: /(?:支付时间|交易时间|付款时间|交易日期|日期|时间)\s*[:：]\s*([^\n]+)/,
  description: /(?:商品说明|商品|交易说明|交易摘要|摘要|说明)\s*[:：]\s*([^\n]+)/,
}

function firstMatch(re: RegExp, body: string): string | undefined {
  const m = body.match(re)
  return m ? m[1].trim() : undefined
}

/**
 * An HTML notice arrives with its table cells as " | " (from the mail server on this computer, or `htmlText`):
 * "付款金额： | ¥12.00 |" is read as "付款金额：¥12.00".
 */
function joinCells(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.includes('|') ? line.split('|').map(trim).filter(Boolean).join('：').replace(/[:：]{2,}/g, '：') : line))
    .join('\n')
}

function parseLabeled(text: string, message: EmailMessage, currency: Currency): EmailReading | null {
  const body = joinCells(text)
  const amountStr = firstMatch(LABEL.amount, body)
  if (!amountStr) return null
  const amount = parseMoney(amountStr, currency)
  if (amount === null) return null
  if (SKIP_ROW.test(body)) return nothing('not_spending')
  if (foreignCell(amountStr, currency)) return nothing('other_currency')
  const timeStr = firstMatch(LABEL.time, body)
  const parsed = timeStr ? parseDateCell(timeStr) : null
  if (!parsed?.date) return null
  const merchantRaw = firstMatch(LABEL.merchant, body) ?? firstMatch(LABEL.description, body) ?? 'Unknown'
  const description = firstMatch(LABEL.description, body) ?? ''
  const amountAbs = Math.abs(amount)
  if (amountAbs === 0) return null
  return { candidates: [buildCandidate(message, 0, normalizeMerchant(merchantRaw), amountAbs, currency, parsed.date, parsed.time, description || merchantRaw)] }
}

// ───────────────────────────── English and Indonesian receipts and alerts ─────────────────────────────

// Strongest first: a receipt that lists Subtotal, Tax and Total is read at its total, not at a line item.
const AMOUNT_LABELS = [
  'grand total', 'total amount paid', 'total paid', 'amount paid', 'total amount', 'total charged', 'amount charged',
  'order total', 'total price', 'total pembayaran', 'total bayar', 'total dibayar', 'jumlah dibayar', 'jumlah pembayaran',
  'total belanja', 'total harga', 'harga total', 'total transaksi', 'nominal transaksi', 'jumlah transaksi', 'nilai transaksi',
  'transaction amount', 'payment amount', 'total payment', 'total', 'paid', 'charged', 'amount', 'nominal', 'jumlah',
]
const MERCHANT_LABELS = [
  'merchant name', 'nama merchant', 'merchant', 'paid to', 'payment to', 'pembayaran ke', 'dibayar ke', 'bayar ke', 'payee',
  'store name', 'nama toko', 'store', 'toko', 'outlet', 'restaurant', 'restoran', 'nama penerima', 'penerima', 'seller',
  'sold by', 'penjual', 'to',
]
// a description says what was bought more often than where, so it is only a late fallback for the merchant
const WEAK_MERCHANT_LABELS = ['description', 'keterangan', 'deskripsi']
const DATE_LABELS = [
  'transaction date', 'transaction time', 'payment date', 'payment time', 'date paid', 'paid on', 'order date',
  'purchase date', 'invoice date', 'date issued', 'date & time',
  'date and time', 'tanggal transaksi', 'tanggal pembayaran', 'tanggal & waktu', 'tanggal dan waktu',
  'waktu transaksi', 'waktu pembayaran', 'tanggal', 'tgl transaksi', 'tgl', 'waktu', 'date', 'paid',
]
const TIME_LABELS = ['time', 'jam', 'pukul', 'waktu']

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')

/** "Label: value", "Label value" (unless `colonOnly`), "Label (IDR): value", or a label alone on its line. */
function labelRe(labels: readonly string[], colonOnly: boolean): RegExp {
  const tail = colonOnly ? String.raw`\s*(?:[:：]\s*(.*)|$)` : String.raw`\s*(?:[:：]\s*(.*)|\s(.+)|$)`
  return new RegExp(String.raw`^(${labels.map(escapeRe).join('|')})(?:\s*\(([^()]{1,12})\))?${tail}`, 'i')
}

const AMOUNT_RE = labelRe(AMOUNT_LABELS, false)
const MERCHANT_RE = labelRe(MERCHANT_LABELS, true)
const WEAK_MERCHANT_RE = labelRe(WEAK_MERCHANT_LABELS, true)
const DATE_RE = labelRe(DATE_LABELS, false)
const TIME_RE = labelRe(TIME_LABELS, false)

interface Labelled {
  rank: number
  value: string
  /** the line the value was read from: the label's own, or the next one for a label alone */
  at: number
  /** a currency in brackets after the label: "Total (IDR)" */
  hint?: string
}

/** Every line that starts with one of `labels`, with its value (or the next line's, for a label alone). */
function labelled(lines: readonly string[], re: RegExp, labels: readonly string[]): Labelled[] {
  const out: Labelled[] = []
  lines.forEach((line, i) => {
    const m = re.exec(line)
    if (!m) return
    const rank = labels.indexOf(m[1].toLowerCase().replace(/\s+/g, ' '))
    const inline = (m[3] ?? m[4] ?? '').trim()
    const value = inline || (lines[i + 1] ?? '')
    if (rank >= 0 && value) out.push({ rank, value, at: inline ? i : i + 1, ...(m[2] ? { hint: m[2] } : {}) })
  })
  return out.sort((a, b) => a.rank - b.rank)
}

interface Found {
  money: MoneyText
  mark: Mark | null
  /** the line that holds the amount */
  at: number
  merchant?: string
}

function labelledAmount(lines: readonly string[]): Found | null {
  for (const l of labelled(lines, AMOUNT_RE, AMOUNT_LABELS)) {
    const money = readMoney(l.value)
    const mark = money?.mark ?? markOf(l.hint)
    if (money && mark) return { money, mark, at: l.at }
  }
  return null
}

// "You paid Rp25.000 to …", "You sent a payment of $25.00 USD to …", "Anda telah membayar Rp 50.000 ke …"
const PAID = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:you(?:'ve|\s+have)?\s+(?:just\s+)?(?:paid|spent|sent(?:\s+a\s+payment\s+of)?)|your\s+payment\s+of|payment\s+of|you\s+were\s+charged|charged|anda\s+(?:telah\s+|sudah\s+|berhasil\s+)?(?:membayar|bayar|melakukan\s+pembayaran(?:\s+sebesar)?)|kamu\s+(?:telah\s+|sudah\s+|berhasil\s+)?(?:membayar|bayar)|pembayaran\s+sebesar|transaksi\s+sebesar|sebesar)\s+`,
  'giu',
)
const TO_WHOM = /^\s+(?:to|ke|kepada|di|at)\s+(.+)$/i

function sentenceAmount(lines: readonly string[]): Found | null {
  for (const [at, line] of lines.entries()) {
    let tries = 0
    for (const m of line.matchAll(PAID)) {
      if (++tries > 5) break
      const rest = line.slice(m.index + m[0].length)
      const money = readMoney(rest)
      if (!money?.mark) continue
      const to = TO_WHOM.exec(rest.slice(money.length))
      return { money, mark: money.mark, at, ...(to ? { merchant: to[1] } : {}) }
    }
  }
  return null
}

const GENERIC_NAME = /^(?:your|the|a|an|payment|order|purchase|transaction|receipt|e-?receipt|invoice|booking|account|card|you|anda|kamu|pembayaran|transaksi|pembelian|pesanan|struk|bukti)$/i
// "Receipt from Sep 27, 2026" names a day, not a shop
const MONTH_WORD =
  '(?:jan(?:uary|uari)?|feb(?:ruary|ruari)?|mar(?:ch|et)?|apr(?:il)?|may|mei|jun[ei]?|jul[yi]?|aug(?:ust)?|agu(?:stus)?|agt|sept?(?:ember)?|o[ck]t(?:ober)?|nov(?:ember)?|nop|de[cs](?:ember)?)\\.?'
const DATE_NAME = new RegExp(`^(?:${MONTH_WORD}\\s+\\d{1,2}\\b|\\d{1,2}\\s+${MONTH_WORD}(?:\\s|$))`, 'i')

/** A merchant name out of untrusted text: cut at the first clause or reference, refused when it is not a name. */
function cleanName(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw
    .replace(/[\u0000-\u001F\u007F<>*_`]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(/\s+(?:on|pada|via|using|menggunakan|dengan|with|at|for|untuk|tanggal|tgl|sebesar|berhasil|was|is|has|telah|sudah)\s|\s[#|(]|\s[-\u2013\u2014]\s|[.,;!?](?:\s|$)|\s+\d{4,}/i)[0]
    .replace(/^[\s:\-\u2013\u2014]+|[\s.,;:!\-\u2013\u2014]+$/g, '')
    .trim()
  if (!s || s.length > 60 || /@|https?:|www\./i.test(s) || !/\p{L}/u.test(s) || GENERIC_NAME.test(s) || DATE_NAME.test(s)) return undefined
  return s
}

function labelledMerchant(lines: readonly string[], re: RegExp, labels: readonly string[]): string | undefined {
  for (const l of labelled(lines, re, labels)) {
    const name = cleanName(l.value)
    if (name) return name
  }
  return undefined
}

const SUBJECT_MERCHANT = [
  /\b(?:receipt|payment|order|purchase|transaction|invoice|booking|trip|ride)s?\s+(?:from|to|with|at)\s+(.+)$/i,
  /\b(?:pembayaran|transaksi|pembelian|pesanan|bayar|belanja)\s+(?:ke|di|kepada|dari)\s+(.+)$/i,
  /^(?:[Yy]our\s+)?([A-Z][\w&'+-]*(?:\s+[A-Z][\w&'+-]*)?)\s+(?:[Ee]-?[Rr]eceipt|[Rr]eceipt)\b/,
]

/** "Your receipt from Acme Inc #1234-5678" gives "Acme Inc"; a subject that names no one gives nothing. */
function subjectMerchant(subject: string): string | undefined {
  for (const re of SUBJECT_MERCHANT) {
    const name = cleanName(re.exec(subject)?.[1])
    if (name) return name
  }
  return undefined
}

// senders that are the merchant themselves; a bank or wallet is only the way the money went
const SENDER_BRANDS: Record<string, string> = {
  'apple.com': 'Apple', 'google.com': 'Google', 'uber.com': 'Uber', 'grab.com': 'Grab', 'amazon.com': 'Amazon',
  'airasia.com': 'AirAsia', 'agoda.com': 'Agoda', 'booking.com': 'Booking.com', 'trip.com': 'Trip.com',
  'klook.com': 'Klook', 'shopee.co.id': 'Shopee', 'tokopedia.com': 'Tokopedia', 'gojek.com': 'Gojek',
}

function senderBrand(from: string): string | undefined {
  const domain = senderDomain(from)
  const key = Object.keys(SENDER_BRANDS).find((d) => domain === d || domain.endsWith(`.${d}`))
  return key ? SENDER_BRANDS[key] : undefined
}

function labelledDate(lines: readonly string[]): When | null {
  for (const l of labelled(lines, DATE_RE, DATE_LABELS)) {
    const when = parseEmailDate(l.value)
    if (!when) continue
    if (when.time) return when
    const time = labelled(lines, TIME_RE, TIME_LABELS).map((t) => timeIn(t.value)).find(Boolean)
    return time ? { date: when.date, time } : { date: when.date }
  }
  return null
}

/** One line of a receipt, tidied: bullets and bold marks off, table cells ("Total | Rp 150.000") as "Total: Rp 150.000". */
function tidyLine(line: string): string {
  return line
    .replace(/\*\*/g, '')
    .replace(/^(?:[\u2022*>|]|-\s)+\s*/, '')
    .replace(/\s*[|\t]\s*/g, ': ')
    .replace(/(?::\s*){2,}/g, ': ')
    .replace(/[:\s]+$/, '')
    .trim()
}

/**
 * Is this email about money coming in? Refund and inflow words count only in the subject and in the body down to
 * the line that holds the amount: a footer ("You received this email because…") or a promo ("Dapatkan cashback")
 * under a real receipt must not throw the purchase away. A credit type line or a "CR" amount counts anywhere.
 */
function moneyIn(subject: string, lines: readonly string[], found: Found): boolean {
  return (
    found.money.plus ||
    CREDIT_TYPE.test(lines.join('\n')) ||
    CREDIT_MARK.test(lines[found.at] ?? '') ||
    isInflow([subject, ...lines.slice(0, found.at + 1)].join('\n'))
  )
}

function parseReceipt(body: string, message: EmailMessage, currency: Currency): EmailReading {
  const subject = String(message.subject ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 300)
  const whole = `${subject}\n${body}`
  if (SKIP_ROW.test(whole) || FAILED.test(whole)) return nothing('not_spending')
  const lines = body.split('\n').map(tidyLine).filter(Boolean)
  const sentence = sentenceAmount(lines)
  const found = labelledAmount(lines) ?? sentence
  if (!found?.mark) return nothing(isInflow(whole) ? 'not_spending' : 'no_match')
  if (moneyIn(subject, lines, found)) return nothing('not_spending')
  if (resolveMark(found.mark, currency) !== currency) return nothing('other_currency')
  const amount = amountToMinor(found.money.num, currency)
  if (!amount) return nothing('no_match')
  const when = labelledDate(lines) ?? messageWhen(String(message.date ?? ''))
  if (!when) return nothing('no_match')
  const merchant =
    labelledMerchant(lines, MERCHANT_RE, MERCHANT_LABELS) ??
    cleanName(found.merchant ?? sentence?.merchant) ??
    subjectMerchant(subject) ??
    labelledMerchant(lines, WEAK_MERCHANT_RE, WEAK_MERCHANT_LABELS) ??
    senderBrand(String(message.from ?? '')) ??
    'Unknown'
  const name = normalizeMerchant(merchant)
  return { candidates: [buildCandidate(message, 0, name, amount, currency, when.date, when.time, (subject || merchant).slice(0, 200))] }
}

// ───────────────────────────── public API ─────────────────────────────

/** Read one email: its spending candidates, or why it gave none. Never throws. */
export function readEmail(message: EmailMessage, currency: Currency = 'CNY'): EmailReading {
  if (!message || typeof message.body !== 'string') return nothing('no_match')
  try {
    const body = norm(message.body)
    return parseTable(body, message, currency) ?? parseLabeled(body, message, currency) ?? parseReceipt(body, message, currency)
  } catch {
    return nothing('no_match')
  }
}

/** Parse one email body into spending candidates. Never throws; unknown/unparseable input yields []. */
export function parseEmail(message: EmailMessage, currency: Currency = 'CNY'): SpendingCandidate[] {
  return readEmail(message, currency).candidates
}

export function parseEmails(messages: EmailMessage[], currency: Currency = 'CNY'): SpendingCandidate[] {
  return (Array.isArray(messages) ? messages : []).flatMap((m) => parseEmail(m, currency))
}
