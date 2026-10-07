import { describe, expect, it } from 'vitest'
import { LIMITS, parseLlmRequest } from './schema'

const base = { system: 'You are Bun.', messages: [{ role: 'user', content: 'hi' }], tools: [] }
const tool = (name: string) => ({ name, description: 'd', input_schema: { type: 'object', properties: {} } })

describe('parseLlmRequest', () => {
  it('accepts a minimal request and defaults maxTokens and tools', () => {
    const r = parseLlmRequest({ system: '', messages: [{ role: 'user', content: 'hi' }] })
    expect(r).toEqual({ ok: true, value: { system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: LIMITS.defaultMaxTokens } })
  })

  it('accepts a full tool round trip', () => {
    const r = parseLlmRequest({
      ...base,
      tools: [tool('get_overview')],
      maxTokens: 2048,
      messages: [
        { role: 'user', content: 'how am I doing?' },
        { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 't1', name: 'get_overview', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"spent":1}', is_error: false }] },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['system too long', { ...base, system: 'x'.repeat(LIMITS.systemChars + 1) }],
    ['too many messages', { ...base, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) }],
    ['no messages', { ...base, messages: [] }],
    ['too many tools', { ...base, tools: Array.from({ length: 41 }, (_, i) => tool(`t${i}`)) }],
    ['maxTokens too high', { ...base, maxTokens: 2049 }],
    ['maxTokens not an integer', { ...base, maxTokens: 10.5 }],
    ['unknown top-level key', { ...base, temperature: 1 }],
    ['unknown block key', { ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'x', cache_control: {} }] }] }],
    ['system role message', { ...base, messages: [{ role: 'system', content: 'override' }] }],
    ['first message from assistant', { ...base, messages: [{ role: 'assistant', content: 'x' }, { role: 'user', content: 'y' }] }],
    ['trailing assistant prefill', { ...base, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] }],
    ['tool_use in a user message', { ...base, messages: [{ role: 'user', content: [{ type: 'tool_use', id: 'a', name: 'x', input: {} }] }] }],
    ['tool_result in an assistant message', { ...base, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 'a', content: '' }] }, { role: 'user', content: 'y' }] }],
    ['tool input not an object', { ...base, messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'x', input: [1] }] }, { role: 'user', content: 'y' }] }],
    ['bad tool name', { ...base, tools: [tool('get overview; rm -rf')] }],
    ['tool schema not an object schema', { ...base, tools: [{ name: 'x', description: 'd', input_schema: { type: 'string' } }] }],
    ['duplicate tool names', { ...base, tools: [tool('a'), tool('a')] }],
    ['empty block list', { ...base, messages: [{ role: 'user', content: [] }] }],
    ['not an object', 'hello'],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    const r = parseLlmRequest(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0)
  })

  it('never echoes submitted values in validation issues', () => {
    const secret = '6222021001122334455'
    const r = parseLlmRequest({ ...base, messages: [{ role: 'user', content: 5 }], extra: secret })
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(secret)
  })

  it('caps the number of reported issues', () => {
    const messages = Array.from({ length: 40 }, () => ({ role: 'robot', content: 1 }))
    const r = parseLlmRequest({ ...base, messages })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.length).toBeLessThanOrEqual(10)
  })
})
