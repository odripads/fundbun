import { TOOL_SPECS, isToolName } from '../agent/specs'
import { addDays } from '../dates'
import { fmt, toMinor } from '../money'
import type {
  Account,
  Autonomy,
  BankState,
  Bill,
  Currency,
  Decision,
  DreamItem,
  ISODateTime,
  Mandate,
  Minor,
  PendingStatus,
  PolicyDecision,
  Tier,
  ToolCall,
  ToolName,
} from '../types'

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
  /**
   * OPTIONAL: ids of the recurring series the finance engine detected (finance/recurring). Used by the
   * cancel_subscription entity check. When omitted, the ids found on bank.transactions[].recurringId are used.
   */
  knownRecurringIds?: string[]
  /**
   * OPTIONAL: minutes east of UTC used to bucket the daily / monthly caps into calendar days
   * (default 0 = UTC; China Standard Time = 480).
   */
  utcOffsetMinutes?: number
}

// ───────────────────────────── constants ─────────────────────────────

/** Strings without an explicit maxLength in the tool schema are capped at this length. */
export const DEFAULT_MAX_STRING_LENGTH = 1000
/** P-LIQUIDITY looks at unpaid bills due within this many days of the sandbox "today". */
export const LIQUIDITY_HORIZON_DAYS = 14
/** P-LIQUIDITY cushion kept in checking on top of bills due soon, in major units (¥500). */
export const LIQUIDITY_BUFFER_MAJOR = 500
/** pay_bill may be scheduled at most this many days ahead. */
export const MAX_SCHEDULE_DAYS = 60
export const RATE_WINDOW_MS = 60 * 60_000
export const BREAKER_WINDOW_MINUTES = 10
export const BREAKER_MAX_DENIALS = 3

const DECISION_RANK: Record<Decision, number> = { allow: 0, confirm: 1, step_up: 2, deny: 3 }

const AUTONOMY_LABEL: Record<Autonomy, string> = {
  observe: 'Observe',
  suggest: 'Suggest',
  copilot: 'Co-pilot',
  autopilot: 'Autopilot',
}

const T4_REASONS: Partial<Record<ToolName, string>> = {
  add_payee: 'Adding a new payee is never allowed for the assistant. Only you can add payees, in your bank app.',
  transfer_external: 'Sending money to other people or outside accounts is never allowed for the assistant.',
  invest: 'The assistant is never allowed to buy investments.',
  apply_credit: 'The assistant is never allowed to apply for loans or credit.',
  change_mandate: 'The assistant can never change its own permissions. Only you can, in Settings, with your PIN.',
}

// ───────────────────────────── mandate ─────────────────────────────

/** Safe defaults: autonomy 'copilot', perActionCap ¥500, dailyCap ¥1,000, monthlyCap ¥5,000, undo 30s, 20 actions/h. */
export function defaultMandate(): Mandate {
  return {
    autonomy: 'copilot',
    perActionCap: 50_000,
    dailyCap: 100_000,
    monthlyCap: 500_000,
    disabledTools: [],
    frozen: false,
    undoWindowSec: 30,
    maxActionsPerHour: 20,
    failedPinAttempts: 0,
  }
}

// ───────────────────────────── argument validation ─────────────────────────────

