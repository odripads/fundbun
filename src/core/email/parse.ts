/**
 * Template-based, on-device (NO AI) parser of transaction emails → `SpendingCandidate[]`.
 *
 * Every body is UNTRUSTED: the parser can only ever produce a `SpendingCandidate` (a record awaiting the user's
 * Confirm), never an action or a payment. Parsing is defensive — any input that does not match a supported
 * template yields nothing, and anything that smells like a refund / credit / inflow is skipped.
 *
 * Supported formats:
 *   - a Chinese bank e-statement table (交易日期 / 商户 / 交易金额 / 摘要), pipe- or tab- or wide-space-delimited
 *   - WeChat Pay / Alipay / bank "account change" notification emails (付款金额 / 收款方 / 支付时间 …)
 */

import { categorize, normalizeMerchant } from '../finance/categorize'
import { parseDateCell, parseMoney } from '../sandbox/csv'
import type { Currency, ISODate, Minor, SpendingCandidate } from '../types'
import type { EmailMessage } from './types'

function norm(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
}

const trim = (s: string): string => s.trim()

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

/** Credit / refund / inflow rows are not spending. */
const SKIP_ROW = /还款|退款|存入|收入|利息|溢缴|退货|冲正|入账|收款成功|转入/

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

// ───────────────────────────── bank e-statement table ─────────────────────────────

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

function parseTable(body: string, message: EmailMessage, currency: Currency): SpendingCandidate[] {
  const lines = body.split('\n')
  const header = findHeader(lines)
  if (!header) return []
  const out: SpendingCandidate[] = []
  for (let i = header.index + 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], header.delim)
    const parsed = parseDateCell(cells[header.cols.date] ?? '')
    if (!parsed) continue
    const amount = parseMoney(cells[header.cols.amount] ?? '', currency)
    if (amount === null) continue
    const merchantCell = header.cols.merchant >= 0 ? cells[header.cols.merchant] : ''
    const descCell = header.cols.desc >= 0 ? cells[header.cols.desc] : ''
    if (SKIP_ROW.test(`${merchantCell} ${descCell}`)) continue
    const rawMerchant = merchantCell || descCell || 'Unknown'
    const amountAbs = Math.abs(amount)
    if (amountAbs === 0) continue
    const merchant = normalizeMerchant(rawMerchant)
    out.push(buildCandidate(message, out.length, merchant, amountAbs, currency, parsed.date, parsed.time, descCell || rawMerchant))
  }
  return out
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

function parseLabeled(body: string, message: EmailMessage, currency: Currency): SpendingCandidate[] {
  const amountStr = firstMatch(LABEL.amount, body)
  if (!amountStr) return []
  const amount = parseMoney(amountStr, currency)
  if (amount === null) return []
  if (SKIP_ROW.test(body)) return []
  const timeStr = firstMatch(LABEL.time, body)
  const parsed = timeStr ? parseDateCell(timeStr) : null
  if (!parsed?.date) return []
  const merchantRaw = firstMatch(LABEL.merchant, body) ?? firstMatch(LABEL.description, body) ?? 'Unknown'
  const description = firstMatch(LABEL.description, body) ?? ''
  const amountAbs = Math.abs(amount)
  if (amountAbs === 0) return []
  return [buildCandidate(message, 0, normalizeMerchant(merchantRaw), amountAbs, currency, parsed.date, parsed.time, description || merchantRaw)]
}

// ───────────────────────────── public API ─────────────────────────────

/** Parse one email body into spending candidates. Never throws; unknown/unparseable input yields []. */
export function parseEmail(message: EmailMessage, currency: Currency = 'CNY'): SpendingCandidate[] {
  if (!message || typeof message.body !== 'string') return []
  try {
    const body = norm(message.body)
    const table = parseTable(body, message, currency)
    return table.length ? table : parseLabeled(body, message, currency)
  } catch {
    return []
  }
}

export function parseEmails(messages: EmailMessage[], currency: Currency = 'CNY'): SpendingCandidate[] {
  return (Array.isArray(messages) ? messages : []).flatMap((m) => parseEmail(m, currency))
}
