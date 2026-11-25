import { describe, expect, it, vi } from 'vitest'
import { CUSTOM_AGENT_ID, PRESETS, presetById } from './presets'
import { CLOUD_TIMEOUT_MS, LOCAL_TIMEOUT_MS, checkBaseUrl, createAiService, type AgentProbeResult } from './service'
import { MAX_MODEL_ID, createMemoryStore, type SecretCodec } from './store'

const xorCodec: SecretCodec = {
  describe: 'Test encrypted codec',
  encode: (plain) => `enc:${Buffer.from(plain, 'utf8').toString('base64')}`,
  decode: (stored) => (stored.startsWith('enc:') ? Buffer.from(stored.slice(4), 'base64').toString('utf8') : ''),
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('checkBaseUrl', () => {
  it('accepts https URLs and strips trailing slashes', () => {
    expect(checkBaseUrl('https://api.example.com/v1///')).toEqual({
      ok: true,
      value: { url: 'https://api.example.com/v1', local: false },
    })
  })

  it('accepts plain http only for localhost, 127.0.0.1, [::1] and .localhost', () => {
    for (const url of ['http://localhost:11434/v1/', 'http://127.0.0.1:1234/v1', 'http://[::1]:11434/v1', 'http://ollama.localhost/v1']) {
      expect(checkBaseUrl(url)).toMatchObject({ ok: true, value: { local: true } })
    }
    expect(checkBaseUrl('http://api.example.com/v1')).toMatchObject({ ok: false })
  })

  it('rejects invalid URLs, non-http protocols and embedded credentials', () => {
    expect(checkBaseUrl('not-a-url').ok).toBe(false)
    expect(checkBaseUrl('ftp://example.com/v1').ok).toBe(false)
    expect(checkBaseUrl('https://user:secret@api.example.com/v1')).toEqual({
      ok: false,
      error: 'Put the key in the key box, not in the address.',
    })
    expect(checkBaseUrl('https://sk-key@api.example.com/v1').ok).toBe(false)
  })
})

describe('createAiService: secrets, validation and connections', () => {
  it('stores keys encoded and never exposes them in state(), get(), active() or add()', async () => {
    const store = createMemoryStore()
    const svc = createAiService({ store, codec: xorCodec })
    const added = await svc.add({ presetId: 'deepseek', apiKey: 'sk-very-secret-key', model: 'deepseek-chat' })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    const stored = store.load().connections[0]
    expect(stored.secret).toBe(xorCodec.encode('sk-very-secret-key'))
    expect(stored.secret).not.toContain('sk-very-secret-key')

    const dumped = JSON.stringify([added.value, svc.state(), svc.get(added.value.id), svc.active()])
    expect(dumped).not.toContain('sk-very-secret-key')
    expect(dumped).not.toContain(stored.secret!)
    expect(svc.get(added.value.id)?.hasKey).toBe(true)
    expect(svc.state().keyStorage).toBe(xorCodec.describe)
  })

  it('requires a key when the preset needs one, and allows keyless presets without a key', async () => {
    const fetch = vi.fn(async () => jsonRes({ data: [{ id: 'llama3.2' }] }))
    const svc = createAiService({ store: createMemoryStore(), fetch })

    const missing = await svc.add({ presetId: 'deepseek', model: 'deepseek-chat' })
    expect(missing).toEqual({ ok: false, error: 'DeepSeek needs a key.' })

    const local = await svc.add({ presetId: 'ollama' })
    expect(local.ok).toBe(true)
    if (local.ok) {
      expect(local.value.hasKey).toBe(false)
      expect(local.value.local).toBe(true)
      expect(local.value.model).toBe('llama3.2')
    }
  })

  it('fetches the model list when no model is given and reports 401/403 clearly', async () => {
    const fetchOk = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/openai/models')
      return jsonRes({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-2.5-pro' }] })
    })
    const svc = createAiService({ store: createMemoryStore(), fetch: fetchOk })
    const res = await svc.add({ presetId: 'gemini', apiKey: 'gk-test' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.model).toBe('gemini-2.5-flash')
    const listed = await svc.models(res.ok ? res.value.id : '')
    expect(listed).toEqual({ ok: true, value: ['gemini-2.5-flash', 'gemini-2.5-pro'] })

    const fetch401 = vi.fn(async () => new Response('bad key', { status: 401 }))
    const svc2 = createAiService({ store: createMemoryStore(), fetch: fetch401 })
    const denied = await svc2.add({ presetId: 'deepseek', apiKey: 'sk-bad' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error).toContain('did not accept this key')
  })

  it('keeps the first connection active, does not steal active on add, and moves active on remove', async () => {
    const svc = createAiService({ store: createMemoryStore() })
    const a = await svc.add({ presetId: 'deepseek', apiKey: 'sk-1', model: 'deepseek-chat' })
    const b = await svc.add({ presetId: 'openai', apiKey: 'sk-2', model: 'gpt-4o-mini' })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return

    expect(svc.state().activeId).toBe(a.value.id)
    expect(svc.active()?.id).toBe(a.value.id)

    expect(svc.setActive(b.value.id).ok).toBe(true)
    expect(svc.state().activeId).toBe(b.value.id)

    expect(svc.remove(b.value.id)).toBe(true)
    expect(svc.state().activeId).toBe(a.value.id)

    expect(svc.remove(a.value.id)).toBe(true)
    expect(svc.state().activeId).toBeNull()
    expect(svc.remove(a.value.id)).toBe(false)
    expect(svc.setActive('ai_missing').ok).toBe(false)
  })

  it('caps the number of connections at 20', async () => {
    const svc = createAiService({ store: createMemoryStore() })
    for (let i = 0; i < 20; i++) {
      const r = await svc.add({ presetId: 'ollama', model: `m-${i}` })
      expect(r.ok).toBe(true)
    }
    const over = await svc.add({ presetId: 'ollama', model: 'm-20' })
    expect(over).toEqual({ ok: false, error: 'That is a lot of connections. Remove one first.' })
  })

  it('returns null from activeProvider() for agent connections and unconfigured connections', async () => {
    const svc = createAiService({ store: createMemoryStore(), find: () => '/usr/local/bin/npx' })
    expect(svc.activeProvider()).toBeNull()

    const agent = await svc.add({ presetId: 'claude-code' })
    expect(agent.ok).toBe(true)
    expect(svc.activeProvider()).toBeNull()

    const api = await svc.add({ presetId: 'ollama', model: 'llama3.2' })
    expect(api.ok).toBe(true)
    if (api.ok) {
      svc.setActive(api.value.id)
      const active = svc.activeProvider()
      expect(active?.connection.id).toBe(api.value.id)
      expect(active?.timeoutMs).toBe(LOCAL_TIMEOUT_MS)
    }

    const cloud = await svc.add({ presetId: 'deepseek', apiKey: 'sk-1', model: 'deepseek-chat' })
    if (cloud.ok) {
      svc.setActive(cloud.value.id)
      expect(svc.activeProvider()?.timeoutMs).toBe(CLOUD_TIMEOUT_MS)
    }
  })

  it('tests a connection and reports tools true/false plus errors', async () => {
    let replyContent: unknown[] = [{ type: 'tool_use', id: 'c1', function: { name: 'ping', arguments: '{"word":"bun"}' } }]
    let nextStatus = 200
    const fetch = vi.fn(async () => {
      if (nextStatus !== 200) return new Response('bad', { status: nextStatus })
      return jsonRes({
        model: 'deepseek-chat',
        choices: [{ message: { content: replyContent.some((x: any) => x.type === 'tool_use') ? null : 'pong', tool_calls: replyContent.filter((x: any) => x.type === 'tool_use') }, finish_reason: 'stop' }],
      })
    })
    const svc = createAiService({ store: createMemoryStore(), fetch, now: () => new Date('2026-11-25T10:00:00.000Z') })
    const added = await svc.add({ presetId: 'deepseek', apiKey: 'sk-1', model: 'deepseek-chat' })
    if (!added.ok) throw new Error('expected add ok')

    const withTools = await svc.test(added.value.id)
    expect(withTools).toMatchObject({ ok: true, model: 'deepseek-chat', tools: true })
    expect(svc.get(added.value.id)?.okAt).toBe('2026-11-25T10:00:00.000Z')

    replyContent = []
    const noTools = await svc.test(added.value.id)
    expect(noTools).toMatchObject({ ok: true, tools: false })

    nextStatus = 401
    const failed = await svc.test(added.value.id)
    expect(failed.ok).toBe(false)
    expect(svc.get(added.value.id)?.lastError).toBeTruthy()
  })

  it('applies per-provider wire quirks (DeepSeek, Qwen, OpenAI, custom)', async () => {
    const bodies: Record<string, Record<string, unknown>> = {}
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      bodies[String(url)] = JSON.parse(String(init?.body))
      return jsonRes({ model: 'm', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    })
    const svc = createAiService({ store: createMemoryStore(), fetch })
    const cases = [
      { presetId: 'deepseek', apiKey: 'k', model: 'deepseek-chat' },
      { presetId: 'qwen', apiKey: 'k', model: 'qwen-plus' },
      { presetId: 'openai', apiKey: 'k', model: 'gpt-4o-mini' },
      { presetId: 'custom', baseUrl: 'https://custom.example.com/v1', model: 'my-model' },
    ]
    for (const c of cases) {
      const added = await svc.add(c)
      expect(added.ok).toBe(true)
      if (!added.ok) continue
      svc.setActive(added.value.id)
      const active = svc.activeProvider()!
      await active.provider.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 128 })
    }

    expect(bodies['https://api.deepseek.com/chat/completions']).toMatchObject({ thinking: { type: 'disabled' }, max_tokens: 128 })
    expect(bodies['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions']).toMatchObject({ enable_thinking: false, max_tokens: 128 })
    expect(bodies['https://api.openai.com/v1/chat/completions']).toMatchObject({ max_completion_tokens: 128 })
    expect(bodies['https://api.openai.com/v1/chat/completions']).not.toHaveProperty('max_tokens')
    expect(bodies['https://custom.example.com/v1/chat/completions']).toMatchObject({ max_tokens: 128 })
    expect(bodies['https://custom.example.com/v1/chat/completions']).not.toHaveProperty('thinking')
    expect(bodies['https://custom.example.com/v1/chat/completions']).not.toHaveProperty('enable_thinking')
  })

  it('resolves agentCommand for npx, bin, missing binaries and custom commands', async () => {
    const bins: Record<string, string | null> = { npx: '/opt/homebrew/bin/npx', opencode: '/Users/me/.opencode/bin/opencode', claude: null, 'my-agent': '/usr/local/bin/my-agent' }
    const svc = createAiService({ store: createMemoryStore(), find: (b) => bins[b] ?? null })

    const claude = await svc.add({ presetId: 'claude-code' })
    const openCode = await svc.add({ presetId: 'opencode' })
    const qwen = await svc.add({ presetId: 'qwen-code' })
    const customBare = await svc.add({ presetId: CUSTOM_AGENT_ID, command: ['my-agent', '--acp', '--flag'] })
    const customMissing = await svc.add({ presetId: CUSTOM_AGENT_ID, command: ['no-such-bin', '--acp'] })
    const customPath = await svc.add({ presetId: CUSTOM_AGENT_ID, command: ['/opt/custom/agent', 'acp'] })
    if (!claude.ok || !openCode.ok || !qwen.ok || !customBare.ok || !customMissing.ok || !customPath.ok) throw new Error('add failed')

    expect(svc.agentCommand(claude.value.id)).toEqual({
      ok: true,
      value: { command: '/opt/homebrew/bin/npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.106.0'] },
    })
    expect(svc.agentCommand(openCode.value.id)).toEqual({
      ok: true,
      value: { command: '/Users/me/.opencode/bin/opencode', args: ['acp'] },
    })
    expect(svc.agentCommand(qwen.value.id).ok).toBe(false)
    expect(svc.agentCommand(customBare.value.id)).toEqual({
      ok: true,
      value: { command: '/usr/local/bin/my-agent', args: ['--acp', '--flag'] },
    })
    expect(svc.agentCommand(customMissing.value.id).ok).toBe(false)
    expect(svc.agentCommand(customPath.value.id)).toEqual({
      ok: true,
      value: { command: '/opt/custom/agent', args: ['acp'] },
    })

    const noNpx = createAiService({ store: createMemoryStore(), find: () => null })
    const c2 = await noNpx.add({ presetId: 'claude-code' })
    if (c2.ok) expect(noNpx.agentCommand(c2.value.id)).toEqual({ ok: false, error: 'Claude Code needs Node.js (the "npx" command was not found).' })

    expect(PRESETS.length).toBeGreaterThanOrEqual(10)
  })
})

