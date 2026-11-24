import { describe, expect, it } from 'vitest'
import { fakeHost, llmText, llmTool, scriptedLlm } from '../../../tests/helpers/fake-host'
import { ON_DEVICE_TIMEOUT_MS, OWN_MODEL_TIMEOUT_MS } from './llm-engine'
import { buildAgentPreamble, buildSystemPrompt, type SystemPromptInput } from './prompts'
import { createAgentEngine } from './runtime'

const BASE: SystemPromptInput = { name: 'Jing Lin', currency: 'CNY', today: '2026-10-22', tone: 'cheeky', autonomy: 'copilot' }

describe('open mode (bring your own AI)', () => {
  it('adds the Beyond money section only when open=true and in agent preambles', () => {
    const closed = buildSystemPrompt({ ...BASE, open: false })
    expect(closed).not.toContain('## Beyond money')
    expect(closed).toContain('Keep every reply under 90 words')

    const open = buildSystemPrompt({ ...BASE, open: true })
    expect(open).toContain('## Beyond money')
    expect(open).toContain("About the user's money: keep every reply under 90 words")
    expect(open).toContain('Markdown (lists, code blocks) is fine')

    const preamble = buildAgentPreamble({ ...BASE, open: true })
    expect(preamble).toContain('## Beyond money')
    expect(preamble).toContain('Write without em dashes')
  })

  it('marks Markdown answers with code as rich, preserves code indentation, and ignores non-money numbers in general answers', async () => {
    const codeReply = [
      'Here is a splitter for 3 friends (step 1 of 2):',
      '',
      '```python',
      'def split_bill(total_cents, people=4):',
      '    per_person = total_cents / people',
      '    return round(per_person, 2)',
      '```',
    ].join('\n')

    const host = fakeHost({ persona: 'mei' })
    const llm = scriptedLlm([llmText(codeReply)])
    host.setLlm(llm.client)
    host.llmInfo = () => ({ local: true, label: 'DeepSeek', onDevice: false })
    const engine = createAgentEngine(host)

    const msg = await engine.respond('Write a Python function that splits a bill')
    expect(msg.via).toBe('DeepSeek')
    expect(msg.rich).toBe(true)
    expect(msg.grounding?.ok).toBe(true)
    expect(msg.text).toContain('    per_person = total_cents / people')
    expect(msg.text).toContain('    return round(per_person, 2)')
    expect(llm.requests[0].system).toContain('## Beyond money')
    expect(llm.requests[0].maxTokens).toBe(3000)
  })

  it('still rejects ungrounded money figures like ¥31,415.92 even in open general mode', async () => {
    const host = fakeHost({ persona: 'mei' })
    const llm = scriptedLlm([llmText('Sure! By the way, you spent ¥31,415.92 on coffee. Here is your poem about stars.')])
    host.setLlm(llm.client)
    host.llmInfo = () => ({ local: true, label: 'DeepSeek', onDevice: false })
    const engine = createAgentEngine(host)

    const msg = await engine.respond('Write me a poem about stars')
    expect(msg.grounding).toMatchObject({ ok: false, ungrounded: ['¥31,415.92'] })
    expect(msg.text).not.toContain('31,415')
  })

  it('keeps non-open money replies plain (rich not set) and uses longer timeouts for local/on-device models', async () => {
    const timeouts: number[] = []
    const host = fakeHost({ persona: 'mei' })
    const base = scriptedLlm([llmTool('get_overview', {}), llmText('**Headline**\n\nSpent ¥12,140 against ¥9,500.')])
    const origComplete = base.client.complete.bind(base.client)
    host.setLlm({
      baseUrl: base.client.baseUrl,
      health: base.client.health.bind(base.client),
      complete: (...args: Parameters<typeof origComplete>) => {
        if (args[1] !== undefined) timeouts.push(args[1])
        return origComplete(...args)
      },
    } as unknown as typeof base.client)

    // hosted gateway (llmInfo undefined): not rich even with markdown tokens, short timeout
    const hostedMsg = await createAgentEngine(host).respond('How am I doing this month?')
    expect(hostedMsg.rich).toBeUndefined()
    expect(hostedMsg.via).toBeUndefined()

    // on-device local model (Ollama): uses ON_DEVICE_TIMEOUT_MS
    host.llmInfo = () => ({ local: true, label: 'Ollama', onDevice: true })
    await createAgentEngine(host).respond('How am I doing this month?')
    host.llmInfo = () => ({ local: true, label: 'DeepSeek', onDevice: false })
    await createAgentEngine(host).respond('How am I doing this month?')

    expect(timeouts).toContain(ON_DEVICE_TIMEOUT_MS)
    expect(timeouts).toContain(OWN_MODEL_TIMEOUT_MS)
  })
})
