import { describe, expect, it, vi } from 'vitest'
import { MAX_MODEL_ID } from '../ai/store'
import { applyAgentModel, extractAgentModels, modesAfterSwitch } from './runtime'

/** The model setting as @agentclientprotocol/claude-agent-acp 0.106.0 answers session/new (read from its dist). */
const claudeConfig = {
  configOptions: [
    { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default' }] },
    {
      id: 'model',
      name: 'Model',
      description: 'AI model to use',
      category: 'model',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default (recommended)', description: 'Opus 4.5' },
        { value: 'opus', name: 'Opus', description: 'Most capable' },
        { value: 'sonnet', name: 'Sonnet' },
      ],
    },
  ],
}

function conn(result: 'ok' | 'fail' = 'ok') {
  return { request: vi.fn(() => (result === 'ok' ? Promise.resolve({}) : Promise.reject(new Error('no')))) }
}

describe('extractAgentModels: which models an agent offers', () => {
  it('reads the modern model setting (flat options) and leaves other settings alone', () => {
    expect(extractAgentModels(claudeConfig)).toEqual({
      configId: 'model',
      current: 'default',
      options: [
        { id: 'default', name: 'Default (recommended)' },
        { id: 'opus', name: 'Opus' },
        { id: 'sonnet', name: 'Sonnet' },
      ],
    })
  })

  it('flattens grouped options and finds the setting by category whatever its id', () => {
    const created = {
      configOptions: [{
        id: 'llm',
        category: 'model',
        currentValue: 'gpt-5',
        options: [
          { group: 'openai', name: 'OpenAI', options: [{ value: 'gpt-5', name: 'GPT-5' }, { value: 'gpt-5-mini', name: 'GPT-5 mini' }] },
          { group: 'anthropic', name: 'Anthropic', options: [{ value: 'claude-sonnet', name: 'Claude Sonnet' }] },
        ],
      }],
    }
    expect(extractAgentModels(created)).toEqual({
      configId: 'llm',
      current: 'gpt-5',
      options: [{ id: 'gpt-5', name: 'GPT-5' }, { id: 'gpt-5-mini', name: 'GPT-5 mini' }, { id: 'claude-sonnet', name: 'Claude Sonnet' }],
    })
  })

  it('finds the setting by id "model" when no category is given', () => {
    const created = { configOptions: [{ id: 'model', currentValue: 'm1', options: [{ value: 'm1', name: 'One' }] }] }
    expect(extractAgentModels(created)).toEqual({ configId: 'model', current: 'm1', options: [{ id: 'm1', name: 'One' }] })
  })

  it('reads the older models shape, with no config id (session/set_model)', () => {
    const created = {
      models: {
        currentModelId: 'gemini-2.5-pro',
        availableModels: [{ modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }, { modelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }],
      },
    }
    expect(extractAgentModels(created)).toEqual({
      current: 'gemini-2.5-pro',
      options: [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }, { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }],
    })
  })

  it('falls back to the older shape when the config options hold no model setting', () => {
    const created = { configOptions: [{ id: 'mode', category: 'mode', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask' }] }], models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'M' }] } }
    expect(extractAgentModels(created)).toEqual({ current: 'm', options: [{ id: 'm', name: 'M' }] })
  })

  it('reports nothing for an agent that offers no model choice', () => {
    expect(extractAgentModels({})).toEqual({ options: [] })
    expect(extractAgentModels({ sessionId: 's1', modes: {} })).toEqual({ options: [] })
  })

  it('survives malformed and hostile answers', () => {
    const cases: Record<string, unknown>[] = [
      { configOptions: 'model' },
      { configOptions: [null, 7, 'x', []] },
      { configOptions: [{ id: 'model', options: { value: 'm' } }] },
      { configOptions: [{ id: 'model', currentValue: 42, options: [null, 1, { value: 7 }, { name: 'no value' }, { value: '   ' }, { group: 'g', options: 'nope' }] }] },
      { models: 'gpt' },
      { models: { currentModelId: { id: 'x' }, availableModels: [{ id: 'not-modelId' }, null] } },
    ]
    for (const created of cases) expect(extractAgentModels(created)).toEqual({ options: [] })
  })

  it('trims and caps ids and names, drops duplicates, and keeps the list short', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ value: `m-${i}`, name: `Model ${i}` }))
    const out = extractAgentModels({ configOptions: [{ id: 'model', currentValue: 'm-0', options: [{ value: '  m-0  ', name: '  Zero  ' }, { value: 'm-0', name: 'Again' }, ...many] }] })
    expect(out.options).toHaveLength(200)
    expect(out.options[0]).toEqual({ id: 'm-0', name: 'Zero' })
    expect(out.options.filter((o) => o.id === 'm-0')).toHaveLength(1)

    const long = extractAgentModels({ configOptions: [{ id: 'model', options: [{ value: 'x'.repeat(5000), name: 'y'.repeat(5000) }, { value: 'ok', name: 'n'.repeat(5000) }] }] })
    // an id too long to store is left out, never cut short; a long name is only shortened
    expect(long.options).toEqual([{ id: 'ok', name: 'n'.repeat(120) }])
    // a name is optional: the id stands in for it
    expect(extractAgentModels({ configOptions: [{ id: 'model', options: [{ value: 'plain' }] }] }).options).toEqual([{ id: 'plain', name: 'plain' }])
  })

  it('keeps ids up to the length FundBun stores, and leaves longer ones out, the model in use too', () => {
    const atLimit = `gateway/${'a'.repeat(MAX_MODEL_ID - 8)}`
    const over = `gateway/${'b'.repeat(MAX_MODEL_ID - 7)}`
    expect(atLimit).toHaveLength(MAX_MODEL_ID)
    const out = extractAgentModels({ configOptions: [{ id: 'model', currentValue: over, options: [{ value: atLimit, name: 'Long' }, { value: over, name: 'Too long' }] }] })
    expect(out).toEqual({ configId: 'model', options: [{ id: atLimit, name: 'Long' }] })
    const legacy = extractAgentModels({ models: { currentModelId: atLimit, availableModels: [{ modelId: over }, { modelId: atLimit, name: 'Long' }] } })
    expect(legacy).toEqual({ current: atLimit, options: [{ id: atLimit, name: 'Long' }] })
  })

  it('always lists the model in use, even when the agent left it out', () => {
    const out = extractAgentModels({ configOptions: [{ id: 'model', currentValue: 'hidden', options: [{ value: 'a', name: 'A' }] }] })
    expect(out.current).toBe('hidden')
    expect(out.options).toEqual([{ id: 'a', name: 'A' }, { id: 'hidden', name: 'hidden' }])
  })

  it('keeps the model in use among the choices when the agent lists more models than FundBun shows', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ modelId: `p/m${i}`, name: `Model ${i}` }))
    const legacy = extractAgentModels({ models: { currentModelId: 'p/m230', availableModels: many } })
    expect(legacy.options).toHaveLength(200)
    expect(legacy.options.at(-1)).toEqual({ id: 'p/m230', name: 'Model 230' })
    expect(legacy.options.slice(0, 199).map((o) => o.id)).toEqual(many.slice(0, 199).map((m) => m.modelId))

    const config = extractAgentModels({ configOptions: [{ id: 'model', currentValue: 'unlisted', options: many.map((m) => ({ value: m.modelId, name: m.name })) }] })
    expect(config.options).toHaveLength(200)
    expect(config.options.at(-1)).toEqual({ id: 'unlisted', name: 'unlisted' })
    // the model in use early in the list takes no extra place
    const early = extractAgentModels({ models: { currentModelId: 'p/m3', availableModels: many } })
    expect(early.options.map((o) => o.id)).toEqual(many.slice(0, 200).map((m) => m.modelId))
  })
})

