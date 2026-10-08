import { pastedBillLine } from '../agent/support'
import type { AppApi, LlmStatus, Result } from '../app-api'
import type { ChatMessage, SuggestedAction } from '../types'
import { STATIC_BUILD_REASON } from './constants'
import { LOCKED_MSG, NOT_SET_UP_MSG, syncClock, type Core } from './core'
import { WELCOME_SUGGESTIONS, assistantMessage, turnErrorMessage, unavailablePending, userMessage } from './messages'
import { OK, attempt, errorMessage, fail, safely } from './util'

type AgentApi = Pick<
  AppApi,
  'sendMessage' | 'xrayBill' | 'approveAction' | 'rejectAction' | 'undoAction' | 'runSuggestedAction' | 'clearChat' | 'checkLlm'
>

export function initialLlmStatus(hasClient: boolean): LlmStatus {
  return hasClient ? { checked: false, available: false } : { checked: true, available: false, reason: STATIC_BUILD_REASON }
}

export function createAgentApi(core: Core): AgentApi {
  const { store, engines } = core

  function busy(delta: number) {
    store.setRuntime({ busy: Math.max(0, store.runtime().busy + delta) })
  }

  /** Persist the failed turn (user text + an apology) so the conversation stays coherent. Never throws. */
  function recordFailure(text: string, chatStart: number, e: unknown, source: 'chat' | 'xray' = 'chat'): ChatMessage {
    console.error('[fundbun] agent turn failed:', e)
    const ts = core.now()
    const msg = turnErrorMessage(errorMessage(e), ts)
    // a pasted bill is never stored verbatim, not even when the turn fails
    const shown = source === 'xray' ? safely('pastedBillLine', () => pastedBillLine(text), 'Pasted a bill') : text
    safely('record failed turn', () => store.mutate((draft) => {
      const hasUser = draft.chat.slice(chatStart).some((m) => m.role === 'user' && (m.text === text || m.text === shown))
      if (!hasUser) draft.chat.push(userMessage(shown, ts))
      draft.chat.push(msg)
    }), undefined)
    return msg
  }

  async function turn(text: string, source: 'chat' | 'xray'): Promise<ChatMessage> {
    const ts = core.now()
    if (core.lock.locked) return assistantMessage(LOCKED_MSG, ts)
    if (!store.get().profile) return assistantMessage(NOT_SET_UP_MSG, ts)
    if (typeof text !== 'string' || !text.trim()) {
      return assistantMessage('What would you like to know?', ts, { suggestions: WELCOME_SUGGESTIONS })
    }
    syncClock(core)
    const chatStart = store.get().chat.length
    busy(+1)
    try {
      const engine = engines.get()
      safely('engine.expire', () => engine.expire(), undefined)
      return await engine.respond(text, { source })
    } catch (e) {
      return recordFailure(text, chatStart, e, source)
    } finally {
      busy(-1)
    }
  }

  async function checkLlm(): Promise<void> {
    const set = (llm: LlmStatus) => store.setRuntime({ llm })
    const client = core.llmClient
    if (!client) return set(initialLlmStatus(false))
    const s = store.get()
    if (!s.settings.llmEnabled) return set({ checked: true, available: false, reason: 'The LLM engine is switched off in settings' })
    if (!s.profile?.consent.llmProcessing) {
      return set({ checked: true, available: false, reason: 'No consent for LLM processing: using the on-device engine' })
    }
    try {
      const h = await client.health()
      const status: LlmStatus = { checked: true, available: h.ok === true }
      if (h.provider) status.provider = h.provider
      if (h.model) status.model = h.model
      if (!h.ok) status.reason = h.reason ?? 'LLM gateway unavailable'
      set(status)
    } catch (e) {
      set({ checked: true, available: false, reason: `LLM gateway unreachable: ${errorMessage(e)}` })
    }
  }

  return {
    sendMessage: (text) => turn(text, 'chat'),
    xrayBill: (text) => turn(text, 'xray'),
    async approveAction(pendingId, pin): Promise<Result> {
      if (core.lock.locked) return fail(LOCKED_MSG)
      syncClock(core)
      try {
        const r = await engines.get().approve(pendingId, pin)
        return r.ok ? OK : fail(r.error ?? 'Action was not approved')
      } catch (e) {
        return fail(errorMessage(e))
      }
    },
    rejectAction(pendingId) {
      if (core.lock.locked) return
      safely('engine.reject', () => engines.get().reject(pendingId), undefined)
    },
    undoAction(pendingId) {
      if (core.lock.locked) return fail(LOCKED_MSG)
      return attempt(() => {
        const r = engines.get().undo(pendingId)
        return r.ok ? OK : fail(r.error ?? 'Could not undo that action')
      })
    },
    async runSuggestedAction(action: SuggestedAction) {
      const reason = core.lock.locked ? LOCKED_MSG : !store.get().profile ? NOT_SET_UP_MSG : null
      if (reason) return unavailablePending(action, 'user', reason, core.now())
      syncClock(core)
      try {
        return await engines.get().propose(action, 'user')
      } catch (e) {
        console.error('[fundbun] propose failed:', e)
        return unavailablePending(action, 'user', `Bun could not check this action: ${errorMessage(e)}`, core.now())
      }
    },
    clearChat() {
      if (core.lock.locked) return
      safely('clearChat', () => store.mutate((draft) => {
        draft.chat = []
        draft.dialogue = {}
      }), undefined)
    },
    checkLlm,
  }
}
