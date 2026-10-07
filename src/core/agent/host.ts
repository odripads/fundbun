import type {
  ActionPreview,
  AppState,
  AuditActor,
  AuditType,
  BillFinding,
  ChatCard,
  ChatMessage,
  FinanceContext,
  ISODateTime,
  PendingAction,
  RecurringSeries,
  SuggestedAction,
  ToolCall,
  Transaction,
  TripwireEvent,
} from '../types'
import type { SandboxBank } from '../sandbox/bank'
import type { LlmClient } from './llm'

/**
 * What the controller (src/core/app.ts) exposes to the agent runtime and the tool executors.
 * The runtime never touches storage or React — only this interface.
 */
export interface AgentHost {
  /** current immutable state snapshot */
  state(): AppState
  /** finance context of the current state (throws if not onboarded) */
  ctx(): FinanceContext
  /** derived analyses, memoised by the controller */
  recurring(): RecurringSeries[]
  findings(): BillFinding[]
  now(): ISODateTime
  /**
   * Atomic mutation: the controller deep-clones the state into a draft, hands the recipe the draft plus a live
   * SandboxBank wrapping draft.bank, then commits (persist + notify) if the recipe returns, or discards the draft if
   * it throws (the error propagates). Nested calls join the outer transaction.
   */
  mutate<T>(recipe: (draft: AppState, bank: SandboxBank) => T): T
  /** append a hash-chained audit entry (inside or outside mutate) */
  audit(actor: AuditActor, type: AuditType, summary: string, data?: Record<string, unknown>): void
  /** LLM client when the LLM engine is enabled, consented and reachable — otherwise null (use the offline engine) */
  llm(): LlmClient | null
  /** call after transactions were added: evaluates tripwires, stores events, audits; returns new events */
  afterTransactions(txns: Transaction[]): TripwireEvent[]
}

/** Result of running one tool. */
export interface ToolOutcome {
  ok: boolean
  /** compact JSON-able result (fed to the LLM / grounding check / offline templates) */
  data: unknown
  /** one-line human summary for traces and plan steps */
  summary: string
  /** rich UI cards to attach to the assistant message */
  cards: ChatCard[]
  error?: string
  /** transactions created (for undo) */
  txnIds?: string[]
  /** the result contains untrusted text (bill rawText, memos, imports) → taints the turn */
  untrusted?: boolean
}

/** The agent runtime as the controller sees it. Implemented by src/core/agent/runtime.ts. */
export interface AgentEngine {
  /** run one user turn; appends the user + assistant messages to state.chat and returns the assistant message */
  respond(text: string, opts?: { source?: 'chat' | 'xray' }): Promise<ChatMessage>
  /** route a UI SuggestedAction through the same policy gate (proposedBy 'user' when the user tapped a button) */
  propose(action: SuggestedAction, proposedBy: ToolCall['proposedBy']): Promise<PendingAction>
  /** approve a pending action (PIN required for step_up); re-verifies bindingHash and policy before executing */
  approve(pendingId: string, pin?: string): Promise<{ ok: boolean; error?: string }>
  reject(pendingId: string): void
  undo(pendingId: string): { ok: boolean; error?: string }
  /** mark expired pending actions (called by the controller on load and before each turn) */
  expire(): void
  /** structured preview for a call (used by the controller for UI-initiated proposals) */
  preview(call: ToolCall): ActionPreview
}

export type AgentEngineFactory = (host: AgentHost) => AgentEngine
