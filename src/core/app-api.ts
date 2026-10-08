import type {
  AppSettings,
  AppState,
  Autonomy,
  Bill,
  BillFinding,
  CategoryId,
  ChatMessage,
  Consent,
  Currency,
  DreamEquivalent,
  DreamItem,
  FinanceContext,
  GoalProgress,
  Insight,
  Mandate,
  Minor,
  MirrorState,
  MonthHistoryPoint,
  MonthSummary,
  PendingAction,
  Profile,
  RecurringSeries,
  SuggestedAction,
  Tone,
  ToolName,
  Transaction,
  Tripwire,
  TripwireEvent,
  YearMonth,
} from './types'

/**
 * The public surface of the FundBun controller (src/core/app.ts → createFundBunApp()).
 * The React UI, the scenario runner and the tests all drive the product through this interface only.
 * Snapshots are immutable: every mutation produces a new snapshot object and notifies subscribers
 * (compatible with React's useSyncExternalStore).
 */

export interface LlmStatus {
  checked: boolean
  available: boolean
  provider?: string
  model?: string
  reason?: string
}

export interface DerivedState {
  /** null until onboarded */
  ctx: FinanceContext | null
  /** current month */
  summary: MonthSummary | null
  mirror: MirrorState | null
  /** last 6 months, oldest first */
  history: MonthHistoryPoint[]
  recurring: RecurringSeries[]
  findings: BillFinding[]
  insights: Insight[]
  goals: GoalProgress[]
  /** unpaid bills sorted by due date */
  upcomingBills: Bill[]
  unseenEvents: TripwireEvent[]
  /** pending actions awaiting the user (status 'pending') */
  awaiting: PendingAction[]
  llm: LlmStatus
  /** the agent is working on a reply */
  busy: boolean
  /** the engine that will answer the next message */
  engine: 'offline' | 'llm'
  /** "Could've collection": cumulative over/under across the last 6 months in dream items */
  couldve?: { totalOver: Minor; totalUnder: Minor; equivalents: DreamEquivalent[] }
  /** per-month mirror verdicts for the last 6 months (oldest first) */
  mirrorHistory?: { month: YearMonth; status: MirrorState['status']; delta: Minor; item?: DreamEquivalent }[]
  /**
   * Agent money movement against the mandate's caps, computed with the policy engine's own helper and
   * calendar bucketing (security/policy.agentMoneyUsed, device UTC offset) — what Settings and the glass box show.
   */
  capUsage: CapUsage
}

export interface AppSnapshot {
  state: AppState
  derived: DerivedState
}

export type DataSource =
  | { kind: 'persona'; personaId: string }
  | { kind: 'csv'; text: string; startingBalance: Minor }
  | { kind: 'empty'; startingBalance: Minor }

export interface DreamInput {
  name: string
  price: Minor
  image: string
  kind: DreamItem['kind']
  note?: string
}

export interface TripwireInput {
  kind: Tripwire['kind']
  threshold: number
  category?: CategoryId
  enabled?: boolean
}

export interface OnboardingInput {
  name: string
  currency: Currency
  monthlyIncome: Minor
  targetSpend: Minor
  payday: number
  workHoursPerMonth?: number
  tone: Tone
  consent: Pick<Consent, 'financialData' | 'llmProcessing' | 'notifications'>
  dreams: DreamInput[]
  /** omitted → defaultTripwires(profile) */
  tripwires?: TripwireInput[]
  autonomy: Autonomy
  caps?: Partial<Pick<Mandate, 'perActionCap' | 'dailyCap' | 'monthlyCap'>>
  /** step-up PIN, 4–6 digits */
  pin: string
  dataSource: DataSource
}

export interface Result {
  ok: boolean
  error?: string
}

export interface SandboxPurchase {
  merchant: string
  amount: Minor
  category?: CategoryId
  memo?: string
  /** local time of the purchase, 'HH:MM' (e.g. '01:10' for a late-night order); invalid values are ignored */
  time?: string
}

export interface CapUsage {
  /** agent-initiated money moved today (approved or executed), the same bucketing as the policy engine */
  today: Minor
  /** … and this calendar month */
  month: Minor
  dailyCap: Minor
  monthlyCap: Minor
  perActionCap: Minor
}

export interface HandoffOptions {
  /** also pause the agent (kill switch) while a human helps */
  freeze?: boolean
}

