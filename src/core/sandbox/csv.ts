import { CATEGORIES, CATEGORY_IDS } from '../categories'
import { addDays } from '../dates'
import { MINOR_PER_MAJOR } from '../money'
import type { CategoryId, Currency, ISODate, Minor, PayChannel, Transaction, TxnFlag } from '../types'
import { defaultCategorizer, defaultNormalizer, safeCategorize, type Categorizer, type MerchantNormalizer } from './categorizer'
import { mixSeed } from './random'

export interface CsvImportResult {
  transactions: Transaction[]
  skipped: number
  errors: string[]
  /** detected format */
  format: 'generic' | 'wechat_pay' | 'alipay' | 'unknown'
}

export interface CsvImportOptions {
  accountId: string
  currency: Currency
  userRules?: Record<string, CategoryId>
  /** default: finance/categorize.categorize */
  categorizer?: Categorizer
  /** default: finance/categorize.normalizeMerchant */
  normalizer?: MerchantNormalizer
  /** stop after this many data rows (default 20,000) */
  maxRows?: number
}

type Format = CsvImportResult['format']

const DEFAULT_MAX_ROWS = 20_000
const MAX_ERRORS = 50
const HEADER_SCAN_ROWS = 60
const LIMITS = { merchant: 80, description: 200, memo: 500 }

// ── parsing ────────────────────────────────────────────────────────────────

/**
 * RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). Quoted fields may contain delimiters and line
 * breaks; a quote inside an unquoted field is kept literally. Completely blank lines are dropped.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let quoted = false
  const endField = () => {
    row.push(field)
    field = ''
    quoted = false
  }
  const endRow = () => {
    const wasQuoted = quoted
    endField()
    if (!(row.length === 1 && row[0] === '' && !wasQuoted)) rows.push(row)
    row = []
  }
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else inQuotes = false
    } else if (c === '"' && field === '' && !quoted) {
      inQuotes = true
      quoted = true
    } else if (c === delimiter) endField()
    else if (c === '\n' || c === '\r') {
      endRow()
      if (c === '\r' && text[i + 1] === '\n') i++
    } else field += c
  }
  if (field !== '' || row.length > 0 || quoted) endRow()
  return rows
}

/** The most frequent of , ; and tab in the first lines (WeChat/Alipay preambles are comma-padded). */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/, 40).join('\n')
  const counts = [',', ';', '\t'].map((d) => ({ d, n: sample.split(d).length - 1 }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

// ── cell helpers ───────────────────────────────────────────────────────────

function clean(text: string | undefined, max: number): string {
  return (text ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** "/" is WeChat/Alipay's placeholder for "nothing" */
function present(text: string | undefined): string {
  const t = clean(text, 1_000)
  return t === '/' ? '' : t
}

function normHeader(cell: string): string {
  return cell
    .replace(/^﻿/, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** "Amount (CNY)" → "amount" */
function headerKey(cell: string): string {
  return normHeader(cell).replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function findCol(header: readonly string[], names: readonly string[]): number {
  const keys = header.map(headerKey)
  for (const name of names) {
    const i = keys.indexOf(name)
    if (i >= 0) return i
  }
  return -1
}

/**
 * Parse a money cell into signed minor units without floating point: "¥1,236.00", "-12.50", "(45.50)",
 * "1.234,56", "+18500", "300 元", "12.00 DR". Returns null when the cell holds no amount.
 */
export function parseMoney(cell: string, currency: Currency): Minor | null {
  let s = clean(cell, 64).replace(/[   \s]/g, '')
  if (!s) return null
  let sign = 1
  if (/^\(.*\)$/.test(s)) {
    sign = -1
    s = s.slice(1, -1)
  }
  const suffix = s.match(/(DR|CR)$/i)
  if (suffix) {
    if (suffix[1].toUpperCase() === 'DR') sign = -sign
    s = s.slice(0, -2)
  }
  s = s.replace(/^(?:¥|￥|\$|€|£|RMB|CNY|USD|EUR|HKD|元)+/i, '').replace(/(?:¥|￥|元|RMB|CNY)+$/i, '')
  if (/^[-−+]/.test(s)) {
    if (s[0] !== '+') sign = -sign
    s = s.slice(1)
  } else if (/-$/.test(s)) {
    sign = -sign
    s = s.slice(0, -1)
  }
  s = s.replace(/^(?:¥|￥|\$|€|£)/, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot && /,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const m = s.match(/^(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  const k = MINOR_PER_MAJOR[currency]
  const decimals = Math.round(Math.log10(k))
  const frac = (m[2] ?? '').padEnd(decimals + 1, '0')
  const minor = Number(m[1]) * k + Number(frac.slice(0, decimals) || '0') + (Number(frac[decimals]) >= 5 ? 1 : 0)
  return Number.isSafeInteger(minor) ? sign * minor : null
}

type DayOrder = 'dmy' | 'mdy'

interface ParsedDate {
  date: ISODate
  time?: string
}

function validDate(y: number, m: number, d: number): ISODate | null {
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return y >= 1970 && y <= 2100 && addDays(iso, 0) === iso ? iso : null
}

function timeOf(h?: string, min?: string): string | undefined {
  if (h === undefined || min === undefined) return undefined
  const hh = Number(h)
  const mm = Number(min)
  return hh < 24 && mm < 60 ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : undefined
}

/** "2026-09-28 23:41:07", "2026/9/3", "2026年9月3日", "20260903", "28/09/2026 08:15" (day order per file). */
export function parseDateCell(cell: string, order: DayOrder = 'dmy'): ParsedDate | null {
  const s = clean(cell, 64)
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?/)
  if (m) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]))
    return date ? { date, time: timeOf(m[4], m[5]) } : null
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\s+(\d{1,2}):?(\d{2}))?$/)
  if (m) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]))
    return date ? { date, time: timeOf(m[4], m[5]) } : null
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    const date = order === 'dmy' ? validDate(Number(m[3]), b, a) : validDate(Number(m[3]), a, b)
    return date ? { date, time: timeOf(m[4], m[5]) } : null
  }
  return null
}