describe('Grok (xAI) preset', () => {
  it('is a key preset on the xAI OpenAI-compatible endpoint', () => {
    expect(presetById('xai')).toEqual({
      id: 'xai', name: 'Grok', vendor: 'xAI', kind: 'openai_compat', group: 'key', needsKey: true,
      baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai/', note: 'Your own xAI API key.',
    })
    const keys = PRESETS.filter((p) => p.group === 'key').map((p) => p.id)
    expect(keys).toContain('xai')
    expect(keys.indexOf('xai')).toBeLessThan(keys.indexOf('custom'))
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
    expect(createAiService({ store: createMemoryStore() }).state().presets.map((p) => p.id)).toContain('xai')
  })

  it('needs a key, lists models with it, and talks to api.x.ai', async () => {
    const seen: { url: string; auth: string | null }[] = []
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('Authorization') })
      return jsonRes({ data: [{ id: 'grok-4' }, { id: 'grok-4-mini' }] })
    })
    const svc = createAiService({ store: createMemoryStore(), fetch })
    expect(await svc.add({ presetId: 'xai' })).toEqual({ ok: false, error: 'Grok needs a key.' })
    const added = await svc.add({ presetId: 'xai', apiKey: 'xai-test-key' })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.value).toMatchObject({ kind: 'openai_compat', baseUrl: 'https://api.x.ai/v1', model: 'grok-4', hasKey: true, local: false })
    expect(seen[0]).toEqual({ url: 'https://api.x.ai/v1/models', auth: 'Bearer xai-test-key' })
  })
})

