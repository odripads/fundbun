import type { ChatCard } from '../../../core/types'
import { ActionCard } from './ActionCard'
import { AffordabilityCard, GoalsCard, MirrorCard } from './cards/DreamCards'
import { FindingsCard, InsightsCard } from './cards/FindingCards'
import { ClarifyCard, NoticeCard, XrayCard } from './cards/SafetyCards'
import { useSend, type ChatCardContext } from './cards/shared'
import { BreakdownCard, BudgetCard, RecurringCard, TransactionsCard } from './cards/SpendingCards'
import { PlanCard } from './PlanCard'

export type { ChatCardContext } from './cards/shared'

export interface ChatCardViewProps {
  card: ChatCard
  /** how the card sits in the conversation (optional: cards also render standalone, e.g. in the glass box) */
  context?: ChatCardContext
}

const EMPTY: ChatCardContext = {}

/** Renders any ChatCard type from structured data (never from model prose). */
export function ChatCardView({ card, context = EMPTY }: ChatCardViewProps) {
  switch (card.type) {
    case 'mirror': return <MirrorCard card={card} context={context} />
    case 'breakdown': return <BreakdownCard card={card} context={context} />
    case 'transactions': return <TransactionsCard card={card} context={context} />
    case 'findings': return <FindingsCard card={card} context={context} />
    case 'recurring': return <RecurringCard card={card} context={context} />
    case 'insights': return <InsightsCard card={card} context={context} />
    case 'affordability': return <AffordabilityCard card={card} context={context} />
    case 'goals': return <GoalsCard card={card} context={context} />
    case 'budget': return <BudgetCard card={card} context={context} />
    case 'xray': return <XrayCard card={card} context={context} />
    case 'action': return <ActionCard pendingId={card.pendingId} variant={context.actionMode === 'receipt' ? 'receipt' : 'card'} />
    case 'plan': return <PlanWithStop planId={card.planId} context={context} />
    case 'clarify': return <ClarifyCard card={card} context={context} />
    case 'notice': return <NoticeCard card={card} context={context} />
    default: return null
  }
}

function PlanWithStop({ planId, context }: { planId: string; context: ChatCardContext }) {
  const send = useSend(context)
  return <PlanCard planId={planId} onStop={() => send('stop')} />
}
