import { describe, expect, it } from 'vitest'
import { personaState } from '../../../tests/helpers/fake-host'
import type { LlmStatus } from '../app-api'
import { AiClient } from '../ai/client'
import type { AppState } from '../types'
import { createHost, type AgentSession } from './host'
import { createStore } from './store'

const session: AgentSession = { key: () => 'chat_1', fresh: () => true, used: () => undefined, signal: () => new AbortController().signal }

function hostWith(llm: LlmStatus) {
  const state: AppState = personaState('mei')
  state.profile = { ...state.profile!, consent: { ...state.profile!.consent, llmProcessing: true } }
  const store = createStore(state, { llm, busy: 0 }, { onCommit: () => undefined, blockedReason: () => null })
  return createHost({ store, now: () => '2026-10-22T02:00:00.000Z', llmClient: null, aiClient: new AiClient('/api', async () => new Response('{}')), session })
}

describe('createHost().agent(): who answers, by name', () => {
  const agent: LlmStatus = { checked: true, available: true, local: true, kind: 'agent', connectionId: 'ai_agent0000001', presetId: 'claude-code', provider: 'Claude' }

  it('names the agent and the model it runs on', () => {
    expect(hostWith({ ...agent, model: 'Opus 5.5' }).agent?.()?.label).toBe('Claude Opus 5.5')
    expect(hostWith({ ...agent, provider: 'Claude Code', model: 'Opus 5.5' }).agent?.()?.label).toBe('Claude Opus 5.5')
    expect(hostWith({ ...agent, presetId: 'antigravity', provider: 'Antigravity', model: 'Gemini 4 Neon' }).agent?.()?.label).toBe('Antigravity · Gemini 4 Neon')
  })

  it('names the agent alone when no model is known yet', () => {
    expect(hostWith(agent).agent?.()?.label).toBe('Claude')
    expect(hostWith({ ...agent, model: '' }).agent?.()?.label).toBe('Claude')
    expect(hostWith({ ...agent, model: 'Default (recommended)' }).agent?.()?.label).toBe('Claude')
    const { provider: _none, presetId: _p, ...unnamed } = agent
    expect(hostWith({ ...unnamed, model: 'Opus' }).agent?.()?.label).toBe('Opus')
  })

  it('gives no agent link when an API model or the built-in engine answers', () => {
    expect(hostWith({ ...agent, kind: 'openai_compat' }).agent?.()).toBeNull()
    expect(hostWith({ ...agent, available: false }).agent?.()).toBeNull()
  })
})
