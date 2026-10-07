import { ym } from '../dates'
import { describeTripwire, proposeBudget, summarizeMonth } from '../finance'
import { callAmount } from '../security/policy'
import type { ActionPreview, AppState, Minor, RecurringSeries, ToolCall, Tripwire } from '../types'
import type { AgentHost } from './host'
import { TOOL_SPECS, isToolName } from './specs'
import {
  accountLabel,
  categoryLabel,
  checkingOf,
  ctxOf,
  findBill,
  findDream,
  maskArgs,
  money,
  pct,
  pctLabel,
  potOf,
  shortDate,
} from './support'

/**
 * Structured, code-built previews of what a call will do — the action card content. Never LLM prose.
 * `to` feeds the binding hash, so it only holds stable identifiers (names + masked numbers, no balances).
 */
export function buildPreview(call: ToolCall, state: AppState, recurring: RecurringSeries[]): ActionPreview {
  try {
    return previewFor(call, state, recurring)
  } catch {
    return generic(call)
  }
}

export function previewWithHost(call: ToolCall, host: AgentHost): ActionPreview {
  return buildPreview(call, host.state(), safeRecurring(host))
}

function safeRecurring(host: AgentHost): RecurringSeries[] {
  try {
    return host.recurring()
  } catch {
    return []
  }
}

function generic(call: ToolCall): ActionPreview {
  const spec = isToolName(call.tool) ? TOOL_SPECS[call.tool] : undefined
  return {
    title: spec?.label ?? 'Unknown action',
    summary: spec ? spec.description : 'FundBun does not recognise this action, so it will not run.',
    reversible: spec?.reversible ?? false,
    risk: !spec || spec.tier >= 3 ? 'high' : spec.tier === 2 ? 'medium' : 'low',
    effects: [],
  }
}

type Builder = (call: ToolCall, state: AppState, recurring: RecurringSeries[]) => ActionPreview

function previewFor(call: ToolCall, state: AppState, recurring: RecurringSeries[]): ActionPreview {
  if (!isToolName(call.tool)) return generic(call)
  const spec = TOOL_SPECS[call.tool]
  if (spec.tier === 4) return prohibited(call)
  if (spec.tier === 0) return { title: spec.label, summary: 'Read-only: nothing changes.', reversible: true, risk: 'low', effects: ['Reads your data on this device'] }
  const build = BUILDERS[call.tool]
  return build ? build(call, state, recurring) : generic(call)
}

const undoLine = (state: AppState) => `You can undo it for ${state.mandate.undoWindowSec} seconds`
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function prohibited(call: ToolCall): ActionPreview {
  const spec = TOOL_SPECS[call.tool as keyof typeof TOOL_SPECS]
  const args = maskArgs(call.args)
  const to = str(args.to) || str(args.account) || str(args.name) || undefined
  return {
    title: spec.label,
    summary: 'The assistant is never allowed to do this. Only you can, in your bank app.',
    ...(typeof args.amount === 'number' ? { amount: args.amount } : {}),
    ...(to ? { to } : {}),
    reversible: false,
    risk: 'high',
    effects: ['Blocked by FundBun\'s permission rules (tier T4)', 'Nothing will be sent or changed'],
  }
}

function transferToGoal(call: ToolCall, state: AppState): ActionPreview {
  const f = money(state)
  const amount = num(call.args.amount)
  const dream = findDream(state, call.args.goalId)
  const checking = checkingOf(state.bank)
  if (!dream) return { title: `Move ${f(amount)} to an unknown goal`, summary: 'This goal does not exist.', amount, from: accountLabel(checking), reversible: true, risk: 'medium', effects: ['Nothing will move: the goal was not found'] }
  const pot = potOf(state, dream)
  const potBal = pot?.balance ?? 0
  const bal = checking?.balance ?? 0
  return {
    title: `Move ${f(amount)} to ${dream.name}`,
    summary: `From ${accountLabel(checking)} into your ${dream.name} pot, as soon as you approve.`,
    amount,
    from: accountLabel(checking),
    to: `${dream.name} pot`,
    reversible: true,
    risk: 'medium',
    effects: [
      `${checking?.name ?? 'Checking'}: ${f(bal)} → ${f(bal - amount)}`,
      `${dream.name} pot: ${f(potBal)} → ${f(potBal + amount)} (${pctLabel(pct(potBal + amount, dream.price))} of ${f(dream.price)})`,
      'Stays in your own accounts',
      undoLine(state),
    ],
  }
}

