import { CATEGORIES, isSpendingCategory } from '../categories'
import { addMonths, daysInMonth, diffDays, monthLabel, monthsBack, shiftMonth, ym } from '../dates'
import {
  allGoalProgress,
  checkAffordability,
  computeMirror,
  describeTripwire,
  dreamEquivalents,
  generateInsights,
  goalProgress,
  normalizeMerchant,
  proposeBudget,
  subscriptionNiche,
  summarizeMonth,
  xrayBill,
} from '../finance'
import { FIXED_CATEGORIES, isSpending, spendValue } from '../finance/ledger'
import { uid } from '../ids'
import type { SandboxBank } from '../sandbox/bank'
import type {
  ActionPreview,
  AppState,
  BudgetPlan,
  CategoryId,
  ChatCard,
  FinanceContext,
  RecurringSeries,
  ToolCall,
  ToolName,
  Transaction,
  Tripwire,
} from '../types'
import type { AgentHost, ToolOutcome } from './host'
import { previewWithHost } from './previews'
import { TOOL_SPECS, isToolName } from './specs'
import {
  accountLabel,
  activeSubscriptions,
  categoryLabel,
  checkingOf,
  compact,
  ctxOf,
  currencyOf,
  errorText,
  findDream,
  money,
  pct,
  shortDate,
} from './support'

/** What an executed action needs to be undone (stored in PendingAction.result). */
export type UndoRecord =
  | { kind: 'money'; txnIds: string[] }
  | { kind: 'budget'; previous: BudgetPlan | null }
  | { kind: 'tripwire'; tripwireId: string }
  | { kind: 'recategorize'; txnId: string; category: CategoryId; categorySource: Transaction['categorySource']; categoryConfidence: number; ruleKey: string; previousRule?: CategoryId }
  | { kind: 'reminder'; billId: string; previous?: number }

export interface UntrustedText {
  source: string
  text: string
}

/** Internal result: the public ToolOutcome plus what the runtime needs for undo and injection scanning. */
export interface ToolRun {
  outcome: ToolOutcome
  undo?: UndoRecord
  untrustedTexts: UntrustedText[]
}

type Args = Record<string, unknown>
type Executor = (args: Args, host: AgentHost, call: ToolCall) => ToolRun

/** Execute a tool call that the policy engine already allowed / the user approved. Never call without the gate. */
export function executeTool(call: ToolCall, host: AgentHost): ToolOutcome {
  return runTool(call, host).outcome
}

/** Structured, code-built preview of what a call will do (never LLM prose). */
export function previewTool(call: ToolCall, host: AgentHost): ActionPreview {
  return previewWithHost(call, host)
}

export function runTool(call: ToolCall, host: AgentHost): ToolRun {
  if (!isToolName(call.tool)) return failed(`Unknown tool "${String(call.tool).slice(0, 40)}"`)
  if (TOOL_SPECS[call.tool].tier === 4) return failed(`${TOOL_SPECS[call.tool].label} is never allowed for the assistant`)
  const exec = EXECUTORS[call.tool]
  if (!exec) return failed(`No executor for ${call.tool}`)
  try {
    return exec(isRecord(call.args) ? call.args : {}, host, call)
  } catch (e) {
    return failed(errorText(e))
  }
}

function failed(error: string): ToolRun {
  return { outcome: { ok: false, data: { error }, summary: error, cards: [], error }, untrustedTexts: [] }
}

function ok(data: unknown, summary: string, cards: ChatCard[], extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { ok: true, data, summary, cards, ...extra }
}

function isRecord(v: unknown): v is Args {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined)

// ───────────────────────────── T0 · read ─────────────────────────────

function getOverview(args: Args, host: AgentHost): ToolRun {
  const ctx = host.ctx()
  const month = str(args.month)
  const s = summarizeMonth(ctx, month)
  const mirror = computeMirror(ctx, month)
  const data = compact({
    month: s.month,
    monthLabel: monthLabel(s.month),
    status: mirror.status,
    spent: s.spent,
    target: s.target,
    projected: s.projected,
    remaining: s.remaining,
    safeToSpendToday: s.safeToSpendToday,
    delta: mirror.delta,
    income: s.income,
    savedToGoals: s.savedToGoals,
    dayOfMonth: s.dayOfMonth,
    daysInMonth: s.daysInMonth,
    headline: mirror.headline,
    subline: mirror.subline,
    itemName: mirror.item?.name,
    quantity: mirror.quantity,
    fraction: mirror.fraction,
    goal: mirror.goal ? { id: mirror.goal.itemId, name: mirror.goal.name, saved: mirror.goal.saved, price: mirror.goal.price, pct: mirror.goal.pct } : undefined,
    goalDelayDays: mirror.goalDelayDays,
    hoursOfWork: mirror.hoursOfWork,
    mood: mirror.mood,
    cta: mirror.cta,
    ...balanceData(host.state()),
    ...paceData(s),
  })
  const f = money(host.state())
  return { outcome: ok(data, `${monthLabel(s.month)}: spent ${f(s.spent)} of ${f(s.target)} (${mirror.status})`, [{ type: 'mirror', mirror }]), untrustedTexts: [] }
}

