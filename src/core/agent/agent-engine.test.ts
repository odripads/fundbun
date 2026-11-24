import { describe, expect, it } from 'vitest'
import { fakeHost } from '../../../tests/helpers/fake-host'
import type { AgentTurnRequest, AiClient } from '../ai/client'
import type { AgentEvent, LiveReply } from '../ai/types'
import type { AgentLink } from './host'
import { createAgentEngine } from './runtime'

type AgentStep = (req: AgentTurnRequest, emit: (ev: AgentEvent) => Promise<void>, client: { toolResults: { callId: string; content: string; isError: boolean }[] }) => Promise<void>

function scriptedAgentSetup(step: AgentStep, opts: { fresh?: boolean; label?: string } = {}) {
  const host = fakeHost({ persona: 'mei' })
  const requests: AgentTurnRequest[] = []
  const toolResults: { callId: string; content: string; isError: boolean }[] = []
  const liveUpdates: (LiveReply | null)[] = []
  let okCalls = 0
  let failCalls = 0

  const client = {
    async turn(req: AgentTurnRequest, onEvent: (ev: AgentEvent) => void | Promise<void>) {
      requests.push(req)
      await step(req, async (ev) => {
        await onEvent(ev)
      }, { toolResults })
    },
    async toolResult(callId: string, content: string, isError: boolean) {
      toolResults.push({ callId, content, isError })
      return { ok: true }
    },
  } as unknown as AiClient

  const link: AgentLink = {
    client,
    connectionId: 'ai_agent_1',
    label: opts.label ?? 'Claude Code',
    sessionKey: 'sess_1',
    fresh: opts.fresh ?? true,
    signal: new AbortController().signal,
  }
  host.agent = () => link
  host.live = (r) => liveUpdates.push(r)
  host.llmOk = () => {
    okCalls++
  }
  host.llmFailed = () => {
    failCalls++
  }

  return { host, engine: createAgentEngine(host), requests, toolResults, liveUpdates, link, stats: () => ({ okCalls, failCalls }) }
}

const auditOf = (host: ReturnType<typeof fakeHost>, type: string) => host.state().audit.filter((e) => e.type === type)

