import { CATEGORIES } from '../categories'
import { monthLabel, ym } from '../dates'
import { computeMirror, goalProgress, primaryGoal, summarizeMonth } from '../finance'
import { roundDownTo10 } from '../finance/actions'
import { listJoin } from '../finance/copy'
import { uid } from '../ids'
import type { AppState, CategoryId, Minor, PendingAction, PlanStep, RecurringSeries, TaskPlan, Tone, ToolName } from '../types'
import { newCall, refreshPlan, runGated, type GateResult } from './actions'
import type { Choice } from './dialogue'
import type { Facts } from './facts'
import type { AgentHost } from './host'
import { entityCandidates, matchGoal, type Intent, type NluSlots } from './nlu'
import {
  activeSubscriptions,
  categoryLabel,
  findDream,
  money,
  moneyCopy,
  nluContextOf,
  openDreams,
  pctLabel,
  potOf,
  shortDate,
  unpaidBills,
} from './support'
import { cheapestOverlapping } from './tools'
import { addSource, trace, type Turn } from './turn'

/** Rule-based planner: an understood intent + slots → the tool call to make, or the question to ask. */

export type Slots = NluSlots & Record<string, unknown>

/** A one-line note the reply leads with (voice.line key + facts), e.g. "I can only pay the billed amount". */
export interface PlanNote {
  key: string
  facts?: Record<string, string>
  /** numbers the note quotes that no tool returned as such (kept as grounding sources) */
  sources?: Record<string, unknown>
}

export type IntentPlan =
  | { kind: 'chat'; intent: Intent; focus?: string }
  | { kind: 'unknown'; intent: Intent }
  | { kind: 'refusal'; intent: Intent; t4?: { tool: ToolName; args: Record<string, unknown>; store: boolean }; notes?: PlanNote[] }
  | { kind: 'read'; intent: Intent; tool: ToolName; args: Record<string, unknown>; focus?: string }
  | { kind: 'action'; intent: Intent; tool: ToolName; args: Record<string, unknown>; notes?: PlanNote[] }
  | { kind: 'clarify'; intent: Intent; tool: ToolName; missing: string; slots: Slots; choices: Choice[]; facts: Facts; notes?: PlanNote[] }
  | { kind: 'ask'; intent: Intent; facts: Facts }
  /** "Which subscriptions should I cancel?" — a recommendation built from list_recurring + analyze_bills */
  | { kind: 'recommend'; intent: Intent }

