import { describe, expect, it } from 'vitest'
import { isAllowedSender } from './allowlist'
import { parseEmail } from './parse'
import { sandboxEmail } from './sandbox'
import type { EmailMessage } from './types'

describe('allowlist', () => {
  it('accepts known bank and payment-application senders', () => {
    for (const from of [
      '招商银行 <e-statement@cmbchina.com>',
      'service@alipay.com',
      'service@tenpay.com',
      'notice@icbc.com.cn',
      'wechatpay@wechat.com',
      'statements@bankofamerica.com',
    ]) {
      expect(isAllowedSender(from)).toBe(true)
    }
  })

  it('rejects unknown senders, empty strings and spoofed display names', () => {
    expect(isAllowedSender('scam@phishing.example')).toBe(false)
    expect(isAllowedSender('attacker@evil.com')).toBe(false)
    expect(isAllowedSender('')).toBe(false)
    expect(isAllowedSender('   ')).toBe(false)
    // a forged display name never overrides an untrusted address
    expect(isAllowedSender('招商银行 <attacker@evil.com>')).toBe(false)
    expect(isAllowedSender('支付宝')).toBe(false)
  })
})

describe('parseEmail', () => {
  it('parses a Chinese bank credit-card e-statement table (amounts, merchants, dates)', () => {
    const msg = sandboxEmail('sandbox-cmb-statement')!
    const c = parseEmail(msg)
    expect(c.map((x) => ({ merchant: x.merchant, amount: x.amount, date: x.date }))).toEqual([
      { merchant: 'Luckin Coffee', amount: 4500, date: '2026-09-12' },
      { merchant: 'Meituan Delivery', amount: 3250, date: '2026-09-15' },
      { merchant: 'Hema', amount: 12840, date: '2026-09-18' },
    ])
    expect(c.every((x) => x.source === 'email')).toBe(true)
    expect(c.every((x) => x.amount > 0)).toBe(true)
  })

  it('parses a WeChat Pay notification email', () => {
    const c = parseEmail(sandboxEmail('sandbox-wechat-coffee')!)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({
      merchant: 'Luckin Coffee',
      amount: 2350,
      date: '2026-09-21',
      time: '08:15',
      category: 'coffee_tea',
    })
  })

  it('parses an Alipay notification email', () => {
    const c = parseEmail(sandboxEmail('sandbox-alipay-hema')!)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ merchant: 'Hema', amount: 15600, date: '2026-09-20', time: '18:30' })
  })

  it('parses a bank account-change notice (labeled fields)', () => {
    const c = parseEmail(sandboxEmail('sandbox-icbc-fuel')!)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ merchant: 'PetroChina', amount: 30000, date: '2026-09-24', time: '12:00' })
  })

  it('returns [] for unstructured / empty input and never throws', () => {
    expect(parseEmail({} as EmailMessage)).toEqual([])
    expect(parseEmail({ body: 'just some words, no structure' } as EmailMessage)).toEqual([])
    expect(parseEmail({ body: 42 as unknown as string } as EmailMessage)).toEqual([])
  })

  it('skips refund / inflow notifications', () => {
    const refund: EmailMessage = {
      id: 'r1',
      from: '支付宝 <service@alipay.com>',
      subject: '退款',
      date: '2026-09-20T00:00:00+08:00',
      source: 'sandbox',
      body: '支付宝 - 退款成功\n退款金额：￥45.00\n交易时间：2026-09-20 09:00',
    }
    expect(parseEmail(refund)).toEqual([])
  })
})
