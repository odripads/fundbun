// @vitest-environment jsdom
import { createElement as h } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '../ds/testing'
import { describeConnection, modelChoices, optionLabel, testLine } from './AiSheet'
import { Markdown, parseMarkdown } from './Markdown'
import { answeringLabel } from './ModelChip'

afterEach(cleanup)

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, fenced code blocks, lists, and blockquotes', () => {
    const blocks = parseMarkdown([
      '# Summary',
      '',
      'First line',
      'Second line',
      '',
      '```python',
      'def hi():',
      '    return 1',
      '```',
      '',
      '- item one',
      '  wrapped line',
      '- item two',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted line',
    ].join('\n'))

    expect(blocks).toEqual([
      { kind: 'h', level: 1, text: 'Summary' },
      { kind: 'p', text: 'First line\nSecond line' },
      { kind: 'code', lang: 'python', text: 'def hi():\n    return 1' },
      { kind: 'ul', items: ['item one wrapped line', 'item two'] },
      { kind: 'ol', items: ['first', 'second'] },
      { kind: 'quote', text: 'quoted line' },
    ])
  })
})

describe('Markdown component security & formatting', () => {
  it('renders links and images as plain text (no <a> or <img>) and escapes script tags', async () => {
    const src = [
      'Click [here](https://evil.example/phish) or see ![pic](https://evil.example/x.png).',
      '',
      'Use **bold**, *italic* and `inline()`.',
      '',
      '<script>alert(1)</script><img src=x onerror=alert(1)>',
    ].join('\n')
    const { container } = await render(h(Markdown, { text: src }))
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('here (https://evil.example/phish)')
    expect(container.textContent).toContain('pic (https://evil.example/x.png)')
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('em')?.textContent).toBe('italic')
    expect(container.querySelector('code')?.textContent).toBe('inline()')
  })
})

describe('AI UI labels and summaries', () => {
  it('formats testLine across failure, missing tool support, and success', () => {
    expect(testLine({ ok: false, ms: 0, error: 'Bad key' })).toEqual({ tone: 'bad', text: 'Bad key' })
    expect(testLine({ ok: true, ms: 1250, tools: false })).toMatchObject({ tone: 'warn' })
    expect(testLine({ ok: true, ms: 500, tools: true })).toEqual({ tone: 'ok', text: "Answered in 0.5 s and can use FundBun's tools." })
  })

  it('formats an agent test: started, ask-first verified, models counted', () => {
    expect(testLine({ ok: true, ms: 2300, tools: true, kind: 'agent', modelCount: 3 })).toEqual({ tone: 'ok', text: 'Connected in 2.3 s (ask-first mode verified, 3 models found).' })
    expect(testLine({ ok: true, ms: 900, kind: 'agent', modelCount: 1 }).text).toBe('Connected in 0.9 s (ask-first mode verified, 1 model found).')
    expect(testLine({ ok: true, ms: 900, kind: 'agent', modelCount: 0 }).text).toBe('Connected in 0.9 s (ask-first mode verified).')
    expect(testLine({ ok: false, ms: 900, kind: 'agent', error: 'Claude Code is not signed in on this computer.' })).toEqual({ tone: 'bad', text: 'Claude Code is not signed in on this computer.' })
  })

  it('lists model choices with names, and keeps a model no longer offered visible', () => {
    const base = { id: 'ai_1', presetId: 'claude-code', label: 'Claude Code', hasKey: false, local: false, kind: 'agent' as const, createdAt: '2026-11-25T00:00:00Z' }
    const offered = [{ id: 'default', name: 'Default (recommended)' }, { id: 'opus', name: 'opus' }]
    expect(modelChoices({ ...base, model: 'opus' }, offered)).toEqual(offered)
    expect(modelChoices({ ...base, model: 'retired', modelName: 'Retired' }, offered)).toEqual([{ id: 'retired', name: 'Retired' }, ...offered])
    expect(modelChoices(base, [])).toEqual([])
    expect(optionLabel({ id: 'default', name: 'Default (recommended)' })).toBe('Default (recommended) (default)')
    expect(optionLabel({ id: 'opus', name: 'opus' })).toBe('opus')
  })

  it('describes connections cleanly', () => {
    const base = { id: 'ai_1', presetId: 'x', label: 'X', hasKey: false, createdAt: '2026-11-25T00:00:00Z' }
    expect(describeConnection({ ...base, kind: 'agent', local: true })).toContain('An agent on this computer')
    expect(describeConnection({ ...base, kind: 'agent', local: false, model: 'opus', modelName: 'Opus' })).toBe('Opus · agent on this computer, your own sign-in')
    expect(describeConnection({ ...base, kind: 'agent', local: false, model: 'claude-sonnet-5' })).toBe('claude-sonnet-5 · agent on this computer, your own sign-in')
    expect(describeConnection({ ...base, kind: 'openai_compat', local: true, model: 'llama3' })).toBe('llama3 · runs on this computer')
    expect(describeConnection({ ...base, kind: 'openai_compat', local: false, model: 'deepseek-chat', hasKey: true })).toBe('deepseek-chat · your own key')
    expect(describeConnection({ ...base, kind: 'openai_compat', local: false })).toBe('No model picked · your own key')
  })

  it('formats answeringLabel for built-in, agent, local AI, and hosted fallback', () => {
    expect(answeringLabel({ checked: true, available: false }, 'offline')).toBe('Built-in engine')
    expect(answeringLabel({ checked: true, available: true, kind: 'agent', provider: 'Claude Code' }, 'llm')).toBe('Claude Code')
    expect(answeringLabel({ checked: true, available: true, kind: 'agent', provider: 'Claude Code', model: '' }, 'llm')).toBe('Claude Code')
    expect(answeringLabel({ checked: true, available: true, kind: 'agent', provider: 'Claude Code', model: 'Opus' }, 'llm')).toBe('Claude Code · Opus')
    expect(answeringLabel({ checked: true, available: true, kind: 'agent' }, 'llm')).toBe('Your agent')
    expect(answeringLabel({ checked: true, available: true, local: true, provider: 'DeepSeek', model: 'deepseek-chat' }, 'llm')).toBe('DeepSeek · deepseek-chat')
    expect(answeringLabel({ checked: true, available: true, local: false, provider: 'anthropic', model: 'claude' }, 'llm')).toBe('AI model')
  })
})
