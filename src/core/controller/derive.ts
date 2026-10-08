import { agentRecords } from '../agent/actions'
import type { CapUsage, DerivedState, LlmStatus } from '../app-api'
import { compareDate } from '../dates'
import {
  allGoalProgress,
  analyzeBills,
  computeMirror,
  couldveCollection,
  detectRecurring,
  generateInsights,
  mirrorHistory,
  monthHistory,
  summarizeMonth,
} from '../finance'
import type {
  AppState,
  Bill,
  BillFinding,
  FinanceContext,
  GoalProgress,
  Insight,
  MirrorState,
  MonthHistoryPoint,
  MonthSummary,
  RecurringSeries,
} from '../types'
import { agentMoneyUsed, utcOffsetMinutesAt } from '../security/policy'
import { ctxOf } from './state'
import { safely } from './util'

export interface RuntimeFlags {
  llm: LlmStatus
  /** number of agent turns in flight */
  busy: number
}

/** Finance analyses of one committed state. Each field is computed on first access and memoised. */
export interface FinanceDerived {
  readonly ctx: FinanceContext | null
  readonly summary: MonthSummary | null
  readonly mirror: MirrorState | null
  readonly history: MonthHistoryPoint[]
  readonly recurring: RecurringSeries[]
  readonly findings: BillFinding[]
  readonly insights: Insight[]
  readonly goals: GoalProgress[]
  readonly upcomingBills: Bill[]
  /** "Could've collection" over the last HISTORY_MONTHS months */
  readonly couldve: NonNullable<DerivedState['couldve']> | undefined
  /** per-month mirror verdicts for the last HISTORY_MONTHS months, oldest first */
  readonly mirrorHistory: NonNullable<DerivedState['mirrorHistory']> | undefined
}

/** months covered by history, couldve and mirrorHistory */
const HISTORY_MONTHS = 6

const cache = new WeakMap<AppState, FinanceDerived>()

/** Memoised (per state object) finance analyses — shared by snapshots and the AgentHost. */
export function financeFor(state: AppState): FinanceDerived {
  let f = cache.get(state)
  if (!f) {
    f = lazyFinance(state)
    cache.set(state, f)
  }
  return f
}

function lazyFinance(state: AppState): FinanceDerived {
  const ctx = ctxOf(state)
  const memo = new Map<string, unknown>()
  function once<T>(key: string, fallback: T, fn: (c: FinanceContext) => T): T {
    if (!memo.has(key)) memo.set(key, ctx ? safely(key, () => fn(ctx), fallback) : fallback)
    return memo.get(key) as T
  }
  const derived: FinanceDerived = {
    ctx,
    get summary() { return once<MonthSummary | null>('summarizeMonth', null, (c) => summarizeMonth(c)) },
    get mirror() { return once<MirrorState | null>('computeMirror', null, (c) => computeMirror(c)) },
    get history() { return once<MonthHistoryPoint[]>('monthHistory', [], (c) => monthHistory(c, HISTORY_MONTHS)) },
    get recurring() {
      return once<RecurringSeries[]>('detectRecurring', [], (c) =>
        detectRecurring(c.bank.transactions, c.bank.today, c.bank.cancelledMerchants))
    },
    get findings() { return once<BillFinding[]>('analyzeBills', [], (c) => analyzeBills(c, derived.recurring)) },
    get insights() { return once<Insight[]>('generateInsights', [], (c) => generateInsights(c)) },
    get goals() { return once<GoalProgress[]>('allGoalProgress', [], (c) => allGoalProgress(c)) },
    get upcomingBills() { return once<Bill[]>('upcomingBills', [], (c) => upcomingBills(c.bank.bills)) },
    get couldve() { return once<FinanceDerived['couldve']>('couldveCollection', undefined, (c) => couldveCollection(c, HISTORY_MONTHS)) },
    get mirrorHistory() { return once<FinanceDerived['mirrorHistory']>('mirrorHistory', undefined, (c) => mirrorHistory(c, HISTORY_MONTHS)) },
  }
  return derived
}

export function upcomingBills(bills: Bill[]): Bill[] {
  return bills.filter((b) => b.status !== 'paid').sort((a, b) => compareDate(a.dueDate, b.dueDate))
}

/** 'llm' only when the user enabled it, consented to LLM processing, and the gateway is reachable. */
export function engineFor(state: AppState, llm: LlmStatus): 'offline' | 'llm' {
  // defensive: a damaged save without consent must never crash the snapshot
  const consented = state.profile?.consent?.llmProcessing === true
  return state.settings.llmEnabled && consented && llm.available ? 'llm' : 'offline'
}

/**
 * Agent money movement against the caps, exactly as the policy engine counts it: the same agent records
 * (agent/actions.agentRecords), the same helper (security/policy.agentMoneyUsed) and the same device-offset
 * calendar bucketing — so the bars in Settings and the glass box show what the next cap check will see.
 */
export function capUsageOf(state: AppState, now: string): CapUsage {
  const m = state.mandate
  const used = safely('capUsage', () => agentMoneyUsed(agentRecords(state), now, utcOffsetMinutesAt(now)), { today: 0, month: 0 })
  return { today: used.today, month: used.month, dailyCap: m.dailyCap, monthlyCap: m.monthlyCap, perActionCap: m.perActionCap }
}

const isoNow = () => new Date().toISOString()

/**
 * Derived view of a snapshot. Finance fields are lazy getters (computed once per committed state); `now`
 * is the controller's clock (cap usage is bucketed by its calendar day).
 */
export function createDerived(state: AppState, rt: RuntimeFlags, now: () => string = isoNow): DerivedState {
  const fin = financeFor(state)
  let caps: CapUsage | undefined
  return Object.freeze({
    today: state.bank.today,
    clock: state.bank.personaId ? 'sandbox' as const : 'real' as const,
    get ctx() { return fin.ctx },
    get summary() { return fin.summary },
    get mirror() { return fin.mirror },
    get history() { return fin.history },
    get recurring() { return fin.recurring },
    get findings() { return fin.findings },
    get insights() { return fin.insights },
    get goals() { return fin.goals },
    get upcomingBills() { return fin.upcomingBills },
    get couldve() { return fin.couldve },
    get mirrorHistory() { return fin.mirrorHistory },
    get capUsage() { return (caps ??= capUsageOf(state, now())) },
    unseenEvents: state.tripwireEvents.filter((e) => !e.seen),
    awaiting: state.pending.filter((p) => p.status === 'pending'),
    llm: rt.llm,
    busy: rt.busy > 0,
    engine: engineFor(state, rt.llm),
  })
}
