/**
 * Pure view logic for the Bills screen: calendar strip, bill grouping, finding evidence, subscription groups,
 * X-ray helpers. No React, no DOM — everything here is unit-tested in billsView.test.ts.
 */
import { addDays, dateLabel, diffDays, monthLabel, weekday, ym } from '../../../core/dates'
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, fmt } from '../../../core/money'
import { dreamEquivalents } from '../../../core/finance/dreams'
import { subscriptionNiche, type SubscriptionNiche } from '../../../core/finance/categorize'
import type {
  AppState,
  Bill,
  BillFinding,
  BillStatus,
  Currency,
  DreamEquivalent,
  DreamItem,
  FindingKind,
  InjectionReport,
  ISODate,
  Minor,
  Payee,
  PendingAction,
  RecurringSeries,
  SuggestedAction,
  Tone,
  XrayResult,
} from '../../../core/types'

export const CALENDAR_DAYS = 14

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ───────────────────────────── bills ─────────────────────────────

/** What the user sees: an unpaid bill past its due date reads as overdue even before the bank flips it. */
export function displayStatus(bill: Bill, today: ISODate): BillStatus {
  if (bill.status === 'upcoming' && bill.dueDate < today) return 'overdue'
  return bill.status
}

export function isOpen(bill: Bill): boolean {
  return bill.status !== 'paid'
}

const STATUS_RANK: Record<BillStatus, number> = { overdue: 0, upcoming: 1, scheduled: 2, paid: 3 }

function byDue(a: Bill, b: Bill): number {
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name)
}

export interface BillGroups {
  /** overdue + everything due in the next `horizon` days (paid ones too, so an early payment stays visible) */
  soon: Bill[]
  /** unpaid bills due after the horizon */
  later: Bill[]
}

export function groupBills(bills: Bill[], today: ISODate, horizon = CALENDAR_DAYS): BillGroups {
  const end = addDays(today, horizon - 1)
  const soon: Bill[] = []
  const later: Bill[] = []
  for (const b of bills) {
    if (isOpen(b) && b.dueDate < today) soon.push(b)
    else if (b.dueDate >= today && b.dueDate <= end) soon.push(b)
    else if (isOpen(b) && b.dueDate > end) later.push(b)
  }
  return { soon: soon.sort(byDue), later: later.sort(byDue) }
}

export interface DueSummary {
  total: Minor
  count: number
  next?: Bill
}

/** Still to pay this month: unpaid and scheduled bills due this calendar month, plus anything overdue. */
export function dueThisMonth(bills: Bill[], today: ISODate): DueSummary {
  const month = ym(today)
  const due = bills.filter((b) => isOpen(b) && (ym(b.dueDate) === month || b.dueDate < today)).sort(byDue)
  return { total: due.reduce((s, b) => s + b.amountDue, 0), count: due.length, next: due.find((b) => b.status !== 'scheduled') }
}

/** "Today", "Tomorrow", "In 6 days", "Yesterday", "3 days ago" */
export function relativeDay(date: ISODate, today: ISODate): string {
  const d = diffDays(today, date)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  if (d === -1) return 'Yesterday'
  return d > 0 ? `In ${d} days` : `${-d} days ago`
}

/** Schedule one day before the due date (never today or earlier — that's "Pay now"). */
export function scheduleDate(bill: Bill, today: ISODate): ISODate | undefined {
  if (bill.dueDate <= today) return undefined
  const dayBefore = addDays(bill.dueDate, -1)
  return dayBefore > today ? dayBefore : bill.dueDate
}

export type BillIcon = 'power' | 'water' | 'home' | 'phone' | 'wifi' | 'card' | 'shield' | 'receipt'

export function billIcon(bill: Pick<Bill, 'name' | 'category'>): BillIcon {
  const n = bill.name.toLowerCase()
  if (/electric|power|电/.test(n)) return 'power'
  if (/water|水/.test(n)) return 'water'
  if (/rent|dorm|housing|apartment|房/.test(n) || bill.category === 'housing') return 'home'
  if (/broadband|internet|fiber|wifi|宽带/.test(n)) return 'wifi'
  if (/mobile|unicom|telecom|phone|plan|移动|联通|电信/.test(n) || bill.category === 'phone_internet') return 'phone'
  if (bill.category === 'insurance') return 'shield'
  if (bill.category === 'fees') return 'card'
  return 'receipt'
}