/** DD/MM vs MM/DD: decided once per file from any unambiguous value (default DD/MM). */
function detectDayOrder(cells: readonly string[]): DayOrder {
  for (const c of cells) {
    const m = clean(c, 64).match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/)
    if (!m) continue
    if (Number(m[1]) > 12) return 'dmy'
    if (Number(m[2]) > 12) return 'mdy'
  }
  return 'dmy'
}

// ── categories ─────────────────────────────────────────────────────────────

const CATEGORY_SYNONYMS: Record<string, CategoryId> = {
  food: 'dining', restaurant: 'dining', restaurants: 'dining', 'eating out': 'dining', dining: 'dining',
  takeaway: 'delivery', takeout: 'delivery', 'food delivery': 'delivery', coffee: 'coffee_tea', tea: 'coffee_tea',
  rent: 'housing', mortgage: 'housing', bills: 'utilities', electricity: 'utilities', water: 'utilities',
  phone: 'phone_internet', internet: 'phone_internet', mobile: 'phone_internet', transportation: 'transport',
  taxi: 'transport', medical: 'health', pharmacy: 'health', beauty: 'personal_care', salary: 'income',
  wages: 'income', payroll: 'income', transfers: 'transfer', saving: 'savings', charges: 'fees', fee: 'fees',
  餐饮: 'dining', 外卖: 'delivery', 咖啡: 'coffee_tea', 奶茶: 'coffee_tea', 交通: 'transport', 购物: 'shopping',
  住房: 'housing', 房租: 'housing', 水电: 'utilities', 话费: 'phone_internet', 工资: 'income', 收入: 'income',
  转账: 'transfer', 医疗: 'health', 教育: 'education', 娱乐: 'entertainment', 旅行: 'travel', 旅游: 'travel',
  超市: 'groceries', 买菜: 'groceries', 订阅: 'subscriptions', 礼物: 'gifts', 红包: 'gifts', 保险: 'insurance',
}

