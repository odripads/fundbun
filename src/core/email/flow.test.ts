import { describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../app'
import { checkInbox, processInbox } from './flow'
import { sandboxEmailSource } from './sandbox'
import type { EmailMessage, EmailSource } from './types'

const candidate = () => ({
  id: 'e1',
  merchant: 'FundBun Test Shop',
  amount: 1234,
  currency: 'CNY' as const,
  date: '2026-09-01',
  category: 'shopping' as const,
  description: 'test purchase',
  source: 'email' as const,
})

describe('checkInbox', () => {
  it('consent OFF → never fetches', async () => {
    const fetch = vi.fn<EmailSource['fetch']>().mockResolvedValue([])
    const source: EmailSource = { id: 'x', name: 'X', kind: 'sandbox', available: true, fetch }
    expect(await checkInbox(source, { consent: false })).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('consent ON → processes the sandbox mailbox into candidates and flags the malicious one', async () => {
    const result = await checkInbox(sandboxEmailSource, { consent: true })
    expect(result).not.toBeNull()
    expect(result!.total).toBe(7)
    expect(result!.allowed).toBe(7)
    expect(result!.ignored).toBe(0)
    expect(result!.flagged.map((f) => f.message.id)).toEqual(['sandbox-malicious'])
    // 6 good emails → 8 spending items, none of them the transfer
    expect(result!.candidates).toHaveLength(8)
    expect(result!.candidates.some((c) => c.amount === 500000)).toBe(false)
  })

  it('ignores non-allow-listed senders', () => {
    const foreign: EmailMessage = {
      id: 'foreign-1',
      from: 'noreply@newsletter.example',
      subject: 'Your weekly deals',
      date: '2026-09-01T00:00:00+08:00',
      source: 'sandbox',
      body: '付款金额：¥999.00\n收款方：Shop\n支付时间：2026-09-01 10:00',
    }
    // one allow-listed email + one foreign email → the foreign one is dropped, the good one parsed
    const good: EmailMessage = { ...foreign, id: 'good-1', from: '支付宝 <service@alipay.com>' }
    const r = processInbox([good, foreign])
    expect(r.ignored).toBe(1)
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].merchant).toBe('Shop')
  })
})

describe('addSpending dedupe', () => {
  it('skips duplicates on a re-add', () => {
    const app = createTestApp()
    app.loadDemo('mei')
    expect(app.addSpending([candidate()])).toEqual({ added: 1, duplicates: 0 })
    expect(app.addSpending([candidate()])).toEqual({ added: 0, duplicates: 1 })
    expect(app.getSnapshot().state.bank.transactions.filter((t) => t.merchant === 'FundBun Test Shop')).toHaveLength(1)
  })
})

describe('end-to-end inbox → confirm', () => {
  it('a malicious email never becomes an action, and confirm adds only the good spendings', async () => {
    const app = createTestApp()
    app.loadDemo('mei')
    const balance = app.getSnapshot().state.bank.accounts.find((a) => a.type === 'checking')!.balance

    const result = (await checkInbox(sandboxEmailSource, { consent: true }))!
    // the user confirms the candidates — the malicious email produced none
    const { added, duplicates } = app.addSpending(result.candidates)

    expect(added).toBe(result.candidates.length)
    expect(duplicates).toBe(0)
    const after = app.getSnapshot()
    // reading emails never moves money: the balance is untouched
    expect(after.state.bank.accounts.find((a) => a.type === 'checking')!.balance).toBe(balance)
    expect(after.state.pending).toHaveLength(0)
    expect(after.state.bank.transactions.some((t) => t.amount === -500000)).toBe(false)
  })
})