interface PropSchema {
  type?: string
  enum?: unknown[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
}

/**
 * Validate tool args against TOOL_SPECS[tool].inputSchema (supports the subset used there: object,
 * properties, required, additionalProperties:false, type string/integer/boolean, enum, minimum, maximum,
 * maxLength, pattern). Also rejects non-finite / non-integer money.
 * Extra checks beyond the schema: args must be a plain JSON object (no prototype tricks), strings without
 * a maxLength are capped at DEFAULT_MAX_STRING_LENGTH, months/dates must be real calendar values, and a
 * category_pct tripwire needs a category.
 */
export function validateArgs(call: ToolCall): { ok: boolean; errors: string[] } {
  const tool = typeof call?.tool === 'string' ? call.tool : ''
  if (!isToolName(tool)) return { ok: false, errors: [`unknown tool "${clip(tool)}"`] }
  const args: unknown = call.args
  if (!isPlainObject(args)) return { ok: false, errors: ['the arguments must be a JSON object'] }
  const schema = TOOL_SPECS[tool].inputSchema
  const errors: string[] = []
  for (const key of Object.keys(args)) {
    if (!hasOwn(schema.properties, key) && schema.additionalProperties === false) errors.push(`unexpected argument "${clip(key)}"`)
  }
  for (const key of schema.required ?? []) {
    if (!hasOwn(args, key) || args[key] === undefined) errors.push(`missing required argument "${key}"`)
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (hasOwn(args, key) && args[key] !== undefined) errors.push(...checkValue(key, args[key], prop as PropSchema))
  }
  if (errors.length === 0) errors.push(...semanticErrors(tool, args))
  return { ok: errors.length === 0, errors }
}

function checkValue(key: string, v: unknown, prop: PropSchema): string[] {
  switch (prop.type) {
    case 'string': {
      if (typeof v !== 'string') return [`${key} must be text`]
      const max = prop.maxLength ?? DEFAULT_MAX_STRING_LENGTH
      if (v.length > max) return [`${key} is too long (max ${max} characters)`]
      if (prop.minLength !== undefined && v.length < prop.minLength) return [`${key} is too short`]
      if (prop.pattern !== undefined && !new RegExp(prop.pattern).test(v)) return [`${key} has an invalid format`]
      break
    }
    case 'integer':
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) return [`${key} must be a whole number`]
      break
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return [`${key} must be a number`]
      break
    case 'boolean':
      if (typeof v !== 'boolean') return [`${key} must be true or false`]
      break
  }
  if (prop.enum && !prop.enum.includes(v)) return [`${key} is not one of the allowed values`]
  if (typeof v === 'number') {
    if (prop.minimum !== undefined && v < prop.minimum) return [`${key} must be at least ${prop.minimum}`]
    if (prop.maximum !== undefined && v > prop.maximum) return [`${key} must be at most ${prop.maximum}`]
  }
  return []
}

function semanticErrors(tool: ToolName, args: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (typeof args.month === 'string' && !isRealMonth(args.month)) errors.push('month must be a real month (YYYY-MM)')
  if (typeof args.date === 'string' && !isRealDate(args.date)) errors.push('date must be a real calendar date (YYYY-MM-DD)')
  if (tool === 'create_tripwire') {
    const kind = args.kind
    if (kind === 'category_pct' && args.category === undefined) errors.push('a category tripwire needs a category')
    const pctKind = kind === 'month_pct' || kind === 'category_pct' || kind === 'pace_over'
    if (pctKind && typeof args.threshold === 'number' && args.threshold > 1000) errors.push('a percentage threshold must be at most 1000')
  }
  return errors
}

function isRealMonth(m: string): boolean {
  const mm = Number(m.slice(5, 7))
  return /^\d{4}-\d{2}$/.test(m) && mm >= 1 && mm <= 12
}

function isRealDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d
}

// ───────────────────────────── policy gate ─────────────────────────────

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
 *
 * The first deny wins (its ruleId is the only one reported). P-FUNDS also covers withdraw_from_goal (pot
 * balance) and paying a bill now (checking balance). Never throws on hostile calls; a corrupted mandate fails
 * closed (missing caps count as ¥0, an unknown autonomy level never auto-executes).
 */
export function evaluatePolicy(call: ToolCall, ctx: PolicyContext): PolicyDecision {
  const tainted = ctx.tainted === true
  const tool = typeof call?.tool === 'string' ? call.tool : ''
  if (!isToolName(tool)) {
    return denial(4, tainted, 'P-UNKNOWN-TOOL', `The assistant asked for an action that doesn't exist ("${clip(tool)}"), so nothing was done.`)
  }
  const spec = TOOL_SPECS[tool]
  const tier = spec.tier
  const deny = (ruleId: string, reason: string) => denial(tier, tainted, ruleId, reason)
  const { mandate, bank } = ctx
  const currency = bankCurrency(bank)
  const money = (m: Minor) => fmt(m, currency)

  if (!ctx.consentFinancial) {
    return deny('P-CONSENT', "You haven't agreed to let FundBun process your financial data, so the assistant can't read or act on it.")
  }
  if (tier === 4) return deny('P-T4-PROHIBITED', T4_REASONS[tool] ?? 'This action is never allowed for the assistant.')

  const validation = validateArgs(call)
  if (!validation.ok) return deny('P-ARGS', `The request was blocked because its details were invalid: ${validation.errors.join('; ')}.`)
  const args = call.args

  if ((mandate.disabledTools ?? []).includes(tool)) return deny('P-TOOL-DISABLED', `You switched off "${spec.label}" for the assistant.`)
  if (tier >= 1 && mandate.frozen) {
    const why = mandate.breakerReason ? ` The safety breaker paused it: ${mandate.breakerReason}` : ''
    return deny('P-FROZEN', `The assistant is paused, so it can only read and explain until you turn it back on.${why}`)
  }
  if (tier >= 1 && mandate.autonomy === 'observe') {
    return deny('P-OBSERVE', 'Your assistant is set to Observe, so it can explain things but not take actions.')
  }
  if (tier >= 1) {
    const lastHour = actionsInLastHour(ctx.recentAgentActions, ctx.now)
    const maxPerHour = limit(mandate.maxActionsPerHour, defaultMandate().maxActionsPerHour)
    if (lastHour >= maxPerHour) {
      return deny('P-RATE', `The assistant has already tried ${plural(lastHour, 'action')} in the last hour, which is your hourly limit (${maxPerHour}). It will wait before doing more.`)
    }
  }

  const entityProblem = checkEntities(tool, args, ctx)
  if (entityProblem) return deny('P-ENTITY', entityProblem)

  const amount = spec.movesMoney ? callAmount(call, bank) : 0
  if (spec.movesMoney) {
    const moneyDenial = checkMoney(tool, args, amount, ctx, money)
    if (moneyDenial) return deny(moneyDenial.ruleId, moneyDenial.reason)
  }

  return gate(tier, mandate.autonomy, tainted, amount, money, mandate.undoWindowSec)
}

