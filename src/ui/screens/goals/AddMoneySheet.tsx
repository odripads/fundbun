import { PiggyBank } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CURRENCY_SYMBOL, parseAmount, toMajor } from '../../../core/money'
import type { DreamItem, GoalProgress } from '../../../core/types'
import { DreamImage } from '../../components/brand'
import { Button, Callout, Chip, ProgressBar, Sheet, TextField, useToast } from '../../components/ds'
import { sandboxToday, shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import { billsDueWithin, contributionError, fmtWhole, isNegativeInput, liquidityNote, pctAfterAdding, quickAmounts, remainingOf } from './model'
import styles from './Goals.module.css'

export interface AddMoneySheetProps {
  item: DreamItem | null
  progress?: GoalProgress
  onClose: () => void
}

const selectFunds = (s: AppSnapshot) => ({
  available: s.state.bank.accounts.find((a) => a.type === 'checking')?.balance ?? 0,
  bills: s.derived.upcomingBills,
  today: sandboxToday(s),
  currency: s.state.profile?.currency ?? 'CNY',
})

/** User-initiated move from checking into a goal pot (app.contributeToGoal — audited as the user's action). */
export function AddMoneySheet({ item, progress, onClose }: AddMoneySheetProps) {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { available, bills, today, currency } = useSnapshot(selectFunds, shallowEqual)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [busy, setBusy] = useState(false)
  // keep the last item while the sheet animates out
  const [shown, setShown] = useState<{ item: DreamItem; progress?: GoalProgress } | null>(null)

  useEffect(() => {
    if (item) {
      setShown({ item, progress })
      setText('')
      setAttempted(false)
    }
  }, [item, progress])

  const target = shown?.item
  const p = item ? progress : shown?.progress
  // a minus sign is never dropped silently: "-50" is not "Stash ¥50"
  const negative = isNegativeInput(text)
  const amount = negative ? null : parseAmount(text, currency)
  const error = contributionError(amount, available, currency, text)
  const remaining = remainingOf(p)
  const chips = quickAmounts(remaining, available, currency)
  const after = pctAfterAdding(p, amount ?? 0)
  const note = !error && amount ? liquidityNote(available, amount, billsDueWithin(bills, today), currency) : null

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    setAttempted(true)
    if (!target || error || !amount) return
    setBusy(true)
    const r = await run(() => app.contributeToGoal(target.id, amount), { errorTitle: 'Couldn’t move the money' })
    setBusy(false)
    if (r?.ok) {
      onClose()
      toast.show({
        tone: 'success',
        title: `${fmtWhole(amount, currency)} stashed in ${target.name}`,
        message: `${after}% there now. Future you says thanks.`,
        image: <DreamImage image={target.image} alt="" size={56} />,
      })
    }
  }

  return (
    <Sheet
      open={Boolean(item)}
      onClose={onClose}
      title={target ? `Add money to ${target.name}` : 'Add money'}
      description={`From checking · ${fmtWhole(available, currency)} available. You move it, so no agent limits apply.`}
      media={target ? <DreamImage image={target.image} alt="" size={52} /> : null}
      initialFocus={inputRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button iconStart={<PiggyBank />} loading={busy} disabled={Boolean((attempted || negative) && error)} onClick={() => void submit()}>
            {amount && !error ? `Stash ${fmtWhole(amount, currency)}` : 'Stash it'}
          </Button>
        </>
      }
    >
      {target ? (
        <form className={styles.addForm} onSubmit={submit} noValidate>
          <TextField
            ref={inputRef}
            label="Amount"
            prefix={CURRENCY_SYMBOL[currency]}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            error={(attempted || negative) && error ? error : undefined}
            className={styles.amountField}
          />
          {chips.length > 0 ? (
            <div className={styles.chips} role="group" aria-label="Quick amounts">
              {chips.map((c) => (
                <Chip key={c.amount} selected={amount === c.amount} onClick={() => setText(String(toMajor(c.amount, currency)))}>
                  {c.label}
                </Chip>
              ))}
            </div>
          ) : null}
          {p ? (
            <ProgressBar
              value={after}
              max={100}
              tone="under"
              label={`${target.name} after this`}
              valueLabel={amount && !error ? `${Math.floor(p.pct)}% → ${after}%` : `${Math.floor(p.pct)}% saved`}
              valueText={amount && !error ? `${after}% saved after this` : `${Math.floor(p.pct)}% saved so far`}
              markers={[{ value: p.pct }]}
            />
          ) : null}
          {note ? <Callout tone="warn">{note}</Callout> : null}
        </form>
      ) : null}
    </Sheet>
  )
}
