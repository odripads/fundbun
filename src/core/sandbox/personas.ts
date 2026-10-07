import type { BankState, BudgetPlan, Currency, DreamItem, ISODate, Minor, Profile, Tripwire } from '../types'

export interface PersonaDef {
  id: string
  /** display name, e.g. "Mei" */
  name: string
  /** one line, e.g. "24 · UX designer in Shenzhen" */
  tagline: string
  city: string
  currency: Currency
  monthlyIncome: Minor
  targetSpend: Minor
  payday: number
  /** short description of the story this persona demonstrates */
  story: string
}

export interface PersonaBundle {
  profile: Profile
  bank: BankState
  dreams: DreamItem[]
  budget: BudgetPlan
  tripwires: Tripwire[]
}

/**
 * Built-in sandbox personas. Must include:
 *  - 'mei'  — young professional in Shenzhen (CNY). Current month is OVER target (overspend lands on a
 *             recognisable dream item; long-term goal "Birkin 25"). Has a subscription price hike, a duplicate
 *             charge, an electricity bill spike, overlapping video subscriptions, late-night delivery habit,
 *             a bill whose rawText contains a prompt-injection attempt, and upcoming bills with verified payees.
 *  - 'arif' — international student (e.g. Indonesian studying in Shenzhen or abroad) who is UNDER target this
 *             month (positive mirror: "that's new shoes, guilt-free" / "closer to your laptop").
 */
export const PERSONAS: PersonaDef[] = []

/** Build a complete, deterministic persona bundle for the given sandbox date. */
export function loadPersona(id: string, today: ISODate, seed = 20261020): PersonaBundle {
  throw new Error('TODO loadPersona ' + id + today + seed)
}
