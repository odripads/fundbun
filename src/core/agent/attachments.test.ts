import { describe, expect, it } from 'vitest'
import { fakeHost, llmText, scriptedLlm } from '../../../tests/helpers/fake-host'
import { MAX_ATTACHMENT_CHARS, MAX_ATTACHMENTS, MAX_ATTACHMENTS_CHARS, cleanAttachments } from './attachments'
import { createAgentEngine } from './runtime'

const receipt = { name: 'receipt.pdf', kind: 'pdf', text: 'Luckin Coffee\n2026-10-21\nLatte 18.00\nTotal 18.00' }

describe('cleanAttachments', () => {
  it('keeps only strings, drops empty files and control characters', () => {
    const out = cleanAttachments([receipt, { name: 'empty.txt', text: '   ' }, 'nope', null, { name: 'a\u0000b\u0007.txt', kind: 'te-xt!', text: 'x\u0000y' }])
    expect(out).toEqual([receipt, { name: 'ab.txt', kind: 'text', text: 'xy' }])
    expect(cleanAttachments('not a list')).toEqual([])
  })

  it('caps the number of files, each file and the whole message', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 5 }, (_, i) => ({ name: `f${i}.txt`, kind: 'text', text: 'y'.repeat(MAX_ATTACHMENT_CHARS * 2) }))
    const out = cleanAttachments(many)
    expect(out.length).toBeLessThanOrEqual(MAX_ATTACHMENTS)
    expect(out.every((f) => f.text.length <= MAX_ATTACHMENT_CHARS && f.truncated)).toBe(true)
    expect(out.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(MAX_ATTACHMENTS_CHARS)
  })
})

describe('a chat message with files', () => {
  it('sends the file to the model as untrusted data and marks the turn untrusted', async () => {
    const host = fakeHost({ persona: 'mei' })
    const llm = scriptedLlm([llmText('That is one latte for ¥18.')])
    host.setLlm(llm.client)
    const msg = await createAgentEngine(host).respond('What is on this receipt?', { attachments: [receipt] })
    const sent = JSON.stringify(llm.requests[0].messages)
    expect(sent).toContain('<untrusted source=\\"attached-file\\">')
    expect(sent).toContain('Latte 18.00')
    expect(sent).toContain('What is on this receipt?')
    const user = host.state().chat.find((m) => m.role === 'user')
    expect(user?.attachments).toEqual([receipt])
    expect(msg.trace?.some((t) => t.kind === 'injection')).toBe(true)
  })

  it('sends an older file only by name', async () => {
    const host = fakeHost({ persona: 'mei' })
    const llm = scriptedLlm([llmText('Got it.'), llmText('Sure.')])
    host.setLlm(llm.client)
    const engine = createAgentEngine(host)
    await engine.respond('Read this', { attachments: [receipt] })
    const msg = await engine.respond('And how am I doing this month?')
    const second = JSON.stringify(llm.requests[1].messages)
    expect(second).toContain('[attached earlier: receipt.pdf]')
    expect(second).not.toContain('Latte 18.00')
    // its text was in the conversation a moment ago: the turn is still treated as untrusted
    expect(msg.trace?.some((t) => t.kind === 'injection')).toBe(true)
  })

  it('a file with no words gets a default question', async () => {
    const host = fakeHost({ persona: 'mei' })
    const llm = scriptedLlm([llmText('ok')])
    host.setLlm(llm.client)
    await createAgentEngine(host).respond('', { attachments: [receipt] })
    expect(host.state().chat.find((m) => m.role === 'user')?.text).toBe('Have a look at this file.')
  })

  it('with the built-in engine, says files need the user’s own AI and reads nothing', async () => {
    const host = fakeHost({ persona: 'mei' })
    const msg = await createAgentEngine(host).respond('What is on this receipt?', { attachments: [receipt] })
    expect(msg.text).toMatch(/only read files when your own AI is connected/)
    expect(msg.cards?.some((c) => c.type === 'notice' && c.title === 'Files need your own AI')).toBe(true)
  })

  it('ignores files on a pasted-bill X-ray', async () => {
    const host = fakeHost({ persona: 'mei' })
    await createAgentEngine(host).respond('Bill: water 57.93', { source: 'xray', attachments: [receipt] })
    expect(host.state().chat.find((m) => m.role === 'user')?.attachments).toBeUndefined()
  })
})
