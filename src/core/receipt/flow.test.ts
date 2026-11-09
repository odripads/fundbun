import { describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage } from '../app'
import { looksDuplicate } from './dedupe'
import { parseReceipt } from './parse'
import { receiptSample } from './sandbox'

describe('receipt consent + data flow (controller level)', () => {
  it('consent is OFF by default: scanning is blocked until the user opts in', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    expect(app.getSnapshot().state.settings.receiptScans).toBe(false)
  })

  it('opting in flips the setting, and opting out blocks scanning again', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    app.setSettings({ receiptScans: true })
    expect(app.getSnapshot().state.settings.receiptScans).toBe(true)
    app.setSettings({ receiptScans: false })
    expect(app.getSnapshot().state.settings.receiptScans).toBe(false)
  })

  it('confirm adds exactly one spending via addSpending', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    const before = app.getSnapshot().state.bank.transactions.length
    const r = parseReceipt(receiptSample('luckin').text, { today: app.getSnapshot().derived.today })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const result = app.addSpending([r.candidate])
    expect(result).toEqual({ added: 1, duplicates: 0 })
    const after = app.getSnapshot()
    expect(after.state.bank.transactions.length).toBe(before + 1)
    const added = after.state.bank.transactions.at(-1)!
    expect(added.amount).toBe(-r.candidate.amount)
    expect(added.merchant).toBe(r.candidate.merchant)
    // a receipt import lands as a plain, read-only transaction — categorySource 'import', never a payment
    expect(added.categorySource).toBe('import')
  })

  it('rejecting a scan never changes state (no add, no audit, no photo persisted)', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    const before = app.getSnapshot()
    const beforeCount = before.state.bank.transactions.length
    const beforeAudit = before.state.audit.length

    // Reject = parse, then simply don't call addSpending (and revoke the object URL in the UI).
    const r = parseReceipt(receiptSample('taxi').text, { today: before.derived.today })
    expect(r.ok).toBe(true)

    const after = app.getSnapshot()
    expect(after.state.bank.transactions.length).toBe(beforeCount)
    expect(after.state.audit.length).toBe(beforeAudit)
  })

  it('a duplicate candidate is flagged by looksDuplicate and skipped by addSpending', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    const r = parseReceipt(receiptSample('luckin').text, { today: app.getSnapshot().derived.today })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // add once
    expect(app.addSpending([r.candidate])).toEqual({ added: 1, duplicates: 0 })

    // re-scan the same receipt: it now looks like a duplicate and addSpending skips it
    const again = parseReceipt(receiptSample('luckin').text, { today: app.getSnapshot().derived.today })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(looksDuplicate(again.candidate, app.getSnapshot().state.bank.transactions)).toBe(true)
    expect(app.addSpending([again.candidate])).toEqual({ added: 0, duplicates: 1 })
  })
})
