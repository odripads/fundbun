import type { DerivedState, LlmStatus } from '../app-api'
import { compareDate } from '../dates'
import {
  allGoalProgress,
  analyzeBills,
  computeMirror,
  detectRecurring,
  generateInsights,
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
}

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
    get history() { return once<MonthHistoryPoint[]>('monthHistory', [], (c) => monthHistory(c, 6)) },
    get recurring() {
      return once<RecurringSeries[]>('detectRecurring', [], (c) =>
        detectRecurring(c.bank.transactions, c.bank.today, c.bank.cancelledMerchants))
    },
    get findings() { return once<BillFinding[]>('analyzeBills', [], (c) => analyzeBills(c, derived.recurring)) },
    get insights() { return once<Insight[]>('generateInsights', [], (c) => generateInsights(c)) },
    get goals() { return once<GoalProgress[]>('allGoalProgress', [], (c) => allGoalProgress(c)) },
    get upcomingBills() { return once<Bill[]>('upcomingBills', [], (c) => upcomingBills(c.bank.bills)) },
  }
  return derived
}

export function upcomingBills(bills: Bill[]): Bill[] {
  return bills.filter((b) => b.status !== 'paid').sort((a, b) => compareDate(a.dueDate, b.dueDate))
}

/** 'llm' only when the user enabled it, consented to LLM processing, and the gateway is reachable. */
export function engineFor(state: AppState, llm: LlmStatus): 'offline' | 'llm' {
  const consented = state.profile?.consent.llmProcessing === true
  return state.settings.llmEnabled && consented && llm.available ? 'llm' : 'offline'
}

/** Derived view of a snapshot. Finance fields are lazy getters (computed once per committed state). */
export function createDerived(state: AppState, rt: RuntimeFlags): DerivedState {
  const fin = financeFor(state)
  return Object.freeze({
    get ctx() { return fin.ctx },
    get summary() { return fin.summary },
    get mirror() { return fin.mirror },
    get history() { return fin.history },
    get recurring() { return fin.recurring },
    get findings() { return fin.findings },
    get insights() { return fin.insights },
    get goals() { return fin.goals },
    get upcomingBills() { return fin.upcomingBills },
    unseenEvents: state.tripwireEvents.filter((e) => !e.seen),
    awaiting: state.pending.filter((p) => p.status === 'pending'),
    llm: rt.llm,
    busy: rt.busy > 0,
    engine: engineFor(state, rt.llm),
  })
}
