import { describe, expect, it } from 'vitest'
import { fakeHost, lastToolResult, llmText, llmTool, scriptedLlm } from '../../../tests/helpers/fake-host'
import { createAgentEngine } from './runtime'

/** log_spending: an AI that read a receipt or an order email adds the purchase, through the same gate as every tool. */
function setup(steps: Parameters<typeof scriptedLlm>[0]) {
  const host = fakeHost({ persona: 'mei' })
  const llm = scriptedLlm(steps)
  host.setLlm(llm.client)
  return { host, llm, engine: createAgentEngine(host) }
}

const coffee = { merchant: 'Luckin Coffee', amount: 1_800, category: 'coffee_tea', source: 'email' }

describe('log_spending', () => {
  it('is proposed, waits for approval, then adds the purchase; undo removes it', async () => {
    const { host, llm, engine } = setup([llmTool('log_spending', { ...coffee, date: host0Today() }), llmText('I found it and set it up for you to approve.')])
    const before = host.state().bank.transactions.length
    await engine.respond('Add the Luckin coffee I bought today')
    const result = JSON.parse(lastToolResult(llm.requests[1])!.content)
    expect(result.status).toBe('pending')
    const p = host.state().pending[0]
    expect(p).toMatchObject({ status: 'pending', call: { tool: 'log_spending', proposedBy: 'llm' } })
    expect(p.preview.title).toBe('Log Luckin Coffee')
    expect(host.state().bank.transactions).toHaveLength(before)

    const ok = await engine.approve(p.id)
    expect(ok.ok).toBe(true)
    const added = host.state().bank.transactions.filter((t) => t.merchant === 'Luckin Coffee' && t.amount === -1_800)
    expect(added).toHaveLength(1)
    expect(added[0].id).toMatch(/^em_ai/)

    expect(engine.undo(p.id).ok).toBe(true)
    expect(host.state().bank.transactions).toHaveLength(before)
  })

  it('refuses a future date, a non-spending category and a missing source before anything is proposed', async () => {
    for (const bad of [
      { ...coffee, date: '2099-01-01' },
      { ...coffee, date: host0Today(), category: 'income' },
      { merchant: 'X', amount: 100, category: 'coffee_tea', date: host0Today() },
    ]) {
      const { host, llm, engine } = setup([llmTool('log_spending', bad), llmText('ok')])
      await engine.respond('log it')
      const result = JSON.parse(lastToolResult(llm.requests[1])!.content)
      expect(result.status === 'denied' || result.status === 'failed').toBe(true)
      expect(host.state().bank.transactions.some((t) => t.merchant === 'Luckin Coffee' && t.date === '2099-01-01')).toBe(false)
    }
  })
})

/** The persona's sandbox "today" (the fake host's clock is the bank's). */
function host0Today(): string {
  return fakeHost({ persona: 'mei' }).state().bank.today
}
