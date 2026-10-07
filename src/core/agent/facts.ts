import { monthLabel, ym } from '../dates'
import { listJoin, withArticle } from '../finance/copy'
import type { AppState, Minor, RecurringSeries, ToolName } from '../types'
import type { Intent } from './nlu'
import type { ActionStage } from './voice'
import { categoryLabel, findBill, findDream, money, pctLabel, shortDate } from './support'

/**
 * Tool outcomes → the pre-formatted fact strings voice.composeReply expects (see voice.FACT_KEYS).
 * Every number in a fact comes from tool data (or the call's own args), so offline replies stay grounded.
 */
export type Facts = Record<string, string>

/** The intent whose templates describe a tool's result. */
export const TOOL_INTENT: Partial<Record<ToolName, Intent>> = {
  get_overview: 'overview',
  get_spending_breakdown: 'breakdown',
  search_transactions: 'search',
  list_recurring: 'subscriptions',
  analyze_bills: 'bills',
  get_insights: 'insights',
  check_affordability: 'afford',
  get_goals: 'goals',
  xray_bill: 'xray',
  set_category_budget: 'set_budget',
  create_budget_plan: 'budget_plan',
  create_tripwire: 'tripwire',
  set_bill_reminder: 'bills',
  transfer_to_goal: 'save_to_goal',
  withdraw_from_goal: 'withdraw_goal',
  pay_bill: 'pay_bill',
  cancel_subscription: 'cancel_sub',
  dispute_transaction: 'dispute',
  add_payee: 'add_payee',
  transfer_external: 'external_transfer',
  invest: 'invest',
  apply_credit: 'credit',
  change_mandate: 'change_permissions',
}

type D = Record<string, unknown>
const obj = (v: unknown): D => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as D) : {})
const arr = (v: unknown): D[] => (Array.isArray(v) ? v.map(obj) : [])
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const noStop = (s: string | undefined) => s?.replace(/[.!\s]+$/, '')

function put(facts: Facts, key: string, value: string | undefined): void {
  if (value) facts[key] = value
}

function positive(f: (m: Minor) => string, v: unknown): string | undefined {
  const n = num(v)
  return n !== undefined && n > 0 ? f(n) : undefined
}

// ───────────────────────────── read tools ─────────────────────────────

export function readFacts(tool: ToolName, data: unknown, state: AppState): Facts {
  const builder = READERS[tool]
  return builder ? builder(obj(data), state) : {}
}

type Reader = (d: D, state: AppState) => Facts

function overviewFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const facts: Facts = {}
  put(facts, 'status', text(d.status))
  put(facts, 'month', text(d.monthLabel))
  put(facts, 'spent', f(num(d.spent) ?? 0))
  put(facts, 'target', f(num(d.target) ?? 0))
  put(facts, 'delta', positive(f, d.delta))
  put(facts, 'remaining', positive(f, d.remaining))
  put(facts, 'projected', positive(f, d.projected))
  put(facts, 'safeToSpend', positive(f, d.safeToSpendToday))
  put(facts, 'itemName', itemPhrase(d))
  put(facts, 'goalName', text(obj(d.goal).name))
  const delay = num(d.goalDelayDays)
  if (delay !== undefined && delay > 0) facts.goalDelayDays = String(delay)
  put(facts, 'headline', text(d.headline))
  return facts
}

function itemPhrase(d: D): string | undefined {
  const name = text(d.itemName)
  if (!name) return undefined
  const q = num(d.quantity)
  if (q !== undefined && q >= 2) return `${q}× ${name}`
  if (q === 1) return withArticle(name)
  const fr = num(d.fraction)
  return fr !== undefined && fr > 0 ? `${pctLabel(fr * 100)} of your ${name}` : withArticle(name)
}

function breakdownFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const facts: Facts = {}
  put(facts, 'month', text(d.monthLabel))
  put(facts, 'total', positive(f, d.total))
  const top = arr(d.categories)[0]
  if (top && (num(top.spent) ?? 0) > 0) {
    put(facts, 'topCategory', text(top.label))
    put(facts, 'topAmount', f(num(top.spent) ?? 0))
    put(facts, 'topShare', num(top.share) !== undefined ? pctLabel(num(top.share) as number) : undefined)
  }
  const focus = obj(d.focus)
  if (text(focus.label)) {
    put(facts, 'category', text(focus.label))
    put(facts, 'categorySpent', f(num(focus.spent) ?? 0))
    put(facts, 'categoryLimit', positive(f, focus.limit))
    put(facts, 'categoryPct', num(focus.pct) !== undefined ? `${num(focus.pct)}%` : undefined)
    put(facts, 'categoryPrev', positive(f, focus.prevMonth))
    const count = num(focus.count)
    if (count) facts.count = String(count)
    put(facts, 'itemEquivalent', text(focus.equivalent))
  }
  return facts
}

function searchFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const facts: Facts = { count: String(num(d.count) ?? 0) }
  put(facts, 'query', text(d.query) ?? (text(d.category) ? categoryLabel(text(d.category)) : undefined))
  const month = text(d.month)
  if (month && /^\d{4}-\d{2}$/.test(month)) facts.month = monthLabel(month)
  put(facts, 'total', positive(f, d.total))
  const largest = obj(d.largest)
  if (num(largest.amount)) facts.largest = `${f(num(largest.amount) as number)} at ${text(largest.merchant) ?? 'a merchant'} on ${shortDate(text(largest.date))}`
  return facts
}

function subscriptionFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const facts: Facts = { count: String(num(d.count) ?? 0) }
  put(facts, 'monthlyTotal', positive(f, d.monthlyTotal))
  put(facts, 'annualTotal', positive(f, d.annualTotal))
  const hike = obj(d.priceHike)
  if (text(hike.merchant)) facts.priceHike = `${text(hike.merchant)} went from ${f(num(hike.from) ?? 0)} to ${f(num(hike.to) ?? 0)}`
  const overlap = obj(d.overlap)
  const names = Array.isArray(overlap.merchants) ? (overlap.merchants as string[]) : []
  if (names.length >= 2) facts.overlap = `you pay for ${names.length} video services (${listJoin(names)})`
  return facts
}

function billsFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const findings = arr(d.findings)
  const facts: Facts = { count: String(findings.length) }
  const next = arr(d.upcoming)[0]
  if (next) facts.nextBill = `${text(next.name)} (${f(num(next.amountDue) ?? 0)}, due ${shortDate(text(next.dueDate))})`
  const first = (kind: string) => noStop(text(findings.find((x) => x.kind === kind)?.title))
  put(facts, 'duplicate', first('duplicate_charge'))
  put(facts, 'spike', first('bill_spike'))
  put(facts, 'priceHike', first('price_hike'))
  return facts
}

function insightFacts(d: D): Facts {
  const insights = arr(d.insights)
  const facts: Facts = { count: String(insights.length) }
  const [top, second] = insights
  if (top) {
    put(facts, 'top', noStop(text(top.title)))
    put(facts, 'topWhy', noStop(text(top.why)))
    put(facts, 'itemEquivalent', text(top.dream))
  }
  if (second) put(facts, 'second', noStop(text(second.title)))
  return facts
}

function affordFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const facts: Facts = {}
  put(facts, 'verdict', text(d.verdict))
  const label = text(d.label)
  put(facts, 'label', label && label !== 'this' ? label : undefined)
  put(facts, 'amount', positive(f, d.amount))
  const after = num(d.remainingAfter)
  if (after !== undefined && after >= 0) facts.remainingAfter = f(after)
  put(facts, 'overTargetBy', positive(f, d.overTargetBy))
  const hours = num(d.hoursOfWork)
  if (hours) facts.hoursOfWork = String(hours)
  put(facts, 'goalName', text(d.goalName))
  const delay = num(d.goalDelayDays)
  if (delay) facts.goalDelayDays = String(delay)
  put(facts, 'equivalent', text(arr(d.equivalents)[0]?.label))
  return facts
}

function goalsFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const goals = arr(d.goals)
  const facts: Facts = { count: String(goals.length) }
  const primary = goals.find((g) => g.kind === 'goal') ?? goals[0]
  if (!primary) return facts
  put(facts, 'goalName', text(primary.name))
  facts.saved = f(num(primary.saved) ?? 0)
  facts.price = f(num(primary.price) ?? 0)
  facts.pct = pctLabel(num(primary.pct) ?? 0)
  const eta = text(primary.etaDate)
  if (eta) facts.eta = monthLabel(ym(eta))
  put(facts, 'monthlyRate', positive(f, primary.monthlyRate))
  const others = goals.filter((g) => g !== primary).slice(0, 3).map((g) => `${text(g.name)} (${pctLabel(num(g.pct) ?? 0)})`)
  if (others.length) facts.others = listJoin(others)
  return facts
}

function xrayFacts(d: D, state: AppState): Facts {
  const f = money(state)
  const facts: Facts = {}
  if (obj(d.injection).suspicious === true) facts.injection = 'yes'
  put(facts, 'merchant', text(d.merchant))
  put(facts, 'total', positive(f, d.total))
  put(facts, 'dueDate', shortDate(text(d.dueDate)))
  const lines = arr(d.lineItems).length
  if (lines) facts.lineCount = String(lines)
  const cmp = obj(d.comparison)
  const change = num(cmp.changePct)
  if (change !== undefined && num(cmp.previousAverage)) {
    facts.comparison = `that's ${Math.abs(Math.round(change))}% ${change >= 0 ? 'above' : 'below'} your usual ${f(num(cmp.previousAverage) as number)}`
  }
  const warnings = Array.isArray(d.warnings) ? (d.warnings as string[]) : []
  put(facts, 'warning', noStop(warnings.find((w) => !/instructions|safety scan|above your usual/i.test(w))))
  return facts
}

