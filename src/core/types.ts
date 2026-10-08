/**
 * FundBun shared domain contract.
 *
 * Everything in src/core is framework-free TypeScript (no DOM, no React) so the
 * same code runs in the browser app, the Node scenario runner, and the tests.
 *
 * Money is ALWAYS integer minor units (fen / cents) — type `Minor`.
 * On transactions, negative = money out, positive = money in.
 */

// ───────────────────────────── primitives ─────────────────────────────

export type Currency = 'CNY' | 'USD' | 'EUR' | 'GBP' | 'HKD' | 'SGD' | 'JPY' | 'IDR' | 'MYR' | 'AUD'
/** YYYY-MM-DD */
export type ISODate = string
/** Full ISO-8601 timestamp */
export type ISODateTime = string
/** YYYY-MM */
export type YearMonth = string
/** Integer minor units (fen/cents). */
export type Minor = number

// ───────────────────────────── categories ─────────────────────────────

export type CategoryId =
  | 'housing'
  | 'utilities'
  | 'phone_internet'
  | 'groceries'
  | 'dining'
  | 'delivery'
  | 'coffee_tea'
  | 'transport'
  | 'shopping'
  | 'subscriptions'
  | 'entertainment'
  | 'health'
  | 'education'
  | 'travel'
  | 'personal_care'
  | 'gifts'
  | 'insurance'
  | 'fees'
  | 'other'
  | 'income'
  | 'transfer'
  | 'savings'

/** need = essentials, want = discretionary, save = goal pots, income/transfer = excluded from spending */
export type CategoryKind = 'need' | 'want' | 'save' | 'income' | 'transfer'

export interface CategoryMeta {
  id: CategoryId
  label: string
  kind: CategoryKind
  emoji: string
  /** CSS colour used in charts (works on light + dark backgrounds) */
  color: string
}

// ───────────────────────────── bank / sandbox ─────────────────────────────

export type AccountType = 'checking' | 'pot'

export interface Account {
  id: string
  name: string
  type: AccountType
  balance: Minor
  currency: Currency
  /** for pots: the DreamItem this pot saves toward */
  goalId?: string
  /** e.g. "•••• 4821" — never a full number */
  maskedNumber?: string
}

export type PayChannel = 'wechat_pay' | 'alipay' | 'card' | 'bank_transfer' | 'cash'
export type TxnFlag = 'duplicate_suspect' | 'anomaly' | 'price_hike' | 'late_night' | 'disputed' | 'refund' | 'reversed'
export type Initiator = 'user' | 'agent' | 'bank' | 'sandbox'

export interface Transaction {
  id: string
  accountId: string
  date: ISODate
  /** HH:MM local time, optional */
  time?: string
  /** negative = outflow */
  amount: Minor
  currency: Currency
  /** normalised merchant / counterparty display name */
  merchant: string
  /** raw bank description */
  description: string
  /** free-text memo from the counterparty — UNTRUSTED CONTENT */
  memo?: string
  category: CategoryId
  categorySource: 'rule' | 'model' | 'user' | 'llm' | 'import'
  /** 0..1 */
  categoryConfidence: number
  channel?: PayChannel
  payeeId?: string
  recurringId?: string
  billId?: string
  initiatedBy?: Initiator
  flags?: TxnFlag[]
}

export type PayeeKind = 'utility' | 'telco' | 'landlord' | 'subscription' | 'person' | 'merchant' | 'card'

export interface Payee {
  id: string
  name: string
  kind: PayeeKind
  /** only verified payees can ever receive agent-initiated payments */
  verified: boolean
  maskedAccount?: string
  addedAt: ISODate
}

export type BillStatus = 'upcoming' | 'scheduled' | 'paid' | 'overdue'

export interface BillLineItem {
  label: string
  amount: Minor
}

export interface Bill {
  id: string
  payeeId: string
  name: string
  category: CategoryId
  amountDue: Minor
  dueDate: ISODate
  /** billing period, YYYY-MM */
  period: YearMonth
  status: BillStatus
  scheduledFor?: ISODate
  paidTxnId?: string
  lineItems?: BillLineItem[]
  /** raw bill text as received — UNTRUSTED CONTENT, may contain prompt injection */
  rawText?: string
  source: 'sandbox' | 'import' | 'xray'
}

