import { monthLabel, ym } from '../dates'
import { listJoin } from '../finance/copy'
import type { AppState, Minor, RecurringSeries, ToolName } from '../types'
import type { Lang } from './lang'
import type { Intent } from './nlu'
import type { ActionStage } from './voice'
import { categoryLabel, findBill, findDream, money, moneyCopy, pctLabel, shortDate } from './support'
import { categoryName, dateName, delayIn, dueInPhrase, groupName, joinList, monthName } from './voice-i18n'

/**
 * Tool outcomes → the pre-formatted fact strings voice.composeReply expects (see voice.FACT_KEYS).
 * Every number in a fact comes from tool data (or the call's own args), so offline replies stay grounded.
 * Totals, targets and projections read as whole yuan from ¥100 (moneyCopy); one bill, one transaction, a price
 * or an amount the user asked to move keeps its cents (money).
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

export interface FactOptions {
  /** reply language: month, date and category labels follow it (default English) */
  lang?: Lang
  /** recurring series, to name the subscription behind a finding */
  recurring?: RecurringSeries[]
}

export function readFacts(tool: ToolName, data: unknown, state: AppState, opts: FactOptions = {}): Facts {
  const builder = READERS[tool]
  return builder ? builder(obj(data), state, { lang: opts.lang ?? 'en', recurring: opts.recurring ?? [] }) : {}
}

type Reader = (d: D, state: AppState, o: Required<FactOptions>) => Facts

/** Month / date / category labels in the reply language. */
function labels(lang: Lang) {
  return {
    month: (ymOrIso: unknown, fallback?: unknown) => (lang === 'en' ? text(fallback) ?? (typeof ymOrIso === 'string' && /^\d{4}-\d{2}/.test(ymOrIso) ? monthLabel(ymOrIso.slice(0, 7)) : undefined) : monthName(text(ymOrIso), lang)),
    monthShort: (m: unknown, fallback?: unknown) => (lang === 'en' ? text(fallback) ?? (typeof m === 'string' && /^\d{4}-\d{2}/.test(m) ? monthLabel(m.slice(0, 7), 'short') : undefined) : monthName(text(m), lang, true)),
    date: (d: unknown) => (lang === 'en' ? shortDate(text(d)) : dateName(text(d), lang)),
    category: (c: unknown, fallback?: unknown) => (lang === 'en' ? text(fallback) ?? (text(c) ? categoryLabel(text(c)) : undefined) : categoryName(text(c), lang) ?? text(fallback)),
    list: (items: string[]) => (lang === 'en' ? listJoin(items) : joinList(items, lang)),
  }
}

/** "+¥1,998" / "−¥300" / "±¥0". */
function signed(f: (m: Minor) => string, delta: number): string {
  return delta > 0 ? `+${f(delta)}` : delta < 0 ? `−${f(-delta)}` : `±${f(0)}`
}

function overviewFacts(d: D, state: AppState, o: Required<FactOptions>): Facts {
  const f = moneyCopy(state)
  const exact = money(state)
  const L = labels(o.lang)
  const facts: Facts = {}
  put(facts, 'status', text(d.status))
  put(facts, 'month', L.month(d.month, d.monthLabel))
  put(facts, 'spent', f(num(d.spent) ?? 0))
  put(facts, 'target', f(num(d.target) ?? 0))
  put(facts, 'delta', positive(f, d.delta))
  put(facts, 'remaining', positive(f, d.remaining))
  put(facts, 'projected', positive(f, d.projected))
  put(facts, 'safeToSpend', positive(f, d.safeToSpendToday))
  put(facts, 'goalName', text(obj(d.goal).name))
  // the dream framing (headline, item) is on the mirror card this reply comes with: the text complements it, never repeats it
  const delay = num(d.goalDelayDays)
  if (delay !== undefined && delay > 0) facts.goalDelay = delayIn(delay, o.lang)
  // balance (focus 'balance'): the everyday account — masked number only — and each pot
  const checking = num(d.checkingBalance)
  if (checking !== undefined) {
    facts.checking = exact(checking)
    facts.account = [text(d.checkingName) ?? (o.lang === 'zh' ? '活期账户' : o.lang === 'id' ? 'Rekening utama' : 'Everyday account'), text(d.checkingMasked)].filter(Boolean).join(' ')
  }
  const pots = arr(d.pots).filter((p) => text(p.name) && num(p.balance) !== undefined)
  if (pots.length) facts.pots = L.list(pots.map((p) => `${text(p.name)} ${f(num(p.balance) as number)}`))
  // safe to spend (focus 'safe_to_spend')
  put(facts, 'overBy', positive(f, d.overBy))
  const daysLeft = num(d.daysLeft)
  if (daysLeft !== undefined && daysLeft > 0) facts.daysLeft = String(daysLeft)
  put(facts, 'perDayLeft', positive(f, d.perDayLeft))
  put(facts, 'nextMonthDaily', positive(f, d.nextMonthDaily))
  const month = text(d.month)
  put(facts, 'nextMonth', o.lang === 'en' ? text(d.nextMonthLabel) : month ? monthName(nextMonthOf(month), o.lang) : undefined)
  // savings rate (focus 'savings_rate')
  const rate = num(d.savingsRate)
  if (rate !== undefined && rate > 0) facts.savingsRate = pctLabel(rate)
  put(facts, 'income', positive(f, d.income))
  put(facts, 'savedToGoals', positive(f, d.savedToGoals))
  return facts
}

function nextMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function breakdownFacts(d: D, state: AppState, o: Required<FactOptions>): Facts {
  const f = moneyCopy(state)
  const L = labels(o.lang)
  const facts: Facts = {}
  put(facts, 'month', L.month(d.month, d.monthLabel))
  put(facts, 'total', positive(f, d.total))
  const top = arr(d.categories)[0]
  if (top && (num(top.spent) ?? 0) > 0) {
    put(facts, 'topCategory', L.category(top.category, top.label))
    put(facts, 'topAmount', f(num(top.spent) ?? 0))
    put(facts, 'topShare', num(top.share) !== undefined ? pctLabel(num(top.share) as number) : undefined)
  }
  const focus = obj(d.focus)
  if (text(focus.label)) {
    put(facts, 'category', L.category(focus.category, focus.label))
    put(facts, 'categorySpent', f(num(focus.spent) ?? 0))
    put(facts, 'categoryLimit', positive(f, focus.limit))
    put(facts, 'categoryPct', num(focus.pct) !== undefined ? `${num(focus.pct)}%` : undefined)
    put(facts, 'categoryPrev', positive(f, focus.prevMonth))
    const count = num(focus.count)
    if (count) facts.count = String(count)
    if (o.lang === 'en') put(facts, 'itemEquivalent', equivalentPhrase(focus))
  }
  const cmp = obj(d.compare)
  if (num(cmp.total) !== undefined) {
    if (cmp.likeForLike === true) facts.likeForLike = 'yes'
    put(facts, 'prevMonth', L.month(cmp.prevMonth, cmp.prevLabel))
    facts.total = f(num(cmp.total) as number)
    put(facts, 'prevTotal', positive(f, cmp.prevTotal))
    put(facts, 'prevToDate', positive(f, cmp.prevToDate))
    facts.change = signed(f, num(cmp.delta) ?? 0)
    const movers = arr(cmp.movers).filter((m) => num(m.delta)).map((m) => `${L.category(m.category, m.label)} ${signed(f, num(m.delta) as number)}`)
    if (movers.length) facts.movers = L.list(movers)
    const c = obj(cmp.category)
    if (text(c.category)) {
      put(facts, 'category', L.category(c.category, c.label))
      facts.categorySpent = f(num(c.spent) ?? 0)
      facts.categoryPrev = f(num(c.prev) ?? 0)
      put(facts, 'categoryPrevFull', positive(f, c.prevFull))
      facts.change = signed(f, num(c.delta) ?? 0)
    }
  }
  const range = obj(d.range)
  const months = arr(range.months)
  if (months.length >= 2) {
    facts.monthsCount = String(months.length)
    const soFar = o.lang === 'zh' ? '（至今）' : o.lang === 'id' ? ' (sejauh ini)' : ' so far'
    facts.rangeList = months.map((m) => `${L.monthShort(m.month, m.label)} ${f(num(m.spent) ?? 0)}${m.current === true ? soFar : ''}`).join(' · ')
    put(facts, 'rangeTotal', positive(f, range.total))
    if (!facts.category) put(facts, 'category', text(d.group) ? groupName('food', o.lang) : L.category(focus.category, range.label))
  }
  const group = obj(d.group)
  if (num(group.spent) !== undefined) {
    put(facts, 'groupLabel', groupName('food', o.lang) ?? text(group.label))
    facts.groupSpent = f(num(group.spent) as number)
    const parts = arr(group.parts).filter((p) => (num(p.spent) ?? 0) > 0).map((p) => `${L.category(p.category, p.label)} ${f(num(p.spent) as number)}`)
    if (parts.length) facts.groupParts = L.list(parts)
    put(facts, 'groupPrev', positive(f, group.prevMonth))
    if (months.length >= 2) facts.category = groupName('food', o.lang) ?? 'Food'
  }
  return facts
}

