import { CATEGORIES } from '../categories'
import { fmt, MINOR_PER_MAJOR } from '../money'
import type {
  Currency,
  DreamEquivalent,
  FinanceContext,
  ISODate,
  ISODateTime,
  Minor,
  MonthSummary,
  Profile,
  Transaction,
  Tripwire,
  TripwireEvent,
} from '../types'
import { byTone, copyFmt, type Fmt, moneyFmt, plural } from './copy'
import { goalEquivalent, hoursOfWork } from './dreams'
import { isSpending, upTo } from './ledger'
import { summarizeMonth } from './summary'

/** Projections before this day are mostly noise, so pace tripwires stay quiet until then. */
const PACE_FROM_DAY = 5

/** Sensible defaults: month_pct 80, month_pct 100, single_over = 10% of target, pace_over 110. */
export function defaultTripwires(profile: Profile): Tripwire[] {
  const unit = MINOR_PER_MAJOR[profile.currency]
  const single = Math.max(unit, Math.round(profile.targetSpend / 10 / unit) * unit)
  const make = (id: string, kind: Tripwire['kind'], threshold: number): Tripwire => {
    const t: Tripwire = { id, kind, threshold, enabled: true, createdBy: 'default', label: '' }
    return { ...t, label: describeTripwire(t, profile.currency) }
  }
  return [
    make('tw_month_80', 'month_pct', 80),
    make('tw_month_100', 'month_pct', 100),
    make('tw_single', 'single_over', single),
    make('tw_pace_110', 'pace_over', 110),
  ]
}

/** "Alert me at 80% of my monthly target" */
export function describeTripwire(t: Tripwire, currency: Currency): string {
  const money = (m: Minor) => fmt(m, currency)
  switch (t.kind) {
    case 'month_pct':
      return `Alert me at ${t.threshold}% of my monthly target`
    case 'category_pct':
      return `Alert me at ${t.threshold}% of my ${t.category ? CATEGORIES[t.category].label : 'category'} budget`
    case 'single_over':
      return `Alert me on any purchase over ${money(t.threshold)}`
    case 'daily_over':
      return `Alert me when a day's spending passes ${money(t.threshold)}`
    case 'pace_over':
      if (t.threshold > 100) return `Alert me if I'm on pace to end ${t.threshold - 100}% over my target`
      if (t.threshold === 100) return `Alert me if I'm on pace to go over my target`
      return `Alert me if I'm on pace to spend ${t.threshold}% of my target`
  }
}

// ───────────────────────────── firing ─────────────────────────────

interface Firing {
  key: string
  title: string
  message: string
  amount?: Minor
  txnId?: string
  dream?: DreamEquivalent
}

interface EvalInput {
  ctx: FinanceContext
  s: MonthSummary
  /** prose money (totals, targets): whole yuan from ¥100 */
  f: Fmt
  /** exact money: one purchase */
  fx: Fmt
  txns: Transaction[]
  newTxns: Transaction[]
}

