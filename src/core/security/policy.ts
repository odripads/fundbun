import type { BankState, DreamItem, ISODateTime, Mandate, Minor, PendingStatus, PolicyDecision, ToolCall, ToolName } from '../types'

export interface AgentActionRecord {
  ts: ISODateTime
  tool: ToolName
  amount: Minor
  status: PendingStatus
}

export interface PolicyContext {
  mandate: Mandate
  bank: BankState
  dreams: DreamItem[]
  /** the turn ingested untrusted content (bill text, memos, imported files) */
  tainted: boolean
  /** user granted separate consent for financial data processing */
  consentFinancial: boolean
  now: ISODateTime
  /** agent-originated actions (any status) for caps & rate limiting */
  recentAgentActions: AgentActionRecord[]
}

/** Safe defaults: autonomy 'copilot', perActionCap ¥500, dailyCap ¥1,000, monthlyCap ¥5,000, undo 30s, 20 actions/h. */
export function defaultMandate(): Mandate {
  throw new Error('TODO defaultMandate')
}

/**
 * Validate tool args against TOOL_SPECS[tool].inputSchema (supports the subset used there: object,
 * properties, required, additionalProperties:false, type string/integer/boolean, enum, minimum, maximum,
 * maxLength, pattern). Also rejects non-finite / non-integer money.
 */
export function validateArgs(call: ToolCall): { ok: boolean; errors: string[] } {
  throw new Error('TODO validateArgs ' + call.tool)
}

/**
 * Deterministic policy gate — the LLM can only PROPOSE; this decides. Rules, in order (each adds a ruleId):
 *  P-UNKNOWN-TOOL        unknown tool → deny
 *  P-CONSENT             no financial-data consent → deny everything
 *  P-T4-PROHIBITED       tier 4 → deny
 *  P-ARGS                schema/argument validation failure → deny
 *  P-TOOL-DISABLED       tool in mandate.disabledTools → deny
 *  P-FROZEN              mandate.frozen and tier >= 1 → deny
 *  P-OBSERVE             autonomy 'observe' and tier >= 1 → deny
 *  P-RATE                > maxActionsPerHour agent actions in the last hour → deny
 *  P-ENTITY              referenced goal/bill/txn/recurring must exist; bill payee must be verified → deny
 *  P-CAP-PER-ACTION      money amount > perActionCap → deny
 *  P-CAP-DAILY / P-CAP-MONTHLY   cumulative executed/approved agent money movement would exceed caps → deny
 *  P-FUNDS               transfer_to_goal amount > checking balance → deny
 *  P-LIQUIDITY           transfer_to_goal would leave checking below (unpaid bills due in the next 14 days + ¥500
 *                        buffer) → deny with a plain reason (protects against overdraft — Medina 2021)
 *  P-TAINT               tainted turn + tier >= 2 → at least 'confirm' (never auto-execute)
 *  P-TIER-MATRIX         tier vs autonomy: T0 allow; T1 allow (copilot/autopilot) else confirm;
 *                        T2 allow only in autopilot (untainted, within caps) else confirm; T3 always step_up.
 */
export function evaluatePolicy(call: ToolCall, ctx: PolicyContext): PolicyDecision {
  throw new Error('TODO evaluatePolicy ' + call.tool + ctx.now)
}

/**
 * Circuit breaker (human-takeover trigger): trip when, within the last 10 minutes, there were >= 3 denied
 * money-moving agent attempts, or any denied money-moving attempt in a tainted turn. The controller then
 * sets mandate.frozen = true, breakerTrippedAt/breakerReason, and audits 'circuit_breaker'.
 */
export function shouldTripBreaker(
  recent: (AgentActionRecord & { tainted?: boolean; decision?: PolicyDecision['decision'] })[],
  now: ISODateTime,
): { trip: boolean; reason?: string } {
  throw new Error('TODO shouldTripBreaker ' + recent.length + now)
}

/** Money amount a call would move (0 for non-money tools); pay_bill uses the bill's amountDue. */
export function callAmount(call: ToolCall, bank: BankState): Minor {
  throw new Error('TODO callAmount ' + call.tool + bank.today)
}