/** A file's own category label → CategoryId (id, English label, or a common synonym), else undefined. */
export function mapCategoryLabel(label: string): CategoryId | undefined {
  const key = clean(label, 64).toLowerCase()
  if (!key) return undefined
  const byId = CATEGORY_IDS.find((id) => id === key.replace(/[\s&-]+/g, '_'))
  if (byId) return byId
  const byLabel = CATEGORY_IDS.find((id) => CATEGORIES[id].label.toLowerCase() === key)
  return byLabel ?? (Object.hasOwn(CATEGORY_SYNONYMS, key) ? CATEGORY_SYNONYMS[key] : undefined)
}

/** Alipay 交易分类 → the categories it can mean (first = fallback when the categoriser disagrees). */
const ALIPAY_HINTS: Record<string, readonly CategoryId[]> = {
  餐饮美食: ['dining', 'delivery', 'coffee_tea'],
  日用百货: ['shopping', 'groceries', 'personal_care'],
  充值缴费: ['utilities', 'phone_internet'],
  交通出行: ['transport'],
  爱车养车: ['transport'],
  酒店旅游: ['travel'],
  服饰装扮: ['shopping'],
  数码电器: ['shopping'],
  母婴亲子: ['shopping'],
  宠物: ['shopping'],
  运动户外: ['health', 'shopping'],
  医疗健康: ['health'],
  教育培训: ['education'],
  文化休闲: ['entertainment', 'subscriptions'],
  美容美发: ['personal_care'],
  住房物业: ['housing', 'utilities'],
  保险: ['insurance'],
  公益捐赠: ['gifts'],
  收入: ['income'],
  投资理财: ['transfer'],
  信用借还: ['transfer'],
}

function wechatHint(type: string, amount: Minor): readonly CategoryId[] | undefined {
  if (type.includes('退款')) return undefined
  if (type.includes('红包')) return amount < 0 ? ['gifts'] : ['income', 'gifts']
  if (type.includes('转账') || type.includes('群收款') || type.includes('信用卡还款')) return ['transfer']
  return undefined
}

function alipayHint(category: string, amount: Minor): readonly CategoryId[] | undefined {
  if (category === '转账红包') return amount < 0 ? ['transfer', 'gifts'] : ['income', 'transfer', 'gifts']
  return ALIPAY_HINTS[category]
}

interface Categorised {
  category: CategoryId
  source: Transaction['categorySource']
  confidence: number
}

const CONFIDENT = 0.9

/**
 * Platform labels are coarse, so they constrain rather than replace the categoriser: its answer wins when it
 * fits the hint or it is confident; otherwise the hint's first category is used (source 'import').
 */
function resolveCategory(ctx: ImportContext, merchant: string, description: string, amount: Minor, hint?: readonly CategoryId[]): Categorised {
  const r = safeCategorize(ctx.categorizer, merchant, description, amount, ctx.userRules)
  if (!hint?.length) return r
  if (r.confidence > 0 && (hint.includes(r.category) || (r.confidence >= CONFIDENT && r.category !== 'other'))) return r
  return { category: hint[0], source: 'import', confidence: CONFIDENT }
}

// ── formats ────────────────────────────────────────────────────────────────

interface ImportContext {
  opts: CsvImportOptions
  categorizer: Categorizer
  normalizer: MerchantNormalizer
  userRules: Record<string, CategoryId>
  ids: Set<string>
  dayOrder: DayOrder
}

type RowOutcome = { txn: Transaction } | { skip: true } | { error: string }

interface FormatSpec {
  format: Exclude<Format, 'unknown'>
  /** column indexes resolved from the header row */
  columns(header: readonly string[]): Record<string, number> | null
  /** footer/summary lines that are not transactions at all (ignored, not counted as skipped) */
  isNoise?(cells: readonly string[], cols: Record<string, number>): boolean
  row(cells: readonly string[], cols: Record<string, number>, ctx: ImportContext): RowOutcome
}

