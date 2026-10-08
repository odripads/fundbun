import type { RedactionReport } from '../types'

/**
 * Count keys used in RedactionReport.counts:
 * email · iban · phone · cn_id (PRC resident ID) · nik (Indonesian NIK) · card · account (labelled account
 * numbers, e.g. "户号: 0755 3318 0458") · passport · name
 */
export type RedactionKind = 'email' | 'iban' | 'phone' | 'cn_id' | 'nik' | 'card' | 'account' | 'passport' | 'name'

interface Rule {
  kind: RedactionKind
  re: RegExp
  /**
   * replacement for a match, or null to leave it untouched (failed checksum / structure). `before` is the text
   * preceding the match on the same line (for rules that look for a nearby label).
   */
  replace: (match: string, before: string) => string | null
}

// Lookarounds use ASCII \w so CJK text right next to a number (卡号6222…) still matches.
const NB = '(?<![\\w+])'
const NA = '(?![\\w]|[.,]\\d)'

const MASK = '••••'

/** How far before a long number (same line) an account label still counts as "near". */
const LABEL_WINDOW = 48
/** Labels that make a long digit run an account / card number even when it fails Luhn. */
const ACCOUNT_LABEL = /(?:\b(?:accounts?|acct|a\/c|cards?|iban|rekening|no\.?\s*rek)\b|账号|帐号|卡号|账户|帐户|户号|银行卡)/i
/** 12–30 digit runs in groups of 3+ (spaces/dashes), so dates (2026-10-28) and grouped amounts never qualify. */
const LONG_DIGIT_RUN = /(?<![\w+.,¥$€£])\d{3,}(?:[ -]\d{3,})*(?:[ -]\d{1,4})?(?![\w]|[.,]\d)/g

function keepLast4(label: 'CARD' | 'ACCOUNT', digitsOf: string): string {
  return `[${label} ${MASK}${digitsOf.replace(/\D/g, '').slice(-4)}]`
}

/** Already-redacted placeholders are skipped by every later rule (so digits in "[CARD ••••1234]" stay put). */
const PLACEHOLDER = /(\[(?:EMAIL|PHONE|ID|NIK|PASSPORT|NAME|CARD ••••\d{4}|ACCOUNT ••••\d{4}|IBAN ••••[A-Z0-9]{4})\])/