function dreamLine(dream: DreamEquivalent | undefined, amount: Minor, f: Fmt): string {
  return dream ? `That ${f(amount)} = ${dream.label}.` : ''
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

function monthPct(t: Tripwire, { ctx, s, f }: EvalInput): Firing[] {
  if (s.target <= 0 || s.spent < (s.target * t.threshold) / 100) return []
  const tone = ctx.profile.tone
  const over = s.spent - s.target
  const left = s.daysInMonth - s.dayOfMonth
  // past 100% the dream is what the overspend cost; before that it's what's still protected
  const stake = over > 0 ? over : Math.max(0, s.projected - s.target) || s.target - s.spent
  const dream = goalEquivalent(stake, ctx.dreams)
  const pct = Math.round((s.spent / s.target) * 100)
  const lead = over > 0 ? `You're ${f(over)} over your ${f(s.target)} target.` : `You've spent ${f(s.spent)} of your ${f(s.target)} target with ${plural(left, 'day')} to go.`
  const dreamText = dream ? (over > 0 ? `That ${f(stake)} = ${dream.label}.` : s.projected > s.target ? `At this pace you'd end ${f(stake)} over — ${dream.label}.` : `The ${f(stake)} left = ${dream.label}.`) : ''
  return [{
    key: s.month,
    title: byTone(tone, {
      gentle: `${pct}% of your monthly target used`,
      cheeky: over > 0 ? `Target smashed (not in the good way)` : `${pct}% gone already?!`,
      numbers: `Month spend at ${pct}% of target`,
    }),
    message: join(lead, dreamText, byTone(tone, { gentle: `Small swaps add up — you've got this.`, cheeky: 'Bun believes in you.', numbers: '' })),
    amount: s.spent,
    ...(dream ? { dream } : {}),
  }]
}

function categoryPct(t: Tripwire, { ctx, s, f }: EvalInput): Firing[] {
  if (!t.category) return []
  const row = s.byCategory.find((r) => r.category === t.category)
  const limit = row?.limit ?? ctx.budget?.categories.find((c) => c.category === t.category)?.limit
  const spent = row?.spent ?? 0
  if (!limit || limit <= 0 || spent < (limit * t.threshold) / 100) return []
  const label = CATEGORIES[t.category].label
  const dream = goalEquivalent(spent, ctx.dreams)
  const pct = Math.round((spent / limit) * 100)
  return [{
    key: s.month,
    title: byTone(ctx.profile.tone, {
      gentle: `${label} is at ${pct}% of its budget`,
      cheeky: `${label} is ${pct}% through its budget`,
      numbers: `${label}: ${pct}% of budget`,
    }),
    message: join(`${f(spent)} of your ${f(limit)} ${label.toLowerCase()} budget so far.`, dreamLine(dream, spent, f)),
    amount: spent,
    ...(dream ? { dream } : {}),
  }]
}

function singleOver(t: Tripwire, { ctx, f, fx, newTxns }: EvalInput): Firing[] {
  const tone = ctx.profile.tone
  return newTxns
    .filter((x) => isSpending(x) && -x.amount >= t.threshold)
    .map((x) => {
      const amount = -x.amount
      const dream = goalEquivalent(amount, ctx.dreams)
      const hours = hoursOfWork(amount, ctx.profile)
      return {
        key: x.id,
        txnId: x.id,
        title: byTone(tone, {
          gentle: `Big purchase: ${fx(amount)} at ${x.merchant}`,
          cheeky: `Whoa, ${fx(amount)} at ${x.merchant}`,
          numbers: `Purchase over ${f(t.threshold)}: ${fx(amount)}`,
        }),
        message: join(
          dreamLine(dream, amount, fx),
          byTone(tone, {
            gentle: `Still worth it? It's your call.`,
            cheeky: 'Hope it sparks joy!',
            numbers: hours > 0 ? `${hours} hours of work.` : '',
          }),
        ),
        amount,
        ...(dream ? { dream } : {}),
      }
    })
}

function dailyTotals(txns: Transaction[], dates: Set<ISODate>): Map<ISODate, Minor> {
  const out = new Map<ISODate, Minor>()
  for (const t of txns) if (dates.has(t.date) && isSpending(t)) out.set(t.date, (out.get(t.date) ?? 0) - t.amount)
  return out
}

function dailyOver(t: Tripwire, { ctx, f, txns, newTxns }: EvalInput): Firing[] {
  const dates = new Set(newTxns.length > 0 ? newTxns.map((x) => x.date) : [ctx.bank.today])
  const out: Firing[] = []
  for (const [date, total] of [...dailyTotals(txns, dates)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (total <= t.threshold) continue
    const dream = goalEquivalent(total, ctx.dreams)
    out.push({
      key: date,
      title: byTone(ctx.profile.tone, {
        gentle: `Busy spending day: ${f(total)}`,
        cheeky: `${f(total)} in one day — big day!`,
        numbers: `Daily spend ${f(total)} > ${f(t.threshold)}`,
      }),
      message: join(`You've spent ${f(total)} today, above your ${f(t.threshold)} daily line.`, dreamLine(dream, total, f)),
      amount: total,
      ...(dream ? { dream } : {}),
    })
  }
  return out
}

function paceOver(t: Tripwire, { ctx, s, f }: EvalInput): Firing[] {
  if (!s.isCurrent || s.dayOfMonth < PACE_FROM_DAY || s.target <= 0) return []
  if (s.projected <= (s.target * t.threshold) / 100) return []
  const over = Math.max(0, s.projected - s.target)
  const dream = goalEquivalent(over, ctx.dreams)
  return [{
    key: s.month,
    title: byTone(ctx.profile.tone, {
      gentle: `Heads up: on pace for ${f(s.projected)}`,
      cheeky: `Careful — this pace has a price`,
      numbers: `Projected ${f(s.projected)} vs ${f(s.target)} target`,
    }),
    message: join(
      `At this pace you'll end the month around ${f(s.projected)}${over > 0 ? `, ${f(over)} over your ${f(s.target)} target` : ''}.`,
      dream && over > 0 ? `That's ${dream.label}.` : '',
    ),
    amount: s.projected,
    ...(dream && over > 0 ? { dream } : {}),
  }]
}

function loudestMonthPct(tripwires: Tripwire[], firings: Map<string, Firing[]>): string | undefined {
  const firing = tripwires.filter((t) => t.kind === 'month_pct' && (firings.get(t.id)?.length ?? 0) > 0)
  return firing.sort((a, b) => b.threshold - a.threshold)[0]?.id
}

const EVALUATORS: Record<Tripwire['kind'], (t: Tripwire, input: EvalInput) => Firing[]> = {
  month_pct: monthPct,
  category_pct: categoryPct,
  single_over: singleOver,
  daily_over: dailyOver,
  pace_over: paceOver,
}

function mergeTxns(existing: Transaction[], extra: Transaction[]): Transaction[] {
  const ids = new Set(existing.map((t) => t.id))
  return [...existing, ...extra.filter((t) => !ids.has(t.id))]
}

/**
 * Evaluate all enabled tripwires against the current state (and the newly added transactions, for
 * single_over / daily_over). Each tripwire fires at most once per dedupe key (month for *_pct/pace,
 * txn id for single_over, date for daily_over) — returns updated tripwires with lastFiredKey set.
 * Every event message is tangible: includes a DreamEquivalent ("…that's 12% of your Birkin") using the
 * tone in ctx.profile.tone.
 *
 * Event ids are deterministic (`twe_<tripwireId>_<key>`), so a replayed evaluation is easy to dedupe.
 * daily_over checks the days touched by `newTxns` (today when none are given).
 */
export function evaluateTripwires(
  ctx: FinanceContext,
  opts: { newTxns?: Transaction[]; now: ISODateTime },
): { events: TripwireEvent[]; tripwires: Tripwire[] } {
  const newTxns = (opts.newTxns ?? []).filter((t) => t.date <= ctx.bank.today)
  const txns = upTo(mergeTxns(ctx.bank.transactions, newTxns), ctx.bank.today)
  const evalCtx: FinanceContext = { ...ctx, bank: { ...ctx.bank, transactions: txns } }
  const input: EvalInput = { ctx: evalCtx, s: summarizeMonth(evalCtx), f: copyFmt(ctx.profile.currency), fx: moneyFmt(ctx.profile.currency), txns, newTxns }
  const firings = new Map(ctx.tripwires.map((t) => [t.id, t.enabled ? EVALUATORS[t.kind](t, input).filter((x) => x.key !== t.lastFiredKey) : []]))
  const loudest = loudestMonthPct(ctx.tripwires, firings)
  const events: TripwireEvent[] = []
  const tripwires = ctx.tripwires.map((t) => {
    const fresh = firings.get(t.id) ?? []
    if (fresh.length === 0) return t
    // crossing 80% and 100% in one go is one message, not two; the quieter one is still marked as fired
    const silent = t.kind === 'month_pct' && loudest !== undefined && loudest !== t.id
    for (const x of silent ? [] : fresh) {
      events.push({
        id: `twe_${t.id}_${x.key}`,
        tripwireId: t.id,
        firedAt: opts.now,
        ...(x.txnId ? { txnId: x.txnId } : {}),
        title: x.title,
        message: x.message,
        ...(x.amount !== undefined ? { amount: x.amount } : {}),
        ...(x.dream ? { dream: x.dream } : {}),
        seen: false,
      })
    }
    return { ...t, lastFiredKey: fresh[fresh.length - 1].key }
  })
  return { events, tripwires }
}
