import { AI_UNAVAILABLE, type AgentEvent, type AiConnection, type AiState, type ConnectionTest, type ModelOption, type NewConnectionInput } from './types'

export type AiResult<T> = ({ ok: true } & T) | { ok: false; error: string }

export interface AgentTurnRequest {
  connectionId: string
  sessionKey: string
  text: string
  preamble: string
}

const EVENT_TYPES = new Set(['status', 'text', 'thought', 'tool', 'fundbun_tool', 'permission', 'done', 'error'])

/**
 * The app's side of "bring your own AI": talks to the FundBun server on this computer (/api/ai, /api/agent).
 * On the hosted web app those routes do not exist; state() then answers `local: false` and nothing else is offered.
 */
export class AiClient {
  constructor(public baseUrl = '/api', private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  async state(timeoutMs = 4000): Promise<AiState> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/ai/state`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return AI_UNAVAILABLE
      const body = (await res.json()) as Partial<AiState>
      if (body?.local !== true || !Array.isArray(body.presets) || !Array.isArray(body.connections) || !Array.isArray(body.agents)) return AI_UNAVAILABLE
      return { local: true, presets: body.presets, agents: body.agents, connections: body.connections, activeId: typeof body.activeId === 'string' ? body.activeId : null, keyStorage: typeof body.keyStorage === 'string' ? body.keyStorage : '' }
    } catch {
      return AI_UNAVAILABLE
    }
  }

  add(input: NewConnectionInput): Promise<AiResult<{ connection: AiConnection; state: AiState }>> {
    return this.send('POST', '/ai/connections', input, 30_000)
  }

  update(id: string, patch: { label?: string; model?: string; modelName?: string; apiKey?: string }): Promise<AiResult<{ connection: AiConnection; state: AiState }>> {
    return this.send('PATCH', `/ai/connections/${encodeURIComponent(id)}`, patch)
  }

  async remove(id: string): Promise<AiResult<{ state: AiState }>> {
    const r = await this.send<AiState>('DELETE', `/ai/connections/${encodeURIComponent(id)}`)
    return r.ok ? { ok: true, state: r } : r
  }

  async setActive(id: string | null): Promise<AiResult<{ state: AiState }>> {
    const r = await this.send<AiState>('POST', '/ai/active', { id })
    return r.ok ? { ok: true, state: r } : r
  }

  /** an agent answers with each model's name too; asking an agent can mean starting it, so this may take a minute */
  models(id: string): Promise<AiResult<{ models: string[]; modelOptions?: ModelOption[] }>> {
    return this.send('GET', `/ai/connections/${encodeURIComponent(id)}/models`, undefined, 70_000)
  }

  async test(id: string): Promise<ConnectionTest> {
    const r = await this.send<ConnectionTest>('POST', `/ai/connections/${encodeURIComponent(id)}/test`, {}, 70_000)
    return r.ok ? r : { ok: false, ms: 0, error: r.error }
  }

  /**
   * One agent turn. Events arrive in order; `onEvent` may be async (the next event waits for it), which is what
   * lets the app run a FundBun tool and post its result before reading on. Resolves when the stream ends.
   * Never throws: failures arrive as an 'error' event.
   */
  async turn(req: AgentTurnRequest, onEvent: (event: AgentEvent) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/agent/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(req),
        signal,
      })
    } catch {
      return void (await onEvent({ type: 'error', code: signal?.aborted ? 'aborted' : 'network', message: signal?.aborted ? 'Stopped.' : 'FundBun on this computer is not answering.' }))
    }
    if (!res.ok || !res.body) {
      const message = await res.json().then((b: { message?: unknown }) => (typeof b?.message === 'string' ? b.message : ''), () => '')
      return void (await onEvent({ type: 'error', code: `http_${res.status}`, message: message || 'The agent could not be reached.' }))
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl = buffer.indexOf('\n')
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
          const event = parseEvent(line)
          if (event) await onEvent(event)
        }
      }
    } catch {
      await onEvent({ type: 'error', code: signal?.aborted ? 'aborted' : 'network', message: signal?.aborted ? 'Stopped.' : 'The connection to the agent was lost.' })
    }
  }

  toolResult(callId: string, content: string, isError: boolean): Promise<unknown> {
    return this.send('POST', '/agent/tool-result', { callId, content, isError })
  }

  permission(requestId: string, optionId: string | null): Promise<unknown> {
    return this.send('POST', '/agent/permission', { requestId, optionId })
  }

  cancel(sessionKey: string): Promise<unknown> {
    return this.send('POST', '/agent/cancel', { sessionKey })
  }

  close(sessionKey: string): Promise<unknown> {
    return this.send('POST', '/agent/close', { sessionKey })
  }

  private async send<T>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<AiResult<T>> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      const json = (await res.json().catch(() => null)) as (Record<string, unknown> & { message?: unknown }) | null
      if (!res.ok || !json) return { ok: false, error: typeof json?.message === 'string' ? json.message.slice(0, 300) : `FundBun answered HTTP ${res.status}.` }
      return { ok: true, ...(json as T) }
    } catch {
      return { ok: false, error: 'FundBun on this computer is not answering.' }
    }
  }
}

export function parseEvent(line: string): AgentEvent | null {
  if (!line) return null
  try {
    const ev = JSON.parse(line) as { type?: unknown }
    return ev && typeof ev === 'object' && typeof ev.type === 'string' && EVENT_TYPES.has(ev.type) ? (ev as AgentEvent) : null
  } catch {
    return null
  }
}