/** wallet exports start every transaction row with a timestamp; anything else is a summary/footer line */
function lacksTimestamp(cells: readonly string[], cols: Record<string, number>): boolean {
  const when = present(cell(cells, cols.time)) || present(cell(cells, cols.created ?? -1))
  return !/^\d{4}/.test(when)
}

const cell = (cells: readonly string[], i: number): string => (i >= 0 ? (cells[i] ?? '') : '')

function amountCol(header: readonly string[]): number {
  return header.map(normHeader).findIndex((h) => h.startsWith('金额'))
}

function stripBranch(raw: string): string {
  return raw.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim()
}

function normalizeMerchantSafe(ctx: ImportContext, raw: string): string {
  const fallback = clean(stripBranch(raw), LIMITS.merchant) || clean(raw, LIMITS.merchant)
  try {
    const n = clean(ctx.normalizer(raw), LIMITS.merchant)
    return n || fallback
  } catch {
    return fallback
  }
}

/** order numbers are untrusted text: keep id-safe characters only */
function idPart(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
}

function uniqueId(ctx: ImportContext, base: string): string {
  let id = base
  for (let n = 2; ctx.ids.has(id); n++) id = `${base}_${n}`
  ctx.ids.add(id)
  return id
}

function rowHashId(prefix: string, cells: readonly string[]): string {
  return `${prefix}_${mixSeed(0, ...cells.map((c) => clean(c, 200))).toString(36)}`
}

interface TxnParts {
  id: string
  date: ParsedDate
  amount: Minor
  rawMerchant: string
  description: string
  memo?: string
  channel?: PayChannel
  flags?: TxnFlag[]
  categorised: Categorised
}

function buildTxn(ctx: ImportContext, p: TxnParts): Transaction {
  const t: Transaction = {
    id: p.id,
    accountId: ctx.opts.accountId,
    date: p.date.date,
    amount: p.amount,
    currency: ctx.opts.currency,
    merchant: normalizeMerchantSafe(ctx, p.rawMerchant),
    description: clean(p.description, LIMITS.description) || clean(p.rawMerchant, LIMITS.description),
    category: p.categorised.category,
    categorySource: p.categorised.source,
    categoryConfidence: p.categorised.confidence,
  }
  if (p.date.time) t.time = p.date.time
  const memo = clean(p.memo, LIMITS.memo)
  if (memo && memo !== '/') t.memo = memo
  if (p.channel) t.channel = p.channel
  if (p.flags?.length) t.flags = p.flags
  return t
}

function direction(value: string): 'out' | 'in' | 'neutral' {
  const v = clean(value, 16)
  if (v === '支出') return 'out'
  if (v === '收入') return 'in'
  return 'neutral'
}

const FAILED_STATUS = /失败|关闭|撤销|等待|未支付|已退还|failed|closed|cancel/i

const WECHAT: FormatSpec = {
  format: 'wechat_pay',
  isNoise: lacksTimestamp,
  columns(header) {
    const cols = {
      time: findCol(header, ['交易时间']),
      type: findCol(header, ['交易类型']),
      party: findCol(header, ['交易对方']),
      item: findCol(header, ['商品']),
      dir: findCol(header, ['收/支']),
      amount: amountCol(header),
      status: findCol(header, ['当前状态']),
      order: findCol(header, ['交易单号']),
      memo: findCol(header, ['备注']),
    }
    return cols.time >= 0 && cols.type >= 0 && cols.party >= 0 && cols.item >= 0 && cols.dir >= 0 && cols.amount >= 0 ? cols : null
  },
  row(cells, c, ctx) {
    const dir = direction(cell(cells, c.dir))
    if (dir === 'neutral' || FAILED_STATUS.test(cell(cells, c.status))) return { skip: true }
    const date = parseDateCell(cell(cells, c.time))
    if (!date) return { error: `invalid date "${clean(cell(cells, c.time), 40)}"` }
    const abs = parseMoney(cell(cells, c.amount), ctx.opts.currency)
    if (abs === null) return { error: `invalid amount "${clean(cell(cells, c.amount), 40)}"` }
    if (abs === 0) return { skip: true }
    const amount = dir === 'out' ? -Math.abs(abs) : Math.abs(abs)
    const type = present(cell(cells, c.type))
    const item = present(cell(cells, c.item))
    const rawMerchant = present(cell(cells, c.party)) || item || type || 'WeChat Pay'
    const description = [type, item].filter(Boolean).join(' · ')
    const order = idPart(present(cell(cells, c.order)))
    return {
      txn: buildTxn(ctx, {
        id: uniqueId(ctx, order ? `wx_${order}` : rowHashId('wx', cells)),
        date,
        amount,
        rawMerchant,
        description,
        memo: present(cell(cells, c.memo)),
        channel: 'wechat_pay',
        flags: type.includes('退款') && amount > 0 ? ['refund'] : undefined,
        categorised: resolveCategory(ctx, rawMerchant, description, amount, wechatHint(type, amount)),
      }),
    }
  },
}