function gate(tier: Tier, autonomy: Autonomy, tainted: boolean, amount: Minor, money: (m: Minor) => string, undoSec: number): PolicyDecision {
  const ruleIds: string[] = []
  const reasons: string[] = []
  let decision: Decision = 'allow'
  if (tainted && tier >= 2) {
    ruleIds.push('P-TAINT')
    reasons.push('This conversation included text from outside FundBun (a bill, memo or import), so nothing that moves money happens without your tap.')
    decision = 'confirm'
  }
  const matrix = tierMatrix(tier, autonomy, tainted, amount, money, undoSec)
  ruleIds.push('P-TIER-MATRIX')
  reasons.push(matrix.reason)
  if (DECISION_RANK[matrix.decision] > DECISION_RANK[decision]) decision = matrix.decision
  return { decision, tier, reasons, ruleIds, tainted }
}

function tierMatrix(tier: Tier, autonomy: Autonomy, tainted: boolean, amount: Minor, money: (m: Minor) => string, undoSec: number): { decision: Decision; reason: string } {
  const mode = AUTONOMY_LABEL[autonomy] ?? 'its current'
  if (tier === 0) return { decision: 'allow', reason: 'Reading and explaining your data is always allowed.' }
  if (tier === 1) {
    return autonomy === 'copilot' || autonomy === 'autopilot'
      ? { decision: 'allow', reason: `Organizing changes (budgets, tripwires, categories, reminders) are reversible, and ${mode} mode lets the assistant make them.` }
      : { decision: 'confirm', reason: `Your assistant is in ${mode} mode, so it needs your tap before changing anything.` }
  }
  if (tier === 2) {
    if (autonomy !== 'autopilot') return { decision: 'confirm', reason: `Moving money between your own accounts needs your tap in ${mode} mode.` }
    return tainted
      ? { decision: 'confirm', reason: 'Autopilot would normally move this on its own, but this time it waits for your tap.' }
      : { decision: 'allow', reason: `Moving ${money(amount)} between your own accounts is within your limits, and Autopilot lets the assistant do it (you can undo it for ${undoSec} seconds).` }
  }
  return { decision: 'step_up', reason: 'Paying, cancelling or disputing always needs your confirmation and your PIN.' }
}

function denial(tier: Tier, tainted: boolean, ruleId: string, reason: string): PolicyDecision {
  return { decision: 'deny', tier, reasons: [reason], ruleIds: [ruleId], tainted }
}

// ───────────────────────────── entity checks (P-ENTITY) ─────────────────────────────

