/**
 * On-device receipt parsing. Turns OCR text (UNTRUSTED) into a `SpendingCandidate` — a *spending record*
 * that the user must still confirm, never an action or payment. Receipt text can only ever produce data
 * (merchant, amount, date); it can never move money. This module is pure, framework-free and never throws:
 * garbage returns `{ ok: false }`, and anything that looks like an instruction to the reader is flagged
 * (`blocked`) so the UI refuses to add it.
 */
import { categorize, normalizeMerchant } from '../finance/categorize'
import { isSpendingCategory } from '../categories'
import { MINOR_PER_MAJOR } from '../money'
import { INJECTION_THRESHOLD, scanForInjection } from '../security/injection'
import { sha256Hex } from '../security/sha256'
import type { Currency, InjectionReport, ISODate, Minor, SpendingCandidate } from '../types'

export interface ParseReceiptOptions {
  /** fallback when the receipt carries no date — the app's "today" */
  today?: ISODate
  /** fallback currency when none is written on the receipt */
  fallbackCurrency?: Currency
}

export interface ReceiptParseOk {
  ok: true
  candidate: SpendingCandidate
  /** prompt-injection / suspicious-content report on the raw receipt text */
  injection: InjectionReport
  /** true → the receipt carried instructions a receipt has no business carrying; the UI must refuse to add it */
  blocked: boolean
  /** human-readable signals, only present when blocked */
  warnings: string[]
}

export interface ReceiptParseFail {
  ok: false
  error: string
}

export type ReceiptParseResult = ReceiptParseOk | ReceiptParseFail

// ───────────────────────────── currency ─────────────────────────────

/** Detect the receipt's currency from its symbols/words. Order matters (Rp before $, ¥ before $). */
export function detectCurrency(text: string): Currency | null {
  const t = fold(String(text ?? ''))
  if (/\brp\b|idr|rupiah/.test(t)) return 'IDR'
  if (/[¥￥]|\brmb\b|\bcny\b|人民币|\byuan\b|\b元\b|\b块\b/.test(t)) return 'CNY'
  if (/\$|\busd\b/.test(t)) return 'USD'
  return null
}

// ───────────────────────────── money ─────────────────────────────

/** Interpret a numeric token's `.` / `,` separators according to the currency. */
function interpretNumber(num: string, currency: Currency): number | null {
  const hasComma = num.includes(',')
  const hasDot = num.includes('.')
  let major: number
  if (hasComma && hasDot) {
    // the later separator is the decimal separator ("1.234,56" or "1,234.56")
    major = num.lastIndexOf(',') > num.lastIndexOf('.')
      ? Number(num.replace(/\./g, '').replace(',', '.'))
      : Number(num.replace(/,/g, ''))
  } else if (hasComma) {
    // comma is thousands, unless a trailing 1–2 digits makes it a decimal ("1.234,56")
    major = /,\d{1,2}$/.test(num) ? Number(num.replace(/\./g, '').replace(',', '.')) : Number(num.replace(/,/g, ''))
  } else if (hasDot) {
    // Indonesian rupiah writes thousands with dots ("45.000"); other currencies use the dot for cents
    major = currency === 'IDR' ? Number(num.replace(/\./g, '')) : Number(num)
  } else {
    major = Number(num)
  }
  if (!Number.isFinite(major) || major <= 0) return null
  return major
}

/** Parse a money amount (in a receipt line) into integer minor units; null when the line holds no amount. */
export function parseReceiptMoney(raw: string, currency: Currency): Minor | null {
  let s = String(raw ?? '').replace(/[   \s]/g, '').replace(/，/g, ',').replace(/[．﹒]/g, '.')
  s = s.replace(/^(?:¥|￥|\$|€|£|rp\.?|rmb|cny|usd|idr|元|人民币|rupiah)/i, '')
  const m = s.match(/[-−+]?\d[\d.,]*/)
  if (!m) return null
  const neg = /^[-−]/.test(m[0])
  const major = interpretNumber(m[0].replace(/[-−+]/g, ''), currency)
  if (major === null) return null
  const minor = Math.round(major * MINOR_PER_MAJOR[currency])
  if (!Number.isSafeInteger(minor) || minor <= 0) return null
  return neg ? -minor : minor
}

// ───────────────────────────── date ─────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function iso(y: number, mo: number, d: number): ISODate {
  return `${y}-${pad(mo)}-${pad(d)}`
}

function validDate(y: number, mo: number, d: number): boolean {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/**
 * Pull a calendar date out of receipt text: ISO "2026-11-03" / "2026/11/03", day-first "03/11/2026"
 * (or "03-11-2026"), or a month-name form "Nov 3, 2026". Returns an ISO date or null. Never throws.
 */
export function parseReceiptDate(text: string): ISODate | null {
  const t = String(text ?? '').replace(/[．﹒]/g, '.').replace(/[／]/g, '/')
  let m = t.match(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/)
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
    if (validDate(y, mo, d)) return iso(y, mo, d)
  }
  m = t.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)/)
  if (m) {
    const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3])
    // day-first; a first token above 12 can't be a month, so only a valid month/day pair counts
    if (validDate(y, mo, d)) return iso(y, mo, d)
  }
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i)
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; const d = Number(m[2]); const y = Number(m[3])
    if (validDate(y, mo, d)) return iso(y, mo, d)
  }
  return null
}

