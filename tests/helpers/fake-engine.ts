import type { AgentEngine, AgentEngineFactory, AgentHost } from '../../src/core/agent/host'
import { uid } from '../../src/core/ids'
import type { ChatMessage, PendingAction, SuggestedAction, ToolCall } from '../../src/core/types'

export interface FakeEngineLog {
  created: number
  respond: { text: string; source?: string }[]
  expire: number
  approve: { id: string; pin?: string }[]
  reject: string[]
  undo: string[]
  propose: { action: SuggestedAction; proposedBy: ToolCall['proposedBy'] }[]
}

export interface FakeEngineOptions {
  /** replace the default echo reply (the default appends user + assistant messages via host.mutate) */
  respond?: (text: string, host: AgentHost) => Promise<ChatMessage>
  throwOnCreate?: boolean
}

export interface FakeEngineKit {
  factory: AgentEngineFactory
  log: FakeEngineLog
  /** the AgentHost the controller handed to the engine (after first use) */
  host(): AgentHost
}

export function echoReply(host: AgentHost, text: string): ChatMessage {
  const ts = host.now()
  const reply: ChatMessage = { id: uid('msg'), role: 'assistant', text: `echo: ${text}`, ts, engine: 'offline' }
  host.mutate((draft) => {
    draft.chat.push({ id: uid('msg'), role: 'user', text, ts }, reply)
  })
  return reply
}

function pendingFor(action: SuggestedAction, proposedBy: ToolCall['proposedBy'], ts: string): PendingAction {
  return {
    id: uid('pa'),
    call: { id: uid('call'), tool: action.tool, args: action.args, proposedBy },
    decision: { decision: 'confirm', tier: 2, reasons: ['fake'], ruleIds: ['P-TIER-MATRIX'], tainted: false },
    preview: { title: action.label, summary: action.label, reversible: true, risk: 'medium', effects: [] },
    createdAt: ts,
    expiresAt: ts,
    status: 'pending',
    bindingHash: 'fake',
  }
}

/** A deterministic stand-in for the agent runtime that exercises the AgentHost contract. */
export function fakeEngine(opts: FakeEngineOptions = {}): FakeEngineKit {
  const log: FakeEngineLog = { created: 0, respond: [], expire: 0, approve: [], reject: [], undo: [], propose: [] }
  let captured: AgentHost | null = null

  const factory: AgentEngineFactory = (host) => {
    log.created++
    captured = host
    if (opts.throwOnCreate) throw new Error('runtime not ready')
    const engine: AgentEngine = {
      async respond(text, o) {
        log.respond.push({ text, source: o?.source })
        return opts.respond ? opts.respond(text, host) : echoReply(host, text)
      },
      async propose(action, proposedBy) {
        log.propose.push({ action, proposedBy })
        const p = pendingFor(action, proposedBy, host.now())
        host.mutate((draft) => {
          draft.pending.push(p)
        })
        return p
      },
      async approve(id, pin) {
        log.approve.push({ id, pin })
        const p = host.state().pending.find((x) => x.id === id)
        if (!p) return { ok: false, error: 'not found' }
        host.mutate((draft, bank) => {
          const target = draft.pending.find((x) => x.id === id) as PendingAction
          if (target.call.tool === 'transfer_to_goal') {
            const { goalId, amount } = target.call.args as { goalId: string; amount: number }
            const txns = bank.transferInternal(bank.checking().id, `pot_${goalId}`, amount, 'fake transfer', 'agent')
            target.result = { txnIds: txns.map((t) => t.id) }
          }
          target.status = 'executed'
          host.audit('agent', 'action_executed', `Executed ${target.call.tool}`, { pendingId: id })
        })
        return { ok: true }
      },
      reject(id) {
        log.reject.push(id)
        host.mutate((draft) => {
          const p = draft.pending.find((x) => x.id === id)
          if (p) p.status = 'rejected'
        })
      },
      undo(id) {
        log.undo.push(id)
        return { ok: false, error: 'nothing to undo' }
      },
      expire() {
        log.expire++
      },
      preview(call) {
        return { title: call.tool, summary: call.tool, reversible: true, risk: 'low', effects: [] }
      },
    }
    return engine
  }

  return {
    factory,
    log,
    host() {
      if (!captured) throw new Error('engine not created yet')
      return captured
    },
  }
}

/** A promise you can resolve from the outside (to observe in-flight state). */
export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