export type StatusIcon = 'paid' | 'scheduled' | 'overdue' | 'soon' | 'upcoming'

export interface StatusMeta {
  label: string
  tone: 'under' | 'info' | 'over' | 'warn' | 'neutral'
  icon: StatusIcon
}

/** Badge for a bill: text + icon + tone, so colour is never the only signal. */
export function billStatusMeta(bill: Bill, today: ISODate): StatusMeta {
  const status = displayStatus(bill, today)
  if (status === 'paid') return { label: 'Paid', tone: 'under', icon: 'paid' }
  if (status === 'scheduled') return { label: `Scheduled · ${dateLabel(bill.scheduledFor ?? bill.dueDate)}`, tone: 'info', icon: 'scheduled' }
  const days = diffDays(today, bill.dueDate)
  if (status === 'overdue') return { label: days < 0 ? `Overdue · ${plural(-days, 'day')}` : 'Overdue', tone: 'over', icon: 'overdue' }
  if (days <= 3) return { label: days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days} days`, tone: 'warn', icon: 'soon' }
  return { label: 'Upcoming', tone: 'neutral', icon: 'upcoming' }
}

/** "Due Oct 28 · in 6 days" · "Was due Oct 20 · 2 days ago" · "Goes out Oct 29 · due Oct 30" · "Sorted ahead of Oct 25" */
export function dueLine(bill: Bill, today: ISODate): string {
  const status = displayStatus(bill, today)
  const due = dateLabel(bill.dueDate)
  if (status === 'paid') return bill.dueDate >= today ? `Sorted ahead of ${due}` : `Was due ${due}`
  if (status === 'scheduled') return `Goes out ${dateLabel(bill.scheduledFor ?? bill.dueDate)} · due ${due}`
  const rel = relativeDay(bill.dueDate, today)
  return status === 'overdue' ? `Was due ${due} · ${rel.toLowerCase()}` : `Due ${due} · ${rel.toLowerCase()}`
}

/** The bill_spike finding for this bill, if the analysis flagged it. */
export function spikeFor(bill: Bill, findings: BillFinding[]): BillFinding | undefined {
  return findings.find((f) => f.kind === 'bill_spike' && f.billId === bill.id)
}

export function payeeOf(bill: Bill, payees: Payee[]): Payee | undefined {
  return payees.find((p) => p.id === bill.payeeId)
}

// ───────────────────────────── calendar strip ─────────────────────────────

export interface CalendarDay {
  date: ISODate
  /** "Thu" — or the month ("Nov") on the 1st so the month change reads at a glance */
  top: string
  day: number
  isToday: boolean
  isMonthStart: boolean
  bills: Bill[]
  total: Minor
  /** the most urgent status among the day's bills */
  status?: BillStatus
  /** due within 3 days and still unpaid */
  soon: boolean
}

export function calendarDays(bills: Bill[], today: ISODate, days = CALENDAR_DAYS): CalendarDay[] {
  const out: CalendarDay[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const dayBills = bills.filter((b) => b.dueDate === date).sort(byDue)
    const day = Number(date.slice(8, 10))
    const statuses = dayBills.map((b) => displayStatus(b, today))
    const status = statuses.sort((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0]
    out.push({
      date,
      top: day === 1 && i > 0 ? monthLabel(ym(date), 'short').split(' ')[0] : WEEKDAY[weekday(date)],
      day,
      isToday: i === 0,
      isMonthStart: day === 1,
      bills: dayBills,
      total: dayBills.reduce((s, b) => s + b.amountDue, 0),
      ...(status ? { status } : {}),
      soon: i <= 3 && dayBills.some((b) => b.status === 'upcoming'),
    })
  }
  return out
}

/** Bills that fall before the strip: overdue, still unpaid. */
export function overdueBills(bills: Bill[], today: ISODate): Bill[] {
  return bills.filter((b) => isOpen(b) && b.status !== 'scheduled' && b.dueDate < today).sort(byDue)
}

/** Tight amounts for 46px calendar cells: ¥486 · ¥4.3k */
export function shortMoney(minor: Minor, currency: Currency): string {
  const major = Math.abs(minor) / MINOR_PER_MAJOR[currency]
  const sym = CURRENCY_SYMBOL[currency]
  if (major >= 1000) return `${sym}${(major / 1000).toFixed(major >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return `${sym}${Math.round(major)}`
}

export function rangeLabel(days: CalendarDay[]): string {
  if (days.length === 0) return ''
  return `${dateLabel(days[0].date)} – ${dateLabel(days[days.length - 1].date)}`
}

// ───────────────────────────── actions ─────────────────────────────

function sameArgs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}

/** A pending (awaiting approval) action that matches this button, so the button can offer "Review" instead. */
export function findPending(awaiting: PendingAction[], action: SuggestedAction): PendingAction | undefined {
  return awaiting.find((p) => p.status === 'pending' && p.call.tool === action.tool && sameArgs(p.call.args, action.args))
}

export function payAction(bill: Bill, currency: Currency): SuggestedAction {
  return { tool: 'pay_bill', args: { billId: bill.id }, label: `Pay ${fmt(bill.amountDue, currency)}` }
}

export function scheduleAction(bill: Bill, date: ISODate): SuggestedAction {
  return { tool: 'pay_bill', args: { billId: bill.id, date }, label: `Schedule for ${dateLabel(date)}` }
}

export const REMINDER_DAYS = 3

export function reminderAction(bill: Bill, daysBefore = REMINDER_DAYS): SuggestedAction {
  return { tool: 'set_bill_reminder', args: { billId: bill.id, daysBefore }, label: 'Remind me' }
}

export function cancelAction(series: RecurringSeries): SuggestedAction {
  return { tool: 'cancel_subscription', args: { recurringId: series.id }, label: `Cancel ${series.merchant}` }
}

// ───────────────────────────── findings ─────────────────────────────

export interface SeverityMeta {
  label: string
  tone: 'over' | 'warn' | 'info'
}

export const SEVERITY_META: Record<BillFinding['severity'], SeverityMeta> = {
  alert: { label: 'Act now', tone: 'over' },
  warn: { label: 'Worth a look', tone: 'warn' },
  info: { label: 'Good to know', tone: 'info' },
}

export const KIND_LABEL: Record<FindingKind, string> = {
  price_hike: 'Price hike',
  duplicate_charge: 'Duplicate charge',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  bill_spike: 'Bill spike',
  subscription_overlap: 'Overlap',
  annual_cost: 'Yearly cost',
  unusual_amount: 'Unusual amount',
}

export function severityCounts(findings: BillFinding[]): Record<BillFinding['severity'], number> {
  const out = { alert: 0, warn: 0, info: 0 }
  for (const f of findings) out[f.severity]++
  return out
}

const MONEY_KEYS = new Set(['amount', 'from', 'to', 'extraPerYear', 'amountDue', 'average', 'monthlyTotal', 'annualTotal'])
const DATE_KEYS = new Set(['since', 'firstDate', 'secondDate', 'dueDate'])

const EVIDENCE_LABEL: Record<string, string> = {
  from: 'Was',
  to: 'Now',
  pct: 'Change',
  since: 'Since',
  extraPerYear: 'Extra a year',
  amount: 'Each charge',
  firstDate: 'First charge',
  secondDate: 'Second charge',
  daysApart: 'Gap',
  rule: 'Rule',
  amountDue: 'This bill',
  dueDate: 'Due',
  daysLeft: 'Time left',
  average: 'Your usual',
  periods: 'Compared with',
  period: 'Period',
  niche: 'Type',
  services: 'Services',
  count: 'How many',
  monthlyTotal: 'A month',
  annualTotal: 'A year',
  equivalent: 'Same as',
}

const RULE_LABEL: Record<string, string> = {
  series: 'Same billing period',
  billed: 'Within 48 hours',
  instant: 'Within 10 minutes',
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function evidenceValue(key: string, value: number | string, currency: Currency): string {
  if (MONEY_KEYS.has(key) && typeof value === 'number') return fmt(value, currency)
  if (DATE_KEYS.has(key) && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateLabel(value)
  if (key === 'period' && typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) return monthLabel(value, 'short')
  if (key === 'pct' && typeof value === 'number') return `${value > 0 ? '+' : ''}${Math.round(value)}%`
  if (key === 'daysApart' && typeof value === 'number') return value === 0 ? 'Same day' : plural(value, 'day')
  if (key === 'daysLeft' && typeof value === 'number') return value < 0 ? `${plural(-value, 'day')} late` : plural(value, 'day')
  if (key === 'periods' && typeof value === 'number') return `Last ${plural(value, 'bill')}`
  if (key === 'rule' && typeof value === 'string') return RULE_LABEL[value] ?? value
  if (key === 'niche' && typeof value === 'string') return NICHE_LABEL[value as SubscriptionNiche] ?? value
  return String(value)
}

export interface EvidenceRow {
  key: string
  label: string
  value: string
}

/** The numbers behind a finding, labelled for people ("Your usual ¥309.52"), in the engine's order. */
export function evidenceRows(finding: Pick<BillFinding, 'evidence' | 'kind'>, currency: Currency): EvidenceRow[] {
  return Object.entries(finding.evidence)
    .filter(([key]) => !(finding.kind === 'subscription_overlap' && key === 'services'))
    .map(([key, value]) => ({
      key,
      label: key === 'count' && finding.kind === 'annual_cost' ? 'Subscriptions' : EVIDENCE_LABEL[key] ?? humanizeKey(key),
      value: evidenceValue(key, value, currency),
    }))
}

/** Yearly amount a finding is about, for a dream-item comparison (only where it's a recurring cost). */
function yearlyBasis(finding: BillFinding): Minor | undefined {
  const e = finding.evidence
  if (finding.kind === 'annual_cost' || finding.kind === 'subscription_overlap') return typeof e.annualTotal === 'number' ? e.annualTotal : undefined
  if (finding.kind === 'price_hike') return typeof e.extraPerYear === 'number' ? e.extraPerYear : undefined
  return undefined
}

/** "That's 2× Weekend in Chengdu, every year" — only when it's at least a quarter of something you want. */
export function findingEquivalent(finding: BillFinding, dreams: DreamItem[]): DreamEquivalent | undefined {
  const basis = yearlyBasis(finding)
  if (!basis) return undefined
  const eq = dreamEquivalents(basis, dreams, 1)[0]
  return eq && eq.fraction >= 0.25 ? eq : undefined
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The engine's detail minus a trailing "That's 2× Weekend in Chengdu." when the card shows that picture anyway. */
export function trimEquivalent(detail: string, label: string | undefined): string {
  if (!label) return detail
  const re = new RegExp(`\\s*That[’']s ${escapeRegExp(label)}\\.?`, 'i')
  return detail.replace(re, '').trim()
}

// ───────────────────────────── subscriptions ─────────────────────────────

export type NicheKey = SubscriptionNiche | 'other'

export const NICHE_LABEL: Record<NicheKey, string> = {
  video: 'Video streaming',
  music: 'Music streaming',
  cloud: 'Cloud storage',
  fitness: 'Gym & fitness',
  software: 'Apps',
  gaming: 'Gaming',
  other: 'Other',
}

export function isActiveSub(s: RecurringSeries): boolean {
  return s.status === 'active'
}

export interface SubscriptionGroup {
  key: NicheKey
  label: string
  items: RecurringSeries[]
  /** 2+ active services doing the same job */
  overlap: boolean
  /** active monthly total for the group */
  monthly: Minor
}

function monthlyOf(s: RecurringSeries): Minor {
  return Math.round(s.annualCost / 12)
}

/**
 * Overlapping niches (2+ active video services…) first, as their own groups, then every other subscription
 * in one "rest" group. Items: active first, then by price.
 */
export function subscriptionGroups(recurring: RecurringSeries[]): { overlaps: SubscriptionGroup[]; rest: RecurringSeries[] } {
  const subs = recurring.filter((r) => r.isSubscription)
  const byNiche = new Map<NicheKey, RecurringSeries[]>()
  for (const s of subs) {
    const key: NicheKey = subscriptionNiche(s.merchant) ?? 'other'
    byNiche.set(key, [...(byNiche.get(key) ?? []), s])
  }
  const order = (a: RecurringSeries, b: RecurringSeries) => Number(isActiveSub(b)) - Number(isActiveSub(a)) || b.lastAmount - a.lastAmount || a.merchant.localeCompare(b.merchant)
  const overlaps: SubscriptionGroup[] = []
  const rest: RecurringSeries[] = []
  for (const [key, items] of byNiche) {
    const active = items.filter(isActiveSub)
    // a group stays together after a cancellation so the user sees the overlap resolve
    const wasOverlap = key !== 'other' && items.length >= 2
    if (wasOverlap) {
      overlaps.push({ key, label: NICHE_LABEL[key], items: [...items].sort(order), overlap: active.length >= 2, monthly: active.reduce((s, x) => s + monthlyOf(x), 0) })
    } else rest.push(...items)
  }
  overlaps.sort((a, b) => Number(b.overlap) - Number(a.overlap) || b.monthly - a.monthly)
  return { overlaps, rest: rest.sort(order) }
}

export interface SubscriptionTotals {
  activeCount: number
  monthly: Minor
  annual: Minor
  /** yearly cost of the subscriptions the user cancelled (money kept) */
  saved: Minor
  cancelled: RecurringSeries[]
}

export function subscriptionTotals(recurring: RecurringSeries[]): SubscriptionTotals {
  const subs = recurring.filter((r) => r.isSubscription)
  const active = subs.filter(isActiveSub)
  const cancelled = subs.filter((s) => !isActiveSub(s))
  const annual = active.reduce((s, x) => s + x.annualCost, 0)
  return {
    activeCount: active.length,
    monthly: Math.round(annual / 12),
    annual,
    saved: cancelled.reduce((s, x) => s + x.annualCost, 0),
    cancelled,
  }
}

export const CADENCE_LABEL: Record<RecurringSeries['cadence'], string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

/** "/mo" after a price */
export const CADENCE_SUFFIX: Record<RecurringSeries['cadence'], string> = {
  weekly: '/wk',
  monthly: '/mo',
  quarterly: '/qtr',
  yearly: '/yr',
}

// ───────────────────────────── X-ray ─────────────────────────────

export const SIGNAL_LABEL: Record<string, string> = {
  'instruction-override': 'Tries to override instructions',
  'role-spoof': 'Pretends to be the system',
  'ai-addressed': 'Talks to the AI directly',
  'payment-instruction': 'Asks for a payment',
  'payment-to-unknown': 'Names an unknown account',
  'authority-claim': 'Claims you pre-approved it',
  urgency: 'Pushes you to hurry',
  'permission-change': 'Asks for more permissions',
  secrecy: 'Says not to ask you',
  'tool-invocation': 'Tries to call a tool',
  exfiltration: 'Asks for your data',
  'hidden-characters': 'Hidden characters',
  'encoded-payload': 'Encoded text',
  'obfuscated-text': 'Disguised text',
  'scanner-unavailable': 'Safety scan unavailable',
}

export function signalLabel(signal: string): string {
  return SIGNAL_LABEL[signal] ?? humanizeKey(signal.replace(/-/g, '_'))
}

const DATE_RUN = /^\d{4}-\d{1,2}-\d{1,2}$/

/** Account-like digit runs in quoted bill text are masked to the last 4 (never echo a full account number). Dates stay. */
export function maskDigits(text: string): string {
  return text.replace(/\d(?:[\d\s-]*\d){5,}/g, (run) => (DATE_RUN.test(run.trim()) ? run : `•••• ${run.replace(/\D/g, '').slice(-4)}`))
}

export interface FlaggedLine {
  text: string
  signals: string[]
}

/**
 * The lines of pasted text that carry the injection, found by scanning each line on its own (the report's
 * excerpts are fixed-width windows that bleed into neighbouring lines). Most suspicious first, digits masked.
 */
export function flaggedLines(text: string, scan: (line: string) => InjectionReport, max = 2): FlaggedLine[] {
  const out: (FlaggedLine & { score: number; at: number })[] = []
  text.split(/\r?\n/).forEach((raw, at) => {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 8) return
    let report: InjectionReport
    try {
      report = scan(line)
    } catch {
      return
    }
    if (report.signals.length === 0) return
    out.push({ text: maskDigits(line), signals: report.signals, score: report.score, at })
  })
  return out
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, max)
    .sort((a, b) => a.at - b.at)
    .map(({ text: t, signals }) => ({ text: t, signals }))
}

/** The clearest excerpt to show: the longest (excerpts overlap), trimmed of ellipses, digits masked. */
export function primaryExcerpt(excerpts: string[]): string | undefined {
  const best = [...excerpts].sort((a, b) => b.length - a.length)[0]
  return best ? maskDigits(best.replace(/^…|…$/g, '').trim()) : undefined
}

/** Warnings the dedicated UI does not already show (injection banner, history comparison). */
export function otherWarnings(result: XrayResult): string[] {
  return result.warnings.filter((w) => !/instructions aimed at an ai|safety scan|above your usual/i.test(w))
}

/** A sandbox bill the pasted text describes (same total and due date), so the X-ray can offer real actions. */
export function matchBill(result: XrayResult, bills: Bill[]): Bill | undefined {
  if (result.total === undefined || !result.dueDate) return undefined
  return bills.find((b) => b.amountDue === result.total && b.dueDate === result.dueDate)
}

export interface XraySample {
  bill: Bill
  label: string
  featured: boolean
}

const COMMON_FIRST_WORDS = /^(electricity|water|gas|broadband|internet|rent|dorm|phone|heating|power|mobile)\b/i

/** "Electricity" → "electricity bill", "Dorm rent" → "dorm rent", "China Mobile plan" → "China Mobile bill" */
export function billNoun(name: string): string {
  const base = name.trim().replace(/\s+plan$/i, '')
  const lowered = COMMON_FIRST_WORDS.test(base) ? base.charAt(0).toLowerCase() + base.slice(1) : base
  return /\b(rent|bill|statement|notice)$/i.test(lowered) ? lowered : `${lowered} bill`
}

/** "Mei Lin" → "Mei’s", "Agnes" → "Agnes’", no name → "your" */
export function possessive(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  if (!first) return 'your'
  return /s$/i.test(first) ? `${first}’` : `${first}’s`
}

/**
 * One sample per payee (its latest bill with raw text). The featured one is the bill the analysis flagged
 * (a spike), else the next one due.
 */
export function xraySamples(bills: Bill[], findings: BillFinding[], profileName: string, max = 5): XraySample[] {
  const latest = new Map<string, Bill>()
  for (const b of bills) {
    if (!b.rawText) continue
    const cur = latest.get(b.payeeId)
    if (!cur || b.period > cur.period) latest.set(b.payeeId, b)
  }
  const flagged = new Set(findings.filter((f) => f.kind === 'bill_spike' && f.billId).map((f) => f.billId))
  const ordered = [...latest.values()].sort((a, b) => Number(flagged.has(b.id)) - Number(flagged.has(a.id)) || byDue(a, b))
  return ordered.slice(0, max).map((bill, i) => ({
    bill,
    featured: i === 0,
    label: i === 0 ? `Try ${possessive(profileName)} ${billNoun(bill.name)}` : bill.name,
  }))
}

// ───────────────────────────── copy ─────────────────────────────

/** The hero line, in the user's chosen voice. Never pushes spending; celebrates calm. */
export function heroLine(tone: Tone, findings: BillFinding[]): string {
  const { alert, warn } = severityCounts(findings)
  const worth = alert + warn
  if (worth === 0) {
    return tone === 'cheeky' ? 'Your bills are boringly perfect. Love that for you.' : tone === 'numbers' ? 'No issues found.' : 'All calm on the bills front.'
  }
  if (tone === 'numbers') return `${plural(worth, 'issue')} found${alert ? ` · ${alert} urgent` : ''}.`
  if (tone === 'cheeky') return alert ? `Bun sniffed out ${plural(worth, 'thing')} — ${alert === 1 ? 'one is' : `${alert} are`} sneaky.` : `Bun sniffed out ${plural(worth, 'thing')} worth a look.`
  return alert ? `${plural(worth, 'thing')} worth a look — ${alert === 1 ? 'one needs' : `${alert} need`} you soon.` : `${plural(worth, 'small thing')} worth a look, whenever you’re ready.`
}

export function moodFor(findings: BillFinding[]): 'happy' | 'calm' | 'worried' {
  const { alert, warn } = severityCounts(findings)
  return alert > 0 ? 'worried' : warn > 0 ? 'calm' : 'happy'
}

/** "2× Weekend in Chengdu" for the yearly subscription cost, when it amounts to at least a quarter of a dream. */
export function subscriptionDream(annual: Minor, dreams: DreamItem[]): DreamEquivalent | undefined {
  const eq = dreamEquivalents(annual, dreams, 1)[0]
  return eq && eq.fraction >= 0.25 ? eq : undefined
}

/** Celebrate a cancellation (money kept), in the user's voice. Never suggests spending it. */
export function savedLine(tone: Tone, saved: Minor, names: string[], currency: Currency): string {
  const amount = fmt(saved, currency)
  const who = names.length === 1 ? names[0] : `${names.length} subscriptions`
  if (tone === 'numbers') return `${amount} a year kept · ${who} cancelled.`
  if (tone === 'cheeky') return `${amount} a year, back where it belongs. ${names.length === 1 ? `${names[0]} who?` : 'Bye-bye, extras.'}`
  return `Cancelling ${who} keeps ${amount} a year with you. Nicely done.`
}

/** Short summary line for the subscriptions header: "6 active · ¥520 a month" */
export function subsSummary(totals: SubscriptionTotals, currency: Currency): string {
  if (totals.activeCount === 0) return 'No active subscriptions'
  return `${totals.activeCount} active · ${fmt(totals.monthly, currency)} a month`
}

// ───────────────────────────── X-ray safety receipt ─────────────────────────────

export interface SafetyReceipt {
  /** transactions that appeared during the X-ray (must be 0) */
  txnsAdded: number
  /** payees that appeared during the X-ray (must be 0) */
  payeesAdded: number
  /** new pending actions queued during the X-ray (must be 0) */
  actionsQueued: number
  /** the audit entry that recorded the blocked injection, if any */
  auditSeq?: number
}

type ReceiptState = Pick<AppState, 'pending' | 'audit'> & { bank: Pick<AppState['bank'], 'transactions' | 'payees'> }

/** What actually changed while the X-ray ran — the banner claims "nothing moved" only when this proves it. */
export function safetyReceipt(before: ReceiptState, after: ReceiptState): SafetyReceipt {
  const known = (ids: { id: string }[]) => new Set(ids.map((x) => x.id))
  const txns = known(before.bank.transactions)
  const payees = known(before.bank.payees)
  const pending = known(before.pending)
  const lastSeq = before.audit.length > 0 ? before.audit[before.audit.length - 1].seq : -1
  const logged = after.audit.find((e) => e.seq > lastSeq && e.type === 'injection_detected')
  return {
    txnsAdded: after.bank.transactions.filter((t) => !txns.has(t.id)).length,
    payeesAdded: after.bank.payees.filter((p) => !payees.has(p.id)).length,
    actionsQueued: after.pending.filter((p) => !pending.has(p.id)).length,
    ...(logged ? { auditSeq: logged.seq } : {}),
  }
}

export function receiptClean(r: SafetyReceipt): boolean {
  return r.txnsAdded === 0 && r.payeesAdded === 0 && r.actionsQueued === 0
}

// ───────────────────────────── CSV import ─────────────────────────────

export const MAX_CSV_BYTES = 5 * 1024 * 1024

export interface ImportOutcome {
  fileName: string
  title: string
  message: string
  tone: 'success' | 'warn' | 'danger'
  /** the first few row errors, verbatim from the parser */
  errors: string[]
}

/** Toast + status copy for app.importCsv's result. */
export function importSummary(fileName: string, r: { added: number; skipped: number; errors: string[] }): ImportOutcome {
  const errors = r.errors.slice(0, 3)
  if (r.added === 0 && r.errors.length > 0) return { fileName, title: 'Nothing imported', message: r.errors[0], tone: 'danger', errors: errors.slice(1) }
  if (r.added === 0) {
    return { fileName, title: 'No new transactions', message: r.skipped > 0 ? `${plural(r.skipped, 'row')} skipped — already here or not a purchase.` : 'Bun couldn’t find any rows to read.', tone: 'warn', errors }
  }
  const notes = [r.skipped > 0 ? `${plural(r.skipped, 'row')} skipped` : null, r.errors.length > 0 ? `${plural(r.errors.length, 'row')} couldn’t be read` : null].filter(Boolean)
  return {
    fileName,
    title: `Added ${plural(r.added, 'transaction')}`,
    message: notes.length > 0 ? `${notes.join(' · ')}. Bills and subscriptions re-checked.` : 'Bills and subscriptions re-checked.',
    tone: r.errors.length > 0 ? 'warn' : 'success',
    errors,
  }
}
