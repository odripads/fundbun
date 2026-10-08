/**
 * Agent action components shared by every screen. The exported names and signatures are the contract other
 * screens rely on:
 *   const propose = useProposeAction(); await propose(suggestedAction)
 *   <ActionCard pendingId=… />   <ChatCardView card=… />   <ApprovalHost /> (mounted once by App)
 * Every action button goes through the policy engine (app.runSuggestedAction / approveAction) — never around it.
 */
export { ActionCard, type ActionCardProps } from './ActionCard'
export { ApprovalHost } from './ApprovalHost'
export { closeApproval, openApproval, useApprovalTarget } from './approvalStore'
export { ChatCardView, type ChatCardContext, type ChatCardViewProps } from './ChatCardView'
export { Disclosure, type DisclosureProps } from './Disclosure'
export { announceExecuted, undoWithToast, useApprovalFlow, useNow, type ApprovalFlow } from './hooks'
export { PlanCard, type PlanCardProps } from './PlanCard'
export { useProposeAction } from './useProposeAction'