export interface Dispute {
  id: string
  txnId: string
  reason: string
  openedAt: ISODate
  status: 'open' | 'resolved_refund' | 'rejected'
  openedBy: Initiator
}

export interface BankState {
  accounts: Account[]
  /** sorted by date ascending */
  transactions: Transaction[]
  payees: Payee[]
  bills: Bill[]
  disputes: Dispute[]
  /** merchants whose recurring charges were cancelled (generator stops producing them) */
  cancelledMerchants: string[]
  /** the sandbox clock — "today" for every computation */
  today: ISODate
  /** seed used by the deterministic generator */
  seed: number
  personaId?: string
}

// ───────────────────────────── recurring & bills analysis ─────────────────────────────

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface RecurringSeries {
  id: string
  merchant: string
  category: CategoryId
  cadence: Cadence
  /** positive minor units (cost per period) */
  averageAmount: Minor
  lastAmount: Minor
  lastDate: ISODate
  nextExpected: ISODate
  occurrences: number
  txnIds: string[]
  /** 0..1 */
  confidence: number
  isSubscription: boolean
  /** cost per year at the latest amount, positive */
  annualCost: Minor
  priceChange?: { from: Minor; to: Minor; pct: number; date: ISODate }
  status: 'active' | 'cancel_requested' | 'cancelled'
}

export type FindingKind =
  | 'price_hike'
  | 'duplicate_charge'
  | 'due_soon'
  | 'overdue'
  | 'bill_spike'
  | 'subscription_overlap'
  | 'annual_cost'
  | 'unusual_amount'

export interface SuggestedAction {
  tool: ToolName
  args: Record<string, unknown>
  /** button label, e.g. "Cancel iQIYI" */
  label: string
}

export interface BillFinding {
  id: string
  kind: FindingKind
  severity: 'info' | 'warn' | 'alert'
  title: string
  detail: string
  amount?: Minor
  txnIds?: string[]
  billId?: string
  recurringId?: string
  suggestedAction?: SuggestedAction
  /** the numbers that triggered this finding — shown under "Why?" */
  evidence: Record<string, number | string>
}

export interface XrayResult {
  merchant?: string
  total?: Minor
  dueDate?: ISODate
  period?: YearMonth
  lineItems: BillLineItem[]
  maskedAccount?: string
  category?: CategoryId
  warnings: string[]
  injection: InjectionReport
  /** comparison against history of the same merchant, if any */
  comparison?: { previousAverage: Minor; changePct: number }
}

// ───────────────────────────── dreams / goals ─────────────────────────────

export type DreamKind = 'goal' | 'treat'

export interface DreamItem {
  id: string
  name: string
  price: Minor
  /** 'preset:<key>' (see src/ui/assets/items) or a data: URL of a user photo (kept on-device) */
  image: string
  /** goal = saving toward it; treat = a smaller guilt-free reward */
  kind: DreamKind
  potAccountId?: string
  createdAt: ISODate
  achievedAt?: ISODate
  note?: string
}

export interface GoalProgress {
  itemId: string
  name: string
  saved: Minor
  price: Minor
  /** 0..100 */
  pct: number
  /** average monthly contribution over last 3 months */
  monthlyRate: Minor
  etaDate?: ISODate
  etaMonths?: number
}

export interface DreamEquivalent {
  itemId: string
  itemName: string
  image: string
  /** amount / price — 0.38 means 38% of the item, 2 means two of them */
  fraction: number
  /** human label: "38% of your Birkin" / "2× New sneakers" */
  label: string
}

// ───────────────────────────── profile ─────────────────────────────

export type Tone = 'cheeky' | 'gentle' | 'numbers'

export interface Consent {
  /** separate consent for processing financial (sensitive) personal information — PIPL Art. 29 */
  financialData: boolean
  /** consent to send minimised, redacted context to an LLM provider */
  llmProcessing: boolean
  notifications: boolean
  grantedAt: ISODateTime
  /** version of the consent text */
  version: string
}

export interface Profile {
  name: string
  currency: Currency
  /** net monthly income */
  monthlyIncome: Minor
  /** what the user is willing to spend per month (excl. savings) */
  targetSpend: Minor
  /** day of month salary lands, 1..28 */
  payday: number
  /** for "hours of work" framing; default 174 */
  workHoursPerMonth: number
  tone: Tone
  consent: Consent
  onboardedAt: ISODateTime
  personaId?: string
}

