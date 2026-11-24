import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcpError, connectAcp, type AcpTransport, type JsonObject } from './acp'

function fakeTransport() {
  const lineHandlers: ((line: string) => void)[] = []
  const closeHandlers: ((code: number | null) => void)[] = []
  const errHandlers: ((text: string) => void)[] = []
  const sent: JsonObject[] = []
  let killed = false
  const transport: AcpTransport = {
    write: (line) => sent.push(JSON.parse(line) as JsonObject),
    onLine: (h) => void lineHandlers.push(h),
    onClose: (h) => void closeHandlers.push(h),
    onStderr: (h) => void errHandlers.push(h),
    kill: () => {
      killed = true
      for (const h of closeHandlers) h(0)
    },
  }
  return {
    transport,
    sent,
    get killed() {
      return killed
    },
    push: (msg: JsonObject) => {
      const line = JSON.stringify(msg)
      for (const h of lineHandlers) h(line)
    },
    pushRaw: (line: string) => {
      for (const h of lineHandlers) h(line)
    },
    stderr: (text: string) => {
      for (const h of errHandlers) h(text)
    },
    close: (code: number | null = 0) => {
      for (const h of closeHandlers) h(code)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('connectAcp', () => {
  it('matches out-of-order responses to their request ids', async () => {
    const t = fakeTransport()
    const conn = connectAcp(t.transport)
    const p1 = conn.request('first', { a: 1 })
    const p2 = conn.request('second', { b: 2 })
    expect(t.sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'first', params: { a: 1 } },
      { jsonrpc: '2.0', id: 2, method: 'second', params: { b: 2 } },
    ])
    t.push({ jsonrpc: '2.0', id: 2, result: { ans: 'two' } })
    t.push({ jsonrpc: '2.0', id: 1, result: { ans: 'one' } })
    await expect(p2).resolves.toEqual({ ans: 'two' })
    await expect(p1).resolves.toEqual({ ans: 'one' })
  })

  it('rejects with AcpError carrying code and data on JSON-RPC error responses', async () => {
    const t = fakeTransport()
    const conn = connectAcp(t.transport)
    const p = conn.request('fail', {})
    t.push({ jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'Signed out', data: { hint: 'login' } } })
    const err = await p.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AcpError)
    expect(err).toMatchObject({ message: 'Signed out', code: -32001, data: { hint: 'login' } })
  })

  it('delivers notifications and handles agent-to-client requests', async () => {
    const t = fakeTransport()
    const conn = connectAcp(t.transport)
    const notes: [string, JsonObject][] = []
    conn.onNotification((method, params) => notes.push([method, params]))
    t.push({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk' } } })
    expect(notes).toEqual([['session/update', { update: { sessionUpdate: 'agent_message_chunk' } }]])

    // default request handler returns -32601
    t.push({ jsonrpc: '2.0', id: 'srv-1', method: 'unknown/method', params: {} })
    await vi.waitFor(() => expect(t.sent).toHaveLength(1))
    expect(t.sent[0]).toMatchObject({ jsonrpc: '2.0', id: 'srv-1', error: { code: -32601 } })

    conn.onRequest(async (method, params) => {
      if (method === 'session/request_permission') return { outcome: { outcome: 'selected', optionId: params.pick } }
      throw new AcpError('Bad args', -32602)
    })
    t.push({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { pick: 'allow_once' } })
    t.push({ jsonrpc: '2.0', id: 100, method: 'other', params: {} })
    await vi.waitFor(() => expect(t.sent).toHaveLength(3))
    expect(t.sent[1]).toEqual({ jsonrpc: '2.0', id: 99, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } })
    expect(t.sent[2]).toEqual({ jsonrpc: '2.0', id: 100, error: { code: -32602, message: 'Bad args' } })
  })

  it('ignores non-JSON banners on stdout and keeps the tail of stderr', async () => {
    const t = fakeTransport()
    const conn = connectAcp(t.transport)
    const p = conn.request('init', {})
    t.pushRaw('Welcome to Agent CLI v1.0!')
    t.pushRaw('not { valid json')
    t.push({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    await expect(p).resolves.toEqual({ ok: true })

    t.stderr('a'.repeat(1500))
    t.stderr('b'.repeat(1500))
    expect(conn.stderrTail()).toHaveLength(2000)
    expect(conn.stderrTail().endsWith('b'.repeat(1500))).toBe(true)
  })

  it('rejects all pending requests on close and resolves exited', async () => {
    const t = fakeTransport()
    const conn = connectAcp(t.transport)
    const p1 = conn.request('a', {})
    const p2 = conn.request('b', {})
    t.close(1)
    await expect(p1).rejects.toBeInstanceOf(AcpError)
    await expect(p2).rejects.toBeInstanceOf(AcpError)
    await expect(conn.exited).resolves.toEqual({ code: 1 })
    expect(conn.alive).toBe(false)
    await expect(conn.request('c', {})).rejects.toBeInstanceOf(AcpError)
    conn.notify('ignored', {})
    expect(t.sent).toHaveLength(2)
  })

  it('rejects a request when its timeout fires and ignores any late response', async () => {
    vi.useFakeTimers()
    const t = fakeTransport()
    const conn = connectAcp(t.transport)
    const p = conn.request('slow', {}, 500)
    vi.advanceTimersByTime(500)
    await expect(p).rejects.toThrow(/did not answer "slow" in time/)
    t.push({ jsonrpc: '2.0', id: 1, result: { late: true } })
    conn.close()
    expect(t.killed).toBe(true)
  })
})
