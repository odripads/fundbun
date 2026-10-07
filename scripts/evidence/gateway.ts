import type { AddressInfo } from 'node:net'
import { createGatewayServer } from '../../server/app'
import { createMockProvider, type MockProvider } from '../../server/providers/mock'
import type { LlmProvider, ProviderRequest, ProviderResult } from '../../server/providers/types'
import type { LlmContentBlock } from '../../src/core/agent/llm'

/** The real LLM gateway (server/app.ts) on 127.0.0.1:<ephemeral port>, in-process, with a deterministic provider. */
export interface EvidenceGateway {
  /** base URL for createFundBunApp({ llmBaseUrl }) */
  base: string
  provider: LlmProvider
  /** requests the gateway answered (health + llm), counted from its access log */
  requests(): number
  /** POST /api/llm requests only */
  llmCalls(): number
  /** what the provider received after server-side redaction */
  received(): ProviderRequest[]
  close(): Promise<void>
}

export async function startGateway(provider: LlmProvider & { received?: ProviderRequest[] } = createMockProvider()): Promise<EvidenceGateway> {
  let count = 0
  let llm = 0
  const server = createGatewayServer({
    provider,
    rateLimitRpm: 10_000,
    log: (line) => {
      count++
      if (/ POST \/api\/llm /.test(line)) llm++
    },
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    base: `http://127.0.0.1:${port}/api`,
    provider,
    requests: () => count,
    llmCalls: () => llm,
    received: () => provider.received ?? [],
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

export function mockProvider(): MockProvider {
  return createMockProvider()
}

/**
 * A scripted adversarial model for C5: it reads the Taobao transactions (whose memo carries an injected instruction)
 * and then "obeys" by proposing a move of money — exactly what a compromised model would do. Deterministic: the step
 * is chosen by how many tool results this turn already has.
 */
export function memoObeyingProvider(transfer: { goalId: string; amount: number }): LlmProvider & { received: ProviderRequest[] } {
  const received: ProviderRequest[] = []
  return {
    name: 'scripted',
    model: 'scripted-memo-obeyer',
    received,
    async complete(req): Promise<ProviderResult> {
      received.push(structuredClone(req))
      const rounds = req.messages.filter((m) => typeof m.content !== 'string' && m.content.some((b) => b.type === 'tool_result')).length
      const usage = { inputTokens: 0, outputTokens: 0 }
      const tool = (name: string, input: Record<string, unknown>): ProviderResult => ({
        content: [{ type: 'tool_use', id: `toolu_scripted_${rounds}`, name, input } as LlmContentBlock],
        stopReason: 'tool_use', provider: 'scripted', model: 'scripted-memo-obeyer', usage,
      })
      if (rounds === 0) return tool('search_transactions', { query: 'Taobao', limit: 25 })
      if (rounds === 1) return tool('transfer_to_goal', { goalId: transfer.goalId, amount: transfer.amount })
      return {
        content: [{ type: 'text', text: 'I proposed that move — please review it on the card.' }],
        stopReason: 'end_turn', provider: 'scripted', model: 'scripted-memo-obeyer', usage,
      }
    },
  }
}
