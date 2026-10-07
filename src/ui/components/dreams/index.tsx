/**
 * Dream item editor (name, price, goal/treat, preset illustration or on-device photo).
 * MINIMAL VERSION — owned and polished by the onboarding UI engineer; Goals reuses it. Keep names/props.
 */
import { useState } from 'react'
import type { DreamInput } from '../../../core/app-api'
import type { Currency } from '../../../core/types'
import { toMinor } from '../../../core/money'
import { Button, TextField } from '../ds'

export interface DreamEditorProps {
  currency: Currency
  initial?: Partial<DreamInput>
  submitLabel?: string
  onSubmit: (input: DreamInput) => void
  onCancel?: () => void
}

export function DreamEditor({ currency, initial, submitLabel = 'Save', onSubmit, onCancel }: DreamEditorProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(initial?.price ? String(initial.price / 100) : '')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit({ name, price: toMinor(Number(price), currency), image: initial?.image ?? 'preset:gift', kind: initial?.kind ?? 'goal' })
      }}
    >
      <TextField label="What is it?" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <TextField label="Price" value={price} onChange={(e) => setPrice(e.currentTarget.value)} />
      <Button type="submit">{submitLabel}</Button>
      {onCancel ? (
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </form>
  )
}