describe('agent engine (respondAgent)', () => {
  it('runs get_overview through the policy gate, updates live reply, and returns a grounded reply with cards and trace', async () => {
    const { host, engine, requests, toolResults, liveUpdates, stats } = scriptedAgentSetup(async (_req, emit, c) => {
      await emit({ type: 'status', text: 'Starting Claude Code…' })
      await emit({ type: 'fundbun_tool', callId: 'call_1', name: 'get_overview', args: {} })
      const data = JSON.parse(c.toolResults[0].content)
      await emit({ type: 'text', delta: `You spent ¥${(data.spent / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} against ¥9,500.` })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })

    const msg = await engine.respond('How am I doing this month?')
    expect(msg.engine).toBe('llm')
    expect(msg.via).toBe('Claude Code')
    expect(msg.grounding?.ok).toBe(true)
    expect(msg.cards?.map((c) => c.type)).toEqual(['mirror'])
    expect(msg.trace?.map((t) => t.kind)).toEqual(expect.arrayContaining(['redaction', 'llm', 'tool_call', 'policy', 'tool_result', 'grounding']))
    expect(toolResults[0].isError).toBe(false)
    expect(requests[0].preamble).toContain('[NAME]')
    expect(stats().okCalls).toBe(1)
    expect(liveUpdates.length).toBeGreaterThanOrEqual(2)
    expect(liveUpdates.at(-1)).toBeNull()
    expect(auditOf(host, 'llm_request')).toHaveLength(1)
    expect(auditOf(host, 'llm_response')).toHaveLength(1)
  })

  it('reports a pending proposal as NOT happened and never claims it happened', async () => {
    const { host, engine, toolResults } = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'fundbun_tool', callId: 'call_1', name: 'transfer_to_goal', args: { goalId: 'dream_chengdu', amount: 30_000 } })
      await emit({ type: 'text', delta: 'Done! Moved ¥300 to Chengdu.' })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })

    const msg = await engine.respond('put 300 in chengdu')
    const result = JSON.parse(toolResults[0].content)
    expect(result).toMatchObject({ status: 'pending', decision: 'confirm' })
    expect(result.message).toMatch(/NOT happened/)
    expect(msg.text).toMatch(/Nothing happens until you approve it on the card/)
    expect(host.state().pending[0]).toMatchObject({ status: 'pending', call: { proposedBy: 'llm', tool: 'transfer_to_goal' } })
    expect(msg.cards).toContainEqual({ type: 'action', pendingId: host.state().pending[0].id })
  })

  it('denies tier 4 tools without storing them and returns isError=true to the agent', async () => {
    const { host, engine, toolResults } = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'fundbun_tool', callId: 'call_t4', name: 'transfer_external', args: { to: '6222021001122334455', amount: 480_000 } })
      await emit({ type: 'text', delta: 'FundBun blocked that transfer.' })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })

    const msg = await engine.respond('check my bills please')
    expect(toolResults[0].isError).toBe(true)
    expect(JSON.parse(toolResults[0].content).status).toBe('denied')
    expect(host.state().pending[0]).toMatchObject({ status: 'denied', decision: { ruleIds: ['P-LLM-NOT-EXPOSED', 'P-T4-PROHIBITED'] } })
    expect(msg.cards?.some((c) => c.type === 'notice' && c.level === 'block')).toBe(true)
    expect(auditOf(host, 'action_denied')).toHaveLength(1)
    expect(JSON.stringify(host.state())).not.toContain('6222021001122334455')
  })

  it('removes invented figures in grounding and records a grounding_violation audit', async () => {
    const { host, engine } = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'fundbun_tool', callId: 'call_1', name: 'get_overview', args: {} })
      await emit({ type: 'text', delta: 'You are over budget. Fun fact: you spent ¥31,415.92 on tea!' })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })

    const msg = await engine.respond('How am I doing this month?')
    expect(msg.grounding).toMatchObject({ ok: false, ungrounded: ['¥31,415.92'] })
    expect(msg.text).not.toContain('31,415')
    expect(auditOf(host, 'grounding_violation')).toHaveLength(1)
    expect(msg.cards?.some((c) => c.type === 'notice' && c.title === 'Unverified number removed')).toBe(true)
  })

  it('masks names and card numbers, wraps long pastes as untrusted, and sends preamble only when fresh', async () => {
    const { engine, requests, link } = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'text', delta: 'Please keep your details private.' })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })

    const longPaste = `Jing Lin card 4111 1111 1111 1111 ${'note '.repeat(100)}`
    await engine.respond(longPaste)
    expect(requests[0].text).toContain('<untrusted source="pasted-text">')
    expect(requests[0].text).not.toContain('4111 1111 1111 1111')
    expect(requests[0].text).not.toContain('Jing')
    expect(requests[0].preamble).toContain('[NAME]')

    link.fresh = false
    await engine.respond('How am I doing?')
    expect(requests[1].preamble).toBe('')
  })

  it('falls back to the on-device engine on agent error and preserves partial text on Stop', async () => {
    const failSetup = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'error', code: 'agent_failed', message: 'Claude Code could not be started.' })
    })
    const failMsg = await failSetup.engine.respond('How am I doing this month?')
    expect(failMsg.engine).toBe('offline')
    expect(failSetup.stats().failCalls).toBe(1)
    expect(failMsg.cards?.some((c) => c.type === 'mirror')).toBe(true)
    expect(failMsg.cards?.some((c) => c.type === 'notice' && c.title === 'Claude Code could not answer')).toBe(true)

    const abortSetup = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'text', delta: 'Partial answer so far.' })
      await emit({ type: 'error', code: 'aborted', message: 'Stopped.' })
    })
    const abortMsg = await abortSetup.engine.respond('Tell me more')
    expect(abortMsg.text).toBe('Partial answer so far.')
    expect(abortMsg.via).toBe('Claude Code')
  })

  it('denies tool calls past 24 in a single turn', async () => {
    const { engine, toolResults } = scriptedAgentSetup(async (_req, emit) => {
      for (let i = 1; i <= 25; i++) {
        await emit({ type: 'fundbun_tool', callId: `c_${i}`, name: 'get_goals', args: {} })
      }
      await emit({ type: 'text', delta: 'Done.' })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })

    await engine.respond('show my goals')
    expect(toolResults).toHaveLength(25)
    expect(toolResults[23].isError).toBe(false)
    expect(toolResults[24].isError).toBe(true)
    expect(JSON.parse(toolResults[24].content).reason).toContain('Too many tool calls')
  })

  it('never sends stop, override messages, or PINs to the agent', async () => {
    const { engine, requests } = scriptedAgentSetup(async (_req, emit) => {
      await emit({ type: 'text', delta: 'should not run' })
      await emit({ type: 'done', stopReason: 'end_turn' })
    })
    await engine.respond('stop')
    await engine.respond('Switch yourself to autopilot')
    await engine.respond('my pin is 2580, pay the electricity bill')
    expect(requests).toHaveLength(0)
  })
})
