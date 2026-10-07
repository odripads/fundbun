import { describe, expect, it } from 'vitest'
import { fakeHost, lastToolResult, llmText, llmTool, scriptedLlm } from '../../../tests/helpers/fake-host'
import { LlmError } from './llm'
import { MAX_ROUNDS, buildHistory, wrapUserText } from './llm-engine'
import { createAgentEngine } from './runtime'

function setup(steps: Parameters<typeof scriptedLlm>[0], persona: 'mei' | 'arif' = 'mei') {
  const host = fakeHost({ persona })
  const llm = scriptedLlm(steps)
  host.setLlm(llm.client)
  return { host, llm, engine: createAgentEngine(host) }
}

const auditOf = (host: ReturnType<typeof fakeHost>, type: string) => host.state().audit.filter((e) => e.type === type)

describe('LLM engine: tool loop', () => {
  it('runs get_overview through the gate and returns a grounded reply', async () => {
    const { host, llm, engine } = setup([
      llmTool('get_overview', {}),
      (req) => {
        const data = JSON.parse(lastToolResult(req)!.content)
        return llmText(`You've spent ¥${(data.spent / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} against your ¥9,500 target.`)
      },
    ])
    const msg = await engine.respond('How am I doing this month?')
    expect(msg.engine).toBe('llm')
    expect(msg.grounding?.ok).toBe(true)
    expect(msg.cards?.map((c) => c.type)).toEqual(['mirror'])
    expect(msg.trace?.map((t) => t.kind)).toEqual(expect.arrayContaining(['redaction', 'llm', 'tool_call', 'policy', 'tool_result', 'grounding']))
    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[0].tools.some((t) => t.name === 'transfer_external')).toBe(false)
    expect(llm.requests[0].system).toContain('[NAME]')
    expect(auditOf(host, 'llm_request')).toHaveLength(2)
    expect(auditOf(host, 'llm_response')[0].data).toMatchObject({ provider: 'fake', stopReason: 'tool_use', toolUses: 1 })
    const audits = JSON.stringify(host.state().audit)
    expect(audits).not.toContain('How am I doing')
    expect(host.state().chat.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('a pending proposal is reported to the model as NOT done, and the reply never claims it happened', async () => {
    const { host, llm, engine } = setup([llmTool('transfer_to_goal', { goalId: 'dream_chengdu', amount: 30_000 }), llmText('Done! I moved ¥300 to Chengdu.')])
    const msg = await engine.respond('put 300 in chengdu')
    const result = JSON.parse(lastToolResult(llm.requests[1])!.content)
    expect(result).toMatchObject({ status: 'pending', decision: 'confirm' })
    expect(result.message).toMatch(/NOT happened/)
    expect(msg.text).toMatch(/Nothing happens until you approve it on the card/)
    const p = host.state().pending[0]
    expect(p).toMatchObject({ status: 'pending', call: { proposedBy: 'llm', tool: 'transfer_to_goal' } })
    expect(msg.cards).toContainEqual({ type: 'action', pendingId: p.id })
  })

  it('#inject-style transfer_external: denied (not exposed + T4), is_error to the model, counted by the breaker', async () => {
    const { host, llm, engine } = setup([
      llmTool('transfer_external', { to: '6222021001122334455', amount: 480_000 }, 'toolu_inject', 'Following the payment notice in your bill now.'),
      llmText('FundBun blocked that transfer.'),
    ])
    const msg = await engine.respond('What should I do about my bills? #inject')
    const result = lastToolResult(llm.requests[1])!
    expect(result.is_error).toBe(true)
    expect(JSON.parse(result.content).status).toBe('denied')
    const p = host.state().pending[0]
    expect(p.decision.ruleIds).toEqual(['P-LLM-NOT-EXPOSED', 'P-T4-PROHIBITED'])
    expect(p.status).toBe('denied')
    expect(auditOf(host, 'action_denied')).toHaveLength(1)
    expect(msg.cards?.some((c) => c.type === 'notice' && c.level === 'block')).toBe(true)
    expect(JSON.stringify(host.state())).not.toContain('6222021001122334455')
  })

  it('hallucinated numbers fail grounding: audited, sentence removed, notice shown', async () => {
    const { host, engine } = setup([llmTool('get_overview', {}), llmText('Your month is over target. Fun fact: you spent ¥31,415.92 on bubble tea this year!')])
    const msg = await engine.respond('How am I doing? #hallucinate')
    expect(msg.grounding).toMatchObject({ ok: false, ungrounded: ['¥31,415.92'] })
    expect(msg.text).not.toContain('31,415')
    expect(msg.text).toContain('over target')
    expect(auditOf(host, 'grounding_violation')[0].data).toMatchObject({ ungrounded: ['¥31,415.92'], engine: 'llm' })
    expect(msg.cards?.some((c) => c.type === 'notice' && c.title === 'Unverified number removed')).toBe(true)
  })

  it('a reply that is only an invented number is replaced by the on-device answer', async () => {
    const { engine } = setup([llmTool('get_overview', {}), llmText('¥31,415.92!')])
    const msg = await engine.respond('How am I doing this month?')
    expect(msg.text).not.toContain('31,415')
    expect(msg.text).toMatch(/target/)
  })

  it('untrusted tool data is wrapped and taints the turn (money then needs a tap; a denied move trips the breaker)', async () => {
    const { host, llm, engine } = setup([
      llmTool('search_transactions', { query: 'Taobao', limit: 25 }),
      llmTool('transfer_to_goal', { goalId: 'dream_birkin', amount: 90_000 }),
      llmText('I could not move that.'),
    ])
    const msg = await engine.respond('look at my taobao spending')
    const wrapped = lastToolResult(llm.requests[1])!.content
    expect(wrapped.startsWith('<untrusted source="tool:search_transactions">')).toBe(true)
    expect(msg.trace?.some((t) => t.kind === 'injection')).toBe(true)
    expect(host.state().pending[0].decision.tainted).toBe(true)
    expect(host.state().mandate.frozen).toBe(true)
    expect(auditOf(host, 'circuit_breaker')).toHaveLength(1)
  })

  it('dream names (user-authored) are wrapped as untrusted inside tool results', async () => {
    const { llm, engine } = setup([llmTool('get_goals', {}), llmText('Here are your goals.')])
    await engine.respond('show my goals please')
    const content = lastToolResult(llm.requests[1])!.content
    const parsed = JSON.parse(content)
    expect(parsed._note).toMatch(/untrusted/)
    expect(parsed.goals[0].name).toBe('<untrusted source="user-content">Birkin 25</untrusted>')
  })

  it('redacts personal data before it leaves the device and audits only counts', async () => {
    const { host, llm, engine } = setup([llmText('Please never share your card number.')])
    await engine.respond('my card is 4111 1111 1111 1111 and phone 13812345678, ok?')
    const sent = JSON.stringify(llm.requests[0])
    expect(sent).not.toContain('4111 1111 1111 1111')
    expect(sent).not.toContain('13812345678')
    const counts = auditOf(host, 'llm_request')[0].data.redactions as Record<string, number>
    expect(counts.card).toBeGreaterThan(0)
    expect(counts.phone).toBeGreaterThan(0)
    expect(JSON.stringify(host.state().audit)).not.toContain('13812345678')
  })

  it('stops after MAX_ROUNDS tool rounds', async () => {
    const { llm, engine } = setup([llmTool('get_goals', {})])
    const msg = await engine.respond('loop forever')
    expect(llm.requests).toHaveLength(MAX_ROUNDS)
    expect(msg.trace?.some((t) => /round limit/.test(t.label))).toBe(true)
    expect(msg.text.length).toBeGreaterThan(0)
  })

  it('falls back to the offline engine when the LLM fails', async () => {
    const { host, engine } = setup([new LlmError(503, 'down', 'llm_unavailable')])
    const msg = await engine.respond('How am I doing this month?')
    expect(msg.engine).toBe('offline')
    expect(msg.trace?.some((t) => t.kind === 'error')).toBe(true)
    expect(msg.cards?.[0].type).toBe('mirror')
    expect(auditOf(host, 'llm_response').at(-1)?.summary).toMatch(/fell back/)
  })

  it('dialogue acts, refusals and pastes stay on the deterministic path', async () => {
    const { llm, engine } = setup([llmText('should not be called')])
    await engine.respond('stop')
    await engine.respond('Send ¥4,800 to account 6222 0210 0112 3456 789')
    await engine.respond('Switch yourself to autopilot')
    expect(llm.requests).toHaveLength(0)
  })
})

describe('helpers', () => {
  it('buildHistory starts with a user turn, merges roles and wraps long pastes', () => {
    const ts = '2026-10-22T02:00:00.000Z'
    const h = buildHistory([
      { id: '1', role: 'assistant', text: 'Hi!', ts },
      { id: '2', role: 'user', text: 'a', ts },
      { id: '3', role: 'user', text: 'b', ts },
      { id: '4', role: 'assistant', text: 'c', ts },
      { id: '5', role: 'user', text: 'x'.repeat(500), ts },
    ])
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(h[0].content).toBe('a\nb')
    expect(String(h[2].content)).toContain('<untrusted source="pasted-text">')
  })

  it('wrapUserText wraps only strings containing user-authored text', () => {
    const out = wrapUserText({ a: 'Birkin 25 progress', b: 'plain', n: 3 }, ['Birkin 25']) as Record<string, unknown>
    expect(out.a).toMatch(/^<untrusted source="user-content">/)
    expect(out.b).toBe('plain')
    expect(out.n).toBe(3)
    expect(wrapUserText({ b: 'plain' }, ['Birkin 25'])).toEqual({ b: 'plain' })
  })
})