/** "about the price of your New running shoes" · "2.6% of your Birkin 25" · "the price of 2× New sneakers". */
function equivalentPhrase(focus: D): string | undefined {
  const label = text(focus.equivalent)
  const item = text(focus.equivalentItem)
  const fraction = num(focus.equivalentFraction)
  if (!label) return undefined
  if (!item || fraction === undefined) return label
  if (fraction >= 0.95 && fraction < 2) return `about the price of your ${item}`
  if (fraction >= 2) return `the price of ${label}`
  return label
}

function searchFacts(d: D, state: AppState, o: Required<FactOptions>): Facts {
  const f = money(state)
  const c = moneyCopy(state)
  const L = labels(o.lang)
  const facts: Facts = { count: String(num(d.count) ?? 0) }
  put(facts, 'query', text(d.query) ?? (text(d.category) ? L.category(d.category) : text(d.group) ? groupName(text(d.group), o.lang) : undefined))
  const month = text(d.month)
  if (month && /^\d{4}-\d{2}$/.test(month)) put(facts, 'month', L.month(month))
  put(facts, 'total', positive(c, d.total))
  put(facts, 'transfers', positive(c, d.transfersOut))
  const at = (t: D) => (o.lang === 'zh' ? `${L.date(t.date)}在${text(t.merchant) ?? '某商家'}花了${f(Math.abs(num(t.amount) ?? 0))}` : o.lang === 'id' ? `${f(Math.abs(num(t.amount) ?? 0))} di ${text(t.merchant) ?? 'sebuah toko'} pada ${L.date(t.date)}` : `${f(Math.abs(num(t.amount) ?? 0))} at ${text(t.merchant) ?? 'a merchant'} on ${L.date(t.date)}`)
  const largest = obj(d.largest)
  if (num(largest.amount)) facts.largest = at(largest)
  if (text(d.sort) === 'amount') {
    const second = arr(d.transactions)[1]
    if (second && num(second.amount)) facts.second = at(second)
  }
  return facts
}

function subscriptionFacts(d: D, state: AppState, _o: Required<FactOptions>): Facts {
  const f = money(state)
  const c = moneyCopy(state)
  const facts: Facts = { count: String(num(d.count) ?? 0) }
  put(facts, 'monthlyTotal', positive(c, d.monthlyTotal))
  put(facts, 'annualTotal', positive(c, d.annualTotal))
  const hike = obj(d.priceHike)
  if (text(hike.merchant)) facts.priceHike = `${text(hike.merchant)} went from ${f(num(hike.from) ?? 0)} to ${f(num(hike.to) ?? 0)}`
  const overlap = obj(d.overlap)
  const names = Array.isArray(overlap.merchants) ? (overlap.merchants as string[]) : []
  if (names.length >= 2) facts.overlap = `you pay for ${names.length} video services (${listJoin(names)})`
  return facts
}