const ALIPAY: FormatSpec = {
  format: 'alipay',
  isNoise: lacksTimestamp,
  columns(header) {
    const cols = {
      time: findCol(header, ['交易时间', '付款时间', '交易创建时间']),
      created: findCol(header, ['交易创建时间']),
      category: findCol(header, ['交易分类']),
      party: findCol(header, ['交易对方']),
      item: findCol(header, ['商品说明', '商品名称']),
      dir: findCol(header, ['收/支']),
      amount: amountCol(header),
      status: findCol(header, ['交易状态']),
      order: findCol(header, ['交易订单号', '交易号']),
      memo: findCol(header, ['备注']),
    }
    return cols.time >= 0 && cols.party >= 0 && cols.item >= 0 && cols.dir >= 0 && cols.amount >= 0 ? cols : null
  },
  row(cells, c, ctx) {
    const dir = direction(cell(cells, c.dir))
    const status = cell(cells, c.status)
    // a refund shows up as its own 收入 row; closed / failed / pending trades moved no money
    if (dir === 'neutral' || (FAILED_STATUS.test(status) && !status.includes('退款'))) return { skip: true }
    const when = present(cell(cells, c.time)) || present(cell(cells, c.created))
    const date = parseDateCell(when)
    if (!date) return { error: `invalid date "${clean(when, 40)}"` }
    const abs = parseMoney(cell(cells, c.amount), ctx.opts.currency)
    if (abs === null) return { error: `invalid amount "${clean(cell(cells, c.amount), 40)}"` }
    if (abs === 0) return { skip: true }
    const amount = dir === 'out' ? -Math.abs(abs) : Math.abs(abs)
    const item = present(cell(cells, c.item))
    const platformCategory = present(cell(cells, c.category))
    const rawMerchant = present(cell(cells, c.party)) || item || 'Alipay'
    const isRefund = amount > 0 && (platformCategory === '退款' || status.includes('退款') || item.includes('退款'))
    const order = idPart(present(cell(cells, c.order)))
    return {
      txn: buildTxn(ctx, {
        id: uniqueId(ctx, order ? `ali_${order}` : rowHashId('ali', cells)),
        date,
        amount,
        rawMerchant,
        description: item,
        memo: present(cell(cells, c.memo)),
        channel: 'alipay',
        flags: isRefund ? ['refund'] : undefined,
        categorised: resolveCategory(ctx, rawMerchant, item, amount, isRefund ? undefined : alipayHint(platformCategory, amount)),
      }),
    }
  },
}

