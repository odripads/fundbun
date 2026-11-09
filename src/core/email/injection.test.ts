import { describe, expect, it } from 'vitest'
import { createTestApp } from '../app'
import { parseEmail } from './parse'
import { sandboxEmail } from './sandbox'
import { scanEmail } from './scan'

const malicious = () => sandboxEmail('sandbox-malicious')!

describe('injection: the malicious email', () => {
  it('is flagged by the scanner', () => {
    const report = scanEmail(malicious())
    expect(report.suspicious).toBe(true)
    expect(report.score).toBeGreaterThanOrEqual(0.5)
    expect(report.signals).toContain('instruction-override')
    expect(report.signals).toContain('payment-instruction')
  })

  it('parses to nothing (no candidate, no transfer)', () => {
    expect(parseEmail(malicious())).toEqual([])
  })

  it('never becomes an action or moves money — verified through the controller', () => {
    const app = createTestApp()
    app.loadDemo('mei')
    const before = app.getSnapshot().state.bank.accounts.find((a) => a.type === 'checking')!.balance
    const txnCountBefore = app.getSnapshot().state.bank.transactions.length

    // the UI would only call addSpending with CONFIRMED candidates; a confirmed set can never include the
    // malicious email because it parses to nothing — but even if we tried, a SpendingCandidate is not an action
    app.addSpending(parseEmail(malicious()))

    const after = app.getSnapshot()
    expect(after.state.bank.accounts.find((a) => a.type === 'checking')!.balance).toBe(before)
    expect(after.state.bank.transactions.length).toBe(txnCountBefore)
    // no payment / pending action was created, and the ¥5000 transfer never landed
    expect(after.state.pending).toHaveLength(0)
    expect(after.state.bank.transactions.some((t) => t.amount === -500000)).toBe(false)
  })
})
