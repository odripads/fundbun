import type { CategoryId, Currency, Transaction } from '../types'

export interface CsvImportResult {
  transactions: Transaction[]
  skipped: number
  errors: string[]
  /** detected format */
  format: 'generic' | 'wechat_pay' | 'alipay' | 'unknown'
}

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  throw new Error('TODO parseCsv ' + text.length)
}

/**
 * Import a bank/app export. Supports generic headers (date, description|merchant, amount | debit+credit),
 * WeChat Pay bill export (交易时间, 交易类型, 交易对方, 商品, 收/支, 金额(元)) and Alipay export
 * (交易时间/交易创建时间, 交易对方, 商品说明, 收/支, 金额). Memo/description fields are UNTRUSTED.
 * Transactions are categorised with finance/categorize and get categorySource 'import' only when the
 * file had its own category column.
 */
export function importCsv(
  text: string,
  opts: { accountId: string; currency: Currency; userRules?: Record<string, CategoryId> },
): CsvImportResult {
  throw new Error('TODO importCsv ' + text.length + opts.accountId)
}