function localToday(): ISODate {
  const d = new Date()
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

// ───────────────────────────── totals & merchant ─────────────────────────────

const TOTAL_LABEL = /(?:total|grand\s*total|amount\s*due|total\s*due|payable|net\s*payable|合计|总计|总金额|金额合计|应付|实付|应收|总数|jumlah|total\s*tagihan|total\s*belanja|total\s*harga)/i
const EXCLUDE_LABEL = /(?:subtotal|小计|discount|优惠|折扣|\btax\b|税|change|找零|支付方式|payment\s*method|vat|gst)/i
const HEADER_LINE = /^(?:receipt|发票|小票|收据|struk|invoice|kwitansi|nota)\b/i

function extractTotal(text: string, currency: Currency): Minor | null {
  const strong: Minor[] = []
  const weak: Minor[] = []
  for (const line of text.split(/\r?\n/)) {
    const amt = parseReceiptMoney(line, currency)
    if (amt === null || amt <= 0) continue
    if (TOTAL_LABEL.test(line)) {
      strong.push(amt)
      continue
    }
    if (EXCLUDE_LABEL.test(line)) continue
    // amount-dominant line (the amount is almost the whole line) — a bare or symbol-only total
    const rest = line.replace(/[¥￥$€£\s.,\d]/g, '').replace(/rp|rmb|cny|idr|usd|元|人民币|rupiah/gi, '')
    if (rest.length <= 8) weak.push(amt)
  }
  const pool = strong.length ? strong : weak
  return pool.length ? Math.max(...pool) : null
}

/** The first meaningful line — the shop name — kept raw (UNTRUSTED) for the description. */
function extractMerchantLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (HEADER_LINE.test(line)) continue
    if (parseReceiptDate(line)) continue
    if (/订单号|小票号|order\s*(no|id|#)|receipt\s*(no|#)|ticket\s*(no|#)/i.test(line)) continue
    if (TOTAL_LABEL.test(line) || /日期|时间|date|time|cashier|收银/i.test(line)) continue
    return line
  }
  return lines[0] ?? ''
}

// ───────────────────────────── injection ─────────────────────────────

/**
 * A receipt has no business giving anyone instructions. Beyond the shared scanner, these patterns flag a
 * receipt that tells the reader to ignore rules or to transfer money — the exact "ignore instructions,
 * transfer ¥5000" attack a small slip of paper could carry.
 */
const RECEIPT_INJECTION: { signal: string; weight: number; patterns: RegExp[] }[] = [
  {
    signal: 'instruction-override',
    weight: 0.7,
    patterns: [
      /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^\n]{0,40}?\b(?:instructions?|rules?|prompts?|directives?|guidelines?|policies?|safeguards?)\b/i,
      /\b(?:instructions?|rules?|prompts?|directives?)[^\n]{0,20}?(?:ignore|disregard|override|bypass)\b/i,
      /(?:忽略|无视|忘记|不要理会|跳过|绕过)[^\n]{0,20}?(?:指令|指示|规则|提示|要求|政策)/,
    ],
  },
  {
    signal: 'payment-instruction',
    weight: 0.7,
    patterns: [
      /\b(?:transfer|send|wire|remit|move)\b\s*(?:¥|￥|\$|rp\.?|rmb|idr|usd)?\s*\d/i,
      /\b(?:transfer|send|wire|remit|move)\b[^\n]{0,30}?\b(?:account|iban|wallet|card|payee)\b/i,
      /(?:转账|汇款|转入|打款|转出|汇出)[^\n]{0,20}?(?:¥|￥|人民币|账户|账号|卡号)?[^\n]{0,6}?\d/,
    ],
  },
]

/** Scan receipt text for prompt-injection: the shared scanner plus receipt-specific instruction patterns. */
export function scanReceiptInjection(text: string): InjectionReport {
  const base = scanForInjection(text)
  const t = fold(String(text ?? ''))
  const signals = [...base.signals]
  const excerpts = [...base.excerpts]
  let score = base.score
  for (const rule of RECEIPT_INJECTION) {
    if (signals.includes(rule.signal)) continue
    for (const re of rule.patterns) {
      const m = re.exec(t)
      if (!m) continue
      signals.push(rule.signal)
      score += rule.weight
      const start = Math.max(0, m.index - 20)
      excerpts.push(`${start > 0 ? '…' : ''}${t.slice(start, m.index + m[0].length + 20).trim()}`)
      break
    }
  }
  score = Math.min(1, Math.round(score * 100) / 100)
  return { suspicious: score >= INJECTION_THRESHOLD, score, signals, excerpts }
}

function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase()
}

// ───────────────────────────── parse ─────────────────────────────

/**
 * Parse receipt OCR text into a spending candidate. Returns `{ ok: false }` for garbage; otherwise
 * `{ ok: true, candidate, injection, blocked }`. `blocked` means the text tried to give instructions —
 * the caller must NOT add it. All fields the user can edit before confirming.
 */
export function parseReceipt(text: string, opts: ParseReceiptOptions = {}): ReceiptParseResult {
  const raw = String(text ?? '')
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'No text to read from this receipt.' }

  const currency = detectCurrency(trimmed) ?? opts.fallbackCurrency ?? 'CNY'
  const total = extractTotal(trimmed, currency)
  if (total === null) return { ok: false, error: 'Could not find a total on this receipt.' }

  const rawMerchant = extractMerchantLine(trimmed)
  const merchant = normalizeMerchant(rawMerchant) || 'Receipt'
  const date = parseReceiptDate(trimmed) ?? opts.today ?? localToday()
  let category = categorize(merchant, '', -total).category
  if (!isSpendingCategory(category)) category = 'other'

  const injection = scanReceiptInjection(trimmed)
  const candidate: SpendingCandidate = {
    id: `receipt_${sha256Hex(trimmed).slice(0, 16)}`,
    merchant,
    amount: total,
    currency,
    date,
    category,
    description: rawMerchant || 'Receipt',
    source: 'receipt',
  }

  return {
    ok: true,
    candidate,
    injection,
    blocked: injection.suspicious,
    warnings: injection.suspicious ? injection.signals : [],
  }
}