function billsFacts(d: D, state: AppState, o: Required<FactOptions>): Facts {
  const f = money(state)
  const L = labels(o.lang)
  const findings = arr(d.findings)
  const facts: Facts = { count: String(findings.length) }
  const billLine = (b: D) => {
    const amount = f(num(b.amountDue) ?? 0)
    const due = L.date(b.dueDate)
    return o.lang === 'zh' ? `${text(b.name)}（${amount}，${due}到期）` : o.lang === 'id' ? `${text(b.name)} (${amount}, jatuh tempo ${due})` : `${text(b.name)} (${amount}, due ${due})`
  }
  const next = arr(d.upcoming)[0]
  if (next) facts.nextBill = billLine(next)
  const first = (kind: string) => findings.find((x) => x.kind === kind)
  if (o.lang === 'en') {
    put(facts, 'duplicate', noStop(text(first('duplicate_charge')?.title)))
    put(facts, 'spike', noStop(text(first('bill_spike')?.title)))
    put(facts, 'priceHike', noStop(text(first('price_hike')?.title)))
  }
  const actionable = num(d.actionable)
  if (actionable !== undefined) facts.actionable = String(actionable)
  const fyi = num(d.fyi)
  if (fyi) facts.fyi = String(fyi)
  // the duplicate charge, by merchant and date (focus 'duplicate')
  const dup = first('duplicate_charge')
  if (dup) {
    const ids = Array.isArray(dup.txnIds) ? (dup.txnIds as string[]) : []
    const txn = state.bank.transactions.find((t) => t.id === ids[ids.length - 1])
    put(facts, 'dupMerchant', txn?.merchant)
    put(facts, 'dupAmount', positive(f, dup.amount))
    put(facts, 'dupDate', L.date(txn?.date))
  }
  const spike = o.lang !== 'en' ? first('bill_spike') : undefined
  if (spike) {
    put(facts, 'spikeBill', findBill(state, spike.billId)?.name)
    const pct = num(obj(spike.evidence).pct)
    if (pct !== undefined) facts.spikePct = `${Math.round(pct)}%`
  }
  const hike = o.lang !== 'en' ? first('price_hike') : undefined
  if (hike) put(facts, 'hikeMerchant', o.recurring.find((r) => r.id === hike.recurringId)?.merchant)
  // one bill (focus 'due')
  const focus = obj(d.focus)
  if (text(focus.name)) {
    facts.billName = text(focus.name) as string
    put(facts, 'amount', positive(f, focus.amountDue))
    put(facts, 'dueDate', L.date(focus.dueDate))
    const days = num(focus.daysUntil)
    if (days !== undefined && text(focus.status) !== 'paid') facts.dueIn = dueInPhrase(days, o.lang)
    if (text(focus.status) === 'paid') facts.dueIn = o.lang === 'zh' ? '已付' : o.lang === 'id' ? 'sudah dibayar' : 'already paid'
  }
  // what is due soon (withinDays)
  const window = obj(d.window)
  if (num(window.days) !== undefined) {
    facts.windowDays = String(num(window.days))
    const bills = arr(window.bills)
    if (bills.length) facts.windowList = L.list(bills.map(billLine))
  }
  return facts
}