const RULES: Rule[] = [
  {
    kind: 'email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    replace: () => '[EMAIL]',
  },
  {
    kind: 'iban',
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g,
    replace: (m) => {
      const compact = m.replace(/ /g, '')
      return isValidIban(compact) ? `[IBAN ${MASK}${compact.slice(-4)}]` : null
    },
  },
  {
    kind: 'phone',
    // international format: +<country> then digit groups
    re: new RegExp(`${NB}\\+\\(?\\d{1,4}\\)?(?:[ .-]?\\(?\\d{1,5}\\)?){1,6}(?!\\d)`, 'g'),
    replace: redactInternationalPhone,
  },
  {
    kind: 'phone',
    // mainland mobile 1[3-9]x xxxx xxxx with optional 86 / 0086 / +86 — runs before cards because
    // 0086 + mobile is 15 digits and can pass Luhn by chance
    re: new RegExp(`${NB}(?:(?:\\+|00)?86[ -]?)?1[3-9]\\d(?:[ -]?\\d{4}){2}${NA}`, 'g'),
    replace: () => '[PHONE]',
  },
  {
    kind: 'cn_id',
    re: new RegExp(`${NB}[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]${NA}`, 'g'),
    replace: () => '[ID]',
  },
  {
    kind: 'card',
    re: new RegExp(
      `${NB}(?:\\d{13,19}|\\d{4}([ -])\\d{4}(?:\\1\\d{4}){1,2}(?:\\1\\d{1,4})?|\\d{4}[ -]\\d{6}[ -]\\d{5})${NA}`,
      'g',
    ),
    replace: (m) => {
      const digits = m.replace(/\D/g, '')
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? `[CARD ${MASK}${digits.slice(-4)}]` : null
    },
  },
  {
    kind: 'nik',
    re: new RegExp(`${NB}(?:1[1-9]|[2-9]\\d)\\d{4}[0-7]\\d(?:0[1-9]|1[0-2])\\d{6}${NA}`, 'g'),
    replace: (m) => {
      const day = Number(m.slice(6, 8))
      const realDay = day > 40 ? day - 40 : day
      return realDay >= 1 && realDay <= 31 ? '[NIK]' : null
    },
  },
  {
    kind: 'account',
    // any 8–30 digit number right after an account label (bank or utility account, customer number)
    re: /(?:\b(?:account|acct|a\/c|customer)\s*(?:no\.?|number|num|#|id)?|户号|账号|帐号|卡号|账户|帐户|客户号|客户编号)\s*[:：#.]?\s*\d(?:[ -]?\d){7,29}(?![\w])/gi,
    replace: (m) => {
      const number = /\d(?:[ -]?\d){7,29}$/.exec(m)
      if (!number) return null
      const digits = number[0].replace(/\D/g, '')
      return `${m.slice(0, number.index)}[ACCOUNT ${MASK}${digits.slice(-4)}]`
    },
  },
  {
    kind: 'phone',
    // Indonesian mobile 08xx-xxxx-xxxx (or 62 8xx…)
    re: new RegExp(`${NB}(?:62|0)8\\d{1,2}[ -]?\\d{3,4}[ -]?\\d{3,5}${NA}`, 'g'),
    replace: (m) => (countDigits(m) >= 10 && countDigits(m) <= 14 ? '[PHONE]' : null),
  },
  {
    kind: 'phone',
    // mainland landline 0755-12345678
    re: new RegExp(`${NB}0\\d{2,3}-\\d{7,8}${NA}`, 'g'),
    replace: () => '[PHONE]',
  },
  {
    kind: 'passport',
    re: new RegExp(`${NB}[A-Z]{1,2}\\d{7,8}${NA}`, 'g'),
    replace: () => '[PASSPORT]',
  },
  {
    kind: 'account',
    // a long number (12+ digits) near an account / card label, Luhn or not: "to account at ICBC 6222 0212 3456 7890 123"
    re: LONG_DIGIT_RUN,
    replace: (m, before) => {
      const n = countDigits(m)
      return n >= 12 && n <= 30 && ACCOUNT_LABEL.test(before.slice(-LABEL_WINDOW)) ? keepLast4('ACCOUNT', m) : null
    },
  },
  {
    kind: 'card',
    // UnionPay BIN 62: any 16–19 digit run is a bank card / account number even when it fails Luhn
    re: new RegExp(`${NB}62(?:[ -]?\\d){14,17}${NA}`, 'g'),
    replace: (m) => {
      const n = countDigits(m)
      return n >= 16 && n <= 19 ? keepLast4('CARD', m) : null
    },
  },
]

/**
 * Mask PII before anything leaves the device: emails, phone numbers (CN mobile 1[3-9]x{9}, +country
 * formats), PRC resident ID (18 chars), Indonesian NIK (16 digits), passport-like ids, bank card numbers
 * (13–19 digits, Luhn-valid; keep last 4), IBANs, and any `extraNames` (e.g. the user's name) → [NAME].
 * Bank account numbers that fail Luhn are still masked (keep last 4) when they are 12+ digits near an account
 * label (account, acct, a/c, card, IBAN, rekening, 账号, 卡号, 账户…) or 16–19 digits starting with the UnionPay
 * BIN 62. Amounts like "¥2,000" or "2000.50" and dates must NOT be redacted.
 * Other long digit runs that fail every check (order numbers, timestamps) are left alone on purpose.
 */
export function redactText(text: string, extraNames: string[] = []): RedactionReport {
  return makeRedactor(extraNames)(text)
}

/** Deep-redact all string values in a JSON-like value. */
export function redactDeep<T>(value: T, extraNames: string[] = []): { value: T; counts: Record<string, number> } {
  const redact = makeRedactor(extraNames)
  const counts: Record<string, number> = {}
  const seen = new WeakMap<object, unknown>()
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redact(v)
      mergeCounts(counts, r.counts)
      return r.text
    }
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return seen.get(v)
    if (Array.isArray(v)) {
      const out: unknown[] = []
      seen.set(v, out)
      for (const item of v) out.push(walk(item))
      return out
    }
    if (!isPlainObject(v)) return v
    const out: Record<string, unknown> = {}
    seen.set(v, out)
    for (const [k, item] of Object.entries(v)) out[k] = walk(item)
    return out
  }
  return { value: walk(value) as T, counts }
}

function makeRedactor(extraNames: string[]): (text: string) => RedactionReport {
  const nameRules = buildNameRules(extraNames)
  return (text) => {
    const counts: Record<string, number> = {}
    let out = typeof text === 'string' ? text : String(text ?? '')
    for (const rule of [...RULES, ...nameRules]) out = applyRule(out, rule, counts)
    return { text: out, counts }
  }
}

