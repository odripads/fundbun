/**
 * Tripwires: the user's spending thresholds that fire dream-picture reminders. List with on/off, tap to edit
 * the threshold or delete (with undo), and an add sheet (kind · threshold · category).
 */
import { CalendarDays, Gauge, Plus, ShoppingBag, Sparkles, Tags, Target, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import type { AppSnapshot, TripwireInput } from '../../../core/app-api'
import { CATEGORIES, SPENDING_CATEGORIES } from '../../../core/categories'
import { CURRENCY_SYMBOL } from '../../../core/money'
import type { CategoryId, Currency, Tripwire, TripwireKind } from '../../../core/types'
import { Button, Card, Chip, EmptyState, SectionHeader, Sheet, TextField, Toggle, useToast } from '../../components/ds'
import { sandboxToday, shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import { TRIPWIRE_KINDS, TRIPWIRE_KIND_ORDER, firedText, isBudgetCategory, parseThreshold, thresholdInput, tripwireSentence } from './logic'
import styles from './Settings.module.css'

const KIND_ICON: Record<TripwireKind, ReactNode> = {
  month_pct: <Target />,
  pace_over: <Gauge />,
  category_pct: <Tags />,
  single_over: <ShoppingBag />,
  daily_over: <CalendarDays />,
}

function selectTripwires(s: AppSnapshot) {
  return {
    tripwires: s.state.tripwires,
    events: s.state.tripwireEvents,
    budget: s.state.budget,
    currency: (s.state.profile?.currency ?? 'CNY') as Currency,
    today: sandboxToday(s),
    txns: s.state.bank.transactions,
  }
}

type EditorState = { mode: 'add' } | { mode: 'edit'; tripwire: Tripwire } | null


export function TripwiresSection() {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { tripwires, events, budget, currency, today, txns } = useSnapshot(selectTripwires, shallowEqual)
  const [editor, setEditor] = useState<EditorState>(null)
  const on = tripwires.filter((t) => t.enabled).length

  function remove(t: Tripwire) {
    const r = app.removeTripwire(t.id)
    if (!r.ok) {
      toast.show({ tone: 'danger', title: 'Couldn’t delete it', message: r.error })
      return
    }
    setEditor(null)
    toast.show({
      tone: 'neutral',
      title: 'Tripwire deleted',
      message: t.label,
      actions: [{ label: 'Undo', onClick: () => void app.addTripwire({ kind: t.kind, threshold: t.threshold, category: t.category, enabled: t.enabled }) }],
    })
  }

  return (
    <section id="set-tripwires" aria-labelledby="set-tripwires-h" className={styles.section}>
      <SectionHeader
        id="set-tripwires-h"
        eyebrow={`Spending alerts · ${on} on`}
        title="Tripwires"
        action={<Button size="sm" variant="secondary" iconStart={<Plus />} onClick={() => setEditor({ mode: 'add' })}>Add</Button>}
      />
      {tripwires.length ? (
        <Card padding="none">
          <ul className={styles.twList} role="list">
            {tripwires.map((t) => (
              <li key={t.id} className={styles.twRow} data-off={!t.enabled || undefined}>
                <button type="button" className={styles.twMain} onClick={() => setEditor({ mode: 'edit', tripwire: t })} aria-label={`Edit tripwire: ${t.label}`}>
                  <span className={styles.twIcon} aria-hidden="true">{KIND_ICON[t.kind]}</span>
                  <span className={styles.twText}>
                    <span className={styles.twTitle}>{t.label}</span>
                    <span className={styles.twSub}>
                      {TRIPWIRE_KINDS[t.kind].label} · {firedText(events, t.id, today, txns)}
                      {t.createdBy === 'agent' ? (
                        <span className={styles.twAgent}>
                          <Sparkles aria-hidden="true" /> set by Bun
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <Toggle
                  checked={t.enabled}
                  ariaLabel={`Tripwire: ${t.label}`}
                  onChange={(enabled) => void run(() => app.updateTripwire(t.id, { enabled }))}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <EmptyState compact mood="sleepy" title="No tripwires yet" body="Set one and Bun will show you your dream the moment a threshold trips." action={<Button size="sm" iconStart={<Plus />} onClick={() => setEditor({ mode: 'add' })}>Add a tripwire</Button>} />
        </Card>
      )}

      <TripwireEditor
        state={editor}
        currency={currency}
        budgeted={budget?.categories.map((c) => c.category) ?? []}
        onClose={() => setEditor(null)}
        onDelete={remove}
        onSave={async (input, existing) => {
          const r = await run(() => (existing ? app.updateTripwire(existing.id, input) : app.addTripwire(input)), {
            success: existing ? 'Tripwire updated' : 'Tripwire set. Bun’s watching.',
          })
          if (r && (!('ok' in r) || r.ok)) setEditor(null)
        }}
      />
    </section>
  )
}

interface EditorProps {
  state: EditorState
  currency: Currency
  budgeted: CategoryId[]
  onClose: () => void
  onDelete: (t: Tripwire) => void
  onSave: (input: TripwireInput, existing?: Tripwire) => void
}

function TripwireEditor({ state, currency, budgeted, onClose, onDelete, onSave }: EditorProps) {
  const existing = state?.mode === 'edit' ? state.tripwire : undefined
  const [kind, setKind] = useState<TripwireKind>('single_over')
  const [value, setValue] = useState('')
  const [category, setCategory] = useState<CategoryId>('delivery')
  const [error, setError] = useState<string | undefined>()
  const [opened, setOpened] = useState<EditorState>(null)
  const catId = useId()

  if (state !== opened) {
    // load the form whenever the sheet opens on something new
    setOpened(state)
    if (state) {
      const k = existing?.kind ?? 'single_over'
      setKind(k)
      setValue(existing ? thresholdInput(existing, currency) : String(TRIPWIRE_KINDS[k].defaultValue))
      setCategory(existing?.category ?? budgeted.find((c) => CATEGORIES[c].kind === 'want') ?? budgeted[0] ?? 'dining')
      setError(undefined)
    }
  }

  const meta = TRIPWIRE_KINDS[kind]
  const parsed = parseThreshold(kind, value, currency)
  const categories = [...budgeted, ...SPENDING_CATEGORIES.filter((c) => isBudgetCategory(c) && !budgeted.includes(c))]
  const sentence = 'value' in parsed ? tripwireSentence(kind, parsed.value, category, currency) : null

  function pickKind(k: TripwireKind) {
    setKind(k)
    setValue(String(TRIPWIRE_KINDS[k].defaultValue))
    setError(undefined)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    const input: TripwireInput = { kind, threshold: parsed.value }
    if (kind === 'category_pct') input.category = category
    if (!existing) input.enabled = true
    onSave(input, existing)
  }

  return (
    <Sheet
      open={state !== null}
      onClose={onClose}
      title={existing ? 'Edit tripwire' : 'New tripwire'}
      description={existing ? existing.label : 'Pick what should nudge you. Bun shows your dream the moment it trips.'}
      footer={
        <div className={styles.sheetActions}>
          {existing ? (
            <Button type="button" variant="ghost" iconStart={<Trash2 />} onClick={() => onDelete(existing)} className={styles.deleteButton}>
              Delete
            </Button>
          ) : null}
          <Button type="submit" form="tripwire-form" fullWidth>
            {existing ? 'Save tripwire' : 'Set tripwire'}
          </Button>
        </div>
      }
    >
      <form id="tripwire-form" className={styles.form} onSubmit={submit} noValidate>
        {!existing ? (
          <fieldset className={styles.kindField}>
            <legend className={styles.fieldLabel}>Alert me about</legend>
            <div className={styles.kindChips}>
              {TRIPWIRE_KIND_ORDER.map((k) => (
                <Chip key={k} selected={kind === k} onClick={() => pickKind(k)} icon={KIND_ICON[k]}>
                  {TRIPWIRE_KINDS[k].label}
                </Chip>
              ))}
            </div>
          </fieldset>
        ) : null}
        <p className={styles.fieldHint}>{meta.hint}.</p>
        <TextField
          label={meta.unit === 'pct' ? 'Threshold' : 'Amount'}
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            setValue(e.currentTarget.value)
            setError(undefined)
          }}
          error={error}
          prefix={meta.unit === 'money' ? CURRENCY_SYMBOL[currency] : undefined}
          suffix={meta.unit === 'pct' ? '%' : undefined}
        />
        {kind === 'category_pct' ? (
          <div className={styles.selectField}>
            <label htmlFor={catId} className={styles.fieldLabel}>Category</label>
            <select id={catId} className={styles.select} value={category} onChange={(e) => setCategory(e.currentTarget.value as CategoryId)} disabled={Boolean(existing)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORIES[c].emoji} {CATEGORIES[c].label}{budgeted.includes(c) ? '' : ' (no budget yet)'}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {sentence ? (
          <p className={styles.sentence}>
            <Sparkles aria-hidden="true" />
            {sentence}
          </p>
        ) : null}
      </form>
    </Sheet>
  )
}