function checkEntities(tool: ToolName, args: Record<string, unknown>, ctx: PolicyContext): string | null {
  const { bank } = ctx
  switch (tool) {
    case 'transfer_to_goal':
    case 'withdraw_from_goal': {
      const dream = ctx.dreams.find((d) => d.id === args.goalId)
      if (!dream) return "That dream goal doesn't exist, so no money can be moved for it."
      const pot = findAccount(bank, potIdForGoal(dream))
      if (pot && pot.type !== 'pot') return `The savings pot for "${dream.name}" isn't a savings pot, so the assistant won't use it.`
      if (pot?.goalId && pot.goalId !== dream.id) return `The savings pot linked to "${dream.name}" belongs to a different goal.`
      if (tool === 'withdraw_from_goal' && !pot) return `There's no savings pot for "${dream.name}" yet, so there's nothing to move back.`
      return null
    }
    case 'pay_bill': {
      const bill = findBill(bank, args.billId)
      if (!bill) return "That bill doesn't exist, so it can't be paid."
      if (bill.status === 'paid' || bill.paidTxnId) return `The ${bill.name} bill is already paid.`
      const payee = bank.payees.find((p) => p.id === bill.payeeId)
      if (!payee) return `The ${bill.name} bill has no known payee, so the assistant can't pay it.`
      if (!payee.verified) return `${payee.name} isn't a verified payee, so the assistant can't pay them. Verify the payee in your bank app first.`
      if (typeof args.date === 'string') {
        if (args.date < bank.today) return "A bill payment can't be scheduled in the past."
        if (args.date > addDays(bank.today, MAX_SCHEDULE_DAYS)) return `A bill payment can be scheduled at most ${MAX_SCHEDULE_DAYS} days ahead.`
      }
      return null
    }
    case 'set_bill_reminder':
      return findBill(bank, args.billId) ? null : "That bill doesn't exist, so no reminder was set."
    case 'recategorize_transaction':
      return findTxn(bank, args.txnId) ? null : "That transaction doesn't exist."
    case 'dispute_transaction': {
      const txn = findTxn(bank, args.txnId)
      if (!txn) return "That transaction doesn't exist, so it can't be disputed."
      if (txn.amount >= 0) return 'Only charges (money going out) can be disputed.'
      if (bank.disputes.some((d) => d.txnId === txn.id) || txn.flags?.includes('disputed')) return 'That charge is already being disputed.'
      return null
    }
    case 'cancel_subscription': {
      const known = ctx.knownRecurringIds ?? bank.transactions.map((t) => t.recurringId).filter((id): id is string => !!id)
      return known.includes(args.recurringId as string) ? null : "That subscription wasn't found among your recurring charges, so it can't be cancelled."
    }
    default:
      return null
  }
}

// ───────────────────────────── money checks (caps, funds, liquidity) ─────────────────────────────

function checkMoney(
  tool: ToolName,
  args: Record<string, unknown>,
  amount: Minor,
  ctx: PolicyContext,
  money: (m: Minor) => string,
): { ruleId: string; reason: string } | null {
  const { mandate, bank } = ctx
  const perAction = limit(mandate.perActionCap, 0)
  const daily = limit(mandate.dailyCap, 0)
  const monthly = limit(mandate.monthlyCap, 0)
  if (amount > perAction) {
    return { ruleId: 'P-CAP-PER-ACTION', reason: `${money(amount)} is more than the ${money(perAction)} limit you set for a single assistant action.` }
  }
  const used = usedThisPeriod(ctx)
  if (used.today + amount > daily) {
    return {
      ruleId: 'P-CAP-DAILY',
      reason: `The assistant has already moved ${money(used.today)} today. Another ${money(amount)} would go over your ${money(daily)} daily limit.`,
    }
  }
  if (used.month + amount > monthly) {
    return {
      ruleId: 'P-CAP-MONTHLY',
      reason: `The assistant has already moved ${money(used.month)} this month. Another ${money(amount)} would go over your ${money(monthly)} monthly limit.`,
    }
  }

  const checking = checkingAccount(bank)
  if (tool === 'transfer_to_goal') {
    if (!checking) return { ruleId: 'P-FUNDS', reason: "There's no checking account to move money from." }
    if (amount > checking.balance) {
      return { ruleId: 'P-FUNDS', reason: `You only have ${money(Math.max(0, checking.balance))} in checking, so ${money(amount)} can't be moved.` }
    }
    return liquidityProblem(amount, checking, bank, money)
  }
  if (tool === 'withdraw_from_goal') {
    const dream = ctx.dreams.find((d) => d.id === args.goalId)
    const pot = dream ? findAccount(bank, potIdForGoal(dream)) : undefined
    if (!pot || amount > pot.balance) {
      return { ruleId: 'P-FUNDS', reason: `That pot only holds ${money(Math.max(0, pot?.balance ?? 0))}, so ${money(amount)} can't be moved back.` }
    }
  }
  if (tool === 'pay_bill') {
    const paysNow = typeof args.date !== 'string' || args.date <= bank.today
    if (paysNow && (!checking || amount > checking.balance)) {
      return { ruleId: 'P-FUNDS', reason: `You only have ${money(Math.max(0, checking?.balance ?? 0))} in checking, which isn't enough to pay ${money(amount)} now.` }
    }
  }
  return null
}