function withdrawFromGoal(call: ToolCall, state: AppState): ActionPreview {
  const f = money(state)
  const amount = num(call.args.amount)
  const dream = findDream(state, call.args.goalId)
  const checking = checkingOf(state.bank)
  const pot = dream ? potOf(state, dream) : undefined
  const name = dream?.name ?? 'an unknown goal'
  return {
    title: `Move ${f(amount)} from ${name} back to checking`,
    summary: `From your ${name} pot into ${accountLabel(checking)}, as soon as you approve.`,
    amount,
    from: `${name} pot`,
    to: accountLabel(checking),
    reversible: true,
    risk: 'medium',
    effects: [
      `${name} pot: ${f(pot?.balance ?? 0)} → ${f((pot?.balance ?? 0) - amount)}`,
      `${checking?.name ?? 'Checking'}: ${f(checking?.balance ?? 0)} → ${f((checking?.balance ?? 0) + amount)}`,
      undoLine(state),
    ],
  }
}

function payBill(call: ToolCall, state: AppState): ActionPreview {
  const f = money(state)
  const bill = findBill(state, call.args.billId)
  const checking = checkingOf(state.bank)
  if (!bill) return { title: 'Pay an unknown bill', summary: 'This bill does not exist.', reversible: false, risk: 'high', effects: ['Nothing will be paid'] }
  const payee = state.bank.payees.find((p) => p.id === bill.payeeId)
  const amount = callAmount(call, state.bank)
  const date = str(call.args.date)
  const later = date && date > state.bank.today
  const to = payee ? `${payee.name}${payee.maskedAccount ? ` ${payee.maskedAccount}` : ''} (${payee.verified ? 'verified payee' : 'NOT verified'})` : 'Unknown payee'
  return {
    title: `Pay ${bill.name} ${f(amount)}`,
    summary: later ? `Scheduled for ${shortDate(date)} from ${accountLabel(checking)}. Due ${shortDate(bill.dueDate)}.` : `Paid now from ${accountLabel(checking)}. Due ${shortDate(bill.dueDate)}.`,
    amount,
    from: accountLabel(checking),
    to,
    reversible: false,
    risk: 'high',
    effects: [
      later ? `Goes out on ${shortDate(date)}` : `${checking?.name ?? 'Checking'}: ${f(checking?.balance ?? 0)} → ${f((checking?.balance ?? 0) - amount)}`,
      `${bill.name} bill (${bill.period}) marked ${later ? 'scheduled' : 'paid'}`,
      'Needs your PIN',
      'Can\'t be undone from FundBun',
    ],
  }
}

function cancelSubscription(call: ToolCall, state: AppState, recurring: RecurringSeries[]): ActionPreview {
  const f = money(state)
  const s = recurring.find((r) => r.id === call.args.recurringId)
  if (!s) return { title: 'Cancel an unknown subscription', summary: 'This subscription was not found.', reversible: false, risk: 'medium', effects: ['Nothing will change'] }
  return {
    title: `Cancel ${s.merchant}`,
    summary: `Stops future ${s.merchant} charges in your bank.`,
    to: s.merchant,
    reversible: false,
    risk: 'medium',
    effects: [
      `Stops ${f(s.lastAmount)} ${s.cadence} charges`,
      `Saves about ${f(s.annualCost)} a year`,
      'Needs your PIN',
      `Can't be undone from FundBun — you'd re-subscribe with ${s.merchant}`,
    ],
  }
}

function disputeTransaction(call: ToolCall, state: AppState): ActionPreview {
  const f = money(state)
  const txn = state.bank.transactions.find((t) => t.id === call.args.txnId)
  if (!txn) return { title: 'Dispute an unknown charge', summary: 'This transaction was not found.', reversible: false, risk: 'medium', effects: ['Nothing will change'] }
  return {
    title: `Dispute ${f(Math.abs(txn.amount))} from ${txn.merchant}`,
    summary: `Asks your bank to review the ${shortDate(txn.date)} charge.`,
    to: 'Your bank (disputes)',
    reversible: false,
    risk: 'medium',
    effects: [
      `Charge: ${txn.merchant}, ${f(Math.abs(txn.amount))} on ${shortDate(txn.date)}`,
      `Reason: ${str(call.args.reason).slice(0, 120) || 'not given'}`,
      'The bank decides; a refund is not guaranteed',
      'Needs your PIN',
    ],
  }
}

