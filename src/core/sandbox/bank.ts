import { CATEGORIES } from '../categories'
import { addDays, dayOfMonth, daysInMonth, ym } from '../dates'
import type { Account, BankState, Bill, CategoryId, Dispute, ISODate, Initiator, Minor, PayChannel, Payee, Transaction } from '../types'
import { billPaymentDescription, billsIssuedOn, seriesOf } from './billing'
import { defaultCategorizer, safeCategorize, type Categorizer } from './categorizer'
import { CHECKING_ID, nextTxnId, potId, toTransaction, type Draft } from './drafts'
import { billPaymentSchedule, generateDay, incomeDrafts, potContribution } from './generator'
import { getScript } from './scripts'

export type BankErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'UNKNOWN_ACCOUNT'
  | 'NOT_OWN_ACCOUNT'
  | 'UNKNOWN_BILL'
  | 'BILL_ALREADY_PAID'
  | 'UNVERIFIED_PAYEE'
  | 'AMOUNT_MISMATCH'
  | 'INVALID_AMOUNT'
  | 'BANK_AGENT_LIMIT'
  | 'UNKNOWN_TXN'
  | 'ALREADY_DISPUTED'
  | 'UNKNOWN_MERCHANT'

export class BankError extends Error {
  constructor(public code: BankErrorCode, message: string) {
    super(message)
    this.name = 'BankError'
  }
}

/**
 * Bank-side hard limit for agent-initiated money movement per day, enforced by the sandbox bank itself
 * independently of FundBun's policy engine (defence in depth — like a real bank's API mandate).
 */
export const BANK_AGENT_DAILY_LIMIT: Minor = 500_000 // ¥5,000

/** advanceDays refuses to jump further than this in one call */
export const MAX_ADVANCE_DAYS = 366

const MAX_MEMO_LENGTH = 280
const MAX_REASON_LENGTH = 500
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** digits / spaces / dashes only: what a pasted external account number looks like */
const EXTERNAL_ACCOUNT_LIKE = /^[\d\s-]{8,}$/

export interface SandboxBankOptions {
  /** categoriser for simulated purchases (default: finance/categorize) */
  categorizer?: Categorizer
  /** user-learned merchant → category rules passed to the categoriser */
  userRules?: Record<string, CategoryId>
}

function cleanText(text: string | undefined, max: number): string | undefined {
  // strip C0 control characters (keep \t\n) — untrusted text is stored, never interpreted
  const t = (text ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()
  return t ? t.slice(0, max) : undefined
}

function assertPositiveAmount(amount: Minor): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new BankError('INVALID_AMOUNT', `Amount must be a positive whole number of minor units (got ${amount})`)
  }
}

function isISODate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && addDays(date, 0) === date
}

