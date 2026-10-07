import type { Tone } from '../types'
import type { Intent } from './nlu'

/**
 * Bun's voice for the offline engine. Reply templates per intent × tone. Templates may only interpolate
 * numbers that come from tool results (so offline replies are grounded by construction).
 * `facts` are pre-formatted strings produced from tool results by the runtime.
 */
export function composeReply(intent: Intent, facts: Record<string, string>, tone: Tone): string {
  throw new Error('TODO composeReply ' + intent + Object.keys(facts).length + tone)
}

/** Quick-reply suggestion chips to show after a reply for the given intent. */
export function suggestionsFor(intent: Intent): string[] {
  throw new Error('TODO suggestionsFor ' + intent)
}

/** Standard refusals: external transfers, new payees, investment advice, credit, permission changes. */
export function refusal(intent: Intent, tone: Tone): { title: string; text: string } {
  throw new Error('TODO refusal ' + intent + tone)
}
