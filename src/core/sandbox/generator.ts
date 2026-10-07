import type { BankState, ISODate, Transaction } from '../types'
import type { PersonaDef } from './personas'

/**
 * Deterministically generate ~6 months of history ending at `today` for a persona: salary on payday,
 * rent, utilities (seasonal), phone/internet, subscriptions (with one mid-history price hike), groceries,
 * delivery (Meituan/Ele.me, incl. late-night), milk tea/coffee (Heytea, Luckin, Mixue, Starbucks), DiDi /
 * metro, Taobao/JD/Pinduoduo shopping, entertainment, occasional big purchases, monthly goal-pot
 * contributions. Uses src/core/rng.ts with `seed`. Transactions sorted ascending, categorised with
 * finance/categorize.categorize. Accounts: checking + one pot per goal (pot ids `pot_<goalId>`).
 */
export function generateHistory(persona: PersonaDef, today: ISODate, seed: number): BankState {
  throw new Error('TODO generateHistory ' + persona.id + today + seed)
}

/** Generate the organic transactions for a single new day (used when the sandbox clock advances). */
export function generateDay(bank: BankState, date: ISODate): Transaction[] {
  throw new Error('TODO generateDay ' + bank.today + date)
}
