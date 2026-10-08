import { MessageCircle, ShieldX } from 'lucide-react'
import { useCallback } from 'react'
import type { PendingAction, SuggestedAction } from '../../../core/types'
import { navigate } from '../../router'
import { errorText, useApp } from '../../state'
import { useToast } from '../ds/Toast'
import { openApproval } from './approvalStore'
import { announceExecuted } from './hooks'

/**
 * Route a UI button (a SuggestedAction from a finding / insight / mirror CTA) through the agent's policy gate —
 * the same gate the agent uses. Needs a tap or PIN → the approval sheet opens; ran → a toast with Undo;
 * blocked → a toast with the policy's reason. Read-only buttons answer in the chat.
 */
export function useProposeAction() {
  const app = useApp()
  const toast = useToast()
  return useCallback(
    async (action: SuggestedAction): Promise<PendingAction | undefined> => {
      try {
        const p = await app.runSuggestedAction(action)
        if (p.status === 'pending') {
          openApproval(p.id)
        } else if (p.status === 'executed') {
          if (p.decision.tier === 0) {
            toast.show({
              tone: 'ai',
              title: 'Bun has the answer',
              message: `${action.label} — it’s waiting in the chat.`,
              actions: [{ label: 'Open chat', variant: 'primary', onClick: () => navigate('chat') }],
              icon: <MessageCircle />,
            })
          } else {
            announceExecuted(app, toast, p)
          }
        } else if (p.status === 'denied') {
          toast.show({
            tone: 'danger',
            icon: <ShieldX />,
            title: 'Bun can’t do that',
            message: p.decision.reasons[0] ?? p.error ?? 'Blocked by your safety settings.',
          })
        } else {
          toast.show({ tone: 'danger', title: 'That didn’t work', message: p.error ?? 'Nothing was changed. Please try again.' })
        }
        return p
      } catch (e) {
        toast.show({ tone: 'danger', title: 'That didn’t work', message: `${errorText(e)} Nothing was changed.` })
        return undefined
      }
    },
    [app, toast],
  )
}