const READERS: Partial<Record<ToolName, Reader>> = {
  get_overview: overviewFacts,
  get_spending_breakdown: breakdownFacts,
  search_transactions: searchFacts,
  list_recurring: subscriptionFacts,
  analyze_bills: billsFacts,
  get_insights: insightFacts,
  check_affordability: affordFacts,
  get_goals: goalsFacts,
  xray_bill: xrayFacts,
}

// ───────────────────────────── action tools ─────────────────────────────

export interface ActionInfo {
  stage: ActionStage
  /** executed tool data */
  data?: unknown
  /** plain policy / error reason (blocked) */
  reason?: string
  /** "A, B or C" for need_target */
  options?: string
  recurring?: RecurringSeries[]
}

export function actionFacts(tool: ToolName, args: Record<string, unknown>, state: AppState, info: ActionInfo): Facts {
  const f = money(state)
  const facts: Facts = { stage: info.stage }
  put(facts, 'reason', noStop(info.reason))
  put(facts, 'options', info.options)
  const data = obj(info.data)
  const amount = num(args.amount)
  switch (tool) {
    case 'transfer_to_goal':
    case 'withdraw_from_goal': {
      put(facts, 'amount', amount ? f(amount) : undefined)
      put(facts, 'goalName', findDream(state, args.goalId)?.name ?? text(data.goalName))
      if (num(data.newPct) !== undefined) facts.newPct = pctLabel(num(data.newPct) as number)
      break
    }
    case 'set_category_budget': {
      const category = text(args.category)
      put(facts, 'category', category ? categoryLabel(category) : undefined)
      put(facts, 'limit', positive(f, args.limit))
      const prev = num(data.previousLimit) ?? state.budget?.categories.find((c) => c.category === category)?.limit
      put(facts, 'previousLimit', positive(f, prev))
      put(facts, 'lastMonth', positive(f, data.lastMonth))
      break
    }
    case 'create_budget_plan': {
      const method = text(data.method) ?? text(args.method)
      put(facts, 'method', method === 'fifty_thirty_twenty' ? 'the 50/30/20 rule' : method === 'history' ? 'your last 3 months' : method)
      put(facts, 'total', positive(f, data.total))
      put(facts, 'needs', positive(f, data.needs))
      put(facts, 'wants', positive(f, data.wants))
      put(facts, 'savings', positive(f, data.savings))
      put(facts, 'rationale', noStop(text(data.rationale)))
      break
    }
    case 'create_tripwire': {
      put(facts, 'label', text(data.label) ?? text(args.label))
      put(facts, 'itemName', text(data.itemName) ?? state.dreams.find((d) => d.kind === 'goal' && !d.achievedAt)?.name)
      break
    }
    case 'pay_bill': {
      const bill = findBill(state, args.billId)
      put(facts, 'billName', bill?.name ?? text(data.billName))
      put(facts, 'amount', positive(f, bill?.amountDue ?? data.amount))
      put(facts, 'dueDate', shortDate(bill?.dueDate))
      put(facts, 'payee', state.bank.payees.find((p) => p.id === bill?.payeeId)?.name)
      put(facts, 'scheduledFor', data.status === 'scheduled' ? shortDate(text(data.scheduledFor)) : undefined)
      break
    }
    case 'cancel_subscription': {
      const s = (info.recurring ?? []).find((r) => r.id === args.recurringId)
      put(facts, 'merchant', s?.merchant ?? text(data.merchant))
      put(facts, 'amount', positive(f, s?.lastAmount ?? data.monthly))
      put(facts, 'annualCost', positive(f, s?.annualCost ?? data.annualCost))
      break
    }
    case 'dispute_transaction': {
      const txn = state.bank.transactions.find((t) => t.id === args.txnId)
      put(facts, 'merchant', txn?.merchant)
      put(facts, 'amount', txn ? f(Math.abs(txn.amount)) : undefined)
      put(facts, 'date', shortDate(txn?.date))
      break
    }
    case 'set_bill_reminder': {
      const bill = findBill(state, args.billId)
      const days = num(args.daysBefore)
      if (bill && days !== undefined && info.stage === 'done') facts.reminder = `${days} day${days === 1 ? '' : 's'} before ${bill.name} is due (${shortDate(bill.dueDate)})`
      break
    }
  }
  return facts
}