describe('modesAfterSwitch: the mode a model switch left the session in', () => {
  const modes = { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Ask' }, { id: 'bypassPermissions', name: 'Bypass' }] }

  it('reads the mode the agent reported in its answer to the switch', () => {
    const reply = { configOptions: [{ id: 'mode', category: 'mode', currentValue: 'bypassPermissions' }, { id: 'model', category: 'model', currentValue: 'opus' }] }
    expect(modesAfterSwitch(modes, reply, '')).toEqual({ ...modes, currentModeId: 'bypassPermissions' })
  })

  it('uses a current_mode_update when the answer says nothing about the mode', () => {
    expect(modesAfterSwitch(modes, {}, 'acceptEdits')).toEqual({ ...modes, currentModeId: 'acceptEdits' })
  })

  it('keeps the modes from session/new when nothing changed', () => {
    expect(modesAfterSwitch(modes, {}, '')).toBe(modes)
    expect(modesAfterSwitch(undefined, { configOptions: 'nope' }, '')).toBeUndefined()
  })
})

describe('applyAgentModel: switch a session to the model the user picked', () => {
  const discovered = extractAgentModels(claudeConfig)

  it('uses session/set_config_option when the agent has a model setting', async () => {
    const c = conn()
    expect(await applyAgentModel(c, 'sess_1', 'opus', discovered)).toBe(true)
    expect(c.request).toHaveBeenCalledWith('session/set_config_option', { sessionId: 'sess_1', configId: 'model', value: 'opus' }, 20_000)
  })

  it('uses the older session/set_model when there is no config id', async () => {
    const c = conn()
    const legacy = { current: 'a', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }
    expect(await applyAgentModel(c, 'sess_2', 'b', legacy)).toBe(true)
    expect(c.request).toHaveBeenCalledWith('session/set_model', { sessionId: 'sess_2', modelId: 'b' }, 20_000)
  })

  it('sends nothing when the model is already in use or none was picked', async () => {
    const c = conn()
    expect(await applyAgentModel(c, 's', 'default', discovered)).toBe(true)
    expect(await applyAgentModel(c, 's', '  ', discovered)).toBe(true)
    expect(c.request).not.toHaveBeenCalled()
  })

  it('answers false when the agent refuses the switch', async () => {
    expect(await applyAgentModel(conn('fail'), 's', 'sonnet', discovered)).toBe(false)
  })

  it('refuses a model the agent did not offer, without asking it', async () => {
    const c = conn()
    expect(await applyAgentModel(c, 's', 'gpt-4o', discovered)).toBe(false)
    expect(c.request).not.toHaveBeenCalled()
  })

  it('asks an agent that lists no models, and reports what it said', async () => {
    const ok = conn()
    expect(await applyAgentModel(ok, 's', 'anything', { options: [] })).toBe(true)
    expect(ok.request).toHaveBeenCalledWith('session/set_model', { sessionId: 's', modelId: 'anything' }, 20_000)
    expect(await applyAgentModel(conn('fail'), 's', 'anything', { options: [] })).toBe(false)
  })
})