const GENERIC_NAMES = {
  date: ['date', 'transaction date', 'trans date', 'posting date', 'posted date', 'booking date', 'value date', 'posted', '日期', '交易日期', '记账日期', '交易时间'],
  time: ['time', 'transaction time', '时间'],
  merchant: ['merchant', 'payee', 'counterparty', 'name', 'merchant name', '对方户名', '交易对方', '商户', '商户名称'],
  description: ['description', 'details', 'narrative', 'particulars', 'transaction description', 'transaction details', '摘要', '交易摘要', '用途', '交易说明'],
  amount: ['amount', 'transaction amount', 'amt', 'value', '金额', '交易金额', '发生额'],
  debit: ['debit', 'debit amount', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'out', '支出', '支出金额', '借方', '借方金额', '借方发生额'],
  credit: ['credit', 'credit amount', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'in', '收入', '收入金额', '贷方', '贷方金额', '贷方发生额'],
  direction: ['type', 'direction', 'dr/cr', 'cr/dr', 'debit/credit', 'transaction type', '收/支', '收支', '借贷', '借贷标志'],
  category: ['category', 'categories', '分类', '类别', '交易分类'],
  memo: ['memo', 'note', 'notes', 'remark', 'remarks', 'comment', 'reference', '备注', '附言'],
  currency: ['currency', 'ccy', '币种', '货币'],
}

function genericDirection(value: string): 'out' | 'in' | undefined {
  const v = clean(value, 24).toLowerCase()
  if (['debit', 'dr', 'd', 'out', 'withdrawal', 'expense', 'payment', '支出', '借', '借方', '付款'].includes(v)) return 'out'
  if (['credit', 'cr', 'c', 'in', 'deposit', 'income', '收入', '贷', '贷方', '收款'].includes(v)) return 'in'
  return undefined
}

function genericAmount(cells: readonly string[], c: Record<string, number>, currency: Currency): Minor | null | 'missing' {
  if (c.amount >= 0) {
    const a = parseMoney(cell(cells, c.amount), currency)
    if (a === null) return cell(cells, c.amount).trim() ? null : 'missing'
    const dir = genericDirection(cell(cells, c.direction))
    return dir === 'out' ? -Math.abs(a) : dir === 'in' ? Math.abs(a) : a
  }
  const debit = parseMoney(cell(cells, c.debit), currency)
  const credit = parseMoney(cell(cells, c.credit), currency)
  if (debit === null && credit === null) {
    return cell(cells, c.debit).trim() || cell(cells, c.credit).trim() ? null : 'missing'
  }
  return (credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0)
}

const GENERIC: FormatSpec = {
  format: 'generic',
  columns(header) {
    const cols: Record<string, number> = {}
    for (const [key, names] of Object.entries(GENERIC_NAMES)) cols[key] = findCol(header, names)
    const hasAmount = cols.amount >= 0 || cols.debit >= 0 || cols.credit >= 0
    return cols.date >= 0 && hasAmount ? cols : null
  },
  row(cells, c, ctx) {
    const date = parseDateCell(cell(cells, c.date), ctx.dayOrder)
    if (!date) return { error: `invalid date "${clean(cell(cells, c.date), 40)}"` }
    if (c.time >= 0 && !date.time) {
      const t = clean(cell(cells, c.time), 16).match(/^(\d{1,2}):(\d{2})/)
      if (t) date.time = timeOf(t[1], t[2])
    }
    const currency = clean(cell(cells, c.currency), 8).toUpperCase()
    if (currency && currency !== ctx.opts.currency) return { error: `currency ${currency} differs from the account currency ${ctx.opts.currency}` }
    const amount = genericAmount(cells, c, ctx.opts.currency)
    if (amount === null) return { error: 'invalid amount' }
    if (amount === 'missing') return { error: 'missing amount' }
    if (amount === 0) return { skip: true }
    const merchantCell = present(cell(cells, c.merchant))
    const descriptionCell = present(cell(cells, c.description))
    const rawMerchant = merchantCell || descriptionCell || 'Unknown'
    const description = descriptionCell || merchantCell
    const fileCategory = mapCategoryLabel(cell(cells, c.category))
    return {
      txn: buildTxn(ctx, {
        id: uniqueId(ctx, rowHashId('csv', cells)),
        date,
        amount,
        rawMerchant,
        description,
        memo: present(cell(cells, c.memo)),
        categorised: fileCategory
          ? { category: fileCategory, source: 'import', confidence: 1 }
          : resolveCategory(ctx, rawMerchant, description, amount),
      }),
    }
  },
}

/** Most specific first: a WeChat header would also satisfy the generic matcher. */
const FORMATS: readonly FormatSpec[] = [WECHAT, ALIPAY, GENERIC]

