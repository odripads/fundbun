import { describe, expect, it } from 'vitest'
import { AiClient, parseEvent } from './client'
import { AI_UNAVAILABLE, type AgentEvent } from './types'

function ndjsonStream(chunks: string[], delayMs = 0) {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
        controller.enqueue(enc.encode(c))
      }
      controller.close()
    },
  })
}

describe('AiClient.state', () => {
  it('returns the normalised state from /api/ai/state', async () => {
    const client = new AiClient('/api', async () =>
      new Response(JSON.stringify({ local: true, presets: [], agents: [], connections: [], activeId: 'ai_1', keyStorage: 'Keychain' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(await client.state()).toEqual({
      local: true,
      presets: [],
      agents: [],
      connections: [],
      activeId: 'ai_1',
      keyStorage: 'Keychain',
    })
  })

  it('falls back to AI_UNAVAILABLE on non-JSON, HTTP errors, malformed payloads and network errors', async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => new Response('<html>not json</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      async () => new Response('nope', { status: 404, headers: { 'Content-Type': 'application/json' } }),
      async () => new Response(JSON.stringify({ local: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      async () => {
        throw new TypeError('network down')
      },
    ]
    for (const impl of cases) {
      expect(await new AiClient('/api', impl as typeof fetch).state()).toEqual(AI_UNAVAILABLE)
    }
  })
})

describe('AiClient.turn & parseEvent', () => {
  it('parses NDJSON split across chunks, ignores unknown types, and awaits async handlers in order', async () => {
    const chunks = [
      '{"type":"status","text":"Starting"}\n{"type":"un',
      'known_future","foo":1}\n{"type":"fundbun_',
      'tool","callId":"c1","name":"get_overview","args":{}}\nnot-json\n{"type":"text","delta":"Hi"}\n{"type":"done","stopReason":"end_turn"}\n',
    ]
    const client = new AiClient('/api', async () => new Response(ndjsonStream(chunks), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }))
    const order: string[] = []
    const events: AgentEvent[] = []
    await client.turn(
      { connectionId: 'ai_1', sessionKey: 's1', text: 'hi', preamble: '' },
      async (ev) => {
        events.push(ev)
        order.push(`start:${ev.type}`)
        if (ev.type === 'fundbun_tool') {
          await new Promise((r) => setTimeout(r, 15))
        }
        order.push(`end:${ev.type}`)
      },
    )

    expect(events.map((e) => e.type)).toEqual(['status', 'fundbun_tool', 'text', 'done'])
    expect(order).toEqual([
      'start:status',
      'end:status',
      'start:fundbun_tool',
      'end:fundbun_tool',
      'start:text',
      'end:text',
      'start:done',
      'end:done',
    ])
  })

  it('reports HTTP and network failures as error events without throwing', async () => {
    const httpErr = new AiClient('/api', async () => new Response(JSON.stringify({ message: 'Too busy' }), { status: 503 }))
    const ev1: AgentEvent[] = []
    await httpErr.turn({ connectionId: 'ai_1', sessionKey: 's1', text: 'hi', preamble: '' }, (e) => void ev1.push(e))
    expect(ev1).toEqual([{ type: 'error', code: 'http_503', message: 'Too busy' }])

    const netErr = new AiClient('/api', async () => {
      throw new TypeError('offline')
    })
    const ev2: AgentEvent[] = []
    await netErr.turn({ connectionId: 'ai_1', sessionKey: 's1', text: 'hi', preamble: '' }, (e) => void ev2.push(e))
    expect(ev2).toEqual([{ type: 'error', code: 'network', message: 'FundBun on this computer is not answering.' }])

    const ac = new AbortController()
    ac.abort()
    const abortErr = new AiClient('/api', async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    const ev3: AgentEvent[] = []
    await abortErr.turn({ connectionId: 'ai_1', sessionKey: 's1', text: 'hi', preamble: '' }, (e) => void ev3.push(e), ac.signal)
    expect(ev3).toEqual([{ type: 'error', code: 'aborted', message: 'Stopped.' }])
  })

  it('parseEvent rejects malformed lines and unknown types', () => {
    expect(parseEvent('')).toBeNull()
    expect(parseEvent('{bad')).toBeNull()
    expect(parseEvent('{"type":"bogus"}')).toBeNull()
    expect(parseEvent('{"type":"text","delta":"ok"}')).toEqual({ type: 'text', delta: 'ok' })
  })
})
