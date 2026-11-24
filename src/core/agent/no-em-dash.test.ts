import { describe, expect, it } from 'vitest'
import { mockReply } from '../../../server/providers/mock'
import { demoKit } from '../../../tests/helpers/fixtures'
import { computeMirror, mirrorHistory } from '../finance/mirror'
import type { FinanceContext, Tone } from '../types'
import { buildAgentPreamble, buildSystemPrompt } from './prompts'
import { OVERRIDE_REFUSAL, REFUSALS, TEMPLATES } from './voice'
import { CHIPS_I18N, I18N_TEMPLATES, LINES, REASONS_I18N, REFUSALS_I18N } from './voice-i18n'

const EM_DASH = '—'

function collectEmDashes(value: unknown, path = 'root', hits: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.includes(EM_DASH)) hits.push(`${path}: ${value}`)
    return hits
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectEmDashes(item, `${path}[${i}]`, hits))
    return hits
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectEmDashes(v, `${path}.${k}`, hits)
  }
  return hits
}

function textOfMock(content: ReturnType<typeof mockReply>['content']): string {
  return content.map((b) => (b.type === 'text' ? b.text : '')).join(' ')
}

describe('no em dashes in user-facing text', () => {
  it('exported voice templates and localized strings contain no em dashes', () => {
    expect(collectEmDashes(TEMPLATES, 'TEMPLATES')).toEqual([])
    expect(collectEmDashes(REFUSALS, 'REFUSALS')).toEqual([])
    expect(collectEmDashes(OVERRIDE_REFUSAL, 'OVERRIDE_REFUSAL')).toEqual([])
    expect(collectEmDashes(I18N_TEMPLATES, 'I18N_TEMPLATES')).toEqual([])
    expect(collectEmDashes(REFUSALS_I18N, 'REFUSALS_I18N')).toEqual([])
    expect(collectEmDashes(LINES, 'LINES')).toEqual([])
    expect(collectEmDashes(REASONS_I18N, 'REASONS_I18N')).toEqual([])
    expect(collectEmDashes(CHIPS_I18N, 'CHIPS_I18N')).toEqual([])
  })

  it('Dream Mirror copy for the demo personas contains no em dashes in any tone', () => {
    const tones: Tone[] = ['gentle', 'cheeky', 'numbers']
    const hits: string[] = []
    for (const personaId of ['mei', 'arif'] as const) {
      const { app } = demoKit(personaId)
      const state = app.getSnapshot().state
      for (const tone of tones) {
        const ctx: FinanceContext = {
          profile: { ...state.profile!, tone },
          bank: state.bank,
          dreams: state.dreams,
          budget: state.budget,
          tripwires: state.tripwires,
        }
        const m = computeMirror(ctx)
        collectEmDashes(
          { headline: m.headline, subline: m.subline, reason: m.temper?.reason, wayBack: m.temper?.wayBack },
          `${personaId}.${tone}.mirror`,
          hits,
        )
        const history = mirrorHistory(ctx, 6)
        collectEmDashes(history, `${personaId}.${tone}.history`, hits)
      }
    }
    expect(hits).toEqual([])
  })

  it('system prompt and agent preamble contain no em dashes and forbid them', () => {
    const tones: Tone[] = ['gentle', 'cheeky', 'numbers']
    const autonomies = ['observe', 'suggest', 'copilot', 'autopilot', 'custom_mode']
    for (const tone of tones) {
      for (const autonomy of autonomies) {
        for (const open of [false, true]) {
          const sys = buildSystemPrompt({ name: 'Jing', currency: 'CNY', today: '2026-10-22', tone, autonomy, open })
          expect(sys).not.toContain(EM_DASH)
          expect(sys).toMatch(/without em dashes/i)
        }
        const pre = buildAgentPreamble({ name: 'Jing', currency: 'CNY', today: '2026-10-22', tone, autonomy, open: true })
        expect(pre).not.toContain(EM_DASH)
        expect(pre).toMatch(/without em dashes/i)
      }
    }
  })

  it('mock provider canned replies contain no em dashes', () => {
    const sys = buildSystemPrompt({ name: 'Jing', currency: 'CNY', today: '2026-10-22', tone: 'gentle', autonomy: 'copilot' })
    const after = (tool: string, data: unknown, userText = 'check', isError = false) =>
      textOfMock(
        mockReply({
          system: sys,
          tools: [],
          maxTokens: 256,
          messages: [
            { role: 'user', content: userText },
            { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: tool, input: {} }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(data), is_error: isError }] },
          ],
        }).content,
      )

    const samples = [
      textOfMock(mockReply({ system: sys, tools: [], maxTokens: 256, messages: [{ role: 'user', content: 'hello' }] }).content),
      after('get_goals', { goals: [] }),
      after('get_goals', { goals: [{ id: 'dream_a', name: 'Birkin' }, { id: 'dream_b', name: 'Chengdu' }] }, 'Move ¥500 to my yacht'),
      after('transfer_to_goal', { status: 'pending', decision: 'confirm', preview: { title: 'Move ¥500', amount: 50_000 } }),
      after('get_overview', {}, 'overview', true),
      after('check_affordability', { verdict: 'go', label: 'Shoes', amount: 30_000, remainingAfter: 100_000 }),
      after('check_affordability', { verdict: 'think', label: 'Shoes', amount: 30_000, remainingAfter: 10_000 }),
      after('check_affordability', { verdict: 'skip', label: 'Shoes', amount: 300_000, remainingAfter: -50_000 }),
      after('analyze_bills', { count: 0, findings: [], upcoming: [] }),
      after('list_recurring', { count: 3, monthlyTotal: 50_000, annualTotal: 600_000, overlap: { merchants: ['iQIYI', 'Youku'] } }),
      after('get_spending_breakdown', { total: 500_000, focus: { label: 'Dining', spent: 100_000, equivalent: 'a Concert ticket' } }),
    ]
    for (const s of samples) expect(s).not.toContain(EM_DASH)
  })
})