/** Unpaid bills due within the liquidity horizon (overdue ones included) — money that must stay in checking. */
export function billsDueSoon(bank: BankState, horizonDays = LIQUIDITY_HORIZON_DAYS): Minor {
  const horizon = addDays(bank.today, horizonDays)
  return bank.bills
    .filter((b) => b.status !== 'paid' && !b.paidTxnId && b.dueDate <= horizon)
    .reduce((s, b) => s + Math.max(0, b.amountDue), 0)
}

function liquidityProblem(amount: Minor, checking: Account, bank: BankState, money: (m: Minor) => string): { ruleId: string; reason: string } | null {
  const dueSoon = billsDueSoon(bank)
  const buffer = toMinor(LIQUIDITY_BUFFER_MAJOR, checking.currency)
  const left = checking.balance - amount
  if (left >= dueSoon + buffer) return null
  const safeMax = checking.balance - dueSoon - buffer
  const suggestion = safeMax > 0 ? ` You could safely move up to ${money(safeMax)}.` : ''
  return {
    ruleId: 'P-LIQUIDITY',
    reason: `Moving ${money(amount)} would leave ${money(Math.max(0, left))} in checking, but ${money(dueSoon)} of bills are due in the next ${LIQUIDITY_HORIZON_DAYS} days and FundBun keeps a ${money(buffer)} cushion so you don't overdraw.${suggestion}`,
  }
}

function usedThisPeriod(ctx: PolicyContext): { today: Minor; month: Minor } {
  return agentMoneyUsed(ctx.recentAgentActions, ctx.now, ctx.utcOffsetMinutes ?? 0)
}

/** Minutes east of UTC on this device at `now` (China Standard Time = 480), so caps follow the user's calendar. */
export function utcOffsetMinutesAt(now: ISODateTime): number {
  const ms = Date.parse(now)
  return Number.isFinite(ms) ? -new Date(ms).getTimezoneOffset() : 0
}

/**
 * Agent money movement counted against the daily / monthly caps: approved or executed agent records of
 * money-moving tools, bucketed into the calendar day and month of `now` shifted by `utcOffsetMinutes`.
 * The policy gate (P-CAP-DAILY / P-CAP-MONTHLY) and every UI that shows cap usage use this one function.
 */
export function agentMoneyUsed(records: readonly AgentActionRecord[] | undefined, now: ISODateTime, utcOffsetMinutes = 0): { today: Minor; month: Minor } {
  const offset = Number.isFinite(utcOffsetMinutes) ? utcOffsetMinutes : 0
  const nowMs = Date.parse(now)
  const day = periodKey(nowMs, offset, 10)
  const month = periodKey(nowMs, offset, 7)
  let today = 0
  let thisMonth = 0
  for (const r of records ?? []) {
    if (r.status !== 'approved' && r.status !== 'executed') continue
    if (!isToolName(r.tool) || !TOOL_SPECS[r.tool].movesMoney) continue
    const amt = Number.isFinite(r.amount) ? Math.abs(r.amount) : 0
    const ms = Date.parse(r.ts)
    // unparseable timestamps count against every period (fail closed)
    if (!Number.isFinite(ms) || periodKey(ms, offset, 10) === day) today += amt
    if (!Number.isFinite(ms) || periodKey(ms, offset, 7) === month) thisMonth += amt
  }
  return { today, month: thisMonth }
}

function periodKey(ms: number, offsetMin: number, len: 7 | 10): string {
  return Number.isFinite(ms) ? new Date(ms + offsetMin * 60_000).toISOString().slice(0, len) : 'invalid'
}

function actionsInLastHour(records: AgentActionRecord[] | undefined, now: ISODateTime): number {
  const nowMs = Date.parse(now)
  return (records ?? []).filter((r) => {
    const ms = Date.parse(r.ts)
    if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return true
    return ms > nowMs - RATE_WINDOW_MS
  }).length
}

// ───────────────────────────── circuit breaker ─────────────────────────────

