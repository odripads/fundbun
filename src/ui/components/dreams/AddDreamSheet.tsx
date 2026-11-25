import type { AppSnapshot, DreamInput } from '../../../core/app-api'
import { useApp, useSafeAction, useSnapshot } from '../../state'
import { DreamImage } from '../brand'
import { Sheet, useToast } from '../ds'
import { DreamEditor } from './DreamEditor'

export interface AddDreamSheetProps {
  open: boolean
  onClose: () => void
}

const selectSheet = (s: AppSnapshot) => ({
  currency: s.state.profile?.currency ?? ('CNY' as const),
  today: s.derived.today,
  tracking: s.state.profile?.mode === 'tracking',
})

/**
 * Reusable sheet to add a goal or treat from Home, Dashboard, or the Mirror hero,
 * in either Daily tracking mode or Goal & Mirror mode.
 */
export function AddDreamSheet({ open, onClose }: AddDreamSheetProps) {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { currency, today, tracking } = useSnapshot(selectSheet)

  async function save(input: DreamInput) {
    const added = await run(() => app.addDream(input), { errorTitle: 'Couldn’t add that goal' })
    if (!added) return
    onClose()
    if (tracking) {
      toast.show({
        tone: 'success',
        title: `${added.name} added to your goals`,
        message: 'Saved to your goals. Switch on Goal & Mirror anytime to see it in the Dream Mirror.',
        image: <DreamImage image={added.image} alt="" size={48} />,
        actions: [{ label: 'Turn on Dream Mirror', onClick: () => void app.setProfile({ mode: 'target' }) }],
      })
      return
    }
    toast.show({
      tone: 'success',
      title: `${added.name} is on your list`,
      message: added.kind === 'goal' ? 'It has its own pot. Add to it whenever you like.' : 'A guilt-free treat for a month with money left over.',
      image: <DreamImage image={added.image} alt="" size={48} />,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title="Add a goal or dream"
      description="Something to save toward, or a small treat. Photos stay on this device."
    >
      {open ? (
        <DreamEditor
          currency={currency}
          today={today}
          submitLabel="Add to my goals"
          onSubmit={save}
          onCancel={onClose}
        />
      ) : null}
    </Sheet>
  )
}
