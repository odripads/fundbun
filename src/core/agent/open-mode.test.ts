import { describe, expect, it } from 'vitest'
import { fakeHost, llmText, llmTool, scriptedLlm } from '../../../tests/helpers/fake-host'
import { ON_DEVICE_TIMEOUT_MS, OWN_MODEL_TIMEOUT_MS, withoutUngrounded } from './llm-engine'
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

  it('removes only the sentence with an unverified ¥88.00 and keeps the code block and line breaks (live test, 25 Nov)', async () => {
    const reply = [
      'Here is a short function:',
      '',
      '```python',
      'def split_bill(total, people):',
      '    return round(total / people, 2)',
      '```',
      '',
      'For example, a ¥352 dinner for 4 people comes to ¥88.00 each. It rounds to cents.',
      '',
      'If you need exact cents with no rounding drift, tell me.',
    ].join('\n')
    const host = fakeHost({ persona: 'mei' })
    host.setLlm(scriptedLlm([llmText(reply)]).client)
    host.llmInfo = () => ({ local: true, label: 'DeepSeek', onDevice: false })
    const msg = await createAgentEngine(host).respond('Write a short 3-line Python function to split a dinner bill evenly.')
    expect(msg.grounding?.ok).toBe(false)
    expect(msg.grounding?.ungrounded).toContain('¥88.00')
    expect(msg.text).toBe([
      'Here is a short function:',
      '',
      '```python',
      'def split_bill(total, people):',
      '    return round(total / people, 2)',
      '```',
      '',
      'It rounds to cents.',
      '',
      'If you need exact cents with no rounding drift, tell me.',
    ].join('\n'))
    expect(msg.rich).toBe(true)
    expect(msg.cards?.some((c) => c.type === 'notice' && c.title === 'Unverified number removed')).toBe(true)
  })

  it('fails closed: an unclosed fence does not hide an invented figure, and a money answer with one inside code falls back', async () => {
    const general = fakeHost({ persona: 'mei' })
    general.setLlm(scriptedLlm([llmText('Sure, here it is:\n\n```\nYou spent ¥31,415.92 on coffee this year. Keep going!')]).client)
    general.llmInfo = () => ({ local: true, label: 'DeepSeek', onDevice: false })
    const a = await createAgentEngine(general).respond('Write me a poem about stars')
    expect(a.grounding).toMatchObject({ ok: false, ungrounded: ['¥31,415.92'] })
    expect(a.text).not.toContain('31,415')

    const money = fakeHost({ persona: 'mei' })
    money.setLlm(scriptedLlm([llmTool('get_overview', {}), llmText('Your month is over budget, and here is the math in detail:\n\n```\ncoffee = 31415.92\n```\n\nKeep an eye on it.')]).client)
    money.llmInfo = () => ({ local: true, label: 'DeepSeek', onDevice: false })
    const b = await createAgentEngine(money).respond('How am I doing this month?')
    expect(b.grounding?.ok).toBe(false)
    expect(b.text).not.toContain('31415.92')
  })

  it('withoutUngrounded keeps headings, list markers and indentation, and collapses the gaps a removed line leaves', () => {
    const text = '## Plan\n\n- Save ¥500 a week. Cook at home.\n  - Nested idea.\n\n\n¥88 only.\n\n```\nx = "¥88"\n```'
    expect(withoutUngrounded(text, ['¥500', '¥88'])).toBe('## Plan\n\n- Cook at home.\n  - Nested idea.\n\n```\nx = "¥88"\n```')
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
