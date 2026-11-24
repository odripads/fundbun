import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const BRIDGE_PATH = resolve(import.meta.dirname, 'mcp-bridge.mjs')
const TOKEN = 'c'.repeat(48)

const servers: Server[] = []
const children: ChildProcessWithoutNullStreams[] = []

afterEach(async () => {
  for (const c of children.splice(0)) c.kill('SIGTERM')
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections()
          s.close(() => r())
        }),
    ),
  )
})

async function startBridgeServer(handler: (req: { auth?: string; body: Record<string, unknown> }) => { status: number; body: unknown }) {
  const seen: { auth?: string; body: Record<string, unknown> }[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const entry = { auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> }
      seen.push(entry)
      const out = handler(entry)
      const json = JSON.stringify(out.body)
      res.writeHead(out.status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
      res.end(json)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const port = (server.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}/api/agent/mcp`, seen }
}

function spawnBridge(env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [BRIDGE_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })
  children.push(child)
  const lines: Record<string, unknown>[] = []
  const waiters: ((msg: Record<string, unknown>) => void)[] = []
  let buf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buf += chunk
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      nl = buf.indexOf('\n')
      if (!line) continue
      const parsed = JSON.parse(line) as Record<string, unknown>
      const w = waiters.shift()
      if (w) w(parsed)
      else lines.push(parsed)
    }
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (c: string) => (stderr += c))

  return {
    child,
    stderr: () => stderr,
    send: (msg: Record<string, unknown> | string) => {
      child.stdin.write(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`)
    },
    next: () =>
      new Promise<Record<string, unknown>>((resolve) => {
        const ready = lines.shift()
        if (ready) return resolve(ready)
        waiters.push(resolve)
      }),
    exited: new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code))),
  }
}

describe('mcp-bridge.mjs', () => {
  it('exits with code 1 when FUNDBUN_BRIDGE_URL or FUNDBUN_BRIDGE_TOKEN is missing', async () => {
    const p = spawnBridge({ FUNDBUN_BRIDGE_URL: '', FUNDBUN_BRIDGE_TOKEN: '' })
    expect(await p.exited).toBe(1)
    expect(p.stderr()).toContain('FUNDBUN_BRIDGE_URL')
  })

  it('handles initialize, ping, tools/list, tools/call, errors and stdin EOF against an HTTP server', async () => {
    const srv = await startBridgeServer(({ auth, body }) => {
      if (auth !== `Bearer ${TOKEN}`) return { status: 401, body: { error: 'unauthorized' } }
      if (body.method === 'tools/list') {
        return { status: 200, body: { tools: [{ name: 'get_overview', description: 'Read', inputSchema: { type: 'object' } }] } }
      }
      if (body.method === 'tools/call') {
        if (body.name === 'boom') return { status: 500, body: { error: 'boom' } }
        return { status: 200, body: { content: JSON.stringify({ spent: 5000, args: body.arguments }), isError: false } }
      }
      return { status: 400, body: { error: 'bad' } }
    })

    const b = spawnBridge({ FUNDBUN_BRIDGE_URL: srv.url, FUNDBUN_BRIDGE_TOKEN: TOKEN })

    // invalid JSON and notifications are ignored cleanly
    b.send('not json')
    b.send({ jsonrpc: '2.0', method: 'notifications/initialized' })

    b.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(await b.next()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fundbun' }, capabilities: { tools: {} } },
    })

    b.send({ jsonrpc: '2.0', id: 2, method: 'ping' })
    expect(await b.next()).toEqual({ jsonrpc: '2.0', id: 2, result: {} })

    b.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    expect(await b.next()).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { tools: [{ name: 'get_overview', description: 'Read', inputSchema: { type: 'object' } }] },
    })

    b.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_overview', arguments: { month: '2026-10' } } })
    expect(await b.next()).toEqual({
      jsonrpc: '2.0',
      id: 4,
      result: { content: [{ type: 'text', text: '{"spent":5000,"args":{"month":"2026-10"}}' }], isError: false },
    })

    b.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'boom', arguments: {} } })
    expect(await b.next()).toMatchObject({ jsonrpc: '2.0', id: 5, error: { code: -32603, message: 'FundBun answered HTTP 500' } })

    b.send({ jsonrpc: '2.0', id: 6, method: 'unknown/method' })
    expect(await b.next()).toMatchObject({ jsonrpc: '2.0', id: 6, error: { code: -32601 } })

    expect(srv.seen.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true)

    b.child.stdin.end()
    expect(await b.exited).toBe(0)
  })
})