// ───────────────────────────── budgeting ─────────────────────────────

export interface CategoryBudget {
  category: CategoryId
  limit: Minor
}

export interface BudgetPlan {
  month: YearMonth
  total: Minor
  categories: CategoryBudget[]
  method: 'fifty_thirty_twenty' | 'history' | 'custom'
  createdBy: 'user' | 'agent' | 'default'
  createdAt: ISODateTime
  /** one-line rationale shown to the user */
  rationale?: string
}

export interface CategorySpend {
  category: CategoryId
  /** positive minor units spent */
  spent: Minor
  limit?: Minor
  /** spent / limit * 100 */
  pct?: number
  /** the whole previous month */
  prevMonth?: Minor
  /** the previous month up to the same day of the month (like-for-like for a month in progress) */
  prevMonthToDate?: Minor
  count: number
}

export interface MonthSummary {
  month: YearMonth
  income: Minor
  /** positive: total spending (excludes income, transfers, savings) */
  spent: Minor
  target: Minor
  byCategory: CategorySpend[]
  daysInMonth: number
  /** 1-based day of month of `today` (or daysInMonth for past months) */
  dayOfMonth: number
  /** projected month-end spend */
  projected: Minor
  dailyAvg: Minor
  /** remaining budget / remaining days (>= 0) */
  safeToSpendToday: Minor
  /** target - spent (can be negative) */
  remaining: Minor
  /** money moved into goal pots this month */
  savedToGoals: Minor
  isCurrent: boolean
}

export interface MonthHistoryPoint {
  month: YearMonth
  spent: Minor
  target: Minor
  income: Minor
}

// ───────────────────────────── insights ─────────────────────────────

export type InsightKind =
  | 'category_up'
  | 'category_down'
  | 'top_merchant'
  | 'late_night'
  | 'small_frequent'
  | 'weekend_spike'
  | 'pace_warning'
  | 'under_budget'
  | 'subscription_load'
  | 'anomaly'
  | 'savings_rate'

export interface Insight {
  id: string
  kind: InsightKind
  title: string
  body: string
  amount?: Minor
  category?: CategoryId
  severity: 'positive' | 'neutral' | 'warn'
  /** plain-language explanation of the rule + numbers that produced this insight */
  why: string
  dream?: DreamEquivalent
  suggestedAction?: SuggestedAction
  evidence: Record<string, number | string>
}

// ───────────────────────────── dream mirror ─────────────────────────────

export type MirrorStatus = 'over' | 'pace_over' | 'on_track' | 'under' | 'no_data'
export type BunMood = 'happy' | 'calm' | 'worried' | 'burnt' | 'sleepy'

export interface MirrorState {
  status: MirrorStatus
  month: YearMonth
  spent: Minor
  target: Minor
  projected: Minor
  /** over: spent - target; pace_over: projected - target; under: target - projected (positive) */
  delta: Minor
  /** e.g. "You could've gotten a Birkin." */
  headline: string
  /** e.g. "You're ¥3,450 over your ¥9,000 target — and your Birkin just moved 9 days further away." */
  subline: string
  /** the dream item shown in the hero */
  item?: DreamItem
  /** how many whole items the delta buys (>=1) — present when a whole item fits */
  quantity?: number
  /** delta / item.price when less than one whole item */
  fraction?: number
  /** progress of the primary goal */
  goal?: GoalProgress
  /** how many days the overspend pushes the primary goal back (over/pace_over) */
  goalDelayDays?: number
  /** delta expressed as hours of the user's work */
  hoursOfWork?: number
  tone: Tone
  mood: BunMood
  /** call-to-action the hero offers (over/pace_over: a rule such as a cap or tripwire; under: "Stash ¥X") */
  cta?: SuggestedAction
  /**
   * over / pace_over: the hero's primary button opens a conversation instead of a one-tap rule —
   * `prompt` is sent to Bun as the user's message (e.g. the "get back on track" task plan).
   */
  ctaPrompt?: { label: string; prompt: string }
  /** under target: the guilt-free treat what's left after the stash covers (secondary option, never pushed) */
  treat?: DreamEquivalent
  /** secondary CTA, e.g. "Earmark ¥338 for Concert ticket" (only when the treat has its own pot) */
  secondaryCta?: SuggestedAction
}

