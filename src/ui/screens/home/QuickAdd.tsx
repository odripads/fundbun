import { Plus } from 'lucide-react'
import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CATEGORIES } from '../../../core/categories'
import { categorize } from '../../../core/finance/categorize'
import { dateLabel } from '../../../core/dates'
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, fmt, parseAmount } from '../../../core/money'
import { similarSpend } from '../../../core/receipt/dedupe'
import type { CategoryId } from '../../../core/types'
import { MAX_PRICE_MAJOR } from '../../components/dreams/logic'
import { Button, Callout, Sheet, TextField } from '../../components/ds'
import { useToast } from '../../components/ds/Toast'
import { PURCHASE_CATEGORIES } from '../../components/sandbox/logic'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { manualCandidate } from './model'
import styles from './QuickAdd.module.css'

const selectQuickAdd = (s: AppSnapshot) => ({
  currency: s.state.profile?.currency ?? ('CNY' as const),
  today: s.derived.today,
  rules: s.state.categoryRules,
  transactions: s.state.bank.transactions,
})

export interface QuickAddProps {
  open: boolean
  onClose: () => void
}

/**
 * Add spending by hand in five seconds: an amount, what it was, and a category Bun guesses from the words. No file,
 * no bank. The purchase lands on today, updates the Dream Mirror and can trip a wire like any other.
 */
export function QuickAdd({ open, onClose }: QuickAddProps) {
  const app = useApp()
  const toast = useToast()
  const { currency, today, rules, transactions } = useSnapshot(selectQuickAdd, shallowEqual)
  const [amountText, setAmountText] = useState('')
  const [what, setWhat] = useState('')
  const [category, setCategory] = useState<CategoryId | ''>('')
  const [error, setError] = useState<string | null>(null)
  const catId = useId()
  const seq = useRef(0)
  const amountRef = useRef<HTMLInputElement | null>(null)

  const guess = useMemo(() => (what.trim() ? categorize(what, what, -1, rules).category : null), [what, rules])
  // the same amount a day or two away is probably already here (from a statement, or typed earlier): say so, don't block
  const repeat = useMemo(() => {
    const amount = parseAmount(amountText, currency)
    return amount && amount > 0 ? similarSpend(amount, today, transactions) : undefined
  }, [amountText, currency, today, transactions])

  function close() {
    setError(null)
    onClose()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const amount = parseAmount(amountText, currency)
    if (amount === null || amount <= 0) {
      setError('Type an amount, like 25')
      return
    }
    const ceiling = MAX_PRICE_MAJOR * MINOR_PER_MAJOR[currency]
    if (amount > ceiling) {
      setError(`Keep it under ${fmt(ceiling, currency)}`)
      return
    }
    const candidate = manualCandidate({ amount, what, category, today, currency, rules, seq: `${Date.now().toString(36)}_${seq.current++}` })
    const { added } = app.addSpending([candidate])
    toast.show({
      tone: added > 0 ? 'success' : 'neutral',
      title: added > 0 ? `Added ${fmt(candidate.amount, currency)}` : 'Nothing added',
      message: added > 0 ? `${candidate.merchant} · ${CATEGORIES[candidate.category].label}. You can change the category in Insights.` : 'That one could not be added.',
    })
    setAmountText('')
    setWhat('')
    setCategory('')
    close()
  }

  return (
    <Sheet open={open} onClose={close} title="Add spending" description="Type it in. It stays on this device." initialFocus={amountRef}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          ref={amountRef}
          label="Amount"
          prefix={CURRENCY_SYMBOL[currency]}
          inputMode="decimal"
          autoComplete="off"
          placeholder="25"
          value={amountText}
          onChange={(e) => {
            setAmountText(e.currentTarget.value)
            if (error) setError(null)
          }}
          error={error ?? undefined}
        />
        <TextField
          label="What was it? (optional)"
          autoComplete="off"
          placeholder="Coffee, Hema, taxi…"
          maxLength={60}
          value={what}
          onChange={(e) => setWhat(e.currentTarget.value)}
        />
        <div className={styles.selectField}>
          <label htmlFor={catId} className={styles.selectLabel}>Category</label>
          <select id={catId} className={styles.select} value={category} onChange={(e) => setCategory(e.currentTarget.value as CategoryId | '')}>
            <option value="">{guess ? `Bun’s guess: ${CATEGORIES[guess].emoji} ${CATEGORIES[guess].label}` : 'Let Bun guess'}</option>
            {PURCHASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORIES[c].emoji} {CATEGORIES[c].label}</option>
            ))}
          </select>
        </div>
        {repeat ? (
          <Callout tone="info" title="You may already have this one">
            {fmt(-repeat.amount, currency)} on {dateLabel(repeat.date)}: {repeat.merchant}. If it is the same purchase, close this. If it is another one, add it.
          </Callout>
        ) : (
          <p className={styles.note}>It counts toward today, your month and your tripwires.</p>
        )}
        <Button type="submit" size="lg" fullWidth iconStart={<Plus />}>{repeat ? 'Add anyway' : 'Add it'}</Button>
      </form>
    </Sheet>
  )
}
