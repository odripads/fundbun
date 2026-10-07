import type { Currency, FinanceContext, ISODateTime, Profile, Transaction, Tripwire, TripwireEvent } from '../types'

/** Sensible defaults: month_pct 80, month_pct 100, single_over = 10% of target, pace_over 110. */
export function defaultTripwires(profile: Profile): Tripwire[] {
  throw new Error('TODO defaultTripwires ' + profile.name)
}

/**
 * Evaluate all enabled tripwires against the current state (and the newly added transactions, for
 * single_over / daily_over). Each tripwire fires at most once per dedupe key (month for *_pct/pace,
 * txn id for single_over, date for daily_over) — returns updated tripwires with lastFiredKey set.
 * Every event message is tangible: includes a DreamEquivalent ("…that's 12% of your Birkin") using the
 * tone in ctx.profile.tone.
 */
export function evaluateTripwires(
  ctx: FinanceContext,
  opts: { newTxns?: Transaction[]; now: ISODateTime },
): { events: TripwireEvent[]; tripwires: Tripwire[] } {
  throw new Error('TODO evaluateTripwires ' + ctx.profile.name + opts.now)
}

/** "Alert me at 80% of my monthly target" */
export function describeTripwire(t: Tripwire, currency: Currency): string {
  throw new Error('TODO describeTripwire ' + t.id + currency)
}
