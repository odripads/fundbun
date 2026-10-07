/**
 * Hand-made FinanceContext fixtures for the finance-engine tests. Deliberately independent of the sandbox
 * generator: every number here is chosen by hand so the tests can reason about it.
 */
import { addDays, daysInMonth, monthsBack } from '../dates'
import type {
  Account,
  Bill,
  BudgetPlan,
  CategoryId,
  Dispute,
  DreamItem,
  FinanceContext,
  ISODate,
  Minor,
  Profile,
  Tone,
  Transaction,
  Tripwire,
  YearMonth,
} from '../types'

export const yuan = (n: number): Minor => Math.round(n * 100)

let seq = 0

export function makeTxn(p: Partial<Transaction> & { amount: Minor; date: ISODate }): Transaction {
  return {
    id: `t${++seq}`,
    accountId: 'chk_main',
    currency: 'CNY',
    merchant: 'Shop',
    description: '',
    category: 'other',
    categorySource: 'rule',
    categoryConfidence: 1,
    ...p,
  }
}

/** An outflow of `amount` yuan. */
export function spend(date: ISODate, merchant: string, category: CategoryId, amount: number, extra: Partial<Transaction> = {}): Transaction {
  return makeTxn({ date, merchant, category, amount: -yuan(amount), ...extra })
}

export function pay(date: ISODate, amount: number, merchant = 'Payroll'): Transaction {
  return makeTxn({ date, merchant, category: 'income', amount: yuan(amount) })
}

/** The same charge on `day` of each month (clamped to month length). */
export function monthly(merchant: string, category: CategoryId, amount: number | ((m: YearMonth) => number), day: number, months: YearMonth[], extra: Partial<Transaction> = {}): Transaction[] {
  return months.map((m) => {
    const d = Math.min(day, daysInMonth(m))
    return spend(`${m}-${String(d).padStart(2, '0')}`, merchant, category, typeof amount === 'function' ? amount(m) : amount, extra)
  })
}

/** Pot contributions: a 'savings' outflow from checking and the matching inflow into the pot. */
export function potContributions(potId: string, amount: number, day: number, months: YearMonth[]): Transaction[] {
  return months.flatMap((m) => {
    const date = `${m}-${String(day).padStart(2, '0')}`
    return [
      makeTxn({ date, merchant: 'Goal pot', category: 'savings', amount: -yuan(amount) }),
      makeTxn({ date, accountId: potId, merchant: 'Goal pot', category: 'savings', amount: yuan(amount) }),
    ]
  })
}