export interface AppApi {
  getSnapshot(): AppSnapshot
  subscribe(listener: () => void): () => void

  // ── lifecycle ──
  isOnboarded(): boolean
  completeOnboarding(input: OnboardingInput): Result
  /** one-tap demo: loads a sandbox persona fully onboarded (default 'mei', PIN "2580") */
  loadDemo(personaId?: string): void
  /** wipe all local data (PIPL right to deletion) */
  resetAll(): void

  // ── agent ──
  /** run one agent turn (offline engine or LLM). Resolves with the assistant message. */
  sendMessage(text: string): Promise<ChatMessage>
  /** approve a pending action; `pin` required when decision is step_up */
  approveAction(pendingId: string, pin?: string): Promise<Result>
  rejectAction(pendingId: string): void
  /** undo an executed reversible action within its undo window */
  undoAction(pendingId: string): Result
  /** a UI button (e.g. "Cancel iQIYI" on a finding) — goes through the SAME policy gate as the agent */
  runSuggestedAction(action: SuggestedAction): Promise<PendingAction>
  clearChat(): void
  /**
   * "Talk to a human": records the handoff request (audited as user_action, data.type 'handoff', with a short
   * masked summary — never PINs or full account numbers) and, with `opts.freeze`, pauses the agent too.
   */
  requestHumanHandoff(summary?: string, opts?: HandoffOptions): Result

  // ── dreams ──
  addDream(input: DreamInput): DreamItem
  updateDream(id: string, patch: Partial<DreamInput>): Result
  removeDream(id: string): Result
  /** user-initiated move into a goal pot (not the agent): audited as user_action */
  contributeToGoal(dreamId: string, amount: Minor): Result
  markDreamAchieved(id: string): Result

  // ── tripwires & budget ──
  addTripwire(input: TripwireInput): Tripwire
  updateTripwire(id: string, patch: Partial<TripwireInput>): Result
  removeTripwire(id: string): Result
  markEventsSeen(ids?: string[]): void
  setCategoryBudget(category: CategoryId, limit: Minor): Result
  recategorize(txnId: string, category: CategoryId): Result

  // ── safety ──
  /** raising autonomy or caps requires the PIN; lowering never does */
  setAutonomy(autonomy: Autonomy, pin?: string): Result
  setCaps(caps: Partial<Pick<Mandate, 'perActionCap' | 'dailyCap' | 'monthlyCap'>>, pin?: string): Result
  /** disabling is instant; re-enabling a T2/T3 tool requires the PIN */
  setToolEnabled(tool: ToolName, enabled: boolean, pin?: string): Result
  /** kill switch — instant, no PIN */
  freeze(): void
  unfreeze(pin: string): Result
  changePin(oldPin: string, newPin: string): Result
  verifyAudit(): { ok: boolean; count: number; brokenAt?: number; reason?: string }
  /** full JSON export of local data (PIPL right of access/portability) */
  exportData(): string
  exportAuditJSONL(): string

  // ── vault (at-rest encryption of local data with the PIN) ──
  /** true when persisted data is encrypted and has not been unlocked in this session */
  isLocked(): boolean
  unlock(pin: string): Promise<Result>
  enableVault(pin: string): Promise<Result>
  disableVault(pin: string): Promise<Result>

  // ── profile & settings ──
  setProfile(patch: Partial<Pick<Profile, 'name' | 'monthlyIncome' | 'targetSpend' | 'payday' | 'workHoursPerMonth' | 'tone'>>): Result
  setConsent(patch: Partial<Pick<Consent, 'llmProcessing' | 'notifications'>>): void
  setSettings(patch: Partial<AppSettings>): void
  checkLlm(): Promise<void>

  // ── data ──
  importCsv(text: string): { added: number; skipped: number; errors: string[] }
  /** Bill X-ray via the agent (xray_bill tool) — returns the assistant message with the xray card */
  xrayBill(text: string): Promise<ChatMessage>
  transactions(filter?: { month?: YearMonth; category?: CategoryId; query?: string }): Transaction[]

  // ── sandbox / demo controls ──
  simulatePurchase(p: SandboxPurchase): { txn: Transaction; events: TripwireEvent[] }
  advanceDays(n: number): { txns: Transaction[]; events: TripwireEvent[] }
}