function applyRule(text: string, rule: Rule, counts: Record<string, number>): string {
  return text
    .split(PLACEHOLDER)
    .map((segment, i) => {
      // odd indexes are captured placeholders
      if (i % 2 === 1) return segment
      return segment.replace(rule.re, (m: string, ...rest: unknown[]) => {
        // replace() passes (match, ...groups, offset, whole[, namedGroups])
        const offsetAt = rest.findIndex((x) => typeof x === 'number')
        const offset = offsetAt >= 0 ? (rest[offsetAt] as number) : 0
        const line = segment.slice(0, offset)
        const replacement = rule.replace(m, line.slice(line.lastIndexOf('\n') + 1))
        if (replacement === null) return m
        counts[rule.kind] = (counts[rule.kind] ?? 0) + 1
        return replacement
      })
    })
    .join('')
}

function buildNameRules(extraNames: string[]): Rule[] {
  const names = new Set<string>()
  for (const raw of extraNames ?? []) {
    if (typeof raw !== 'string') continue
    const full = raw.trim().replace(/\s+/g, ' ')
    if ([...full].length < 2) continue
    names.add(full)
    // parts of Latin names ("Mei" of "Mei Lin"); CJK names are matched whole only
    for (const part of full.split(' ')) if (part.length >= 3 && !hasHan(part)) names.add(part)
  }
  return [...names]
    .sort((a, b) => b.length - a.length)
    .map((name) => {
      const body = escapeRegExp(name).replace(/ /g, '\\s+')
      const pattern = hasHan(name) ? body : `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`
      return { kind: 'name' as const, re: new RegExp(pattern, 'giu'), replace: () => '[NAME]' }
    })
}

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** ISO 13616 mod-97 check. */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97
  }
  return rem === 1
}

/**
 * E.164 numbers have 8–15 digits. The pattern can over-run into a following number ("+62 812 3456 7890 2000"),
 * so fall back to the longest group-aligned prefix that is a plausible phone number.
 */
function redactInternationalPhone(m: string): string | null {
  for (let end = m.length; end > 0; end = lastSeparator(m, end)) {
    const n = countDigits(m.slice(0, end))
    if (n >= 8 && n <= 15) return `[PHONE]${m.slice(end)}`
    if (n < 8) return null
  }
  return null
}

function lastSeparator(s: string, before: number): number {
  for (let i = before - 1; i > 0; i--) if (s[i] === ' ' || s[i] === '.' || s[i] === '-') return i
  return 0
}

function countDigits(s: string): number {
  return s.replace(/\D/g, '').length
}

function hasHan(s: string): boolean {
  return /\p{Script=Han}/u.test(s)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isPlainObject(v: object): v is Record<string, unknown> {
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n
}

// ───────────────────────────── display masking (traces, chat, summaries) ─────────────────────────────

/**
 * Digit runs whose digits may be split by single spaces or dashes ("6222 0210 0112 3456 789"). Runs glued to
 * letters or underscores are identifiers ("pa_3f20135526478a", ISO timestamps), not account numbers.
 */
const DIGIT_RUN = /(?<![A-Za-z_\d])\d(?:[ -]?\d)+(?![A-Za-z_\d])/g
/** ISO dates are never account numbers ("2026-10-28"). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Mask every digit run of `minDigits`+ digits (account / card / phone numbers, however they are spaced) to its
 * last four: "6222 0210 0112 3456 789" → "•••• 6789". ISO dates and amounts written with thousands separators
 * or decimals ("¥12,080.24") are left alone. Meant for display surfaces (chat, glass-box traces, summaries);
 * redactText is the stricter pass for anything that leaves the device.
 */
export function maskDigitRuns(text: string, minDigits = 8): string {
  if (typeof text !== 'string' || !/\d/.test(text)) return typeof text === 'string' ? text : String(text ?? '')
  return text.replace(DIGIT_RUN, (run, offset: number, whole: string) => {
    const digits = run.replace(/\D/g, '')
    if (digits.length < minDigits) return run
    // a date (optionally followed by an hour) keeps its date part
    const date = run.slice(0, 10)
    if (ISO_DATE.test(date) && (run.length === 10 || /^[ -]/.test(run.slice(10)))) {
      const rest = run.slice(10)
      return date + (rest.replace(/\D/g, '').length >= minDigits ? rest.replace(/\d(?:[ -]?\d)+/, (r) => `•••• ${r.replace(/\D/g, '').slice(-4)}`) : rest)
    }
    // part of a decimal / grouped amount ("12,345,678.90" never reaches here as one run, but "12345678.90" does)
    if (whole[offset + run.length] === '.' && /\d/.test(whole[offset + run.length + 1] ?? '')) return run
    return `•••• ${digits.slice(-4)}`
  })
}

/** Shorten untrusted or long text for display: masked digit runs, collapsed whitespace, at most `max` chars. */
export function clipForDisplay(text: string, max = 160): string {
  const clean = maskDigitRuns(String(text ?? '')).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 1)).trimEnd()}…` : clean
}