/** Balances the user can see in the app anyway: the everyday account (masked number only) and each goal pot. */
function balanceData(state: AppState): Record<string, unknown> {
  const checking = checkingOf(state.bank)
  const pots = state.bank.accounts
    .filter((a) => a.type === 'pot')
    .map((a) => ({ goalId: a.goalId, name: state.dreams.find((d) => d.id === a.goalId)?.name ?? a.name, balance: a.balance }))
  return compact({
    checkingBalance: checking?.balance,
    checkingName: checking?.name,
    checkingMasked: checking?.maskedNumber,
    pots,
    potsTotal: pots.reduce((sum, p) => sum + p.balance, 0),
  })
}

/** Savings rate, days left and a per-day figure that keeps the rest of the month (or next month) on target. */
function paceData(s: ReturnType<typeof summarizeMonth>): Record<string, unknown> {
  const daysLeft = Math.max(0, s.daysInMonth - s.dayOfMonth)
  const kept = s.income - s.spent
  const next = shiftMonth(s.month, 1)
  return compact({
    daysLeft,
    overBy: s.remaining < 0 ? -s.remaining : undefined,
    perDayLeft: s.remaining > 0 && daysLeft > 0 ? Math.floor(s.remaining / daysLeft) : undefined,
    nextMonthDaily: s.target > 0 ? Math.floor(s.target / daysInMonth(next)) : undefined,
    nextMonthLabel: monthLabel(next),
    kept: s.income > 0 ? kept : undefined,
    savingsRate: s.income > 0 ? Math.round((kept / s.income) * 1000) / 10 : undefined,
  })
}

/** "Food" in everyday speech: delivery + eating out + groceries. */
export const CATEGORY_GROUPS: Record<string, { label: string; categories: CategoryId[] }> = {
  food: { label: 'Food', categories: ['delivery', 'dining', 'groceries'] },
}

function getSpendingBreakdown(args: Args, host: AgentHost): ToolRun {
  const ctx = host.ctx()
  const s = summarizeMonth(ctx, str(args.month))
  const groupKey = str(args.group)
  const group = groupKey ? CATEGORY_GROUPS[groupKey] : undefined
  const months = int(args.months)
  const extra = compact({
    compare: args.compare === true ? compareData(s, str(args.category)) : undefined,
    range: months && months >= 2 ? rangeData(ctx, s.month, Math.min(6, months), str(args.category), group?.categories) : undefined,
    group: group ? groupData(s, group) : undefined,
  })
  const items = s.byCategory.filter((c) => c.spent > 0 || c.limit !== undefined).sort((a, b) => b.spent - a.spent)
  const rows = items.map((c) => compact({
    category: c.category,
    label: categoryLabel(c.category),
    kind: CATEGORIES[c.category]?.kind,
    spent: c.spent,
    limit: c.limit,
    pct: c.pct !== undefined ? Math.round(c.pct) : undefined,
    prevMonth: c.prevMonth,
    count: c.count,
    share: pct(c.spent, s.spent),
  }))
  const category = str(args.category)
  const row = category ? rows.find((r) => r.category === category) ?? { category, label: categoryLabel(category), spent: 0, count: 0, share: 0 } : undefined
  const eq = row ? dreamEquivalents(row.spent, ctx.dreams, 1)[0] : undefined
  const prevToDate = category ? s.byCategory.find((c) => c.category === category)?.prevMonthToDate : undefined
  const focus = row ? compact({ ...row, prevMonthToDate: prevToDate, equivalent: eq?.label, equivalentItem: eq?.itemName, equivalentFraction: eq?.fraction }) : undefined
  const data = compact({ month: s.month, monthLabel: monthLabel(s.month), total: s.spent, target: s.target, categories: rows, focus, current: s.isCurrent, ...extra })
  const f = money(host.state())
  const top = rows[0]
  const summary = focus ? `${focus.label}: ${f(focus.spent)} in ${monthLabel(s.month)}` : top ? `Top category ${top.label} ${f(top.spent)} of ${f(s.spent)}` : 'No spending yet'
  return { outcome: ok(data, summary, [{ type: 'breakdown', month: s.month, items, total: s.spent, target: s.target }]), untrustedTexts: [] }
}

type Summary = ReturnType<typeof summarizeMonth>

