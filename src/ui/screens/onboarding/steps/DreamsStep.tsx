import { CircleAlert, Gift, Plus, Star, Target, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DreamInput } from '../../../../core/app-api'
import { uid } from '../../../../core/ids'
import { DreamImage } from '../../../components/brand'
import { DreamEditor, KIND_COPY } from '../../../components/dreams'
import { Badge, Button, cx, IconButton, Money, useToast } from '../../../components/ds'
import type { DreamDraft } from '../draft'
import type { StepProps } from '../OnboardingScreen'
import d from './DreamsStep.module.css'
import s from './Steps.module.css'

/** The wishlist: at least one item. The first goal becomes the main goal the Mirror measures against. */
export function DreamsStep({ draft, update, errors, setBusy }: StepProps) {
  const toast = useToast()
  const [editorKey, setEditorKey] = useState(0)
  const [adding, setAdding] = useState(draft.dreams.length === 0)
  const list = draft.dreams
  const mainKey = list.find((x) => x.kind === 'goal')?.key

  // while the editor is open, "Add to my list" is the one primary action on screen
  useEffect(() => {
    setBusy?.(adding)
    return () => setBusy?.(false)
  }, [adding, setBusy])

  function add(input: DreamInput) {
    update((dr) => ({ ...dr, dreams: [...dr.dreams, { ...input, key: uid('dream') }] }))
    setEditorKey((k) => k + 1)
    setAdding(false)
  }

  function remove(item: DreamDraft) {
    const index = list.findIndex((x) => x.key === item.key)
    update((dr) => ({ ...dr, dreams: dr.dreams.filter((x) => x.key !== item.key) }))
    if (list.length === 1) setAdding(true)
    toast.show({
      id: 'ob-dream-removed',
      title: `Removed ${item.name}`,
      image: <DreamImage image={item.image} alt="" size={44} />,
      actions: [
        {
          label: 'Undo',
          onClick: () => {
            update((dr) => {
              if (dr.dreams.some((x) => x.key === item.key)) return dr
              const next = [...dr.dreams]
              next.splice(Math.min(index, next.length), 0, item)
              return { ...dr, dreams: next }
            })
            setAdding(false)
          },
        },
      ],
    })
  }

  return (
    <>
      <p className={s.lede}>Goals are things you save toward; treats are guilt-free rewards for a good month. Bun will measure your spending in them.</p>

      {list.length ? (
        <section className={s.section} aria-labelledby="ob-dream-list">
          <div className={d.listHead}>
            <h2 id="ob-dream-list" className={s.h2}>Your list</h2>
            <span className={d.count}>{list.length === 1 ? '1 dream' : `${list.length} dreams`}</span>
          </div>
          <ul className={d.list}>
            {list.map((item) => {
              const main = item.key === mainKey
              return (
                <li key={item.key} className={cx(d.item, s.pop, main && d.main)}>
                  <DreamImage image={item.image} alt="" size={56} glow={main} />
                  <div className={d.itemText}>
                    <p className={d.itemName}>{item.name}</p>
                    <div className={d.itemMeta}>
                      <Money amount={item.price} currency={draft.currency} size="sm" className={d.price} />
                      <Badge size="sm" variant={item.kind === 'goal' ? 'accent' : 'under'} icon={item.kind === 'goal' ? <Target /> : <Gift />}>
                        {KIND_COPY[item.kind].label}
                      </Badge>
                      {main ? (
                        <Badge size="sm" variant="outline" icon={<Star />}>
                          Main goal
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <IconButton label={`Remove ${item.name}`} icon={<Trash2 />} onClick={() => remove(item)} />
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {adding ? (
        <section id="ob-dreams" className={cx(s.card, d.editorCard, errors.dreams && s.cardError)} aria-labelledby="ob-dream-editor">
          <h2 id="ob-dream-editor" className={cx(s.h2, d.editorTitle)}>
            {list.length ? 'Add another dream' : 'Add your first dream'}
          </h2>
          <DreamEditor key={editorKey} currency={draft.currency} submitLabel="Add to my list" onSubmit={add} onCancel={list.length ? () => setAdding(false) : undefined} />
          {errors.dreams ? (
            <p className={s.error} role="alert">
              <CircleAlert aria-hidden="true" />
              {errors.dreams}
            </p>
          ) : null}
        </section>
      ) : (
        <Button variant="secondary" size="lg" fullWidth iconStart={<Plus />} onClick={() => setAdding(true)}>
          Add another dream
        </Button>
      )}
    </>
  )
}