describe('createAiService: agent connections, their models and their test', () => {
  const OPTIONS = [{ id: 'default', name: 'Default (recommended)' }, { id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }]
  const okProbe = (over: Partial<Extract<AgentProbeResult, { ok: true }>> = {}): AgentProbeResult => ({ ok: true, ms: 2300, currentModel: 'default', currentModelName: 'Default (recommended)', options: OPTIONS, ...over })

  async function agentService(probe: AgentProbeResult | (() => Promise<AgentProbeResult>) = okProbe(), extra: Partial<Parameters<typeof createAiService>[0]> = {}) {
    const probeAgent = vi.fn(typeof probe === 'function' ? probe : async () => probe)
    const onConnectionChange = vi.fn()
    const svc = createAiService({ store: createMemoryStore(), find: () => '/usr/local/bin/npx', probeAgent, onConnectionChange, now: () => new Date('2026-11-25T10:00:00.000Z'), ...extra })
    const added = await svc.add({ presetId: 'claude-code' })
    if (!added.ok) throw new Error('expected an agent connection')
    return { svc, id: added.value.id, probeAgent, onConnectionChange }
  }

  it('shows the real command a known agent runs, never "its own command"', async () => {
    const svc = createAiService({ store: createMemoryStore(), find: () => null })
    const claude = await svc.add({ presetId: 'claude-code' })
    const open = await svc.add({ presetId: 'opencode' })
    const custom = await svc.add({ presetId: CUSTOM_AGENT_ID, command: ['my-agent', '--acp'] })
    const api = await svc.add({ presetId: 'ollama', model: 'llama3.2' })
    if (!claude.ok || !open.ok || !custom.ok || !api.ok) throw new Error('add failed')
    expect(claude.value.command).toEqual(['npx', '-y', '@agentclientprotocol/claude-agent-acp@0.106.0'])
    expect(svc.get(open.value.id)?.command).toEqual(['opencode', 'acp'])
    expect(svc.state().connections.find((c) => c.id === custom.value.id)?.command).toEqual(['my-agent', '--acp'])
    expect(api.value).not.toHaveProperty('command')
  })

  it('lists an agent’s models from a (cached) test and writes down the one it uses, quietly', async () => {
    const { svc, id, probeAgent, onConnectionChange } = await agentService()
    expect(await svc.models(id)).toEqual({ ok: true, value: ['default', 'opus', 'sonnet'], options: OPTIONS })
    expect(probeAgent).toHaveBeenCalledWith(id, { useCache: true })
    expect(svc.get(id)).toMatchObject({ model: 'default', modelName: 'Default (recommended)' })
    expect(onConnectionChange).not.toHaveBeenCalled()
  })

  it('keeps a picked model when listing, and fills in its missing name', async () => {
    const { svc, id } = await agentService()
    svc.update(id, { model: 'opus' }, { quiet: true })
    expect(svc.get(id)).not.toHaveProperty('modelName')
    await svc.models(id)
    expect(svc.get(id)).toMatchObject({ model: 'opus', modelName: 'Opus' })
  })

  it('forgets a picked model when the agent offers no model choice at all', async () => {
    const { svc, id } = await agentService({ ok: true, ms: 10, options: [] })
    svc.update(id, { model: 'opus', modelName: 'Opus' }, { quiet: true })
    expect(await svc.models(id)).toEqual({ ok: true, value: [], options: [] })
    expect(svc.get(id)).not.toHaveProperty('model')
    expect(svc.get(id)).not.toHaveProperty('modelName')
  })

  it('reports a failed model list for an agent, and lists nothing without a runtime', async () => {
    const { svc, id } = await agentService({ ok: false, ms: 5, error: 'Claude Code is not signed in on this computer.' })
    expect(await svc.models(id)).toEqual({ ok: false, error: 'Claude Code is not signed in on this computer.' })
    const plain = createAiService({ store: createMemoryStore() })
    const agent = await plain.add({ presetId: 'claude-code' })
    if (agent.ok) expect(await plain.models(agent.value.id)).toEqual({ ok: true, value: [] })
  })

  it('tests an agent by really starting it: ask-first verified, models counted, model written down', async () => {
    const { svc, id, probeAgent, onConnectionChange } = await agentService()
    expect(await svc.test(id)).toEqual({ ok: true, ms: 2300, model: 'Default (recommended)', tools: true, kind: 'agent', modelCount: 3 })
    expect(probeAgent).toHaveBeenCalledWith(id, { useCache: false })
    expect(svc.get(id)).toMatchObject({ model: 'default', modelName: 'Default (recommended)', okAt: '2026-11-25T10:00:00.000Z' })
    expect(onConnectionChange).not.toHaveBeenCalled()
  })

  it('names the picked model in a test, not the agent’s default', async () => {
    const { svc, id } = await agentService()
    svc.update(id, { model: 'sonnet', modelName: 'Sonnet' })
    expect(await svc.test(id)).toMatchObject({ ok: true, model: 'Sonnet', modelCount: 3 })
  })

  it('fails a test when the agent does not start, and when the picked model is gone', async () => {
    const { svc, id } = await agentService({ ok: false, ms: 900, error: 'Claude Code is set to act without asking.' })
    expect(await svc.test(id)).toEqual({ ok: false, ms: 900, error: 'Claude Code is set to act without asking.' })
    expect(svc.get(id)?.lastError).toBe('Claude Code is set to act without asking.')

    const gone = await agentService()
    gone.svc.update(gone.id, { model: 'claude-retired', modelName: 'Retired' })
    const r = await gone.svc.test(gone.id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no longer offers the model "Retired"')
    expect(gone.svc.get(gone.id)?.lastError).toContain('no longer offers')
  })

  it('keeps the old answer for an agent test when no runtime is wired', async () => {
    const svc = createAiService({ store: createMemoryStore() })
    const agent = await svc.add({ presetId: 'claude-code' })
    if (agent.ok) expect(await svc.test(agent.value.id)).toEqual({ ok: false, ms: 0, error: 'An agent answers through its own session, not this route.' })
  })

  it('update(): a new model clears a stale name, and ends the agent’s sessions unless quiet', async () => {
    const { svc, id, onConnectionChange } = await agentService()
    const first = svc.update(id, { model: 'opus', modelName: 'Opus' })
    expect(first.ok && first.value).toMatchObject({ model: 'opus', modelName: 'Opus' })
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
    expect(onConnectionChange).toHaveBeenLastCalledWith(id)

    // the same model again: nothing to restart
    svc.update(id, { model: 'opus' })
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
    expect(svc.get(id)?.modelName).toBe('Opus')

    // a new model without a name drops the old name
    svc.update(id, { model: 'sonnet' })
    expect(svc.get(id)).toMatchObject({ model: 'sonnet' })
    expect(svc.get(id)).not.toHaveProperty('modelName')
    expect(onConnectionChange).toHaveBeenCalledTimes(2)

    // quiet: written down only
    svc.update(id, { model: 'default', modelName: 'Default' }, { quiet: true })
    expect(onConnectionChange).toHaveBeenCalledTimes(2)

    // a name alone, capped and trimmed; an empty name removes it
    svc.update(id, { modelName: `  ${'N'.repeat(300)}  ` })
    expect(svc.get(id)?.modelName).toBe('N'.repeat(120))
    svc.update(id, { modelName: '' })
    expect(svc.get(id)).not.toHaveProperty('modelName')
  })

  it('update(): an API connection’s model change ends nothing; remove() ends any connection’s sessions', async () => {
    const onConnectionChange = vi.fn()
    const svc = createAiService({ store: createMemoryStore(), onConnectionChange })
    const api = await svc.add({ presetId: 'ollama', model: 'llama3.2' })
    if (!api.ok) throw new Error('add failed')
    svc.update(api.value.id, { model: 'qwen3' })
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(svc.remove(api.value.id)).toBe(true)
    expect(onConnectionChange).toHaveBeenCalledWith(api.value.id)
    expect(svc.remove(api.value.id)).toBe(false)
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
  })

  it('never exposes a model name without a model', async () => {
    const { svc, id } = await agentService()
    svc.update(id, { modelName: 'Ghost' })
    expect(svc.get(id)).not.toHaveProperty('modelName')
  })

  it('never cuts a model id short: one at the limit is kept whole, a longer one is not written down', async () => {
    const atLimit = `gateway/${'a'.repeat(MAX_MODEL_ID - 8)}`
    const over = `gateway/${'b'.repeat(MAX_MODEL_ID - 7)}`
    const { svc, id, onConnectionChange } = await agentService(okProbe({ currentModel: over, currentModelName: 'Over', options: [{ id: 'opus', name: 'Opus' }] }))
    // a test that reports an id too long to keep writes nothing down
    await svc.test(id)
    expect(svc.get(id)).not.toHaveProperty('model')

    expect(svc.update(id, { model: ` ${atLimit} `, modelName: 'Long' }).ok).toBe(true)
    expect(svc.get(id)).toMatchObject({ model: atLimit, modelName: 'Long' })
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
    // a longer id changes nothing and ends nothing
    svc.update(id, { model: over })
    expect(svc.get(id)).toMatchObject({ model: atLimit, modelName: 'Long' })
    expect(onConnectionChange).toHaveBeenCalledTimes(1)
  })
})