/** This month against last month: like-for-like to the same day while the month is running, plus the movers. */
function compareData(s: Summary, category?: string): Record<string, unknown> {
  const prev = shiftMonth(s.month, -1)
  const likeForLike = s.isCurrent
  const prevOf = (c: Summary['byCategory'][number]) => (likeForLike ? c.prevMonthToDate ?? c.prevMonth ?? 0 : c.prevMonth ?? 0)
  const prevTotal = s.byCategory.reduce((sum, c) => sum + (c.prevMonth ?? 0), 0)
  const prevToDate = s.byCategory.reduce((sum, c) => sum + prevOf(c), 0)
  const movers = s.byCategory
    .filter((c) => isSpendingCategory(c.category))
    .map((c) => ({ category: c.category, label: categoryLabel(c.category), spent: c.spent, prev: prevOf(c), delta: c.spent - prevOf(c) }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
  const row = category ? s.byCategory.find((c) => c.category === category) : undefined
  return compact({
    month: s.month,
    monthLabel: monthLabel(s.month),
    prevMonth: prev,
    prevLabel: monthLabel(prev),
    likeForLike,
    dayOfMonth: s.dayOfMonth,
    total: s.spent,
    prevTotal,
    prevToDate,
    delta: s.spent - (likeForLike ? prevToDate : prevTotal),
    movers,
    category: row || category ? compact({ category, label: categoryLabel(category), spent: row?.spent ?? 0, prev: row ? prevOf(row) : 0, prevFull: row?.prevMonth ?? 0, delta: (row?.spent ?? 0) - (row ? prevOf(row) : 0) }) : undefined,
  })
}

/** A category (or group) month by month, oldest first; the current month is "so far". */
function rangeData(ctx: FinanceContext, month: string, n: number, category?: string, categories?: CategoryId[]): Record<string, unknown> {
  const list = categories ?? (category ? [category as CategoryId] : undefined)
  const rows = monthsBack(month, n).map((m) => {
    const sm = summarizeMonth(ctx, m)
    const spent = list ? sm.byCategory.filter((c) => list.includes(c.category)).reduce((sum, c) => sum + c.spent, 0) : sm.spent
    return { month: m, label: monthLabel(m, 'short'), spent, current: sm.isCurrent }
  })
  return compact({ months: rows, total: rows.reduce((sum, r) => sum + r.spent, 0), label: categories ? undefined : category ? categoryLabel(category) : undefined })
}

function groupData(s: Summary, group: { label: string; categories: CategoryId[] }): Record<string, unknown> {
  const parts = group.categories.map((c) => {
    const row = s.byCategory.find((x) => x.category === c)
    return { category: c, label: categoryLabel(c), spent: row?.spent ?? 0, prevMonth: row?.prevMonth ?? 0, count: row?.count ?? 0 }
  })
  return { label: group.label, spent: parts.reduce((sum, p) => sum + p.spent, 0), prevMonth: parts.reduce((sum, p) => sum + p.prevMonth, 0), parts: parts.sort((a, b) => b.spent - a.spent) }
}

function isLateNight(time: string | undefined): boolean {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!m) return false
  const h = Number(m[1])
  return h >= 22 || h < 5
}

function searchTransactions(args: Args, host: AgentHost): ToolRun {
  const state = host.state()
  const checking = checkingOf(state.bank)
  const query = str(args.query)?.toLowerCase().trim()
  const category = str(args.category)
  const month = str(args.month)
  const minAmount = int(args.minAmount)
  const limit = Math.min(25, Math.max(1, int(args.limit) ?? 10))
  const lateNight = args.lateNight === true
  const groupKey = str(args.group)
  const groupCats = groupKey ? CATEGORY_GROUPS[groupKey]?.categories : undefined
  const byAmount = args.sort === 'amount'
  // "biggest purchase": things bought, not rent or utility bills
  const purchasesOnly = args.purchasesOnly === true
  const matches = state.bank.transactions.filter((t) =>
    (!checking || t.accountId === checking.id) &&
    t.date <= state.bank.today &&
    (!query || t.merchant.toLowerCase().includes(query) || t.description.toLowerCase().includes(query)) &&
    (!category || t.category === category) &&
    (!groupCats || groupCats.includes(t.category)) &&
    (!month || ym(t.date) === month) &&
    (!lateNight || isLateNight(t.time)) &&
    (!byAmount || isSpending(t)) &&
    (!purchasesOnly || !FIXED_CATEGORIES.has(t.category)) &&
    (minAmount === undefined || Math.abs(t.amount) >= minAmount))
  const newest = [...matches].reverse()
  const ordered = byAmount ? [...newest].sort((a, b) => a.amount - b.amount) : newest
  const shown = ordered.slice(0, limit)
  // spending only: moves into the user's own pots and other transfers are not "spent" (the same rule as everywhere else)
  const total = Math.max(0, matches.reduce((s, t) => s + spendValue(t), 0))
  const transfersOut = matches.filter((t) => t.amount < 0 && !isSpending(t)).reduce((s, t) => s - t.amount, 0)
  const largest = matches.filter(isSpending).reduce<Transaction | undefined>((best, t) => (!best || t.amount < best.amount ? t : best), undefined)
  const data = compact({
    count: matches.length,
    shown: shown.length,
    total,
    transfersOut: transfersOut > 0 ? transfersOut : undefined,
    query: str(args.query),
    category,
    group: groupKey,
    lateNight: lateNight || undefined,
    sort: byAmount ? 'amount' : undefined,
    month,
    largest: largest ? { merchant: largest.merchant, amount: -largest.amount, date: largest.date } : undefined,
    transactions: shown.map((t) => compact({ id: t.id, date: t.date, time: t.time, merchant: t.merchant, amount: t.amount, category: t.category, memo: t.memo, flags: t.flags })),
  })
  const untrustedTexts = shown.filter((t) => t.memo).map((t) => ({ source: `memo:${t.id}`, text: t.memo as string }))
  const title = str(args.query) ?? (category ? categoryLabel(category) : groupKey ? CATEGORY_GROUPS[groupKey]?.label ?? 'Transactions' : 'Recent transactions')
  const f = money(state)
  return {
    outcome: ok(data, `${matches.length} transactions${query ? ` for "${str(args.query)}"` : ''}, ${f(total)} out`, [{ type: 'transactions', title, txns: shown }], {
      untrusted: untrustedTexts.length > 0,
    }),
    untrustedTexts,
  }
}

function listRecurring(args: Args, host: AgentHost): ToolRun {
  const all = host.recurring()
  const onlySubs = args.onlySubscriptions === true
  const series = onlySubs ? all.filter((s) => s.isSubscription) : all
  const active = series.filter((s) => s.status === 'active')
  const annualTotal = active.reduce((s, r) => s + r.annualCost, 0)
  const hike = active.find((s) => s.priceChange && s.priceChange.to > s.priceChange.from)
  const video = activeSubscriptions(all).filter((s) => subscriptionNiche(s.merchant) === 'video')
  const data = compact({
    count: active.length,
    monthlyTotal: Math.round(annualTotal / 12),
    annualTotal,
    priceHike: hike?.priceChange ? { merchant: hike.merchant, from: hike.priceChange.from, to: hike.priceChange.to, pct: hike.priceChange.pct } : undefined,
    overlap: video.length >= 2 ? { niche: 'video', merchants: video.map((s) => s.merchant) } : undefined,
    series: series.map((s) => compact({
      id: s.id, merchant: s.merchant, category: s.category, cadence: s.cadence, lastAmount: s.lastAmount, annualCost: s.annualCost,
      nextExpected: s.nextExpected, isSubscription: s.isSubscription, status: s.status,
      priceChange: s.priceChange ? { from: s.priceChange.from, to: s.priceChange.to, pct: s.priceChange.pct } : undefined,
    })),
  })
  const f = money(host.state())
  return { outcome: ok(data, `${active.length} active ${onlySubs ? 'subscriptions' : 'recurring charges'}, ${f(annualTotal)} a year`, [{ type: 'recurring', series }]), untrustedTexts: [] }
}

function analyzeBills(args: Args, host: AgentHost): ToolRun {
  const state = host.state()
  const findings = host.findings()
  const upcoming = state.bank.bills.filter((b) => b.status !== 'paid' && !b.paidTxnId).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  const today = state.bank.today
  const billId = str(args.billId)
  const bill = billId ? state.bank.bills.find((b) => b.id === billId) : undefined
  const within = int(args.withinDays)
  const data = {
    ...compact({
      focus: bill ? compact({ id: bill.id, name: bill.name, amountDue: bill.amountDue, dueDate: bill.dueDate, status: bill.status, period: bill.period, daysUntil: diffDays(today, bill.dueDate), scheduledFor: bill.scheduledFor }) : undefined,
      window: within !== undefined
        ? { days: within, bills: upcoming.filter((b) => diffDays(today, b.dueDate) <= within).map((b) => ({ id: b.id, name: b.name, amountDue: b.amountDue, dueDate: b.dueDate, overdue: b.dueDate < today })) }
        : undefined,
      // what needs a look vs. what is just good to know — the same split the Bills screen uses
      actionable: findings.filter((x) => x.severity !== 'info').length,
      fyi: findings.filter((x) => x.severity === 'info').length,
    }),
    count: findings.length,
    findings: findings.map((x) => compact({
      id: x.id, kind: x.kind, severity: x.severity, title: x.title, detail: x.detail, amount: x.amount, billId: x.billId,
      recurringId: x.recurringId, txnIds: x.txnIds, suggestedAction: x.suggestedAction, evidence: x.evidence,
    })),
    upcoming: upcoming.map((b) => compact({ id: b.id, name: b.name, amountDue: b.amountDue, dueDate: b.dueDate, status: b.status, reminderDaysBefore: state.billReminders[b.id] })),
  }
  return { outcome: ok(data, `${findings.length} bill findings, ${upcoming.length} unpaid bills`, [{ type: 'findings', findings }]), untrustedTexts: [] }
}

function getInsights(args: Args, host: AgentHost): ToolRun {
  const insights = generateInsights(host.ctx(), str(args.month))
  const data = {
    count: insights.length,
    insights: insights.map((i) => compact({
      id: i.id, kind: i.kind, title: i.title, body: i.body, why: i.why, amount: i.amount, category: i.category, severity: i.severity,
      dream: i.dream?.label, suggestedAction: i.suggestedAction, evidence: i.evidence,
    })),
  }
  return { outcome: ok(data, `${insights.length} insights`, [{ type: 'insights', insights }]), untrustedTexts: [] }
}

function checkAffordabilityTool(args: Args, host: AgentHost): ToolRun {
  const amount = int(args.amount)
  if (amount === undefined || amount <= 0) throw new Error('A positive price is needed')
  const result = checkAffordability(host.ctx(), amount, str(args.label) ?? 'this', str(args.category) as CategoryId | undefined)
  const data = { ...result, equivalents: result.equivalents.map((e) => ({ itemName: e.itemName, label: e.label, fraction: e.fraction })) }
  const f = money(host.state())
  return { outcome: ok(data, `${result.label} ${f(result.amount)}: ${result.verdict}`, [{ type: 'affordability', result }]), untrustedTexts: [] }
}

function getGoals(args: Args, host: AgentHost): ToolRun {
  const ctx = host.ctx()
  const goals = allGoalProgress(ctx)
  const kinds = new Map(ctx.dreams.map((d) => [d.id, d.kind]))
  const monthly = int(args.monthly)
  const data = {
    ...compact({ whatIf: monthly && monthly > 0 ? whatIfData(goals, str(args.goalId), monthly, host.state().bank.today, kinds) : undefined }),
    count: goals.length,
    goals: goals.map((g) => compact({ id: g.itemId, name: g.name, kind: kinds.get(g.itemId), saved: g.saved, price: g.price, pct: g.pct, monthlyRate: g.monthlyRate, etaDate: g.etaDate, etaMonths: g.etaMonths })),
  }
  return { outcome: ok(data, `${goals.length} dreams`, [{ type: 'goals', goals }]), untrustedTexts: [] }
}

/** "If I save ¥3,000 a month": months to the goal at that rate vs the current pace. */
function whatIfData(goals: ReturnType<typeof allGoalProgress>, goalId: string | undefined, monthly: number, today: string, kinds: Map<string, string>): Record<string, unknown> | undefined {
  const g = goals.find((x) => x.itemId === goalId) ?? goals.find((x) => kinds.get(x.itemId) === 'goal' && x.pct < 100) ?? goals[0]
  if (!g) return undefined
  const remaining = Math.max(0, g.price - g.saved)
  const months = remaining > 0 ? Math.ceil(remaining / monthly) : 0
  const current = g.monthlyRate > 0 ? Math.ceil(remaining / g.monthlyRate) : undefined
  return compact({
    goalId: g.itemId, name: g.name, monthly, saved: g.saved, price: g.price, remaining, months,
    etaDate: addMonths(today, months), currentMonthlyRate: g.monthlyRate > 0 ? g.monthlyRate : undefined, currentMonths: current,
    monthsSooner: current !== undefined ? current - months : undefined,
  })
}

function xrayBillTool(args: Args, host: AgentHost): ToolRun {
  const text = str(args.text)
  if (!text) throw new Error('Paste the bill text to X-ray it')
  const parsed = xrayBill(text, host.ctx())
  // no amount, no due date, no line items: this is not a bill — don't dress a guessed merchant / category up as one
  const looksLikeBill = parsed.total !== undefined || parsed.dueDate !== undefined || parsed.lineItems.length > 0
  const result = looksLikeBill ? parsed : { ...parsed, merchant: undefined, category: undefined, period: undefined, comparison: undefined }
  const data = compact({
    looksLikeBill: looksLikeBill ? undefined : false,
    merchant: result.merchant,
    total: result.total,
    dueDate: result.dueDate,
    period: result.period,
    lineItems: result.lineItems,
    maskedAccount: result.maskedAccount,
    category: result.category,
    warnings: result.warnings,
    injection: { suspicious: result.injection.suspicious, score: result.injection.score, signals: result.injection.signals },
    comparison: result.comparison,
  })
  const f = money(host.state())
  const summary = `${result.merchant ?? 'Bill'}${result.total !== undefined ? ` ${f(result.total)}` : ''}${result.injection.suspicious ? ' — injection flagged' : ''}`
  return { outcome: ok(data, summary, [{ type: 'xray', result }], { untrusted: true }), untrustedTexts: [{ source: 'bill', text }] }
}

// ───────────────────────────── T1 · organize ─────────────────────────────

function currentPlan(draft: AppState): BudgetPlan {
  const month = ym(draft.bank.today)
  const base = draft.budget
  if (base && base.month === month) return base
  return {
    month,
    total: 0,
    categories: base ? base.categories.map((c) => ({ ...c })) : [],
    method: 'custom',
    createdBy: 'agent',
    createdAt: `${draft.bank.today}T00:00:00.000Z`,
  }
}

function setCategoryBudget(args: Args, host: AgentHost): ToolRun {
  const category = str(args.category) as CategoryId | undefined
  const limit = int(args.limit)
  if (!category || !(category in CATEGORIES)) throw new Error('Unknown category')
  if (limit === undefined || limit <= 0) throw new Error('The limit must be a positive amount')
  return host.mutate((draft) => {
    const previous = draft.budget ? structuredClone(draft.budget) : null
    const plan = currentPlan(draft)
    const row = plan.categories.find((c) => c.category === category)
    const previousLimit = row?.limit
    if (row) row.limit = limit
    else plan.categories.push({ category, limit })
    plan.total = plan.categories.reduce((s, c) => s + c.limit, 0)
    plan.method = 'custom'
    draft.budget = plan
    const ctx = ctxOf(draft) as FinanceContext
    const lastMonth = summarizeMonth(ctx).byCategory.find((c) => c.category === category)?.prevMonth
    const data = compact({ category, label: categoryLabel(category), limit, previousLimit, lastMonth, total: plan.total })
    const f = money(draft)
    return {
      outcome: ok(data, `${categoryLabel(category)} budget ${f(limit)}${previousLimit !== undefined ? ` (was ${f(previousLimit)})` : ''}`, [{ type: 'budget', plan: structuredClone(plan) }]),
      undo: { kind: 'budget', previous },
      untrustedTexts: [],
    }
  })
}

function createBudgetPlan(args: Args, host: AgentHost, call: ToolCall): ToolRun {
  const method = args.method === 'fifty_thirty_twenty' ? 'fifty_thirty_twenty' : 'history'
  return host.mutate((draft) => {
    const previous = draft.budget ? structuredClone(draft.budget) : null
    const ctx = ctxOf(draft) as FinanceContext
    const plan = proposeBudget(ctx, method, ym(draft.bank.today), { now: host.now(), createdBy: call.proposedBy === 'user' ? 'user' : 'agent' })
    draft.budget = plan
    const kindTotal = (kind: string) => plan.categories.filter((c) => CATEGORIES[c.category]?.kind === kind).reduce((s, c) => s + c.limit, 0)
    const savings = Math.max(0, ctx.profile.monthlyIncome - plan.total)
    const data = compact({
      method: plan.method, total: plan.total, needs: kindTotal('need'), wants: kindTotal('want'), savings: savings > 0 ? savings : undefined,
      rationale: plan.rationale, categories: plan.categories.map((c) => ({ category: c.category, limit: c.limit })),
    })
    return { outcome: ok(data, `Budget plan ${money(draft)(plan.total)} a month (${plan.method})`, [{ type: 'budget', plan: structuredClone(plan) }]), undo: { kind: 'budget', previous }, untrustedTexts: [] }
  })
}

function createTripwire(args: Args, host: AgentHost, call: ToolCall): ToolRun {
  const kind = str(args.kind) as Tripwire['kind'] | undefined
  const threshold = int(args.threshold)
  if (!kind || !['month_pct', 'category_pct', 'single_over', 'daily_over', 'pace_over'].includes(kind)) throw new Error('Unknown tripwire kind')
  if (threshold === undefined || threshold <= 0) throw new Error('The threshold must be a positive whole number')
  const category = str(args.category) as CategoryId | undefined
  if (kind === 'category_pct' && !category) throw new Error('A category tripwire needs a category')
  return host.mutate((draft) => {
    const t: Tripwire = { id: uid('tw'), kind, threshold, enabled: true, createdBy: call.proposedBy === 'user' ? 'user' : 'agent', label: '' }
    if (category) t.category = category
    t.label = describeTripwire(t, currencyOf(draft))
    draft.tripwires.push(t)
    const goal = draft.dreams.find((d) => d.kind === 'goal' && !d.achievedAt)
    const data = compact({ id: t.id, kind, threshold, category, label: t.label, itemName: goal?.name })
    return {
      outcome: ok(data, `Tripwire: ${t.label}`, [{ type: 'notice', level: 'info', title: 'Tripwire set', text: t.label }]),
      undo: { kind: 'tripwire', tripwireId: t.id },
      untrustedTexts: [],
    }
  })
}

function recategorizeTransaction(args: Args, host: AgentHost, call: ToolCall): ToolRun {
  const txnId = str(args.txnId)
  const category = str(args.category) as CategoryId | undefined
  if (!category || !(category in CATEGORIES)) throw new Error('Unknown category')
  return host.mutate((draft) => {
    const txn = draft.bank.transactions.find((t) => t.id === txnId)
    if (!txn) throw new Error('Transaction not found')
    const ruleKey = normalizeMerchant(txn.merchant) || txn.merchant
    const undo: UndoRecord = {
      kind: 'recategorize', txnId: txn.id, category: txn.category, categorySource: txn.categorySource, categoryConfidence: txn.categoryConfidence, ruleKey,
      ...(Object.prototype.hasOwnProperty.call(draft.categoryRules, ruleKey) ? { previousRule: draft.categoryRules[ruleKey] } : {}),
    }
    const from = txn.category
    txn.category = category
    txn.categorySource = call.proposedBy === 'llm' ? 'llm' : 'user'
    txn.categoryConfidence = 1
    draft.categoryRules = { ...draft.categoryRules, [ruleKey]: category }
    const data = { txnId: txn.id, merchant: txn.merchant, amount: txn.amount, from, to: category, rule: ruleKey }
    return { outcome: ok(data, `${txn.merchant}: ${categoryLabel(from)} → ${categoryLabel(category)}`, [{ type: 'transactions', title: 'Recategorised', txns: [structuredClone(txn)] }]), undo, untrustedTexts: [] }
  })
}

function setBillReminder(args: Args, host: AgentHost): ToolRun {
  const billId = str(args.billId)
  const daysBefore = int(args.daysBefore)
  if (daysBefore === undefined || daysBefore < 0 || daysBefore > 14) throw new Error('Reminders can be 0–14 days before the due date')
  return host.mutate((draft) => {
    const bill = draft.bank.bills.find((b) => b.id === billId)
    if (!bill) throw new Error('Bill not found')
    const previous = draft.billReminders[bill.id]
    draft.billReminders = { ...draft.billReminders, [bill.id]: daysBefore }
    const data = compact({ billId: bill.id, billName: bill.name, daysBefore, dueDate: bill.dueDate, previous })
    const text = `${daysBefore} day${daysBefore === 1 ? '' : 's'} before ${bill.name} (due ${shortDate(bill.dueDate)})`
    return {
      outcome: ok(data, `Reminder: ${text}`, [{ type: 'notice', level: 'info', title: 'Reminder set', text }]),
      undo: { kind: 'reminder', billId: bill.id, ...(previous !== undefined ? { previous } : {}) },
      untrustedTexts: [],
    }
  })
}

// ───────────────────────────── T2 · move own money ─────────────────────────────

function moveGoalMoney(args: Args, host: AgentHost, direction: 'in' | 'out'): ToolRun {
  const amount = int(args.amount)
  if (amount === undefined || amount <= 0) throw new Error('The amount must be a positive whole number of minor units')
  return host.mutate((draft, bank) => {
    const dream = findDream(draft, args.goalId)
    if (!dream) throw new Error('That dream goal does not exist')
    const pot = potForDraft(draft, bank, dream.id, dream.name, direction === 'in')
    if (!dream.potAccountId) dream.potAccountId = pot.id
    const checking = bank.checking()
    const txns = direction === 'in'
      ? bank.transferInternal(checking.id, pot.id, amount, '', 'agent')
      : bank.transferInternal(pot.id, checking.id, amount, '', 'agent')
    host.afterTransactions(txns)
    const progress = goalProgress(dream, ctxOf(draft) as FinanceContext)
    const data = {
      goalId: dream.id, goalName: dream.name, amount, direction,
      from: direction === 'in' ? accountLabel(checking) : `${dream.name} pot`,
      to: direction === 'in' ? `${dream.name} pot` : accountLabel(checking),
      checkingBalance: checking.balance, potBalance: pot.balance, newPct: progress.pct, price: dream.price,
    }
    const f = money(draft)
    const summary = direction === 'in' ? `Moved ${f(amount)} into ${dream.name}` : `Moved ${f(amount)} from ${dream.name} to checking`
    return {
      outcome: ok(data, summary, [{ type: 'goals', goals: [progress] }], { txnIds: txns.map((t) => t.id) }),
      undo: { kind: 'money', txnIds: txns.map((t) => t.id) },
      untrustedTexts: [],
    }
  })
}

function potForDraft(draft: AppState, bank: SandboxBank, goalId: string, name: string, create: boolean) {
  const dream = findDream(draft, goalId)
  const existing = draft.bank.accounts.find((a) => a.id === (dream?.potAccountId ?? `pot_${goalId}`)) ?? draft.bank.accounts.find((a) => a.type === 'pot' && a.goalId === goalId)
  if (existing) return existing
  if (!create) throw new Error(`There is no savings pot for ${name} yet`)
  return bank.ensurePot(goalId, name)
}

// ───────────────────────────── T3 · pay / cancel / dispute ─────────────────────────────

function payBill(args: Args, host: AgentHost): ToolRun {
  const billId = str(args.billId)
  if (!billId) throw new Error('Which bill?')
  return host.mutate((draft, bank) => {
    const { bill, txn } = bank.payBill(billId, 'agent', str(args.date))
    if (txn) host.afterTransactions([txn])
    const payee = draft.bank.payees.find((p) => p.id === bill.payeeId)
    const data = compact({
      billId: bill.id, billName: bill.name, amount: bill.amountDue, payee: payee?.name, payeeAccount: payee?.maskedAccount, status: bill.status,
      scheduledFor: bill.scheduledFor, dueDate: bill.dueDate, txnId: txn?.id, checkingBalance: bank.checking().balance,
    })
    const f = money(draft)
    const summary = bill.status === 'scheduled' ? `${bill.name} ${f(bill.amountDue)} scheduled for ${bill.scheduledFor}` : `Paid ${bill.name} ${f(bill.amountDue)}`
    return { outcome: ok(data, summary, [], txn ? { txnIds: [txn.id] } : {}), untrustedTexts: [] }
  })
}

function cancelSubscription(args: Args, host: AgentHost): ToolRun {
  const series = host.recurring().find((r) => r.id === args.recurringId)
  if (!series) throw new Error('That subscription was not found')
  return host.mutate((draft, bank) => {
    bank.cancelRecurring(series.merchant)
    const data = { recurringId: series.id, merchant: series.merchant, monthly: series.lastAmount, annualCost: series.annualCost, cadence: series.cadence, status: 'cancelled' }
    return { outcome: ok(data, `Cancelled ${series.merchant} (${money(draft)(series.annualCost)} a year)`, []), untrustedTexts: [] }
  })
}

function disputeTransaction(args: Args, host: AgentHost): ToolRun {
  const txnId = str(args.txnId)
  if (!txnId) throw new Error('Which charge?')
  return host.mutate((draft, bank) => {
    const dispute = bank.openDispute(txnId, str(args.reason) ?? 'Disputed via FundBun', 'agent')
    const txn = draft.bank.transactions.find((t) => t.id === txnId) as Transaction
    const data = { disputeId: dispute.id, txnId, merchant: txn.merchant, amount: Math.abs(txn.amount), date: txn.date, status: dispute.status }
    return { outcome: ok(data, `Dispute ${dispute.id} opened: ${txn.merchant} ${money(draft)(Math.abs(txn.amount))}`, []), untrustedTexts: [] }
  })
}

const EXECUTORS: Partial<Record<ToolName, Executor>> = {
  get_overview: getOverview,
  get_spending_breakdown: getSpendingBreakdown,
  search_transactions: searchTransactions,
  list_recurring: listRecurring,
  analyze_bills: analyzeBills,
  get_insights: getInsights,
  check_affordability: checkAffordabilityTool,
  get_goals: getGoals,
  xray_bill: xrayBillTool,
  set_category_budget: setCategoryBudget,
  create_budget_plan: createBudgetPlan,
  create_tripwire: createTripwire,
  recategorize_transaction: recategorizeTransaction,
  set_bill_reminder: setBillReminder,
  transfer_to_goal: (args, host) => moveGoalMoney(args, host, 'in'),
  withdraw_from_goal: (args, host) => moveGoalMoney(args, host, 'out'),
  pay_bill: payBill,
  cancel_subscription: cancelSubscription,
  dispute_transaction: disputeTransaction,
}

/** Reverse an executed action's effects (inside host.mutate). Throws when it cannot be undone. */
export function applyUndo(undo: UndoRecord, draft: AppState, bank: SandboxBank): void {
  switch (undo.kind) {
    case 'money':
      bank.reverse(undo.txnIds, '')
      return
    case 'budget':
      draft.budget = undo.previous ? structuredClone(undo.previous) : null
      return
    case 'tripwire':
      draft.tripwires = draft.tripwires.filter((t) => t.id !== undo.tripwireId)
      return
    case 'recategorize': {
      const txn = draft.bank.transactions.find((t) => t.id === undo.txnId)
      if (!txn) throw new Error('Transaction not found')
      Object.assign(txn, { category: undo.category, categorySource: undo.categorySource, categoryConfidence: undo.categoryConfidence })
      const rules = { ...draft.categoryRules }
      if (undo.previousRule) rules[undo.ruleKey] = undo.previousRule
      else delete rules[undo.ruleKey]
      draft.categoryRules = rules
      return
    }
    case 'reminder': {
      const reminders = { ...draft.billReminders }
      if (undo.previous !== undefined) reminders[undo.billId] = undo.previous
      else delete reminders[undo.billId]
      draft.billReminders = reminders
      return
    }
  }
}

/** Cheapest active subscription in a niche that has 2+ services (e.g. three video apps). */
export function cheapestOverlapping(series: RecurringSeries[], niche = 'video'): RecurringSeries | undefined {
  const pool = activeSubscriptions(series).filter((s) => subscriptionNiche(s.merchant) === niche)
  if (pool.length < 2) return undefined
  return [...pool].sort((a, b) => a.lastAmount - b.lastAmount || a.merchant.localeCompare(b.merchant))[0]
}

