import { Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { addDays, addMonths } from '../../../core/dates'
import { CURRENCY_SYMBOL, fmt, parseAmount } from '../../../core/money'
import type { Cadence, Currency, ISODate } from '../../../core/types'
import { Button, Segmented, Sheet, TextField, useToast } from '../../components/ds'
import { useApp } from '../../state'
import styles from './subscriptions.module.css'

export interface AddSubscriptionSheetProps {
  open: boolean
  onClose: () => void
  currency: Currency
  today: ISODate
  /** no bank connected: the subscription also becomes a bill to expect */
  noBank: boolean
}

const CADENCES: { value: Cadence; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'weekly', label: 'Weekly' },
]

/** Add a subscription by hand: name, price, how often and the next payment date. */
export function AddSubscriptionSheet({ open, onClose, currency, today, noBank }: AddSubscriptionSheetProps) {
  const app = useApp()
  const toast = useToast()
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [cadence, setCadence] = useState<Cadence>('monthly')
  const [next, setNext] = useState(addMonths(today, 1))
  const [error, setError] = useState<{ name?: string; price?: string; next?: string }>({})

  function submit(e: FormEvent) {
    e.preventDefault()
    const amount = parseAmount(price, currency)
    const errs: typeof error = {}
    if (!name.trim()) errs.name = 'What is it called? Like Netflix or the gym'
    if (amount === null || amount <= 0) errs.price = 'Type the price, like 30'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next < addDays(today, -31)) errs.next = 'Pick the next payment date'
    setError(errs)
    if (Object.keys(errs).length || amount === null) return
    const r = app.addSubscription({ name, amount, cadence, nextDate: next })
    if (!r.ok) {
      setError({ name: r.error })
      return
    }
    toast.show({
      tone: 'success',
      title: `${name.trim()} added`,
      message: noBank ? `${fmt(amount, currency)} ${cadence}. It shows in Bills before each payment.` : `${fmt(amount, currency)} ${cadence}, counted in your subscriptions.`,
    })
    setName('')
    setPrice('')
    setCadence('monthly')
    setNext(addMonths(today, 1))
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a subscription" description="Something you pay for regularly that Bun hasn’t spotted on a statement yet.">
      <form className={styles.addForm} onSubmit={submit} noValidate>
        <TextField label="What is it?" placeholder="Netflix, gym, iCloud…" maxLength={60} value={name} error={error.name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextField label="Price" prefix={CURRENCY_SYMBOL[currency]} inputMode="decimal" placeholder="30" value={price} error={error.price} onChange={(e) => setPrice(e.currentTarget.value)} />
        <Segmented<Cadence> label="How often?" value={cadence} onChange={setCadence} options={CADENCES} />
        <TextField label="Next payment" type="date" value={next} error={error.next} onChange={(e) => setNext(e.currentTarget.value)} />
        <Button type="submit" size="lg" fullWidth iconStart={<Plus />}>Add it</Button>
      </form>
    </Sheet>
  )
}