function setCategoryBudget(call: ToolCall, state: AppState): ActionPreview {
  const f = money(state)
  const category = str(call.args.category)
  const limit = num(call.args.limit)
  const prev = state.budget?.categories.find((c) => c.category === category)?.limit
  const spent = spentIn(state, category)
  return {
    title: `Set ${categoryLabel(category)} budget to ${f(limit)} a month`,
    summary: 'Changes your budget only — no money moves.',
    reversible: true,
    risk: 'low',
    effects: [
      prev !== undefined ? `Was ${f(prev)}` : 'No limit before',
      ...(spent !== undefined ? [`Spent so far this month: ${f(spent)}`] : []),
      undoLine(state),
    ],
  }
}

function spentIn(state: AppState, category: string): Minor | undefined {
  const ctx = ctxOf(state)
  if (!ctx) return undefined
  return summarizeMonth(ctx).byCategory.find((c) => c.category === category)?.spent ?? 0
}

function createBudgetPlan(call: ToolCall, state: AppState): ActionPreview {
  const f = money(state)
  const ctx = ctxOf(state)
  const method = call.args.method === 'fifty_thirty_twenty' ? 'fifty_thirty_twenty' : 'history'
  const plan = ctx ? proposeBudget(ctx, method, ym(state.bank.today)) : null
  const top = plan ? [...plan.categories].sort((a, b) => b.limit - a.limit).slice(0, 3) : []
  return {
    title: `Apply a ${method === 'history' ? 'history-based' : '50/30/20'} budget${plan ? `: ${f(plan.total)} a month` : ''}`,
    summary: plan?.rationale ?? 'Builds a monthly plan from your income, target and history.',
    reversible: true,
    risk: 'low',
    effects: [
      ...top.map((c) => `${categoryLabel(c.category)}: ${f(c.limit)}`),
      state.budget ? `Replaces your current plan (${f(state.budget.total)})` : 'You have no plan yet',
      undoLine(state),
    ],
  }
}

function createTripwire(call: ToolCall, state: AppState): ActionPreview {
  const t: Tripwire = {
    id: 'preview',
    kind: call.args.kind as Tripwire['kind'],
    threshold: num(call.args.threshold),
    enabled: true,
    createdBy: 'agent',
    label: '',
    ...(typeof call.args.category === 'string' ? { category: call.args.category as Tripwire['category'] } : {}),
  }
  let label = 'Spending tripwire'
  try {
    label = describeTripwire(t, state.profile?.currency ?? 'CNY')
  } catch {
    // keep the generic label
  }
  return {
    title: `Tripwire: ${label}`,
    summary: 'Adds a spending alert — no money moves.',
    reversible: true,
    risk: 'low',
    effects: ['Shows a reminder with your dream item when it fires', undoLine(state)],
  }
}

function recategorize(call: ToolCall, state: AppState): ActionPreview {
  const txn = state.bank.transactions.find((t) => t.id === call.args.txnId)
  const to = categoryLabel(str(call.args.category))
  return {
    title: `File ${txn?.merchant ?? 'this transaction'} under ${to}`,
    summary: 'Changes a category — no money moves.',
    reversible: true,
    risk: 'low',
    effects: [`${categoryLabel(txn?.category)} → ${to}`, `Future ${txn?.merchant ?? ''} purchases are filed under ${to} too`.replace('  ', ' '), undoLine(state)],
  }
}

function setBillReminder(call: ToolCall, state: AppState): ActionPreview {
  const bill = findBill(state, call.args.billId)
  const days = num(call.args.daysBefore)
  return {
    title: `Remind me ${days} day${days === 1 ? '' : 's'} before ${bill?.name ?? 'this bill'}`,
    summary: bill ? `${bill.name} is due ${shortDate(bill.dueDate)}.` : 'Bill not found.',
    reversible: true,
    risk: 'low',
    effects: ['Adds a reminder — no money moves', undoLine(state)],
  }
}

const BUILDERS: Partial<Record<string, Builder>> = {
  transfer_to_goal: transferToGoal,
  withdraw_from_goal: withdrawFromGoal,
  pay_bill: payBill,
  cancel_subscription: cancelSubscription,
  dispute_transaction: disputeTransaction,
  set_category_budget: setCategoryBudget,
  create_budget_plan: createBudgetPlan,
  create_tripwire: createTripwire,
  recategorize_transaction: recategorize,
  set_bill_reminder: setBillReminder,
}
