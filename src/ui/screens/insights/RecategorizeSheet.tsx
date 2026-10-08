import { Check } from 'lucide-react'
import { useState } from 'react'
import { CATEGORIES } from '../../../core/categories'
import type { CategoryId, Currency, Transaction } from '../../../core/types'
import { Button, Money, Sheet, cx } from '../../components/ds'
import { pickerCategories, txnWhen } from './model'
import styles from './sheets.module.css'

export interface RecategorizeSheetProps {
  open: boolean
  /** kept after closing so the sheet animates out with its content */
  txn: Transaction | null
  currency: Currency
  onClose: () => void
  onSave: (txn: Transaction, category: CategoryId) => Promise<boolean>
}

const OPTIONS = pickerCategories()

function Picker({ txn, currency, onSave, onClose, open }: RecategorizeSheetProps & { txn: Transaction }) {
  const [choice, setChoice] = useState<CategoryId>(txn.category)
  const [saving, setSaving] = useState(false)
  const current = CATEGORIES[txn.category]
  const next = CATEGORIES[choice]
  const changed = choice !== txn.category

  async function save() {
    if (!changed) return
    setSaving(true)
    const ok = await onSave(txn, choice)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={txn.merchant}
      description={
        <>
          {txnWhen(txn)} · <Money amount={txn.amount} currency={currency} size="sm" signed tone="gain" />
        </>
      }
      media={<span className={styles.avatar} aria-hidden="true">{next.emoji}</span>}
      size="full"
      footer={
        <div className={styles.recatFoot}>
          <p className={styles.learn} aria-live="polite">
            {changed ? `Bun will file future ${txn.merchant} purchases under ${next.label.toLowerCase()} too.` : `Filed under ${current.label.toLowerCase()}. Pick a better fit.`}
          </p>
          <Button fullWidth disabled={!changed} loading={saving} onClick={save}>
            {changed ? `Move to ${next.label}` : 'Choose a category'}
          </Button>
        </div>
      }
    >
      <fieldset className={styles.picker}>
        <legend className="sr-only">Category for this {txn.amount < 0 ? 'purchase' : 'transaction'}</legend>
        {OPTIONS.map((id) => {
          const c = CATEGORIES[id]
          const checked = id === choice
          return (
            <label key={id} className={cx(styles.option, checked && styles.optionOn)}>
              <input
                type="radio"
                name={`recat-${txn.id}`}
                value={id}
                checked={checked}
                onChange={() => setChoice(id)}
                className={styles.radio}
              />
              <span className={styles.optionEmoji} aria-hidden="true">{c.emoji}</span>
              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{c.label}</span>
                {id === txn.category ? <span className={styles.nowTag}>now</span> : null}
              </span>
              {checked ? <Check aria-hidden="true" className={styles.optionCheck} /> : null}
            </label>
          )
        })}
      </fieldset>
    </Sheet>
  )
}

/** Re-file a transaction. Saving calls app.recategorize, which also learns a rule for the merchant. */
export function RecategorizeSheet(props: RecategorizeSheetProps) {
  if (!props.txn) return null
  // keyed per transaction so the choice resets for each new row
  return <Picker key={props.txn.id} {...props} txn={props.txn} />
}
