import type { CheckInView } from './finance/checkin'
import type { ManualSubscriptionInput } from './finance/subscriptions'
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
  ISODate,
  Insight,
  Mandate,
  Minor,
  MirrorState,
  MonthHistoryPoint,
  MonthSummary,
  PendingAction,
  Profile,
  RecurringSeries,
  SpendMode,
  SpendingCandidate,
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

import type { LiveReply } from './ai/types'

export interface LlmStatus {
  checked: boolean
  available: boolean
  provider?: string
  model?: string
  reason?: string
  /** FundBun's server on this computer answers (desktop app): the user's own AI connection */
  local?: boolean
  /** 'agent' = an agent on this computer (Claude, Antigravity, Codex, …) answers */
  kind?: 'openai_compat' | 'anthropic' | 'agent'
  connectionId?: string
  presetId?: string
  /** the model runs on this computer */
  onDevice?: boolean
}

export interface DerivedState {
  /**
   * The app's "today" (bank.today) — the one date every screen should use: the sandbox clock for demo personas
   * (moved by advanceDays), the device's date for real-data users (kept in step by syncClock).
   */
  today: ISODate
  /**
   * The date the analyses (mirror, summary, insights, history) look from. Equal to `today`, except for a real-data
   * user with no spending this month: then it is the end of the latest month that has spending (an older statement).
   */
  viewDate: ISODate
  /** which clock `today` follows */
  clock: 'sandbox' | 'real'
  /** the daily check-in card: today's slot, the streak, golden buns (finance/checkin) */
  checkIn: CheckInView
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
  /** the reply as it is being written, with the steps taken so far (an agent or a slow model); null otherwise */
  live: LiveReply | null
  /** the engine that will answer the next message */
  engine: 'offline' | 'llm'
  /**
   * "Could've collection": the NET over/under budget across the finished months of the last 6 (finishedMonths, usually
   * 5) in dream items; the current month is reported separately in `soFar` and is not part of the totals.
   */
  couldve?: {
    totalOver: Minor
    totalUnder: Minor
    equivalents: DreamEquivalent[]
    finishedMonths?: number
    soFar?: { month: YearMonth; status: MirrorState['status']; delta: Minor }
  }
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
  /** goals: by when (ISO date); '' clears it when editing */
  targetDate?: string
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
  /** 'tracking': no target, just daily tracking (targetSpend is still required, and kept for later) */
  mode?: SpendMode
  /** AUTO mode: read transaction emails/e-statements (read-only). Requires the AUTO consent screen. */
  emailAuto?: boolean
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
  /**
   * Move to another device (FundBun has no server): an encrypted copy of everything, opened with a password of the
   * user's choosing. restoreBackup replaces what is on this device with it.
   */
  exportBackup(password: string, pin: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>
  /** only with nobody set up on this device; the user picks a new PIN, and permissions start at the defaults */
  restoreBackup(text: string, password: string, newPin: string): Promise<Result>

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
  /** answer an agent's "may I use this tool?" (LiveReply.permission); null = no */
  answerPermission(requestId: string, optionId: string | null): void
  /** stop the reply that is being written */
  stopReply(): void
  /**
   * "Talk to a human": records the handoff request (audited as user_action, data.type 'handoff', with a short
   * masked summary — never PINs or full account numbers) and, with `opts.freeze`, pauses the agent too.
   */
  requestHumanHandoff(summary?: string, opts?: HandoffOptions): Result

  // ── desktop creator mode (widgets an AI drafts; the desktop app only) ──
  /** turning Creator Mode on needs the PIN, because it lets an AI draft widgets; turning it off never does */
  setCreatorMode(enabled: boolean, pin?: string): Promise<Result>
  /** install a widget Bun drafted, after the user saw its live preview in the chat */
  installPlugin(draftId: string): Promise<Result>
  /** install one of the built-in starter widgets */
  installStarterPlugin(starterId: string): Promise<Result>
  /** remove a widget, or switch it off or back on */
  changePlugin(id: string, action: 'uninstall' | 'disable' | 'enable'): Promise<Result>

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
  /**
   * How much of this device's storage FundBun uses (browser storage: about 5 MB per site), how long that lasts at
   * the user's pace, and the error when the last save failed (a full device).
   */
  storageStatus(): StorageStatus
  exportAuditJSONL(): string

  // ── vault (at-rest encryption of local data with the PIN) ──
  /** true when persisted data is encrypted and has not been unlocked in this session */
  isLocked(): boolean
  unlock(pin: string): Promise<Result>
  enableVault(pin: string): Promise<Result>
  disableVault(pin: string): Promise<Result>

  // ── profile & settings ──
  setProfile(patch: Partial<Pick<Profile, 'name' | 'monthlyIncome' | 'targetSpend' | 'payday' | 'workHoursPerMonth' | 'tone' | 'mode'>>): Result
  setConsent(patch: Partial<Pick<Consent, 'llmProcessing' | 'notifications'>>): void
  setSettings(patch: Partial<AppSettings>): void
  checkLlm(): Promise<void>

  // ── data ──
  /**
   * Import a statement file. Safe to call with several files for the same month and with files that overlap: rows
   * already on the ledger are skipped, and a row that matches a purchase the user typed in or scanned is counted once
   * (`matched`, included in `skipped`).
   */
  importCsv(text: string): { added: number; skipped: number; matched: number; errors: string[] }
  /** add parsed spending (from email or receipt) after the user confirms — dedupes against existing */
  addSpending(candidates: SpendingCandidate[]): { added: number; duplicates: number }
  /**
   * No bank connected: record that the user paid a bill in their own bank app. Closes the bill and puts the payment
   * on the ledger (a later statement row for it is counted once). FundBun pays nothing, so there is no PIN.
   */
  markBillPaid(billId: string): { ok: boolean; reason?: string }
  /** take back markBillPaid */
  unmarkBillPaid(billId: string): { ok: boolean; reason?: string }
  /**
   * The daily check-in: "I looked, and there is nothing else to log today". Once a day; it stamps the card, keeps
   * the streak and makes today a logged day for Bun's temper. `earned` is true when it won a golden bun (every
   * seventh day in a row). Logging spending checks in by itself.
   */
  checkIn(): { ok: boolean; added: boolean; streak: number; earned: boolean }
  /**
   * The daily amount the user can live on for the rest of this month (finance/dailyplan); Bun then judges each day
   * by it. null removes it. It ends with the month.
   */
  setDailyPlan(amount: Minor | null): Result
  /**
   * Add a subscription by hand (a plan paid by card, a gym paid in cash): listed with the detected ones, counted in
   * the yearly total, and with no bank connected a bill to expect on its next date.
   */
  addSubscription(input: ManualSubscriptionInput): Result & { id?: string }
  /**
   * No bank connected: a bill the user wants to remember to pay (from a PDF, a photo or typed in). It shows in
   * Bills with "Mark as paid", like the bills Bun predicts. With a bank connected bills come from the bank.
   */
  addBill(input: { name: string; amount: Minor; dueDate: ISODate }): Result & { id?: string }
  removeSubscription(id: string): Result
  /** Bill X-ray via the agent (xray_bill tool) — returns the assistant message with the xray card */
  xrayBill(text: string): Promise<ChatMessage>
  transactions(filter?: { month?: YearMonth; category?: CategoryId; query?: string }): Transaction[]

  // ── clock ──
  /**
   * Real-data users: move the app's "today" forward to the device's date (scheduled payments, overdue bills and
   * tripwires catch up). Call it when the page becomes visible again; boot, unlock, every user action and agent turn
   * call it too. Demo personas keep their sandbox clock. Returns true when the calendar moved.
   */
  syncClock(): boolean

  // ── sandbox / demo controls ──
  simulatePurchase(p: SandboxPurchase): { txn: Transaction; events: TripwireEvent[] }
  advanceDays(n: number): { txns: Transaction[]; events: TripwireEvent[] }
}

export interface StorageStatus {
  /** characters saved (browser storage counts characters) */
  used: number
  /** the browser's usual limit for one site */
  limit: number
  /** used / limit */
  share: number
  /** about how many more months fit at the pace so far; undefined in the first weeks */
  monthsLeft?: number
  /** the last save failed: the newest changes exist only until the page is closed */
  error?: string
}

