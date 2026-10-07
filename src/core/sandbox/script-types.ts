import type {
  Autonomy,
  BillLineItem,
  CategoryId,
  DreamKind,
  ISODate,
  Minor,
  PayChannel,
  Payee,
  Tone,
  TripwireKind,
  TxnFlag,
  YearMonth,
} from '../types'
import type { PersonaDef } from './personas'
import type { PriceSpec } from './random'

/**
 * A persona "script": everything the deterministic generator and the sandbox bank need to simulate one
 * person's financial life. Month offsets are relative to the persona's current month (0 = month of `today`),
 * so the same story works for any sandbox date.
 */

export interface MerchantSpec {
  /** normalised display name, e.g. "Meituan Delivery" */
  merchant: string
  /** raw bank/app description; `{item}` is replaced by one of `items` */
  description: string
  items?: readonly string[]
  category: CategoryId
  channel: PayChannel | readonly PayChannel[]
  price: PriceSpec
  /** relative pick weight inside a habit (default 1) */
  weight?: number
  /** identical amounts days apart are normal here (a metro fare), so they are left alone */
  repeatable?: boolean
}

export type DayKind = 'work' | 'off'

export interface HabitSpec {
  key: string
  merchants: readonly MerchantSpec[]
  /** expected events per day, by day kind (Poisson, capped by maxPerDay) */
  perDay?: Partial<Record<DayKind, number>>
  /** at most this many events per day (default 1: nobody buys two morning coffees ten minutes apart) */
  maxPerDay?: number
  /** events per calendar month (inclusive range), spread over distinct random days */
  perMonth?: readonly [number, number]
  /** for perMonth habits: which days are eligible (default any) */
  on?: DayKind | 'any'
  /** local-time window in decimal hours; values >= 24 wrap to the early morning of the same date */
  hours: readonly [number, number]
  /** never removed by monthly calibration (story-critical habits such as late-night delivery) */
  protected?: boolean
  /** how strongly the month intensity applies: 0 = not at all, 1 = fully (default 1) */
  elasticity?: number
}

export interface SubscriptionSpec {
  merchant: string
  description: string
  category: CategoryId
  channel: PayChannel
  /** day of month the charge lands (clamped to month length) */
  day: number
  time: string
  amount: Minor
  /** price changes taking effect from a month offset (ascending) */
  changes?: readonly { monthOffset: number; amount: Minor }[]
}

export interface IncomeSpec {
  merchant: string
  description: string
  amount: Minor
  day: number
  time: string
  channel: PayChannel
}

export interface PotPlan {
  goalId: string
  name: string
  /** pot balance the history should end at (opening balance is derived); omitted → opening 0 */
  targetBalance?: Minor
  /** monthly standing-order range (inclusive), rounded to `step` */
  monthly?: readonly [Minor, Minor]
  step?: Minor
  day: number
  time: string
  /** first month offset with a contribution (default: every history month) */
  fromMonthOffset?: number
}

export interface BillQuote {
  amount: Minor
  lineItems: BillLineItem[]
  /** human usage line, e.g. "680 kWh" */
  usage?: string
}

export interface RawBillInput {
  billId: string
  period: YearMonth
  dueDate: ISODate
  issueDate: ISODate
  quote: BillQuote
  /** untrusted text appended to the bill (prompt-injection demo) */
  injection?: string
}

export interface BillSeriesSpec {
  /** used in bill ids: bill_<key>_<period> */
  key: string
  payeeId: string
  name: string
  category: CategoryId
  /** day of month the bill is due (clamped to month length) */
  dueDay: number
  /** the bill due in month M + leadMonths is issued on the 1st of month M */
  leadMonths: number
  /** billing period = due month + periodOffset (utilities bill last month's usage) */
  periodOffset: number
  channel: PayChannel
  /** direct debit: in the live sandbox the bank pays it on the due date without anyone acting */
  autoPay?: boolean
  /** in history the persona pays this many days before the due date (inclusive range) */
  payLeadDays: readonly [number, number]
  /** local time window for the payment */
  payHours: readonly [number, number]
  quote(period: YearMonth): BillQuote
  rawText(input: RawBillInput): string
}

export interface StoryTxn {
  monthOffset: number
  day: number
  time: string
  merchant: string
  description: string
  /** signed: negative = outflow */
  amount: Minor
  category: CategoryId
  channel: PayChannel
  memo?: string
  flags?: TxnFlag[]
}

export interface DreamSeed {
  id: string
  name: string
  price: Minor
  image: string
  kind: DreamKind
  note?: string
}

export interface TripwireSeed {
  id: string
  kind: TripwireKind
  threshold: number
  category?: CategoryId
}

export interface PersonaScript {
  def: PersonaDef
  tone: Tone
  account: { name: string; maskedNumber: string; openingBalance: Minor }
  payees: readonly Payee[]
  incomes: readonly IncomeSpec[]
  subscriptions: readonly SubscriptionSpec[]
  habits: readonly HabitSpec[]
  /** merchants the monthly calibration may add when a month comes in under its target */
  fillers: readonly MerchantSpec[]
  pots: readonly PotPlan[]
  bills: readonly BillSeriesSpec[]
  story: readonly StoryTxn[]
  /** story-specific quotes for one bill (e.g. the electricity spike), by due-month offset */
  billOverrides?: readonly { billKey: string; dueMonthOffset: number; quote: (period: YearMonth) => BillQuote }[]
  /** a bill whose raw text carries a prompt-injection attempt */
  injection?: { billKey: string; dueMonthOffset: number; text: string }
  /** discretionary intensity by month offset (default 1) */
  intensity?: Readonly<Record<number, number>>
  calibration: {
    /** total spending per completed month, by month offset (-6..-1) */
    months: Readonly<Record<number, Minor>>
    /** current month: exact to-date total when today is `day`, else fixed + dailyVariable × days */
    current: { day: number; total: Minor; dailyVariable: Minor }
    tolerance: { past: Minor; current: Minor }
  }
  dreams: readonly DreamSeed[]
  tripwires: readonly TripwireSeed[]
  mandate: { autonomy: Autonomy; perActionCap: Minor; dailyCap: Minor; monthlyCap: Minor }
}