// ───────────────────────────── tripwires (spending thresholds) ─────────────────────────────

export type TripwireKind =
  /** month spend crosses threshold% of target */
  | 'month_pct'
  /** a category crosses threshold% of its budget */
  | 'category_pct'
  /** any single purchase above threshold (Minor) */
  | 'single_over'
  /** spend in one day above threshold (Minor) */
  | 'daily_over'
  /** projected month-end spend above threshold% of target */
  | 'pace_over'

export interface Tripwire {
  id: string
  kind: TripwireKind
  /** percent (e.g. 80) for *_pct kinds; Minor for *_over kinds (pace_over uses percent) */
  threshold: number
  category?: CategoryId
  enabled: boolean
  createdBy: 'user' | 'agent' | 'default'
  label: string
  /** dedupe key of the last firing, e.g. "2026-10" or a txn id */
  lastFiredKey?: string
}

export interface TripwireEvent {
  id: string
  tripwireId: string
  firedAt: ISODateTime
  txnId?: string
  title: string
  message: string
  amount?: Minor
  dream?: DreamEquivalent
  seen: boolean
}

// ───────────────────────────── affordability ("Should I?") ─────────────────────────────

export interface AffordabilityResult {
  amount: Minor
  label: string
  verdict: 'go' | 'think' | 'skip'
  /** safe-to-spend today before the purchase */
  safeToSpendToday: Minor
  /** remaining monthly budget after the purchase (may be negative) */
  remainingAfter: Minor
  /** how far over target the month would end (0 if not) */
  overTargetBy: Minor
  hoursOfWork: number
  goalName?: string
  goalDelayDays?: number
  equivalents: DreamEquivalent[]
  reasons: string[]
}

// ───────────────────────────── security / permissions ─────────────────────────────

/**
 * T0 READ        — read data, compute insights. Always allowed (unless consent missing).
 * T1 ORGANIZE    — reversible, no money movement: budgets, tripwires, categories, reminders.
 * T2 MOVE_OWN    — move money between the user's OWN accounts (checking ↔ goal pots), within mandate caps.
 * T3 PAY         — pay a VERIFIED existing payee, cancel a subscription, open a dispute. Always needs confirmation + PIN.
 * T4 PROHIBITED  — new payees, external transfers, investments, credit, changing its own mandate. Agent can never do these.
 */
export type Tier = 0 | 1 | 2 | 3 | 4

/**
 * observe   — agent may only read and explain; it cannot propose actions.
 * suggest   — agent proposes T1–T3; every action needs the user's tap (T3 also PIN).
 * copilot   — T1 runs automatically; T2 needs a tap; T3 needs tap + PIN.
 * autopilot — T1 and T2 (within caps, untainted) run automatically; T3 needs tap + PIN.
 */
export type Autonomy = 'observe' | 'suggest' | 'copilot' | 'autopilot'

export interface Mandate {
  autonomy: Autonomy
  /** max money one agent action may move */
  perActionCap: Minor
  /** max total agent-initiated money movement per day */
  dailyCap: Minor
  /** max total agent-initiated money movement per calendar month */
  monthlyCap: Minor
  /** tools the user switched off */
  disabledTools: ToolName[]
  /** kill switch: when true the agent is read-only */
  frozen: boolean
  /** seconds during which an executed reversible action can be undone */
  undoWindowSec: number
  /** max agent actions (executed or attempted) per rolling hour */
  maxActionsPerHour: number
  /** PBKDF2-HMAC-SHA256 of the step-up PIN (hex) */
  pinHash?: string
  pinSalt?: string
  failedPinAttempts: number
  /** ISO time until which PIN entry is locked after too many failures */
  pinLockedUntil?: ISODateTime
  /** set when the circuit breaker auto-froze the agent (e.g. repeated denied money attempts, injection) */
  breakerTrippedAt?: ISODateTime
  breakerReason?: string
}

export type Decision = 'allow' | 'confirm' | 'step_up' | 'deny'

export interface PolicyDecision {
  decision: Decision
  tier: Tier
  /** human-readable reasons, shown in the glass-box and the action card */
  reasons: string[]
  /** stable rule identifiers, e.g. "P-T4-PROHIBITED", "P-CAP-PER-ACTION" */
  ruleIds: string[]
  /** true when the turn ingested untrusted content (bill text, memos, imports) */
  tainted: boolean
}

export interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  proposedBy: 'llm' | 'offline' | 'user' | 'system'
  rationale?: string
  turnId?: string
}

export interface ActionPreview {
  title: string
  summary: string
  amount?: Minor
  from?: string
  to?: string
  reversible: boolean
  risk: 'low' | 'medium' | 'high'
  /** bullet list of concrete effects */
  effects: string[]
}

export type PendingStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed' | 'undone' | 'denied'

export interface PendingAction {
  id: string
  call: ToolCall
  decision: PolicyDecision
  preview: ActionPreview
  createdAt: ISODateTime
  expiresAt: ISODateTime
  status: PendingStatus
  result?: unknown
  error?: string
  executedAt?: ISODateTime
  /** until when the user can undo (reversible actions only) */
  undoUntil?: ISODateTime
  /**
   * sha256(canonicalJSON({ id, tool, args, amount, to })) — what the user sees is exactly what executes
   * (AP2-style cart mandate / PSD2 dynamic linking). Re-checked at execution; PIN approval is bound to it.
   */
  bindingHash: string
}

export type AuditActor = 'user' | 'agent' | 'system' | 'bank' | 'policy'

export type AuditType =
  | 'session_start'
  | 'onboarding'
  | 'consent'
  | 'tool_call'
  | 'policy_decision'
  | 'action_confirmed'
  | 'action_rejected'
  | 'action_executed'
  | 'action_failed'
  | 'action_undone'
  | 'action_denied'
  | 'step_up_failed'
  | 'tripwire_fired'
  | 'mandate_changed'
  | 'kill_switch'
  | 'injection_detected'
  | 'grounding_violation'
  | 'llm_request'
  | 'llm_response'
  | 'data_import'
  | 'data_export'
  | 'data_wiped'
  | 'sandbox_event'
  | 'user_action'
  | 'circuit_breaker'
  | 'sensitive_request_refused'

export interface AuditEntry {
  seq: number
  ts: ISODateTime
  actor: AuditActor
  type: AuditType
  summary: string
  data: Record<string, unknown>
  /** hash of previous entry ("0"*64 for the first) */
  prevHash: string
  /** sha256(prevHash + canonicalJSON({seq,ts,actor,type,summary,data})) */
  hash: string
}

export interface InjectionReport {
  suspicious: boolean
  /** 0..1 */
  score: number
  /** matched patterns, e.g. "instruction-override", "payment-instruction", "role-spoof" */
  signals: string[]
  /** short excerpts that matched (already truncated) */
  excerpts: string[]
}

export interface GroundingReport {
  ok: boolean
  checked: number
  /** numeric tokens in the reply that do not trace back to any tool result */
  ungrounded: string[]
}

export interface RedactionReport {
  text: string
  counts: Record<string, number>
}

// ───────────────────────────── agent ─────────────────────────────

export type ToolName =
  // T0 read
  | 'get_overview'
  | 'get_spending_breakdown'
  | 'search_transactions'
  | 'list_recurring'
  | 'analyze_bills'
  | 'get_insights'
  | 'check_affordability'
  | 'get_goals'
  | 'xray_bill'
  // T1 organize
  | 'set_category_budget'
  | 'create_budget_plan'
  | 'create_tripwire'
  | 'recategorize_transaction'
  | 'set_bill_reminder'
  // T2 move own money
  | 'transfer_to_goal'
  | 'withdraw_from_goal'
  // T3 pay / cancel / dispute
  | 'pay_bill'
  | 'cancel_subscription'
  | 'dispute_transaction'
  // T4 prohibited (registered so attempts are caught, never executed)
  | 'add_payee'
  | 'transfer_external'
  | 'invest'
  | 'apply_credit'
  | 'change_mandate'

export interface ToolSpec {
  name: ToolName
  tier: Tier
  /** description given to the LLM */
  description: string
  /** JSON Schema for the arguments */
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }
  /** T4 tools are not shown to the LLM, but are still recognised and denied */
  exposedToLLM: boolean
  movesMoney: boolean
  reversible: boolean
  /** short label for UI */
  label: string
}

export type ChatRole = 'user' | 'assistant' | 'system'

