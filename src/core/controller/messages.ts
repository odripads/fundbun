import { toolTier } from '../agent/specs'
import { uid } from '../ids'
import type { ChatMessage, ISODateTime, PendingAction, Profile, SuggestedAction, ToolCall } from '../types'

export const WELCOME_SUGGESTIONS = [
  'How am I doing this month?',
  'Where did my money go?',
  'Check my bills',
  'Any insights for me?',
]

export function welcomeMessage(profile: Profile, ts: ISODateTime): ChatMessage {
  const first = profile.name.trim().split(/\s+/)[0] || 'there'
  return {
    id: uid('msg'),
    role: 'assistant',
    ts,
    engine: 'offline',
    text:
      `Hi ${first}! I'm Bun, your money buddy. I can explain your spending, check your bills and turn your ` +
      'dreams into a plan. I only move money between your own pots when you say so, never anywhere else. ' +
      'What should we look at first?',
    suggestions: WELCOME_SUGGESTIONS,
  }
}

export function assistantMessage(text: string, ts: ISODateTime, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: uid('msg'), role: 'assistant', text, ts, engine: 'offline', ...extra }
}

export function userMessage(text: string, ts: ISODateTime): ChatMessage {
  return { id: uid('msg'), role: 'user', text, ts }
}

/** Shown when an agent turn throws: nothing was executed, the user can retry. */
export function turnErrorMessage(detail: string, ts: ISODateTime): ChatMessage {
  return assistantMessage('Sorry, something went wrong on my side and I didn\'t take any action. Please try again.', ts, {
    cards: [{ type: 'notice', level: 'warn', title: 'Bun hit a snag', text: detail }],
    trace: [{ kind: 'error', label: 'Agent turn failed', detail, ts }],
    suggestions: ['How am I doing this month?'],
  })
}

/** A denied, never-stored PendingAction for when the agent runtime cannot evaluate a UI action. */
export function unavailablePending(
  action: SuggestedAction,
  proposedBy: ToolCall['proposedBy'],
  reason: string,
  ts: ISODateTime,
): PendingAction {
  return {
    id: uid('pa'),
    call: { id: uid('call'), tool: action.tool, args: action.args, proposedBy },
    decision: { decision: 'deny', tier: toolTier(action.tool), reasons: [reason], ruleIds: ['P-ENGINE-UNAVAILABLE'], tainted: false },
    preview: { title: action.label, summary: reason, reversible: false, risk: 'low', effects: [] },
    createdAt: ts,
    expiresAt: ts,
    status: 'denied',
    error: reason,
    bindingHash: '',
  }
}