const SURPLUS_RE = /\b(?:surplus|leftover|left ?over|what'?s left|the rest|remaining|extra|underspend|spare|savings this month)\b|剩下|结余|sisa/i

export function planIntent(intent: Intent, slots: Slots, text: string, host: AgentHost): IntentPlan {
  const today = host.state().bank.today
  switch (intent) {
    case 'greeting':
    case 'help':
    case 'thanks':
      return { kind: 'chat', intent, ...(slots.focus ? { focus: slots.focus } : {}) }
    case 'unknown':
      return { kind: 'unknown', intent }
    case 'external_transfer':
      return {
        kind: 'refusal', intent,
        t4: { tool: 'transfer_external', args: t4Args({ to: slots.person ?? slots.account ?? 'someone else', amount: slots.amount, account: slots.account }), store: true },
        ...(slots.person && /\b(?:bill|rent|invoice|tuition|fee)s?\b/i.test(text) && /['’]s\b/.test(text) ? { notes: [{ key: 'othersBill', facts: { person: slots.person } }] } : {}),
      }
    case 'add_payee':
      return { kind: 'refusal', intent, t4: { tool: 'add_payee', args: t4Args({ name: slots.person ?? 'new payee', account: slots.account }), store: true } }
    case 'change_permissions':
      return { kind: 'refusal', intent, t4: { tool: 'change_mandate', args: t4Args({ autonomy: /auto ?pilot|全自动|自动/i.test(text) ? 'autopilot' : 'unspecified' }), store: true } }
    case 'invest':
      return { kind: 'refusal', intent, t4: { tool: 'invest', args: t4Args({ amount: slots.amount }), store: false } }
    case 'credit':
      return { kind: 'refusal', intent, t4: { tool: 'apply_credit', args: t4Args({ amount: slots.amount }), store: false } }
    case 'sensitive_request':
      return { kind: 'refusal', intent }
    case 'overview':
      return read(intent, 'get_overview', { month: slots.month }, slots.focus)
    case 'breakdown':
      return read(intent, 'get_spending_breakdown', {
        month: slots.month,
        category: slots.category,
        compare: slots.focus === 'compare' ? true : undefined,
        months: slots.months,
        group: slots.group,
      }, slots.focus)
    case 'search': {
      if (slots.focus === 'largest') return read(intent, 'search_transactions', { sort: 'amount', limit: 5, purchasesOnly: slots.category ? undefined : true, category: slots.category, group: slots.group, month: slots.month ?? ym(today) }, 'largest')
      if (slots.focus === 'late_night') return read(intent, 'search_transactions', { lateNight: true, category: slots.group ? undefined : slots.category, group: slots.group, month: slots.month ?? ym(today) }, 'late_night')
      const filtered = Boolean(slots.merchant || slots.category || slots.month || slots.group)
      return read(intent, 'search_transactions', { query: slots.merchant, category: slots.merchant ? undefined : slots.category, group: slots.merchant ? undefined : slots.group, month: slots.month ?? (filtered ? undefined : ym(today)) })
    }
    case 'subscriptions':
      if (slots.focus === 'recommend') return { kind: 'recommend', intent }
      return read(intent, 'list_recurring', { onlySubscriptions: !/\brecurring|bills?\b/i.test(text) })
    case 'insights':
      return read(intent, 'get_insights', { month: slots.month })
    case 'goals':
      return slots.focus === 'what_if' && slots.monthly
        ? read(intent, 'get_goals', { monthly: slots.monthly, goalId: slots.goalId }, 'what_if')
        : read(intent, 'get_goals', {})
    case 'afford':
      return affordPlan(slots, host)
    case 'xray':
      return slots.text ? read(intent, 'xray_bill', { text: slots.text }) : { kind: 'ask', intent, facts: { stage: 'need_text' } }
    case 'bills':
      if (slots.reminder) return reminderPlan(slots, host)
      return read(intent, 'analyze_bills', { billId: slots.focus === 'due' ? slots.billId : undefined, withinDays: slots.withinDays }, slots.focus)
    case 'save_to_goal':
      return savePlan(slots, text, host)
    case 'withdraw_goal':
      return withdrawPlan(slots, host)
    case 'set_budget':
      return budgetPlan(slots, host)
    case 'budget_plan':
      return { kind: 'action', intent, tool: 'create_budget_plan', args: { method: slots.budgetMethod ?? 'history' } }
    case 'tripwire':
      return tripwirePlan(slots, host)
    case 'pay_bill':
      return payPlan(slots, text, host)
    case 'cancel_sub':
      return cancelPlan(slots, host)
    case 'dispute':
      return disputePlan(slots, text, host)
  }
  return { kind: 'unknown', intent: 'unknown' }
}

function t4Args(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k] = v
  return out
}

function read(intent: Intent, tool: ToolName, args: Record<string, unknown>, focus?: string): IntentPlan {
  return { kind: 'read', intent, tool, args: t4Args(args), ...(focus ? { focus } : {}) }
}

/** "Can I afford the concert ticket?" — a dream the user already priced needs no question. */
function affordPlan(slots: Slots, host: AgentHost): IntentPlan {
  const state = host.state()
  if (slots.amount) return read('afford', 'check_affordability', { amount: slots.amount, label: slots.label, category: slots.category })
  const ctx = nluContextOf(state, [])
  const goalId = (slots.label ? matchGoal(slots.label, ctx) : undefined) ?? slots.goalId
  const dream = findDream(state, goalId)
  if (dream && dream.price > 0 && !dream.achievedAt) {
    return read('afford', 'check_affordability', { amount: dream.price, label: dream.name, category: slots.category })
  }
  return clarify('afford', 'check_affordability', 'amount', slots, amountChoices(state, false), { stage: 'need_amount', ...(slots.label ? { label: slots.label } : {}) })
}

function clarify(intent: Intent, tool: ToolName, missing: string, slots: Slots, choices: Choice[], facts: Facts): IntentPlan {
  return { kind: 'clarify', intent, tool, missing, slots, choices, facts }
}

// ───────────────────────────── choices ─────────────────────────────

export function goalChoices(state: AppState): Choice[] {
  return openDreams(state).filter((d) => d.kind === 'goal').map((d) => ({ label: d.name, id: d.id }))
}

function potChoices(state: AppState): Choice[] {
  return state.dreams.filter((d) => (potOf(state, d)?.balance ?? 0) > 0).map((d) => ({ label: d.name, id: d.id }))
}

/** Unpaid bills as choices; bills that share a name are told apart by period ("Electricity · Sep ¥486.20 (overdue)"). */
function billChoices(state: AppState, ids?: string[]): Choice[] {
  const f = money(state)
  const today = state.bank.today
  const bills = unpaidBills(state).filter((b) => !ids || ids.includes(b.id))
  const names = new Map<string, number>()
  for (const b of bills) names.set(b.name, (names.get(b.name) ?? 0) + 1)
  return bills.slice(0, 5).map((b) => {
    const twin = (names.get(b.name) ?? 0) > 1
    const period = twin ? ` · ${monthLabel(b.period, 'short').split(' ')[0]}` : ''
    const overdue = b.dueDate < today ? ' (overdue)' : ''
    return { label: `${b.name}${period} ${f(b.amountDue)}${overdue}`, id: b.id }
  })
}

/** Pay a bill: the one named, the oldest of several with the same name only after asking, never a different amount. */
function payPlan(slots: Slots, text: string, host: AgentHost): IntentPlan {
  const state = host.state()
  const f = money(state)
  let billId = slots.billId
  if (!billId) {
    const named = entityCandidates('bills', text, nluContextOf(state, []))
    if (named.length === 1) billId = named[0]
    else if (named.length > 1) {
      const choices = billChoices(state, named)
      return clarify('pay_bill', 'pay_bill', 'billId', slots, choices, { stage: 'need_target', options: listJoin(choices.map((c) => c.label)) })
    }
  }
  if (!billId) {
    const choices = billChoices(state)
    return clarify('pay_bill', 'pay_bill', 'billId', slots, choices, { stage: 'need_target', options: listJoin(choices.map((c) => c.label)) })
  }
  const bill = state.bank.bills.find((b) => b.id === billId)
  const notes: PlanNote[] = bill && slots.amount && slots.amount !== bill.amountDue ? [{ key: 'billAmountNote', facts: { bill: bill.name, due: f(bill.amountDue) } }] : []
  return { kind: 'action', intent: 'pay_bill', tool: 'pay_bill', args: { billId }, ...(notes.length ? { notes } : {}) }
}

function subChoices(series: RecurringSeries[]): Choice[] {
  return activeSubscriptions(series).map((s) => ({ label: s.merchant, id: s.id }))
}

export function amountChoices(state: AppState, capped = true): Choice[] {
  const f = money(state)
  const cap = state.mandate.perActionCap
  const values = [10_000, 20_000, 30_000, 50_000].filter((v) => !capped || v <= cap)
  return values.slice(0, 3).map((v) => ({ label: f(v), id: String(v) }))
}

function safeRecurring(host: AgentHost): RecurringSeries[] {
  try {
    return host.recurring()
  } catch {
    return []
  }
}

// ───────────────────────────── per-intent planning ─────────────────────────────

function savePlan(slots: Slots, text: string, host: AgentHost): IntentPlan {
  const state = host.state()
  const f = money(state)
  let { goalId, amount } = slots
  const notes: PlanNote[] = []
  // "move all my money": say the limits up front — own pots only, the per-move cap, money kept for bills
  if (slots.all) {
    notes.push({ key: 'moveAllNote', facts: { cap: f(state.mandate.perActionCap) } })
    amount = undefined
  }
  if (!amount && !slots.all && SURPLUS_RE.test(text)) {
    const stash = stashSuggestion(host, goalId)
    if (stash) {
      goalId = goalId ?? stash.goalId
      amount = stash.amount
      const note = stashNote(host, stash)
      if (note) notes.push(note)
    }
  }
  if (slots.repeat && amount) notes.push({ key: 'repeatNote', facts: { amount: f(amount) } })
  const options = goalChoices(state)
  const extra = notes.length ? { notes } : {}
  if (!goalId) {
    if (options.length === 1) goalId = options[0].id
    else return { ...clarify('save_to_goal', 'transfer_to_goal', 'goalId', { ...slots, ...(amount ? { amount } : {}) }, options, { stage: 'need_target', options: listJoin(options.map((o) => o.label)) }), ...extra } as IntentPlan
  }
  if (!amount) {
    const choices = slots.all ? capChoices(state) : amountChoices(state)
    return { ...clarify('save_to_goal', 'transfer_to_goal', 'amount', { ...slots, goalId }, choices, { stage: 'need_amount', goalName: findDream(state, goalId)?.name ?? '' }), ...extra } as IntentPlan
  }
  return { kind: 'action', intent: 'save_to_goal', tool: 'transfer_to_goal', args: { goalId, amount }, ...extra }
}

/** For "move all my money": the per-move maximum first, then smaller steps. */
function capChoices(state: AppState): Choice[] {
  const f = money(state)
  const cap = state.mandate.perActionCap
  const values = [cap, ...[30_000, 20_000, 10_000].filter((v) => v < cap)].slice(0, 3)
  return values.map((v) => ({ label: f(v), id: String(v) }))
}

/** Why the stash is the amount it is ("¥330 gets MacBook Air to 50% — the other ¥338 of your ¥668 surplus is yours"). */
function stashNote(host: AgentHost, stash: { goalId: string; amount: Minor }): PlanNote | undefined {
  try {
    const ctx = host.ctx()
    const state = host.state()
    const s = summarizeMonth(ctx)
    const surplus = s.target - s.projected
    const dream = findDream(state, stash.goalId)
    if (!dream || surplus <= 0) return undefined
    const saved = potOf(state, dream)?.balance ?? 0
    const pct = dream.price > 0 ? ((saved + stash.amount) / dream.price) * 100 : 0
    const c = moneyCopy(state)
    const rest = surplus - stash.amount
    const facts: Record<string, string> = { amount: c(stash.amount), goal: dream.name, pct: pctLabel(pct) }
    if (rest > 0) Object.assign(facts, { rest: c(rest), surplus: c(surplus) })
    return { key: 'stashNote', facts, sources: { surplus, rest, pct, saved } }
  } catch {
    return undefined
  }
}

/** Half of a projected surplus (the mirror's "Stash it" CTA), within the per-action cap. */
export function stashSuggestion(host: AgentHost, goalId?: string): { goalId: string; amount: Minor } | undefined {
  const ctx = host.ctx()
  const mirror = computeMirror(ctx)
  const cta = mirror.cta?.tool === 'transfer_to_goal' ? mirror.cta.args : undefined
  let amount = typeof cta?.amount === 'number' ? cta.amount : 0
  if (!amount) {
    const s = summarizeMonth(ctx)
    const surplus = s.target - s.projected
    if (surplus <= 0) return undefined
    amount = roundDownTo10(Math.floor(surplus / 2), ctx.profile.currency)
  }
  const target = goalId ?? (typeof cta?.goalId === 'string' ? cta.goalId : primaryGoal(ctx.dreams.filter((d) => !d.achievedAt))?.id)
  if (!target) return undefined
  const capped = Math.min(amount, host.state().mandate.perActionCap)
  const rounded = roundDownTo10(capped, ctx.profile.currency)
  return rounded > 0 ? { goalId: target, amount: rounded } : undefined
}

function withdrawPlan(slots: Slots, host: AgentHost): IntentPlan {
  const state = host.state()
  const options = potChoices(state)
  let goalId = slots.goalId
  if (!goalId) {
    if (options.length === 1) goalId = options[0].id
    else return clarify('withdraw_goal', 'withdraw_from_goal', 'goalId', slots, options, { stage: 'need_target', options: listJoin(options.map((o) => o.label)) })
  }
  if (!slots.amount) return clarify('withdraw_goal', 'withdraw_from_goal', 'amount', { ...slots, goalId }, amountChoices(state), { stage: 'need_amount', goalName: findDream(state, goalId)?.name ?? '' })
  return { kind: 'action', intent: 'withdraw_goal', tool: 'withdraw_from_goal', args: { goalId, amount: slots.amount } }
}

function budgetPlan(slots: Slots, host: AgentHost): IntentPlan {
  const state = host.state()
  if (!slots.category) {
    const choices = topWantCategories(host).map((c) => ({ label: categoryLabel(c), id: c }))
    return clarify('set_budget', 'set_category_budget', 'category', slots, choices, { stage: 'need_target' })
  }
  if (!slots.amount) {
    const f = money(state)
    const spent = summarizeMonth(host.ctx()).byCategory.find((c) => c.category === slots.category)
    const base = spent?.limit ?? spent?.prevMonth ?? spent?.spent ?? 0
    const values = [0.8, 0.9, 1].map((k) => roundDownTo10(Math.round(base * k), state.profile?.currency ?? 'CNY')).filter((v, i, a) => v > 0 && a.indexOf(v) === i)
    return clarify('set_budget', 'set_category_budget', 'amount', slots, values.map((v) => ({ label: f(v), id: String(v) })), { stage: 'need_amount', category: categoryLabel(slots.category) })
  }
  return { kind: 'action', intent: 'set_budget', tool: 'set_category_budget', args: { category: slots.category, limit: slots.amount } }
}

function topWantCategories(host: AgentHost): CategoryId[] {
  try {
    return summarizeMonth(host.ctx()).byCategory
      .filter((c) => CATEGORIES[c.category]?.kind === 'want' && c.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 4)
      .map((c) => c.category)
  } catch {
    return ['delivery', 'dining', 'shopping']
  }
}

function tripwirePlan(slots: Slots, host: AgentHost): IntentPlan {
  const kind = slots.tripwireKind ?? (slots.category && slots.percent ? 'category_pct' : slots.percent ? 'month_pct' : slots.amount ? 'single_over' : undefined)
  const pctKind = kind === 'month_pct' || kind === 'category_pct' || kind === 'pace_over'
  const threshold = pctKind ? slots.percent : slots.amount
  if (!kind || !threshold) {
    const f = money(host.state())
    const choices: Choice[] = [
      { label: '80% of my target', id: 'month_pct:80' },
      { label: `Any purchase over ${f(30_000)}`, id: 'single_over:30000' },
      { label: 'If I’m on pace to overshoot', id: 'pace_over:100' },
    ]
    return clarify('tripwire', 'create_tripwire', 'threshold', { ...slots, ...(kind ? { tripwireKind: kind } : {}) }, choices, { stage: 'need_amount' })
  }
  if (kind === 'category_pct' && !slots.category) return clarify('tripwire', 'create_tripwire', 'category', slots, topWantCategories(host).map((c) => ({ label: categoryLabel(c), id: c })), { stage: 'need_amount' })
  const args: Record<string, unknown> = { kind, threshold }
  if (kind === 'category_pct') args.category = slots.category
  return { kind: 'action', intent: 'tripwire', tool: 'create_tripwire', args }
}

function reminderPlan(slots: Slots, host: AgentHost): IntentPlan {
  const daysBefore = typeof slots.daysBefore === 'number' ? Math.min(14, Math.max(0, slots.daysBefore)) : 3
  if (!slots.billId) {
    return clarify('bills', 'set_bill_reminder', 'billId', { ...slots, daysBefore }, billChoices(host.state()), { stage: 'need_target' })
  }
  return { kind: 'action', intent: 'bills', tool: 'set_bill_reminder', args: { billId: slots.billId, daysBefore } }
}

function cancelPlan(slots: Slots, host: AgentHost): IntentPlan {
  const series = safeRecurring(host)
  const id = slots.recurringId
  const known = id ? series.find((s) => s.id === id && s.status === 'active') : undefined
  // "cancel Spotify" when the user has QQ Music: ask, never cancel a different service than the one named
  if (slots.brand) {
    const choices = known ? [{ label: known.merchant, id: known.id }] : subChoices(series)
    const note: PlanNote = { key: 'brandMissing', facts: { brand: slots.brand, ...(known ? { merchant: known.merchant } : {}) } }
    const { brand: _brand, recurringId: _id, ...rest } = slots
    void _brand
    void _id
    return { ...clarify('cancel_sub', 'cancel_subscription', 'recurringId', rest as Slots, choices, { stage: 'need_target', ...(known ? {} : { options: listJoin(choices.map((c) => c.label)) }) }), notes: [note] } as IntentPlan
  }
  if (known) return { kind: 'action', intent: 'cancel_sub', tool: 'cancel_subscription', args: { recurringId: known.id } }
  const choices = subChoices(series)
  return clarify('cancel_sub', 'cancel_subscription', 'recurringId', slots, choices, { stage: 'need_target', options: listJoin(choices.map((c) => c.label)) })
}

function disputePlan(slots: Slots, text: string, host: AgentHost): IntentPlan {
  const state = host.state()
  const f = money(state)
  const dupes = duplicateCharges(host)
  const merchant = slots.recurringId ? safeRecurring(host).find((s) => s.id === slots.recurringId)?.merchant : slots.merchant
  const hit = merchant ? dupes.find((d) => d.merchant.toLowerCase().includes(merchant.toLowerCase()) || merchant.toLowerCase().includes(d.merchant.toLowerCase())) : undefined
  if (hit) return { kind: 'action', intent: 'dispute', tool: 'dispute_transaction', args: { txnId: hit.txnId, reason: hit.reason } }
  if (merchant && !/duplicate|double|twice|重复/i.test(text)) {
    const latest = [...state.bank.transactions].reverse().find((t) => t.amount < 0 && t.merchant.toLowerCase() === merchant.toLowerCase() && !t.flags?.includes('disputed'))
    if (latest) return { kind: 'action', intent: 'dispute', tool: 'dispute_transaction', args: { txnId: latest.id, reason: `Disputed ${latest.merchant} charge of ${f(-latest.amount)} on ${latest.date}` } }
  }
  const choices = dupes.slice(0, 4).map((d) => ({ label: `${d.merchant} ${f(d.amount)} on ${shortDate(d.date)}`, id: d.txnId }))
  return clarify('dispute', 'dispute_transaction', 'txnId', slots, choices, { stage: 'need_target', ...(choices.length ? { options: `Charges that look doubled: ${listJoin(choices.map((c) => c.label))}` } : {}) })
}

interface Dupe {
  txnId: string
  merchant: string
  amount: Minor
  date: string
  reason: string
}

/** Duplicate-charge findings, the clearest (same subscription billed twice) first. */
export function duplicateCharges(host: AgentHost): Dupe[] {
  const state = host.state()
  let findings: ReturnType<AgentHost['findings']> = []
  try {
    findings = host.findings()
  } catch {
    return []
  }
  const out: (Dupe & { rank: number })[] = []
  for (const x of findings) {
    if (x.kind !== 'duplicate_charge') continue
    const args = x.suggestedAction?.tool === 'dispute_transaction' ? x.suggestedAction.args : undefined
    const txnId = typeof args?.txnId === 'string' ? args.txnId : x.txnIds?.[x.txnIds.length - 1]
    const txn = state.bank.transactions.find((t) => t.id === txnId)
    if (!txn || txn.flags?.includes('disputed')) continue
    out.push({ txnId: txn.id, merchant: txn.merchant, amount: -txn.amount, date: txn.date, reason: typeof args?.reason === 'string' ? args.reason : `Duplicate charge from ${txn.merchant}`, rank: x.evidence.rule === 'series' ? 0 : 1 })
  }
  return out.sort((a, b) => a.rank - b.rank || (a.date < b.date ? 1 : -1))
}

// ───────────────────────────── task plans (plan_recovery) ─────────────────────────────

export interface PlanOutcome {
  plan: TaskPlan
  overview?: Record<string, unknown>
  results: Map<string, GateResult>
  /** "Save faster for <goal>": what the fixes free up each month and how much sooner the goal arrives */
  goalImpact?: GoalImpact
  /** the category cap proposed, and what was already spent there this month */
  cap?: { category: CategoryId; limit: Minor; spent: Minor }
}

export interface GoalImpact {
  goalId: string
  goalName: string
  /** estimated monthly saving from the plan's fixes */
  monthly: Minor
  parts: { label: string; monthly: Minor }[]
  /** weeks the goal arrives sooner at the current saving pace + the fixes */
  weeksSooner?: number
  /** the one-off move into the goal pot the plan proposes (pending the user's tap) */
  transfer?: Minor
}

/** Cancel running plans: waiting steps skipped, their pending actions rejected. */
export function cancelActivePlans(host: AgentHost, reason: string): { plans: number; skipped: number; rejected: number } {
  const active = host.state().plans.filter((p) => p.status === 'running' || p.status === 'awaiting_user')
  if (!active.length) return { plans: 0, skipped: 0, rejected: 0 }
  let skipped = 0
  let rejected = 0
  host.mutate((draft) => {
    for (const ref of active) {
      const plan = draft.plans.find((p) => p.id === ref.id) as TaskPlan
      for (const step of plan.steps) {
        if (step.status === 'waiting' || step.status === 'running') {
          step.status = 'skipped'
          step.resultSummary = reason
          skipped++
        }
        if (step.status === 'needs_approval' && step.pendingId) {
          const p = draft.pending.find((x) => x.id === step.pendingId) as PendingAction | undefined
          if (p && p.status === 'pending') {
            p.status = 'rejected'
            rejected++
            host.audit('user', 'action_rejected', `Rejected (plan stopped): ${p.preview.title}`, { pendingId: p.id, tool: p.call.tool, reason: 'interrupted' })
          }
          step.status = 'skipped'
          step.resultSummary = reason
          skipped++
        }
      }
      plan.status = 'cancelled'
      host.audit('user', 'user_action', `Plan cancelled: ${plan.goal}`, { planId: plan.id, reason })
    }
  })
  return { plans: active.length, skipped, rejected }
}

type StepSpec = Omit<PlanStep, 'status' | 'id'> & { id?: string }

class PlanRunner {
  readonly results = new Map<string, GateResult>()
  private n = 0

  constructor(private host: AgentHost, private turn: Turn, readonly planId: string) {}

  add(spec: StepSpec): string {
    const id = spec.id ?? `s${++this.n}`
    this.host.mutate((draft) => {
      const plan = draft.plans.find((p) => p.id === this.planId)
      if (!plan) return
      plan.steps.push({ id, tool: spec.tool, args: spec.args, dependsOn: spec.dependsOn, label: spec.label, status: 'waiting' })
      refreshPlan(plan)
    })
    return id
  }

  run(stepId: string): GateResult | undefined {
    const plan = this.host.state().plans.find((p) => p.id === this.planId)
    const step = plan?.steps.find((s) => s.id === stepId)
    if (!plan || !step || step.status !== 'waiting') return undefined
    const blockedBy = step.dependsOn.filter((d) => plan.steps.find((s) => s.id === d)?.status !== 'done')
    if (blockedBy.length) {
      this.host.mutate((draft) => {
        const s = draft.plans.find((p) => p.id === this.planId)?.steps.find((x) => x.id === stepId)
        if (s) Object.assign(s, { status: 'skipped', resultSummary: `Skipped: ${blockedBy.join(', ')} did not finish` })
      })
      return undefined
    }
    this.host.mutate((draft) => {
      const s = draft.plans.find((p) => p.id === this.planId)?.steps.find((x) => x.id === stepId)
      if (s) s.status = 'running'
    })
    const call = newCall(step.tool, step.args, 'offline', this.turn, step.label)
    const result = runGated(this.host, this.turn, call, { planStep: { planId: this.planId, stepId }, cards: false })
    this.results.set(stepId, result)
    return result
  }

  data(stepId: string): Record<string, unknown> {
    const d = this.results.get(stepId)?.outcome?.data
    return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : {}
  }
}

export function runRecoveryPlan(host: AgentHost, turn: Turn, opts: { goalId?: string } = {}): PlanOutcome {
  const superseded = cancelActivePlans(host, 'Replaced by a new plan')
  if (superseded.plans) trace(turn, 'intent', 'Previous plan cancelled (superseded)', superseded)
  const state = host.state()
  const goal = findDream(state, opts.goalId)
  const planId = uid('plan')
  const title = goal ? `Save faster for ${goal.name}` : `Get ${monthLabel(ym(state.bank.today))} back on track`
  host.mutate((draft) => {
    draft.plans.push({ id: planId, goal: title, createdAt: host.now(), status: 'running', steps: [] })
    host.audit('agent', 'user_action', `Plan started: ${title}`, { planId })
  })
  trace(turn, 'intent', `Task plan: ${title}`, { planId })
  const runner = new PlanRunner(host, turn, planId)
  const s1 = runner.add({ tool: 'get_overview', args: {}, dependsOn: [], label: 'Check how the month is going' })
  runner.run(s1)
  const overview = runner.data(s1)
  const status = String(overview.status ?? 'no_data')
  if (!goal) retitle(host, planId, status, String(overview.monthLabel ?? monthLabel(ym(state.bank.today))))
  let fixes: OverFixes | undefined
  if (status === 'over' || status === 'pace_over') fixes = overPlan(host, runner, s1)
  else if (status === 'under') underPlan(host, runner, s1, opts.goalId)
  else if (status === 'on_track') onTrackPlan(host, runner, s1)
  const goalImpact = goal && fixes ? goalPlan(host, runner, goal.id, fixes, s1) : undefined
  if (goalImpact) addSource(turn, goalImpact)
  if (fixes?.cap) addSource(turn, fixes.cap)
  host.mutate((draft) => {
    const plan = draft.plans.find((p) => p.id === planId)
    if (plan) refreshPlan(plan)
  })
  const plan = host.state().plans.find((p) => p.id === planId) as TaskPlan
  return { plan, overview, results: runner.results, ...(goalImpact ? { goalImpact } : {}), ...(fixes?.cap ? { cap: fixes.cap } : {}) }
}

interface OverFixes {
  steps: string[]
  cap?: { category: CategoryId; limit: Minor; spent: Minor; prevMonth?: Minor }
  sub?: RecurringSeries
}

/**
 * "Save faster for the Birkin": price each fix per month (a cap saves what last month's spend was above it, a
 * cancelled subscription its monthly price), turn the total into weeks gained at the goal's saving pace, and
 * propose moving that monthly amount into the pot now — a pending card, never automatic.
 */
function goalPlan(host: AgentHost, runner: PlanRunner, goalId: string, fixes: OverFixes, after: string): GoalImpact | undefined {
  const state = host.state()
  const dream = findDream(state, goalId)
  if (!dream) return undefined
  const f = money(state)
  const parts: GoalImpact['parts'] = []
  if (fixes.cap) {
    const typical = fixes.cap.prevMonth ?? fixes.cap.spent
    const saving = roundDownTo10(typical - fixes.cap.limit, state.profile?.currency ?? 'CNY')
    if (saving > 0) parts.push({ label: `the ${categoryLabel(fixes.cap.category)} cap`, monthly: saving })
  }
  if (fixes.sub) parts.push({ label: `cancelling ${fixes.sub.merchant}`, monthly: fixes.sub.lastAmount })
  const monthly = parts.reduce((sum, p) => sum + p.monthly, 0)
  if (monthly <= 0) return undefined
  let weeksSooner: number | undefined
  try {
    const progress = goalProgress(dream, host.ctx())
    const remaining = Math.max(0, progress.price - progress.saved)
    if (progress.monthlyRate > 0 && remaining > 0) {
      const months = remaining / progress.monthlyRate - remaining / (progress.monthlyRate + monthly)
      weeksSooner = Math.round((months * 52) / 12)
    }
  } catch {
    weeksSooner = undefined
  }
  const transfer = Math.min(monthly, state.mandate.perActionCap)
  if (transfer > 0) {
    // independent of the other fixes (a cancellation may still be waiting for the PIN): its own card, your tap
    const step = runner.add({ tool: 'transfer_to_goal', args: { goalId, amount: transfer }, dependsOn: [after], label: `Move ${f(transfer)} into ${dream.name} — what these fixes free up each month` })
    runner.run(step)
  }
  return { goalId, goalName: dream.name, monthly, parts, ...(weeksSooner && weeksSooner > 0 ? { weeksSooner } : {}), ...(transfer > 0 ? { transfer } : {}) }
}

function retitle(host: AgentHost, planId: string, status: string, month: string): void {
  const title = status === 'under' ? `Put ${month}’s surplus to work` : status === 'on_track' ? `Keep ${month} on track` : status === 'no_data' ? `Plan ${month}` : `Get ${month} back on track`
  host.mutate((draft) => {
    const plan = draft.plans.find((p) => p.id === planId)
    if (plan) plan.goal = title
  })
}

function overPlan(host: AgentHost, runner: PlanRunner, s1: string): OverFixes {
  const s2 = runner.add({ tool: 'get_spending_breakdown', args: {}, dependsOn: [s1], label: 'Find what pushed you over' })
  const s3 = runner.add({ tool: 'analyze_bills', args: {}, dependsOn: [s1], label: 'Look for bill and subscription leaks' })
  const s4 = runner.add({ tool: 'get_insights', args: {}, dependsOn: [s2], label: 'Spot habits worth changing' })
  runner.run(s2)
  runner.run(s3)
  runner.run(s4)
  const state = host.state()
  const f = money(state)
  const cap = pickCap(runner.data(s2), runner.data(s4), state)
  const proposals: string[] = []
  if (cap) proposals.push(runner.add({ tool: 'set_category_budget', args: { category: cap.category, limit: cap.limit }, dependsOn: [s2, s4], label: `Cap ${categoryLabel(cap.category)} at ${f(cap.limit)}` }))
  const findings = Array.isArray(runner.data(s3).findings) ? (runner.data(s3).findings as { kind?: string }[]) : []
  const sub = findings.some((x) => x.kind === 'subscription_overlap') ? cheapestOverlapping(safeRecurring(host)) : undefined
  if (sub) proposals.push(runner.add({ tool: 'cancel_subscription', args: { recurringId: sub.id }, dependsOn: [s3], label: `Cancel ${sub.merchant} (overlapping video app)` }))
  if (!hasPaceWire(state)) proposals.push(runner.add({ tool: 'create_tripwire', args: { kind: 'pace_over', threshold: 100 }, dependsOn: [s2], label: 'Warn me if I’m on pace to overshoot' }))
  for (const id of proposals) runner.run(id)
  const row = cap ? (Array.isArray(runner.data(s2).categories) ? (runner.data(s2).categories as { category: string; spent: number; prevMonth?: number }[]) : []).find((r) => r.category === cap.category) : undefined
  return {
    steps: proposals,
    ...(cap ? { cap: { ...cap, spent: row?.spent ?? 0, ...(row?.prevMonth !== undefined ? { prevMonth: row.prevMonth } : {}) } } : {}),
    ...(sub ? { sub } : {}),
  }
}

function underPlan(host: AgentHost, runner: PlanRunner, s1: string, goalId?: string): void {
  const s2 = runner.add({ tool: 'get_goals', args: {}, dependsOn: [s1], label: 'Check your dream goals' })
  runner.run(s2)
  const state = host.state()
  const f = money(state)
  const proposals: string[] = []
  const stash = stashSuggestion(host, goalId)
  if (stash) {
    const name = findDream(state, stash.goalId)?.name ?? 'your goal'
    proposals.push(runner.add({ tool: 'transfer_to_goal', args: { goalId: stash.goalId, amount: stash.amount }, dependsOn: [s2], label: `Stash ${f(stash.amount)} in ${name}` }))
  }
  if (!hasPaceWire(state)) proposals.push(runner.add({ tool: 'create_tripwire', args: { kind: 'pace_over', threshold: 100 }, dependsOn: [s1], label: 'Protect the surplus: warn me if I’m on pace to overshoot' }))
  for (const id of proposals) runner.run(id)
}

function onTrackPlan(host: AgentHost, runner: PlanRunner, s1: string): void {
  const s2 = runner.add({ tool: 'get_spending_breakdown', args: {}, dependsOn: [s1], label: 'See where the money goes' })
  const s3 = runner.add({ tool: 'get_insights', args: {}, dependsOn: [s2], label: 'Spot habits worth changing' })
  runner.run(s2)
  runner.run(s3)
  if (!hasPaceWire(host.state())) {
    const s4 = runner.add({ tool: 'create_tripwire', args: { kind: 'pace_over', threshold: 100 }, dependsOn: [s2], label: 'Warn me if I’m on pace to overshoot' })
    runner.run(s4)
  }
}

function hasPaceWire(state: AppState): boolean {
  return state.tripwires.some((t) => t.enabled && t.kind === 'pace_over' && t.threshold <= 100)
}

/**
 * The category cap for an over-budget month. Habits the insights flagged (late-night delivery, small frequent
 * buys) are what a cap can actually change, so a flagged 'want' category at >= 90% of its budget wins;
 * otherwise the biggest over-budget 'want' (a one-off splurge is the last resort). The cap is 10% under the
 * category's current budget, rounded down to 10.
 */
export function pickCap(breakdown: Record<string, unknown>, insights: Record<string, unknown>, state: AppState): { category: CategoryId; limit: Minor } | undefined {
  type Row = { category: CategoryId; kind?: string; spent: number; limit?: number }
  const rows = ((Array.isArray(breakdown.categories) ? breakdown.categories : []) as Row[]).filter((r) => r.kind === 'want' && r.limit !== undefined && r.limit > 0)
  const overBy = (r: Row) => r.spent - (r.limit ?? 0)
  const habits = new Set(((Array.isArray(insights.insights) ? insights.insights : []) as { kind?: string; category?: string }[])
    .filter((i) => HABIT_INSIGHTS.has(i.kind ?? '') && i.category)
    .map((i) => i.category as string))
  const flagged = rows.filter((r) => habits.has(r.category) && r.spent >= (r.limit ?? 0) * 0.9).sort((a, b) => overBy(b) - overBy(a))
  const over = rows.filter((r) => r.spent > (r.limit ?? 0)).sort((a, b) => overBy(b) - overBy(a))
  const row = flagged[0] ?? over[0]
  if (!row?.limit) return undefined
  const currency = state.profile?.currency ?? 'CNY'
  const limit = Math.max(roundDownTo10(Math.round(row.limit * 0.9), currency), 5_000)
  return limit < row.limit ? { category: row.category, limit } : undefined
}

const HABIT_INSIGHTS = new Set(['late_night', 'small_frequent', 'weekend_spike'])

// ───────────────────────────── plan reply ─────────────────────────────

export function planReply(outcome: PlanOutcome, state: AppState, tone: Tone): string {
  const f = moneyCopy(state)
  const { plan, overview } = outcome
  const actions = plan.steps.filter((s) => !READ_TOOLS.has(s.tool))
  const done = actions.filter((s) => s.status === 'done')
  const waiting = actions.filter((s) => s.status === 'needs_approval')
  const blocked = actions.filter((s) => s.status === 'blocked' || s.status === 'failed')
  const status = String(overview?.status ?? 'no_data')
  const spent = typeof overview?.spent === 'number' ? f(overview.spent) : undefined
  const target = typeof overview?.target === 'number' ? f(overview.target) : undefined
  const delta = typeof overview?.delta === 'number' && overview.delta > 0 ? f(overview.delta) : undefined
  if (!actions.length) {
    if (status === 'no_data') return 'There’s no spending to plan around yet this month. Once transactions come in, I can build you a plan.'
    return `I checked your month${spent && target ? ` (${spent} of ${target})` : ''} and there’s nothing I need to change right now. Keep it up!`
  }
  const list = listJoin(actions.map((s) => lower(s.label)))
  const lead = status === 'under'
    ? byTone(tone, {
      gentle: `You’re on course to finish${delta ? ` ${delta}` : ''} under — let’s put it to work. My plan: ${list}.`,
      cheeky: `Look at you, finishing${delta ? ` ${delta}` : ''} under! Let’s make that money count: ${list}.`,
      numbers: `Projected under target${delta ? ` by ${delta}` : ''}. Plan: ${list}.`,
    })
    : byTone(tone, {
      gentle: `Here’s a plan to get back on track${spent && target ? ` (you’re at ${spent} of your ${target} target)` : ''}. I checked where the money went and your bills, then lined up ${actions.length} fixes: ${list}.`,
      cheeky: `Rescue mission time${spent && target ? `: ${spent} spent against a ${target} target` : ''}. I dug through your spending and bills — the plan: ${list}.`,
      numbers: `Recovery plan${spent && target ? ` (spent ${spent} of ${target})` : ''}: ${list}.`,
    })
  const parts = [lead]
  const impact = outcome.goalImpact
  if (impact) {
    const lead2 = `For ${impact.goalName}: these fixes free up about ${f(impact.monthly)} a month${impact.weeksSooner ? ` — roughly ${impact.weeksSooner} weeks sooner at your saving pace` : ''}.`
    parts[0] = `${lead2} ${lead}`
  }
  const cap = outcome.cap
  if (cap && cap.spent >= cap.limit) parts.push(`You’re already at ${f(cap.spent)} on ${categoryLabel(cap.category)} this month, so treat ${f(cap.limit)} as next month’s line.`)
  if (done.length) parts.push(`${countWord(done.length)} ${done.length === 1 ? 'is' : 'are'} already done — you can undo ${done.length === 1 ? 'it' : 'them'} from the card for a short while.`)
  if (waiting.length) parts.push(`${countWord(waiting.length)} ${waiting.length === 1 ? 'needs' : 'need'} your OK on the card${waiting.some((s) => s.tool === 'cancel_subscription' || s.tool === 'pay_bill' || s.tool === 'dispute_transaction') ? ' (with your PIN)' : ''}.`)
  if (blocked.length) parts.push(`${countWord(blocked.length)} couldn’t go ahead: ${lowerFirst(blocked[0].resultSummary ?? 'blocked by your permission rules')}`)
  parts.push('Say “stop” any time to cancel the rest.')
  return parts.join(' ').replace(/\.\./g, '.')
}

const READ_TOOLS = new Set<string>(['get_overview', 'get_spending_breakdown', 'search_transactions', 'list_recurring', 'analyze_bills', 'get_insights', 'check_affordability', 'get_goals', 'xray_bill'])

function byTone(tone: Tone, copy: Record<Tone, string>): string {
  return copy[tone] ?? copy.gentle
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function lowerFirst(s: string): string {
  const t = s.trim()
  return /[.!?]$/.test(t) ? lower(t) : `${lower(t)}.`
}

function countWord(n: number): string {
  return ['None', 'One', 'Two', 'Three', 'Four', 'Five'][n] ?? String(n)
}
