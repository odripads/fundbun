import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createGatewayServer } from '../app'

const running: { close: () => Promise<void> }[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()))
})

async function start(): Promise<string> {
  const server = createGatewayServer({ provider: null, unavailableReason: 'no LLM', rateLimitRpm: 100 })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  running.push({
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  })
  return `http://127.0.0.1:${port}`
}

describe('email routes', () => {
  it('lists sources with the sandbox available and IMAP paths marked not-live-tested', async () => {
    const base = await start()
    const res = await fetch(`${base}/api/email/sources`)
    expect(res.status).toBe(200)
    const sources = (await res.json()) as { id: string; available: boolean; note: string }[]
    expect(sources.find((s) => s.id === 'sandbox')).toMatchObject({ available: true })
    const qq = sources.find((s) => s.id === 'qq')
    expect(qq).toMatchObject({ available: false })
    expect(qq!.note).toContain('授权码')
  })

  it('serves the synthetic sandbox mailbox without any IMAP account', async () => {
    const base = await start()
    const res = await fetch(`${base}/api/email/fetch?source=sandbox`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { source: string; messages: { id: string }[] }
    expect(body.source).toBe('sandbox')
    expect(body.messages.length).toBe(7)
    expect(body.messages.some((m) => m.id === 'sandbox-malicious')).toBe(true)
  })

  it('refuses unavailable sources (QQ/163 IMAP) with 501 and unknown sources with 404', async () => {
    const base = await start()
    const qq = await fetch(`${base}/api/email/fetch?source=qq`)
    expect(qq.status).toBe(501)
    expect((await qq.json())).toMatchObject({ error: 'source_unavailable' })
    const missing = await fetch(`${base}/api/email/fetch?source=nope`)
    expect(missing.status).toBe(404)
    expect((await missing.json())).toMatchObject({ error: 'unknown_source' })
  })
})