export type ChatCard =
  | { type: 'mirror'; mirror: MirrorState }
  | { type: 'breakdown'; month: YearMonth; items: CategorySpend[]; total: Minor; target: Minor }
  | { type: 'transactions'; title: string; txns: Transaction[] }
  | { type: 'findings'; findings: BillFinding[] }
  | { type: 'recurring'; series: RecurringSeries[] }
  | { type: 'insights'; insights: Insight[] }
  | { type: 'affordability'; result: AffordabilityResult }
  | { type: 'goals'; goals: GoalProgress[] }
  | { type: 'budget'; plan: BudgetPlan }
  | { type: 'xray'; result: XrayResult }
  | { type: 'action'; pendingId: string }
  | { type: 'plan'; planId: string }
  | { type: 'clarify'; question: string; options: { label: string; value: string }[] }
  | { type: 'notice'; level: 'info' | 'warn' | 'block'; title: string; text: string }

// ───────────────────────────── task plans (multi-step, DAG) ─────────────────────────────

export type PlanStepStatus = 'waiting' | 'running' | 'done' | 'needs_approval' | 'skipped' | 'failed' | 'blocked'

export interface PlanStep {
  id: string
  tool: ToolName
  args: Record<string, unknown>
  /** ids of steps that must finish first */
  dependsOn: string[]
  /** short human label: "Find what pushed you over" */
  label: string
  status: PlanStepStatus
  resultSummary?: string
  /** when the step produced a PendingAction */
  pendingId?: string
}

/**
 * A goal-driven multi-step plan (e.g. "get me back on track this month"): read steps run automatically,
 * action steps become PendingActions gated by the policy engine. The user can interrupt at any time.
 */
export interface TaskPlan {
  id: string
  goal: string
  createdAt: ISODateTime
  status: 'running' | 'awaiting_user' | 'done' | 'cancelled' | 'failed'
  steps: PlanStep[]
}

/** Dialogue state for clarification / correction across turns. */
export interface DialogueState {
  /** an intent waiting for a missing slot, e.g. which goal to move money to */
  pendingClarification?: { intent: string; slots: Record<string, unknown>; missing: string; askedAt: ISODateTime }
  /** the last proposed pending action id (so "make it ¥200 instead" can correct it) */
  lastProposalId?: string
  lastIntent?: string
}

export type TraceKind = 'intent' | 'tool_call' | 'tool_result' | 'policy' | 'grounding' | 'injection' | 'llm' | 'redaction' | 'error'

export interface TraceStep {
  kind: TraceKind
  label: string
  detail?: unknown
  ts: ISODateTime
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  ts: ISODateTime
  cards?: ChatCard[]
  /** glass-box trace of how this reply was produced */
  trace?: TraceStep[]
  engine?: 'offline' | 'llm'
  grounding?: GroundingReport
  /** quick-reply chips offered after this message */
  suggestions?: string[]
}

// ───────────────────────────── finance context ─────────────────────────────

/** Everything the finance engine needs. Pure data — no methods. */
export interface FinanceContext {
  profile: Profile
  bank: BankState
  dreams: DreamItem[]
  budget: BudgetPlan | null
  tripwires: Tripwire[]
}

// ───────────────────────────── persisted app state ─────────────────────────────

export interface AppSettings {
  /** show the glass-box panel (agent trace, policy decisions, audit) */
  glassBox: boolean
  /** use the LLM gateway when reachable (requires consent.llmProcessing) */
  llmEnabled: boolean
  notificationsEnabled: boolean
  reducedMotion: boolean
  /** encrypt local storage with the PIN (AES-GCM) */
  vault: boolean
}

export interface AppState {
  version: 1
  profile: Profile | null
  bank: BankState
  dreams: DreamItem[]
  budget: BudgetPlan | null
  tripwires: Tripwire[]
  tripwireEvents: TripwireEvent[]
  mandate: Mandate
  pending: PendingAction[]
  chat: ChatMessage[]
  audit: AuditEntry[]
  /** user-learned merchant → category rules */
  categoryRules: Record<string, CategoryId>
  /** reminders the user/agent set on bills, keyed by bill id: days before due */
  billReminders: Record<string, number>
  plans: TaskPlan[]
  dialogue: DialogueState
  settings: AppSettings
}