function detectHeader(rows: readonly string[][]): { spec: FormatSpec; cols: Record<string, number>; index: number } | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  for (let i = 0; i < limit; i++) {
    for (const spec of FORMATS) {
      const cols = spec.columns(rows[i])
      if (cols) return { spec, cols, index: i }
    }
  }
  return null
}

function isBlank(cells: readonly string[]): boolean {
  return cells.every((c) => !clean(c, 8))
}

/** WeChat/Alipay footers and separators ("-----", "共9笔记录", "导出时间…") */
function isFooter(cells: readonly string[]): boolean {
  const first = clean(cells[0], 32)
  return /^[-=#]{3,}/.test(first) || /^(共\d+笔|导出|注[:：]|合计|总计|total)/i.test(first)
}

/** A refund inherits the category of the purchase it reverses (same merchant, earlier, at least as large). */
function inheritRefundCategories(txns: Transaction[]): void {
  for (const refund of txns) {
    if (!refund.flags?.includes('refund') || refund.amount <= 0) continue
    const original = txns.find((t) => t.amount < 0 && t.merchant === refund.merchant && -t.amount >= refund.amount && t.date <= refund.date)
    if (!original) continue
    refund.category = original.category
    refund.categorySource = original.categorySource
    refund.categoryConfidence = original.categoryConfidence
  }
}

function sortByDateTime(txns: Transaction[]): Transaction[] {
  return txns
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || (a.t.time ?? '').localeCompare(b.t.time ?? '') || a.i - b.i)
    .map((x) => x.t)
}

/**
 * Import a bank/app export. Supports generic headers (date, description|merchant, amount | debit+credit),
 * WeChat Pay bill export (交易时间, 交易类型, 交易对方, 商品, 收/支, 金额(元)) and Alipay export
 * (交易时间/交易创建时间, 交易对方, 商品说明, 收/支, 金额). Memo/description fields are UNTRUSTED.
 * Transactions are categorised with finance/categorize and get categorySource 'import' only when the
 * file had its own category column.
 */
export function importCsv(text: string, opts: CsvImportOptions): CsvImportResult {
  if (typeof text !== 'string' || !text.trim()) return { transactions: [], skipped: 0, errors: ['The file is empty.'], format: 'unknown' }
  const rows = parseCsv(text, detectDelimiter(text))
  const header = detectHeader(rows)
  if (!header) {
    return {
      transactions: [],
      skipped: 0,
      errors: ['Could not find a header row with date and amount columns (supported: generic bank CSV, WeChat Pay, Alipay).'],
      format: 'unknown',
    }
  }
  const dataRows = rows.slice(header.index + 1)
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const ctx: ImportContext = {
    opts,
    categorizer: opts.categorizer ?? defaultCategorizer,
    normalizer: opts.normalizer ?? defaultNormalizer,
    userRules: opts.userRules ?? {},
    ids: new Set(),
    dayOrder: detectDayOrder(dataRows.map((r) => cell(r, header.cols.date ?? header.cols.time))),
  }
  const transactions: Transaction[] = []
  const errors: string[] = []
  let skipped = 0
  let read = 0
  dataRows.forEach((cells, i) => {
    if (isBlank(cells) || isFooter(cells) || header.spec.isNoise?.(cells, header.cols)) return
    if (++read > maxRows) {
      skipped++
      return
    }
    const outcome = header.spec.row(cells, header.cols, ctx)
    if ('txn' in outcome) transactions.push(outcome.txn)
    else {
      skipped++
      if ('error' in outcome) errors.push(`Row ${header.index + i + 2}: ${outcome.error}`)
    }
  })
  inheritRefundCategories(transactions)
  if (read > maxRows) errors.push(`Only the first ${maxRows} rows were imported (${read - maxRows} more skipped).`)
  const shown = errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), `…and ${errors.length - MAX_ERRORS} more errors`] : errors
  return { transactions: sortByDateTime(transactions), skipped, errors: shown, format: header.spec.format }
}
