import type { ISODate } from '../types'

/**
 * A statement that arrives as text (a PDF, a Word file, a photo of a printout) instead of a CSV: one transaction
 * per line that carries a date and an amount. The rows become a plain "Date,Description,Amount" CSV, so they go
 * through the same importer, de-duplication and preview as any statement file.
 */

/** At least this many dated lines with an amount make a text a statement rather than one receipt. */
export const STATEMENT_MIN_ROWS = 3

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
}

const DATE_RES: { re: RegExp; read: (m: RegExpMatchArray) => [number | null, number, number] }[] = [
  // 2026-10-03, 2026/10/03, 2026.10.03
  { re: /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 2026年10月3日
  { re: /(20\d{2})年(\d{1,2})月(\d{1,2})日/, read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  // 03/10/2026, 03-10-2026 (day first, as in Indonesia and most statements outside the US)
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/, read: (m) => [Number(m[3]), Number(m[2]), Number(m[1])] },
  // 03 Oct 2026, 3 Okt 2026
  { re: /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(20\d{2})\b/, read: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()] ?? 0, Number(m[1])] },
  // 10月3日 (no year)
  { re: /(\d{1,2})月(\d{1,2})日/, read: (m) => [null, Number(m[1]), Number(m[2])] },
  // 03/10 at the start of a line (no year), as on Indonesian bank statements
  { re: /^\s*(\d{1,2})\/(\d{1,2})(?!\/)\b/, read: (m) => [null, Number(m[2]), Number(m[1])] },
]

/** The first date on a line; a date with no year takes the year that keeps it on or before today. */
export function lineDate(line: string, today: ISODate): { date: ISODate; match: string } | null {
  for (const { re, read } of DATE_RES) {
    const m = line.match(re)
    if (!m) continue
    const [y0, mo, d] = read(m)
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) continue
    const ty = Number(today.slice(0, 4))
    let y = y0 ?? ty
    const pad = (n: number) => String(n).padStart(2, '0')
    if (y0 === null && `${y}-${pad(mo)}-${pad(d)}` > today) y -= 1
    return { date: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] }
  }
  return null
}

// 1,234.56 · 1.234,56 · 1234.56 · 150,000 · 150.000 · ¥25 · Rp 25.000 (a number with separators or decimals, or a currency mark)
const AMOUNT_RE = /(?:[¥￥$€£]|Rp\.?|RMB|IDR|CNY)?\s?-?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|(?:[¥￥$€£]|Rp\.?|RMB|IDR|CNY)\s?-?\d+(?:[.,]\d{1,2})?|-?\d+[.,]\d{2}\b/g

/** A written amount to a plain number ("1.234,56" and "1,234.56" both → 1234.56; "150.000" → 150000). */
export function plainAmount(raw: string): number | null {
  let s = raw.replace(/[¥￥$€£]|Rp\.?|RMB|IDR|CNY/g, '').replace(/\s/g, '')
  const neg = s.startsWith('-')
  s = s.replace(/^-/, '')
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  // a separator followed by exactly two digits at the end is the decimal point; any other separator groups thousands
  if (lastSep >= 0 && s.length - lastSep - 1 === 2) s = `${s.slice(0, lastSep).replace(/[.,]/g, '')}.${s.slice(lastSep + 1)}`
  else s = s.replace(/[.,]/g, '')
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? (neg ? -n : n) : null
}

const INCOME_RE = /\b(?:cr|kr|credit|kredit|salary|gaji|refund|transfer masuk|setoran|deposit)\b|收入|退款|工资|\+\s?\d/i

export interface TextStatement {
  csv: string
  rows: number
}

/** The lines of a text that read as transactions, as a CSV; null when there are fewer than STATEMENT_MIN_ROWS. */
export function statementFromText(text: string, today: ISODate): TextStatement | null {
  const rows: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 6) continue
    const d = lineDate(line, today)
    if (!d) continue
    const rest = line.replace(d.match, ' ')
    const amounts = [...rest.matchAll(AMOUNT_RE)].map((m) => m[0])
    // statements print the amount, then often a running balance: the first amount is the transaction
    const first = amounts[0]
    const value = first ? plainAmount(first) : null
    if (!value) continue
    let description = rest
    for (const a of amounts) description = description.replace(a, ' ')
    description = description.replace(/\b(?:DB|CR|DR|KR|D|K)\b/g, ' ').replace(/[,"]/g, ' ').replace(/\s+/g, ' ').trim() || 'Statement row'
    const signed = value < 0 || !INCOME_RE.test(line) ? -Math.abs(value) : Math.abs(value)
    rows.push(`${d.date},"${description.slice(0, 80)}",${signed.toFixed(2)}`)
  }
  if (rows.length < STATEMENT_MIN_ROWS) return null
  return { csv: ['Date,Description,Amount', ...rows].join('\n'), rows: rows.length }
}

const BILL_RE = /\b(?:due date|amount due|payment due|pay by|invoice|bill(?:ing)? period|jatuh tempo|tagihan|batas pembayaran)\b|应缴|缴费|账单|到期|截止日期|发票/i

/** A document that asks to be paid (an electricity bill, an invoice) rather than proving a payment. */
export function looksLikeBill(text: string): boolean {
  return BILL_RE.test(text)
}

/** A list of rows (a spreadsheet) as CSV text, quoting what needs it. */
export function rowsToCsv(rows: readonly (readonly unknown[])[]): string {
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.filter((r) => r.some((v) => v !== null && v !== undefined && String(v).trim() !== '')).map((r) => r.map(cell).join(',')).join('\n')
}