function sameMerchant(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * The simulated bank. Mutates the BankState it wraps (callers clone for immutable snapshots).
 * Every money movement creates balanced transactions and adjusts account balances.
 */
export class SandboxBank {
  private readonly categorizer: Categorizer
  private readonly userRules: Record<string, CategoryId>

  constructor(public state: BankState, opts: SandboxBankOptions = {}) {
    this.categorizer = opts.categorizer ?? defaultCategorizer
    this.userRules = opts.userRules ?? {}
  }

  checking(): Account {
    const acc = this.state.accounts.find((a) => a.id === CHECKING_ID) ?? this.state.accounts.find((a) => a.type === 'checking')
    if (!acc) throw new BankError('UNKNOWN_ACCOUNT', 'No checking account in this sandbox')
    return acc
  }

  pots(): Account[] {
    return this.state.accounts.filter((a) => a.type === 'pot')
  }

  /** Create a savings pot for a dream goal (id `pot_<goalId>`), or return the existing one. */
  ensurePot(goalId: string, name: string): Account {
    const gid = (goalId ?? '').trim()
    if (!gid) throw new BankError('UNKNOWN_ACCOUNT', 'A goal id is required to open a pot')
    const id = potId(gid)
    const existing = this.state.accounts.find((a) => a.id === id)
    if (existing) {
      if (existing.type !== 'pot') throw new BankError('NOT_OWN_ACCOUNT', `${id} is not a savings pot`)
      return existing
    }
    const pot: Account = { id, name: cleanText(name, 80) ?? gid, type: 'pot', balance: 0, currency: this.checking().currency, goalId: gid }
    this.state.accounts.push(pot)
    return pot
  }

  /** Own-account transfer (checking ↔ pot). Two transactions (category 'savings'), returns both. */
  transferInternal(fromId: string, toId: string, amount: Minor, memo: string, initiatedBy: Initiator): Transaction[] {
    assertPositiveAmount(amount)
    const from = this.ownAccount(fromId)
    const to = this.ownAccount(toId)
    if (from.id === to.id) throw new BankError('NOT_OWN_ACCOUNT', 'Source and destination must be two different own accounts')
    if (from.currency !== to.currency) throw new BankError('INVALID_AMOUNT', 'Cross-currency transfers are not supported')
    if (from.balance < amount) throw new BankError('INSUFFICIENT_FUNDS', `${from.name} has insufficient funds`)
    if (initiatedBy === 'agent' && from.type === 'checking') this.assertAgentAllowance(amount)
    const base = { date: this.state.today, category: 'savings' as const, channel: 'bank_transfer' as const, initiatedBy, memo: cleanText(memo, MAX_MEMO_LENGTH) }
    const out = this.post({ ...base, accountId: from.id, amount: -amount, merchant: to.name, description: `TRANSFER 转账 → ${to.name}` })
    const inn = this.post({ ...base, accountId: to.id, amount, merchant: from.name, description: `TRANSFER 转账 ← ${from.name}` })
    return [out, inn]
  }

  /**
   * Pay a bill to its verified payee (now, or schedule when date > today). The amount is always the bill's
   * amountDue; passing a different `amount` is refused (AMOUNT_MISMATCH).
   */
  payBill(billId: string, initiatedBy: Initiator, date?: ISODate, amount?: Minor): { bill: Bill; txn?: Transaction } {
    const bill = this.state.bills.find((b) => b.id === billId)
    if (!bill) throw new BankError('UNKNOWN_BILL', `Unknown bill ${billId}`)
    if (bill.status === 'paid') throw new BankError('BILL_ALREADY_PAID', `${bill.name} ${bill.period} is already paid`)
    if (amount !== undefined && amount !== bill.amountDue) {
      throw new BankError('AMOUNT_MISMATCH', `Bill amount is ${bill.amountDue}, refusing to pay ${amount}`)
    }
    assertPositiveAmount(bill.amountDue)
    const payee = this.verifiedPayee(bill.payeeId)
    if (date !== undefined) {
      if (!isISODate(date)) throw new BankError('INVALID_AMOUNT', `Invalid payment date "${date}"`)
      if (date > this.state.today) {
        // the instruction is given today, so it counts against today's agent allowance
        if (initiatedBy === 'agent') this.assertAgentAllowance(bill.amountDue)
        bill.status = 'scheduled'
        bill.scheduledFor = date
        return { bill }
      }
    }
    return { bill, txn: this.executeBillPayment(bill, payee, initiatedBy) }
  }

  /** Stop future charges for a merchant (adds to cancelledMerchants). */
  cancelRecurring(merchant: string): void {
    const name = (merchant ?? '').trim()
    if (!name) throw new BankError('UNKNOWN_MERCHANT', 'A merchant name is required')
    const known = this.state.transactions.find((t) => t.amount < 0 && sameMerchant(t.merchant, name))
    if (!known) throw new BankError('UNKNOWN_MERCHANT', `No charges from "${name}" in this account`)
    if (!this.state.cancelledMerchants.some((m) => sameMerchant(m, name))) this.state.cancelledMerchants.push(known.merchant)
  }

  openDispute(txnId: string, reason: string, openedBy: Initiator): Dispute {
    const txn = this.findTxn(txnId)
    if (txn.amount >= 0) throw new BankError('INVALID_AMOUNT', 'Only outgoing payments can be disputed')
    if (this.state.disputes.some((d) => d.txnId === txnId && d.status === 'open')) {
      throw new BankError('ALREADY_DISPUTED', `Transaction ${txnId} already has an open dispute`)
    }
    const dispute: Dispute = {
      id: this.nextDisputeId(),
      txnId,
      reason: cleanText(reason, MAX_REASON_LENGTH) ?? 'No reason given',
      openedAt: this.state.today,
      status: 'open',
      openedBy,
    }
    this.state.disputes.push(dispute)
    if (!txn.flags?.includes('disputed')) txn.flags = [...(txn.flags ?? []), 'disputed']
    return dispute
  }

  /**
   * Reverse transactions (used by undo): adds offsetting entries flagged 'reversed' and restores balances.
   * All-or-nothing: every id is validated (and every resulting balance checked) before anything changes.
   * A reversed bill payment puts the bill back to upcoming/overdue.
   */
  reverse(txnIds: string[], reason: string): Transaction[] {
    const originals = [...new Set(txnIds)].map((id) => this.findTxn(id))
    for (const t of originals) {
      if (t.flags?.includes('reversed')) throw new BankError('UNKNOWN_TXN', `Transaction ${t.id} was already reversed`)
    }
    const delta = new Map<string, Minor>()
    for (const t of originals) delta.set(t.accountId, (delta.get(t.accountId) ?? 0) - t.amount)
    for (const [accountId, change] of delta) {
      const acc = this.ownAccount(accountId)
      if (acc.balance + change < 0) throw new BankError('INSUFFICIENT_FUNDS', `Reversal would overdraw ${acc.name}`)
    }
    const memo = cleanText(reason, MAX_MEMO_LENGTH)
    return originals.map((orig) => {
      orig.flags = [...(orig.flags ?? []), 'reversed']
      this.reopenBill(orig)
      const offset: Draft = {
        accountId: orig.accountId,
        date: this.state.today,
        amount: -orig.amount,
        merchant: orig.merchant,
        description: `REVERSAL 冲正 · ${orig.description}`,
        memo,
        category: orig.category,
        channel: orig.channel,
        initiatedBy: 'bank',
        flags: ['reversed'],
      }
      return this.post(offset)
    })
  }

  /** Demo control: a purchase happens right now (today). Categorised automatically unless category given. */
  simulatePurchase(input: { merchant: string; amount: Minor; category?: CategoryId; memo?: string; time?: string }): Transaction {
    const merchant = cleanText(input.merchant, 80)
    if (!merchant) throw new BankError('UNKNOWN_MERCHANT', 'A merchant name is required')
    const amount = Math.abs(input.amount)
    assertPositiveAmount(amount)
    const checking = this.checking()
    if (checking.balance < amount) throw new BankError('INSUFFICIENT_FUNDS', `${checking.name} has insufficient funds`)
    const given = input.category && Object.hasOwn(CATEGORIES, input.category) ? input.category : undefined
    // the memo is untrusted counterparty text, so it never steers the category
    const cat = given ? { category: given, source: 'user' as const, confidence: 1 } : safeCategorize(this.categorizer, merchant, '', -amount, this.userRules)
    const draft: Draft = {
      accountId: checking.id,
      date: this.state.today,
      time: input.time && HHMM.test(input.time) ? input.time : undefined,
      amount: -amount,
      merchant,
      description: merchant,
      memo: cleanText(input.memo, MAX_MEMO_LENGTH),
      category: cat.category,
      channel: 'wechat_pay',
      initiatedBy: 'user',
    }
    return this.post(draft, cat.source, cat.confidence)
  }

  /**
   * Advance the sandbox clock by n days. For each new day: next-period bills are issued on the 1st, salary
   * lands on payday, scheduled bill payments and direct debits execute, the persona pays its hand-paid bills
   * (rent, utilities, phone) on its habitual day the way its history does, monthly pot standing orders run,
   * organic activity from generateDay is posted, and unpaid bills past their due date turn overdue.
   */
  advanceDays(n: number): Transaction[] {
    if (!Number.isInteger(n) || n < 0 || n > MAX_ADVANCE_DAYS) {
      throw new BankError('INVALID_AMOUNT', `Days must be a whole number between 0 and ${MAX_ADVANCE_DAYS}`)
    }
    const script = getScript(this.state.personaId)
    const out: Transaction[] = []
    for (let i = 0; i < n; i++) {
      const date = addDays(this.state.today, 1)
      this.state.today = date
      if (script) {
        this.state.bills.push(...billsIssuedOn(script, date, this.state.bills))
        out.push(...incomeDrafts(script, date, this.checking().id).map((d) => this.post(d)))
      }
      out.push(...this.runScheduledPayments(date))
      if (script) out.push(...this.runAutoPay(date), ...this.runHabitPayments(date), ...this.runStandingOrders(date))
      out.push(...this.postOrganic(generateDay(this.state, date)))
      this.markOverdue(date)
    }
    return out
  }

  /** Sum of agent-initiated outflows on a date (for the bank-side limit). */
  agentOutflowOn(date: ISODate): Minor {
    const checkingId = this.checking().id
    let total = 0
    for (const t of this.state.transactions) {
      // gross: an undone agent transfer still used up allowance (prevents transfer/undo loops)
      if (t.date === date && t.accountId === checkingId && t.initiatedBy === 'agent' && t.amount < 0) total -= t.amount
    }
    return total
  }

  // ── internals ────────────────────────────────────────────────────────────

  private ownAccount(id: string): Account {
    const acc = this.state.accounts.find((a) => a.id === id)
    if (acc) return acc
    if (EXTERNAL_ACCOUNT_LIKE.test(String(id ?? '').trim())) {
      throw new BankError('NOT_OWN_ACCOUNT', 'Only transfers between your own FundBun accounts are possible')
    }
    throw new BankError('UNKNOWN_ACCOUNT', `Unknown account ${id}`)
  }

  private verifiedPayee(payeeId: string): Payee {
    const payee = this.state.payees.find((p) => p.id === payeeId)
    if (!payee || !payee.verified) throw new BankError('UNVERIFIED_PAYEE', 'Bills can only be paid to verified payees')
    return payee
  }

  private findTxn(id: string): Transaction {
    const txn = this.state.transactions.find((t) => t.id === id)
    if (!txn) throw new BankError('UNKNOWN_TXN', `Unknown transaction ${id}`)
    return txn
  }

  private assertAgentAllowance(amount: Minor): void {
    const used = this.agentOutflowOn(this.state.today)
    if (used + amount > BANK_AGENT_DAILY_LIMIT) {
      throw new BankError('BANK_AGENT_LIMIT', `Bank-side agent limit: ${used + amount} would exceed ${BANK_AGENT_DAILY_LIMIT} today`)
    }
  }

  private executeBillPayment(bill: Bill, payee: Payee, initiatedBy: Initiator, how: { time?: string; channel?: PayChannel } = {}): Transaction {
    const checking = this.checking()
    if (checking.balance < bill.amountDue) throw new BankError('INSUFFICIENT_FUNDS', `${checking.name} has insufficient funds`)
    if (initiatedBy === 'agent') this.assertAgentAllowance(bill.amountDue)
    const txn = this.post({
      accountId: checking.id,
      date: this.state.today,
      ...(how.time && HHMM.test(how.time) ? { time: how.time } : {}),
      amount: -bill.amountDue,
      merchant: payee.name,
      description: billPaymentDescription(bill, payee.name),
      category: bill.category,
      channel: how.channel ?? 'bank_transfer',
      payeeId: payee.id,
      billId: bill.id,
      initiatedBy,
    })
    bill.status = 'paid'
    bill.paidTxnId = txn.id
    delete bill.scheduledFor
    return txn
  }

  private reopenBill(txn: Transaction): void {
    if (!txn.billId) return
    const bill = this.state.bills.find((b) => b.id === txn.billId)
    if (!bill || bill.paidTxnId !== txn.id) return
    bill.status = bill.dueDate < this.state.today ? 'overdue' : 'upcoming'
    delete bill.paidTxnId
  }

  /** Scheduled payments run as the bank's standing instruction; a failed one falls back to unpaid. */
  private runScheduledPayments(date: ISODate): Transaction[] {
    const out: Transaction[] = []
    for (const bill of this.state.bills) {
      if (bill.status !== 'scheduled' || !bill.scheduledFor || bill.scheduledFor > date) continue
      try {
        out.push(this.executeBillPayment(bill, this.verifiedPayee(bill.payeeId), 'bank'))
      } catch (e) {
        if (!(e instanceof BankError)) throw e
        bill.status = bill.dueDate < date ? 'overdue' : 'upcoming'
        delete bill.scheduledFor
      }
    }
    return out
  }

  /** Direct-debit bills (e.g. broadband) are paid by the bank on their due date when funds allow. */
  private runAutoPay(date: ISODate): Transaction[] {
    const script = getScript(this.state.personaId)
    if (!script) return []
    const out: Transaction[] = []
    for (const bill of this.state.bills) {
      if (bill.status !== 'upcoming' || bill.dueDate > date || !seriesOf(script, bill)?.autoPay) continue
      try {
        out.push(this.executeBillPayment(bill, this.verifiedPayee(bill.payeeId), 'bank'))
      } catch (e) {
        if (!(e instanceof BankError)) throw e
      }
    }
    return out
  }

  /**
   * The persona pays the bills it pays by hand (no direct debit) the way its generated history does: on its habitual
   * day (billPaymentSchedule, dueDate − payLeadDays) or as soon as funds allow once that day has passed — so rent and
   * utilities keep landing after the clock moves. Bills the user scheduled or paid are left alone (status 'scheduled'
   * / 'paid'); a bill the account can't cover stays unpaid (and turns overdue) until it can.
   */
  private runHabitPayments(date: ISODate): Transaction[] {
    const script = getScript(this.state.personaId)
    if (!script) return []
    const out: Transaction[] = []
    for (const bill of this.state.bills) {
      if (bill.status !== 'upcoming' && bill.status !== 'overdue') continue
      const series = seriesOf(script, bill)
      if (!series || series.autoPay) continue
      const plan = billPaymentSchedule(script, this.state.seed, series, bill)
      if (plan.date > date) continue
      try {
        out.push(this.executeBillPayment(bill, this.verifiedPayee(bill.payeeId), 'user', { time: plan.time, channel: series.channel }))
      } catch (e) {
        if (!(e instanceof BankError)) throw e
      }
    }
    return out
  }

  private runStandingOrders(date: ISODate): Transaction[] {
    const script = getScript(this.state.personaId)
    if (!script) return []
    const checking = this.checking()
    const out: Transaction[] = []
    for (const plan of script.pots) {
      const pot = this.state.accounts.find((a) => a.id === potId(plan.goalId))
      // a pot whose goal was removed is closed: the standing order stops with it
      if (!plan.monthly || !pot || pot.closed || dayOfMonth(date) !== Math.min(plan.day, daysInMonth(ym(date)))) continue
      const amount = potContribution(script, this.state.seed, plan, ym(date))
      if (amount <= 0 || checking.balance < amount) continue
      out.push(...this.transferInternal(checking.id, pot.id, amount, 'Monthly auto-save 每月自动转存', 'user'))
    }
    return out
  }

  /** Organic purchases the account cannot cover are declined (skipped), like a card at the till. */
  private postOrganic(txns: Transaction[]): Transaction[] {
    const out: Transaction[] = []
    for (const t of txns) {
      const acc = this.state.accounts.find((a) => a.id === t.accountId)
      if (!acc || acc.balance + t.amount < 0) continue
      out.push(this.insert(t))
    }
    return out
  }

  private markOverdue(date: ISODate): void {
    for (const bill of this.state.bills) {
      if (bill.status === 'upcoming' && bill.dueDate < date) bill.status = 'overdue'
    }
  }

  private nextDisputeId(): string {
    const used = new Set(this.state.disputes.map((d) => d.id))
    let n = this.state.disputes.length + 1
    while (used.has(`dsp_${String(n).padStart(3, '0')}`)) n++
    return `dsp_${String(n).padStart(3, '0')}`
  }

  private post(draft: Draft, source?: Transaction['categorySource'], confidence?: number): Transaction {
    const used = new Set(this.state.transactions.map((t) => t.id))
    const txn = toTransaction(draft, nextTxnId(draft.date, used), this.ownAccount(draft.accountId).currency)
    if (source) txn.categorySource = source
    if (confidence !== undefined) txn.categoryConfidence = confidence
    return this.insert(txn)
  }

  /** Keeps transactions sorted by date (stable: same-day entries stay in posting order) and moves the balance. */
  private insert(txn: Transaction): Transaction {
    const list = this.state.transactions
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].date <= txn.date) lo = mid + 1
      else hi = mid
    }
    list.splice(lo, 0, txn)
    this.ownAccount(txn.accountId).balance += txn.amount
    return txn
  }
}
