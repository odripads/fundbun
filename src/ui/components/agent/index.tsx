/**
 * Agent action components shared by every screen.
 * MINIMAL WORKING VERSION — the chat/agent UI engineer owns this folder and replaces the internals.
 * The exported names and signatures are the contract other screens rely on:
 *   const propose = useProposeAction(); await propose(suggestedAction)
 *   <ActionCard pendingId=… />   <ChatCardView card=… />   <ApprovalHost /> (mounted once by App)
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { ChatCard, PendingAction, SuggestedAction } from '../../../core/types'
import { fmt } from '../../../core/money'
import { useApp, useSnapshot } from '../../state'
import { useToast } from '../ds/Toast'
import { Button, Card, PinPad, Sheet } from '../ds'

// ── a tiny global store: which pending action the approval sheet shows ──
let openId: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export function openApproval(pendingId: string) {
  openId = pendingId
  emit()
}
export function closeApproval() {
  openId = null
  emit()
}
function useOpenId() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => openId,
  )
}

/**
 * Route a UI button (a SuggestedAction from a finding / insight / mirror CTA) through the agent's policy gate.
 * Opens the approval sheet when it needs a tap or PIN, toasts when it ran or was denied.
 */
export function useProposeAction() {
  const app = useApp()
  const toast = useToast()
  return useCallback(
    async (action: SuggestedAction): Promise<PendingAction | undefined> => {
      try {
        const p = await app.runSuggestedAction(action)
        if (p.status === 'pending') openApproval(p.id)
        else if (p.status === 'executed') toast.show({ tone: 'success', title: p.preview.title, message: 'Done.' })
        else toast.show({ tone: 'danger', title: 'Bun can’t do that', message: p.decision.reasons[0] ?? p.error ?? 'Blocked by your safety settings.' })
        return p
      } catch (e) {
        toast.show({ tone: 'danger', title: 'That didn’t work', message: String((e as Error).message ?? e) })
        return undefined
      }
    },
    [app, toast],
  )
}

export interface ActionCardProps {
  pendingId: string
  compact?: boolean
}

/** Structured confirmation card for a PendingAction (built from preview data, never LLM prose). */
export function ActionCard({ pendingId }: ActionCardProps) {
  const p = useSnapshot((s) => s.state.pending.find((x) => x.id === pendingId))
  const currency = useSnapshot((s) => s.state.profile?.currency ?? 'CNY')
  if (!p) return null
  return (
    <Card>
      <strong>{p.preview.title}</strong>
      <p>{p.preview.summary}</p>
      {p.preview.amount !== undefined ? <p>{fmt(p.preview.amount, currency)}</p> : null}
      <p>Status: {p.status}</p>
      {p.status === 'pending' ? (
        <Button size="sm" onClick={() => openApproval(p.id)}>
          Review
        </Button>
      ) : null}
    </Card>
  )
}

export interface ChatCardViewProps {
  card: ChatCard
}

/** Renders any ChatCard type. */
export function ChatCardView({ card }: ChatCardViewProps) {
  if (card.type === 'action') return <ActionCard pendingId={card.pendingId} />
  if (card.type === 'notice') return <Card>{card.title}: {card.text}</Card>
  return <Card>{card.type}</Card>
}

/** The single approval sheet (tap to approve; PIN for step_up). Mounted once inside the app frame. */
export function ApprovalHost() {
  const id = useOpenId()
  const app = useApp()
  const toast = useToast()
  const p = useSnapshot((s) => (id ? s.state.pending.find((x) => x.id === id) : undefined))
  const open = Boolean(id && p && p.status === 'pending')
  const needsPin = p?.decision.decision === 'step_up'
  const approve = async (pin?: string) => {
    if (!p) return
    const r = await app.approveAction(p.id, pin)
    if (r.ok) {
      closeApproval()
      toast.show({ tone: 'success', title: p.preview.title, message: 'Done.' })
    } else toast.show({ tone: 'danger', title: 'Not approved', message: r.error })
  }
  return (
    <Sheet open={open} onClose={closeApproval} title={p?.preview.title ?? 'Review'}>
      {p ? (
        <div>
          <p>{p.preview.summary}</p>
          {needsPin ? (
            <PinPad minLength={4} maxLength={6} label="Enter your PIN" onComplete={(pin: string) => approve(pin)} />
          ) : (
            <Button onClick={() => approve()}>Approve</Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              app.rejectAction(p.id)
              closeApproval()
            }}
          >
            Not now
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}