function insightFacts(d: D, _state: AppState, _o: Required<FactOptions>): Facts {
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

function affordFacts(d: D, state: AppState, o: Required<FactOptions>): Facts {
  const f = money(state)
  const c = moneyCopy(state)
  const facts: Facts = {}
  put(facts, 'verdict', text(d.verdict))
  const label = text(d.label)
  put(facts, 'label', label && label !== 'this' ? label : undefined)
  put(facts, 'amount', positive(f, d.amount))
  const after = num(d.remainingAfter)
  if (after !== undefined && after >= 0) facts.remainingAfter = c(after)
  put(facts, 'overTargetBy', positive(c, d.overTargetBy))
  const hours = num(d.hoursOfWork)
  if (hours) facts.hoursOfWork = String(hours)
  put(facts, 'goalName', text(d.goalName))
  const delay = num(d.goalDelayDays)
  if (delay) facts.goalDelay = delayIn(delay, o.lang)
  // never "you could've gotten AirPods Pro" about the AirPods Pro themselves
  const eq = arr(d.equivalents).find((e) => !label || (text(e.itemName) ?? '').toLowerCase() !== label.toLowerCase())
  put(facts, 'equivalent', text(eq?.label))
  return facts
}

function goalsFacts(d: D, state: AppState, o: Required<FactOptions>): Facts {
  const f = moneyCopy(state)
  const L = labels(o.lang)
  const goals = arr(d.goals)
  const facts: Facts = { count: String(goals.length) }
  const whatIf = obj(d.whatIf)
  const primary = (text(whatIf.goalId) ? goals.find((g) => g.id === whatIf.goalId) : undefined) ?? goals.find((g) => g.kind === 'goal') ?? goals[0]
  if (!primary) return facts
  put(facts, 'goalName', text(primary.name))
  facts.saved = f(num(primary.saved) ?? 0)
  facts.price = f(num(primary.price) ?? 0)
  facts.pct = pctLabel(num(primary.pct) ?? 0)
  const eta = text(primary.etaDate)
  if (eta) put(facts, 'eta', L.month(ym(eta)))
  // what-if projection ("if I save ¥3,000 a month")
  if (num(whatIf.monthly)) {
    facts.monthly = f(num(whatIf.monthly) as number)
    facts.months = String(num(whatIf.months) ?? 0)
    put(facts, 'eta', L.month(ym(text(whatIf.etaDate) ?? '')))
    const sooner = num(whatIf.monthsSooner)
    if (sooner !== undefined && sooner > 0) facts.sooner = String(sooner)
    put(facts, 'currentRate', positive(f, whatIf.currentMonthlyRate))
  }
  put(facts, 'monthlyRate', positive(f, primary.monthlyRate))
  const others = goals.filter((g) => g !== primary).slice(0, 3).map((g) => `${text(g.name)} (${pctLabel(num(g.pct) ?? 0)})`)
  if (others.length) facts.others = L.list(others)
  return facts
}

function xrayFacts(d: D, state: AppState, _o: Required<FactOptions>): Facts {
  const f = money(state)
  const c = moneyCopy(state)
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
    facts.comparison = `that's ${Math.abs(Math.round(change))}% ${change >= 0 ? 'above' : 'below'} your usual ${c(num(cmp.previousAverage) as number)}`
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
  /** reply language (default English) */
  lang?: Lang
}

export function actionFacts(tool: ToolName, args: Record<string, unknown>, state: AppState, info: ActionInfo): Facts {
  const f = money(state)
  const c = moneyCopy(state)
  const L = labels(info.lang ?? 'en')
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
      put(facts, 'category', category ? L.category(category) : undefined)
      put(facts, 'limit', positive(c, args.limit))
      const prev = num(data.previousLimit) ?? state.budget?.categories.find((b) => b.category === category)?.limit
      put(facts, 'previousLimit', positive(c, prev))
      put(facts, 'lastMonth', positive(c, data.lastMonth))
      // a new limit can loosen the plan past the user's own target — say so instead of letting it slide
      const total = num(data.total)
      const target = state.profile?.targetSpend
      const limit = num(args.limit)
      if (info.stage === 'done' && total !== undefined && target && total > target && (prev === undefined || (limit ?? 0) > prev)) {
        facts.loosens = `your category limits now add up to ${c(total)}, above your ${c(target)} target`
      }
      break
    }
    case 'create_budget_plan': {
      const method = text(data.method) ?? text(args.method)
      put(facts, 'method', method === 'fifty_thirty_twenty' ? 'the 50/30/20 rule' : method === 'history' ? 'your last 3 months' : method)
      put(facts, 'total', positive(c, data.total))
      put(facts, 'needs', positive(c, data.needs))
      put(facts, 'wants', positive(c, data.wants))
      put(facts, 'savings', positive(c, data.savings))
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
      put(facts, 'dueDate', L.date(bill?.dueDate))
      put(facts, 'payee', state.bank.payees.find((p) => p.id === bill?.payeeId)?.name)
      put(facts, 'scheduledFor', data.status === 'scheduled' ? L.date(text(data.scheduledFor)) : undefined)
      break
    }
    case 'cancel_subscription': {
      const s = (info.recurring ?? []).find((r) => r.id === args.recurringId)
      put(facts, 'merchant', s?.merchant ?? text(data.merchant))
      put(facts, 'amount', positive(f, s?.lastAmount ?? data.monthly))
      put(facts, 'annualCost', positive(c, s?.annualCost ?? data.annualCost))
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
