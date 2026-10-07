import type { Account, BankState, Bill, CategoryId, Dispute, ISODate, Initiator, Minor, Transaction } from '../types'

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

/**
 * The simulated bank. Mutates the BankState it wraps (callers clone for immutable snapshots).
 * Every money movement creates balanced transactions and adjusts account balances.
 */
export class SandboxBank {
  constructor(public state: BankState) {}

  checking(): Account {
    throw new Error('TODO')
  }

  pots(): Account[] {
    throw new Error('TODO')
  }

  /** Create a savings pot for a dream goal (id `pot_<goalId>`), or return the existing one. */
  ensurePot(goalId: string, name: string): Account {
    throw new Error('TODO ' + goalId + name)
  }

  /** Own-account transfer (checking ↔ pot). Two transactions (category 'savings'), returns both. */
  transferInternal(fromId: string, toId: string, amount: Minor, memo: string, initiatedBy: Initiator): Transaction[] {
    throw new Error('TODO ' + fromId + toId + amount + memo + initiatedBy)
  }

  /** Pay a bill to its verified payee (now, or schedule when date > today). */
  payBill(billId: string, initiatedBy: Initiator, date?: ISODate): { bill: Bill; txn?: Transaction } {
    throw new Error('TODO ' + billId + initiatedBy + date)
  }

  /** Stop future charges for a merchant (adds to cancelledMerchants). */
  cancelRecurring(merchant: string): void {
    throw new Error('TODO ' + merchant)
  }

  openDispute(txnId: string, reason: string, openedBy: Initiator): Dispute {
    throw new Error('TODO ' + txnId + reason + openedBy)
  }

  /** Reverse transactions (used by undo): adds offsetting entries flagged 'reversed' and restores balances. */
  reverse(txnIds: string[], reason: string): Transaction[] {
    throw new Error('TODO ' + txnIds.length + reason)
  }

  /** Demo control: a purchase happens right now (today). Categorised automatically unless category given. */
  simulatePurchase(input: { merchant: string; amount: Minor; category?: CategoryId; memo?: string; time?: string }): Transaction {
    throw new Error('TODO ' + input.merchant)
  }

  /** Advance the sandbox clock by n days, generating organic transactions, salary, and due bills. */
  advanceDays(n: number): Transaction[] {
    throw new Error('TODO ' + n)
  }

  /** Sum of agent-initiated outflows on a date (for the bank-side limit). */
  agentOutflowOn(date: ISODate): Minor {
    throw new Error('TODO ' + date)
  }
}
