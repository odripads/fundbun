/**
 * The allowlist of bank / payment-application sender domains that AUTO mode will ever open.
 *
 * Only an email whose sender address (not its display name) matches this list is parsed. The display name is
 * deliberately ignored: a forged "招商银行 <attacker@evil.com>" fails because the address, not the label, is
 * what is checked.
 */

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
]

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return (at >= 0 ? address.slice(at + 1) : '').toLowerCase()
}

function allowedDomain(domain: string): boolean {
  if (!domain) return false
  return ALLOWED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/**
 * True when `from` carries an email address whose domain is allow-listed. The free-text display name is never
 * trusted: only the address counts.
 */
export function isAllowedSender(from: string): boolean {
  if (typeof from !== 'string' || !from.trim()) return false
  const addresses = from.match(EMAIL_RE)
  if (!addresses || addresses.length === 0) return false
  return addresses.some((a) => allowedDomain(domainOf(a)))
}
