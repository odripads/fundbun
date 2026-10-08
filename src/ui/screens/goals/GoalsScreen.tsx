import { Plus, Trash2, TrendingUp, Trophy } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { AppSnapshot, DreamInput } from '../../../core/app-api'
import type { Currency, DreamItem } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { DreamEditor } from '../../components/dreams'
import { Button, Dialog, EmptyState, Money, Sheet, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import { AddMoneySheet } from './AddMoneySheet'
import { Celebration } from './Celebration'
import { AchievedCard, GoalCard, TreatCard } from './DreamCard'
import { celebrationCopy, countsLine, fmtWhole, groupDreams, totalInPots, type Celebration as CelebrationCopy, type DreamRow } from './model'
import styles from './Goals.module.css'

const selectGoals = (s: AppSnapshot) => ({
  dreams: s.state.dreams,
  goals: s.derived.goals,
  accounts: s.state.bank.accounts,
  profile: s.state.profile,
  savedThisMonth: s.derived.summary?.savedToGoals ?? 0,
})

type Editing = { mode: 'add' } | { mode: 'edit'; item: DreamItem }

/** Goals — the dream list (goals, then treats, then achieved), with pots, pace and ETA. */
export function GoalsScreen() {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { dreams, goals, accounts, profile, savedThisMonth } = useSnapshot(selectGoals, shallowEqual)
  const currency = profile?.currency ?? 'CNY'
  const tone = profile?.tone ?? 'gentle'
  const groups = groupDreams(dreams, goals)
  const total = totalInPots(accounts)
  const summaryId = useId()
  const goalsId = useId()
  const treatsId = useId()
  const achievedId = useId()

  const [adding, setAdding] = useState<DreamRow | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmAchieve, setConfirmAchieve] = useState<DreamRow | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<DreamItem | null>(null)
  const [celebrate, setCelebrate] = useState<{ item: DreamItem; copy: CelebrationCopy } | null>(null)

  function openEditor(next: Editing) {
    setEditing(next)
    setEditOpen(true)
  }

  async function save(input: DreamInput) {
    if (editing?.mode === 'edit') {
      const r = await run(() => app.updateDream(editing.item.id, input), { errorTitle: 'Couldn’t save that' })
      if (r?.ok) {
        setEditOpen(false)
        toast.show({ tone: 'success', title: `${input.name} updated`, image: <DreamImage image={input.image} alt="" size={48} /> })
      }
      return
    }
    const added = await run(() => app.addDream(input), { errorTitle: 'Couldn’t add that dream' })
    if (added) {
      setEditOpen(false)
      toast.show({
        tone: 'success',
        title: `${added.name} is on your list`,
        message: added.kind === 'goal' ? 'It has its own pot — add to it whenever you like.' : 'A guilt-free treat for an under-target month.',
        image: <DreamImage image={added.image} alt="" size={48} />,
      })
    }
  }

  async function achieve(row: DreamRow) {
    setConfirmAchieve(null)
    const r = await run(() => app.markDreamAchieved(row.item.id), { errorTitle: 'Couldn’t mark it achieved' })
    if (r?.ok) setCelebrate({ item: row.item, copy: celebrationCopy(row.item, row.progress?.saved ?? 0, tone, currency) })
  }

  async function remove(item: DreamItem) {
    setConfirmRemove(null)
    setEditOpen(false)
    const r = await run(() => app.removeDream(item.id), { errorTitle: 'Couldn’t remove it' })
    if (r?.ok) toast.show({ tone: 'neutral', title: `${item.name} removed`, message: item.potAccountId ? 'Its pot balance went back to checking.' : undefined })
  }

  const editItem = editing?.mode === 'edit' ? editing.item : null
  const editRow = editItem ? [...groups.goals, ...groups.treats, ...groups.achieved].find((r) => r.item.id === editItem.id) : undefined
  const removeBalance = confirmRemove ? (goals.find((g) => g.itemId === confirmRemove.id)?.saved ?? 0) : 0

  if (dreams.length === 0) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="What are you dreaming of?"
          body="Add a goal to save toward — a trip, a laptop, a bag — or a small treat for an under-target month. Bun will mirror your spending in it."
          mood="happy"
          action={<Button iconStart={<Plus />} onClick={() => openEditor({ mode: 'add' })}>Add your first dream</Button>}
        />
        <EditorSheet open={editOpen} editing={editing} currency={currency} onClose={() => setEditOpen(false)} onSave={save} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <section className={styles.summary} aria-labelledby={summaryId}>
        <span className={styles.summaryGlow} aria-hidden="true" />
        <div className={styles.summaryText}>
          <h2 id={summaryId} className={styles.eyebrow}>Saved across your pots</h2>
          <Money amount={total} currency={currency} size="hero" decimals={false} className={styles.total} />
          <p className={styles.summaryMeta}>
            {savedThisMonth > 0 ? (
              <span className={styles.up}><TrendingUp aria-hidden="true" />{fmtWhole(savedThisMonth, currency)} stashed this month</span>
            ) : (
              <span>Nothing stashed yet this month</span>
            )}
            <span>{countsLine(groups)}</span>
          </p>
        </div>
        <span className={styles.summaryBun} aria-hidden="true">
          <BunMascot mood={savedThisMonth > 0 ? 'happy' : 'calm'} size={76} />
        </span>
        <div className={styles.summaryFoot}>
          <ul className={styles.stack} aria-hidden="true">
            {[...groups.goals, ...groups.treats].slice(0, 5).map((r, i) => (
              <li key={r.item.id} style={{ zIndex: 10 - i }}>
                <DreamImage image={r.item.image} alt="" size={36} />
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" iconStart={<Plus />} onClick={() => openEditor({ mode: 'add' })} className={styles.addDream}>
            Add a dream
          </Button>
        </div>
      </section>

      {groups.goals.length > 0 ? (
        <section className={styles.section} aria-labelledby={goalsId}>
          <div className={styles.sectionHead}>
            <h2 id={goalsId} className={styles.sectionTitle}>Saving toward</h2>
            <p className={styles.sectionNote}>Each goal has its own pot. You move the money — Bun only suggests.</p>
          </div>
          <div className={styles.list}>
            {groups.goals.map((row, i) => (
              <GoalCard
                key={row.item.id}
                row={row}
                currency={currency}
                profile={profile}
                index={i}
                onAdd={() => setAdding(row)}
                onAchieve={() => setConfirmAchieve(row)}
                onEdit={() => openEditor({ mode: 'edit', item: row.item })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {groups.treats.length > 0 ? (
        <section className={styles.section} aria-labelledby={treatsId}>
          <div className={styles.sectionHead}>
            <h2 id={treatsId} className={styles.sectionTitle}>Treats</h2>
            <p className={styles.sectionNote}>Guilt-free rewards for months you finish under target — your call, never a nudge.</p>
          </div>
          <div className={styles.list}>
            {groups.treats.map((row, i) => (
              <TreatCard
                key={row.item.id}
                row={row}
                currency={currency}
                profile={profile}
                index={i}
                onAchieve={() => setConfirmAchieve(row)}
                onEdit={() => openEditor({ mode: 'edit', item: row.item })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {groups.achieved.length > 0 ? (
        <section className={styles.section} aria-labelledby={achievedId}>
          <div className={styles.sectionHead}>
            <h2 id={achievedId} className={styles.sectionTitle}>
              <Trophy aria-hidden="true" className={styles.trophyIcon} />
              Achieved
            </h2>
          </div>
          <ul className={styles.shelf} role="list">
            {groups.achieved.map((row) => (
              <AchievedCard key={row.item.id} row={row} currency={currency} onEdit={() => openEditor({ mode: 'edit', item: row.item })} />
            ))}
          </ul>
        </section>
      ) : null}

      <AddMoneySheet item={adding?.item ?? null} progress={adding?.progress} onClose={() => setAdding(null)} />

      <EditorSheet
        open={editOpen}
        editing={editing}
        currency={currency}
        onClose={() => setEditOpen(false)}
        onSave={save}
        extra={
          editItem ? (
            <div className={styles.editExtra}>
              {!editItem.achievedAt && editRow ? (
                <Button variant="secondary" fullWidth onClick={() => { setEditOpen(false); setConfirmAchieve(editRow) }}>
                  {editItem.kind === 'goal' ? 'Mark as achieved' : 'Mark as enjoyed'}
                </Button>
              ) : null}
              <Button variant="ghost" fullWidth iconStart={<Trash2 />} className={styles.removeBtn} onClick={() => setConfirmRemove(editItem)}>
                Remove from my dreams
              </Button>
            </div>
          ) : null
        }
      />

      <Dialog
        open={Boolean(confirmAchieve)}
        onClose={() => setConfirmAchieve(null)}
        title={confirmAchieve ? (confirmAchieve.item.kind === 'goal' ? `Mark ${confirmAchieve.item.name} as achieved?` : `Enjoyed ${confirmAchieve.item.name}?`) : ''}
        description={
          confirmAchieve?.item.kind === 'goal'
            ? `It moves to your Achieved shelf and stops counting as an open goal.${(confirmAchieve.progress?.saved ?? 0) > 0 ? ` Its pot keeps its ${fmtWhole(confirmAchieve.progress?.saved ?? 0, currency)}.` : ''}`
            : 'It moves to your Achieved shelf. This can’t be undone.'
        }
        media={confirmAchieve ? <DreamImage image={confirmAchieve.item.image} alt="" size={72} /> : null}
        actions={
          <>
            <Button onClick={() => confirmAchieve && void achieve(confirmAchieve)}>{confirmAchieve?.item.kind === 'goal' ? 'Mark achieved' : 'Mark enjoyed'}</Button>
            <Button variant="ghost" onClick={() => setConfirmAchieve(null)}>Not yet</Button>
          </>
        }
      />

      <Dialog
        open={Boolean(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
        alert
        tone="danger"
        title={confirmRemove ? `Remove ${confirmRemove.name}?` : ''}
        description={removeBalance > 0 ? `Its pot balance (${fmtWhole(removeBalance, currency)}) goes back to your checking account.` : 'It disappears from your dreams and the mirror.'}
        actions={
          <>
            <Button variant="danger" iconStart={<Trash2 />} onClick={() => confirmRemove && void remove(confirmRemove)}>Remove dream</Button>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>Keep it</Button>
          </>
        }
      />

      <Celebration item={celebrate?.item ?? null} copy={celebrate?.copy ?? null} onClose={() => setCelebrate(null)} />
    </div>
  )
}

interface EditorSheetProps {
  open: boolean
  editing: Editing | null
  currency: Currency
  onClose: () => void
  onSave: (input: DreamInput) => void
  extra?: ReactNode
}

function EditorSheet({ open, editing, currency, onClose, onSave, extra }: EditorSheetProps) {
  const item = editing?.mode === 'edit' ? editing.item : null
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title={item ? `Edit ${item.name}` : 'Add a dream'}
      description={item ? 'Change the name, price or picture. Photos stay on this device.' : 'Something to save toward, or a small treat. Photos stay on this device.'}
    >
      {editing ? (
        <div className={styles.editor}>
          <DreamEditor
            key={item?.id ?? 'new'}
            currency={currency}
            initial={item ? { name: item.name, price: item.price, image: item.image, kind: item.kind, note: item.note } : undefined}
            submitLabel={item ? 'Save changes' : 'Add to my dreams'}
            onSubmit={onSave}
            onCancel={onClose}
          />
          {extra}
        </div>
      ) : null}
    </Sheet>
  )
}