/**
 * Circuit breaker (human-takeover trigger): trip when, within the last 10 minutes, there were >= 3 denied
 * money-moving agent attempts, or any denied money-moving attempt in a tainted turn. The controller then
 * sets mandate.frozen = true, breakerTrippedAt/breakerReason, and audits 'circuit_breaker'.
 * Tier-4 attempts (add_payee, change_mandate, …) count as money-moving: they are the first step of an induced
 * transfer or a privilege escalation. Pass `since` (e.g. when the user last un-froze the agent) so attempts
 * from before the reset don't immediately re-trip it.
 */
export function shouldTripBreaker(
  recent: (AgentActionRecord & { tainted?: boolean; decision?: PolicyDecision['decision'] })[],
  now: ISODateTime,
  opts: { since?: ISODateTime } = {},
): { trip: boolean; reason?: string } {
  const nowMs = Date.parse(now)
  const sinceMs = opts.since ? Date.parse(opts.since) : Number.NEGATIVE_INFINITY
  const windowStart = nowMs - BREAKER_WINDOW_MINUTES * 60_000
  const denied = (recent ?? []).filter((r) => {
    if (r.decision !== 'deny' && r.status !== 'denied') return false
    if (!isHighRisk(r)) return false
    const ms = Date.parse(r.ts)
    if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return true
    return ms > windowStart && ms >= sinceMs
  })
  const injected = denied.find((r) => r.tainted)
  if (injected) {
    return {
      trip: true,
      reason: `A blocked attempt to ${actionPhrase(injected.tool)} came right after reading outside text (possible prompt injection), so the assistant was paused.`,
    }
  }
  if (denied.length >= BREAKER_MAX_DENIALS) {
    return {
      trip: true,
      reason: `${denied.length} blocked attempts to move money in ${BREAKER_WINDOW_MINUTES} minutes, so the assistant was paused for your safety.`,
    }
  }
  return { trip: false }
}

function isHighRisk(r: AgentActionRecord): boolean {
  if (!isToolName(r.tool)) return Number.isFinite(r.amount) && r.amount > 0
  const spec = TOOL_SPECS[r.tool]
  return spec.movesMoney || spec.tier === 4
}

function actionPhrase(tool: string): string {
  return isToolName(tool) ? TOOL_SPECS[tool].label.toLowerCase() : 'move money'
}

// ───────────────────────────── amounts & lookups ─────────────────────────────

/** Money amount a call would move (0 for non-money tools); pay_bill uses the bill's amountDue. */
export function callAmount(call: ToolCall, bank: BankState): Minor {
  const tool = typeof call?.tool === 'string' ? call.tool : ''
  if (!isToolName(tool) || !TOOL_SPECS[tool].movesMoney) return 0
  const args = isPlainObject(call.args) ? call.args : {}
  if (tool === 'pay_bill') {
    const bill = findBill(bank, args.billId)
    return bill && Number.isSafeInteger(bill.amountDue) ? Math.max(0, bill.amountDue) : 0
  }
  const amount = hasOwn(args, 'amount') ? args.amount : undefined
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? amount : 0
}

/** The pot account id for a dream goal: its potAccountId, or the conventional `pot_<goalId>`. */
export function potIdForGoal(dream: Pick<DreamItem, 'id' | 'potAccountId'>): string {
  return dream.potAccountId ?? `pot_${dream.id}`
}

export function checkingAccount(bank: BankState): Account | undefined {
  return bank.accounts.find((a) => a.id === 'chk_main' && a.type === 'checking') ?? bank.accounts.find((a) => a.type === 'checking')
}

function bankCurrency(bank: BankState): Currency {
  return checkingAccount(bank)?.currency ?? bank.accounts[0]?.currency ?? 'CNY'
}

function findAccount(bank: BankState, id: string): Account | undefined {
  return bank.accounts.find((a) => a.id === id)
}

function findBill(bank: BankState, id: unknown): Bill | undefined {
  return typeof id === 'string' ? bank.bills.find((b) => b.id === id) : undefined
}

function findTxn(bank: BankState, id: unknown) {
  return typeof id === 'string' ? bank.transactions.find((t) => t.id === id) : undefined
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function hasOwn(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key)
}

/** Attacker-controlled strings (tool names, arg keys) are shortened and stripped before they reach UI copy. */
function clip(s: string, max = 40): string {
  // eslint-disable-next-line no-control-regex
  const clean = String(s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿<>"]/g, '')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** Non-negative finite limit, or the fallback when the stored value is missing or corrupted. */
function limit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`
}