/** `perDay` yuan of day-to-day spending on every day from `from` to `to` inclusive. */
export function daily(from: ISODate, to: ISODate, merchant: string, category: CategoryId, perDay: number, extra: Partial<Transaction> = {}): Transaction[] {
  const out: Transaction[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(spend(d, merchant, category, perDay, extra))
  return out
}

export function makeProfile(p: Partial<Profile> = {}): Profile {
  return {
    name: 'Test',
    currency: 'CNY',
    monthlyIncome: yuan(10_000),
    targetSpend: yuan(6_000),
    payday: 10,
    workHoursPerMonth: 174,
    tone: 'gentle',
    consent: { financialData: true, llmProcessing: false, notifications: true, grantedAt: '2026-04-01T00:00:00.000Z', version: '1' },
    onboardedAt: '2026-04-01T00:00:00.000Z',
    ...p,
  }
}

export function makeDream(id: string, name: string, price: number, kind: DreamItem['kind'], extra: Partial<DreamItem> = {}): DreamItem {
  return { id, name, price: yuan(price), image: `preset:gift`, kind, createdAt: '2026-04-01', ...extra }
}

export function checking(balance: number): Account {
  return { id: 'chk_main', name: 'Checking', type: 'checking', balance: yuan(balance), currency: 'CNY', maskedNumber: '•••• 4821' }
}

export function pot(goalId: string, balance: number): Account {
  return { id: `pot_${goalId}`, name: `Pot ${goalId}`, type: 'pot', balance: yuan(balance), currency: 'CNY', goalId }
}

export function makeBill(p: Partial<Bill> & { id: string; amountDue: Minor; dueDate: ISODate; period: YearMonth }): Bill {
  return { payeeId: 'payee_power', name: 'Shenzhen Power Supply', category: 'utilities', status: 'upcoming', source: 'sandbox', ...p }
}

export interface CtxInput {
  today: ISODate
  txns?: Transaction[]
  accounts?: Account[]
  bills?: Bill[]
  dreams?: DreamItem[]
  profile?: Partial<Profile>
  budget?: BudgetPlan | null
  tripwires?: Tripwire[]
  disputes?: Dispute[]
  cancelledMerchants?: string[]
}

export function makeCtx(i: CtxInput): FinanceContext {
  const txns = [...(i.txns ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return {
    profile: makeProfile(i.profile),
    bank: {
      accounts: i.accounts ?? [checking(20_000)],
      transactions: txns,
      payees: [],
      bills: i.bills ?? [],
      disputes: i.disputes ?? [],
      cancelledMerchants: i.cancelledMerchants ?? [],
      today: i.today,
      seed: 1,
    },
    dreams: i.dreams ?? [],
    budget: i.budget ?? null,
    tripwires: i.tripwires ?? [],
  }
}

export function withTone(ctx: FinanceContext, tone: Tone): FinanceContext {
  return { ...ctx, profile: { ...ctx.profile, tone } }
}

// ───────────────────────────── stories ─────────────────────────────

export const MEI_DREAMS = [
  makeDream('dream_birkin', 'Birkin 25', 98_000, 'goal', { potAccountId: 'pot_dream_birkin', image: 'preset:bag' }),
  makeDream('dream_chengdu', 'Weekend in Chengdu', 2_400, 'goal', { image: 'preset:plane' }),
  makeDream('dream_airpods', 'AirPods Pro', 1_899, 'treat', { image: 'preset:earbuds' }),
  makeDream('dream_shoes', 'New running shoes', 899, 'treat', { image: 'preset:sneakers' }),
]

/**
 * Mei-like OVER story, today 2026-10-22. Jul–Sep: rent 4,200 + ~¥150/day + fixed charges ≈ ¥9,300/month.
 * October to date: rent + subscriptions + ¥300/day + a ¥1,299 Taobao splurge ≈ ¥12,330 → about ¥2,830 over the
 * ¥9,500 target, which covers the Weekend in Chengdu (¥2,400). Birkin pot ¥23,400 at ¥2,200/month.
 */
export function meiLike(tone: Tone = 'cheeky'): FinanceContext {
  const months = monthsBack('2026-10', 4) // Jul..Oct
  const past = months.slice(0, 3)
  const txns: Transaction[] = [
    ...months.map((m) => pay(`${m}-10`, 18_500)),
    ...monthly('Landlord Zhang', 'housing', 4_200, 1, months),
    ...monthly('iQIYI', 'subscriptions', (m) => (m < '2026-08' ? 25 : 30), 5, months),
    ...monthly('Tencent Video', 'subscriptions', 30, 3, months),
    ...monthly('Youku', 'subscriptions', 25, 8, months),
    ...monthly('NetEase Cloud Music', 'subscriptions', 15, 12, months),
    ...monthly('Pure Fitness', 'health', 399, 15, months),
    ...monthly('China Mobile', 'phone_internet', 128, 25, past),
    spend('2026-10-03', 'Tencent Video', 'subscriptions', 30),
    ...potContributions('pot_dream_birkin', 2_200, 10, months),
    ...daily('2026-07-01', '2026-09-30', 'Luckin Coffee', 'coffee_tea', 30),
    ...daily('2026-07-01', '2026-09-30', 'Hema', 'groceries', 60),
    ...daily('2026-07-01', '2026-09-30', 'DiDi', 'transport', 60),
    ...daily('2026-10-01', '2026-10-22', 'Luckin Coffee', 'coffee_tea', 40),
    ...daily('2026-10-01', '2026-10-22', 'Hema', 'groceries', 100),
    ...daily('2026-10-01', '2026-10-22', 'Meituan Delivery', 'delivery', 160, { time: '23:40' }),
    spend('2026-10-18', 'Taobao', 'shopping', 1_299),
  ]
  return makeCtx({
    today: '2026-10-22',
    txns,
    accounts: [checking(18_000), pot('dream_birkin', 23_400)],
    bills: [
      makeBill({ id: 'bill_power_2026_06', amountDue: yuan(300), dueDate: '2026-07-28', period: '2026-06', status: 'paid' }),
      makeBill({ id: 'bill_power_2026_07', amountDue: yuan(310), dueDate: '2026-08-28', period: '2026-07', status: 'paid' }),
      makeBill({ id: 'bill_power_2026_08', amountDue: yuan(320), dueDate: '2026-09-28', period: '2026-08', status: 'paid' }),
      makeBill({ id: 'bill_power_2026_09', amountDue: yuan(486.2), dueDate: '2026-10-28', period: '2026-09' }),
      makeBill({ id: 'bill_mobile_2026_10', payeeId: 'payee_cmcc', name: 'China Mobile', category: 'phone_internet', amountDue: yuan(128), dueDate: '2026-10-25', period: '2026-10' }),
    ],
    dreams: MEI_DREAMS,
    profile: { name: 'Mei', monthlyIncome: yuan(18_500), targetSpend: yuan(9_500), tone },
  })
}

export const ARIF_DREAMS = [
  makeDream('dream_macbook', 'MacBook Air', 7_999, 'goal', { image: 'preset:laptop' }),
  makeDream('dream_flight', 'Flight home to Medan', 2_600, 'goal', { image: 'preset:plane' }),
  makeDream('dream_concert', 'Concert ticket', 480, 'treat', { image: 'preset:ticket' }),
  makeDream('dream_sneakers', 'New sneakers', 399, 'treat', { image: 'preset:sneakers' }),
]

/**
 * Arif-like UNDER story, today 2026-10-22: dorm 900 + phone + ¥65/day → projected ≈ ¥3,000 against a ¥3,600
 * target. MacBook pot ¥3,680 (46%).
 */
export function arifLike(tone: Tone = 'gentle'): FinanceContext {
  const months = monthsBack('2026-10', 4)
  const txns: Transaction[] = [
    ...months.map((m) => pay(`${m}-05`, 3_500, 'CSC Scholarship stipend')),
    ...monthly('Dorm office', 'housing', 900, 1, months),
    ...monthly('China Mobile', 'phone_internet', 58, 20, months),
    ...monthly('Bilibili', 'subscriptions', 25, 7, months),
    ...potContributions('pot_dream_macbook', 600, 6, months),
    ...daily('2026-07-01', '2026-10-22', 'Campus canteen', 'dining', 40),
    ...daily('2026-07-01', '2026-10-22', 'Shenzhen Metro', 'transport', 10),
    ...daily('2026-07-01', '2026-10-22', 'Mixue', 'coffee_tea', 15),
  ]
  return makeCtx({
    today: '2026-10-22',
    txns,
    accounts: [checking(2_500), pot('dream_macbook', 3_680)],
    dreams: ARIF_DREAMS,
    profile: { name: 'Arif', monthlyIncome: yuan(4_800), targetSpend: yuan(3_600), payday: 5, tone },
  })
}
