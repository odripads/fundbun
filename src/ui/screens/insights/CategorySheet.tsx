import { ArrowRight, MessageCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CATEGORIES } from '../../../core/categories'
import { shiftMonth } from '../../../core/dates'
import { CURRENCY_SYMBOL, fmt } from '../../../core/money'
import type { CategoryId, Currency, Minor, MonthSummary, Transaction } from '../../../core/types'
import { Button, List, ListItem, Money, ProgressBar, Sheet, TextField } from '../../components/ds'
import { useApp, useSafeAction } from '../../state'
import { askAboutCategory, monthName, parseLimit, txnWhen } from './model'
import styles from './sheets.module.css'

export interface CategorySheetProps {
  open: boolean
  /** kept after closing so the sheet can animate out with its content */
  category: CategoryId | null
  s: MonthSummary
  /** the month's transactions in this category (newest first) */
  txns: Transaction[]
  currency: Currency
  onClose: () => void
  onAsk: (text: string) => void
  onSeeAll: (category: CategoryId) => void
}

const PREVIEW = 6

function limitText(limit: Minor | undefined): string {
  return limit ? String(Math.round(limit / 100)) : ''
}

interface LimitFormProps {
  category: CategoryId
  limit: Minor | undefined
  target: Minor
  currency: Currency
}

/** Inline monthly-limit editor. A direct user action (audited as user_action), not an agent proposal. */
function LimitForm({ category, limit, target, currency }: LimitFormProps) {
  const app = useApp()
  const run = useSafeAction()
  const label = CATEGORIES[category].label
  const [draft, setDraft] = useState(limitText(limit))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = draft.trim() !== limitText(limit)

  async function save(e: FormEvent) {
    e.preventDefault()
    const parsed = parseLimit(draft, currency, target)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    setSaving(true)
    const res = await run(() => app.setCategoryBudget(category, parsed.value), {
      success: parsed.value > 0 ? `${label} limit: ${fmt(parsed.value, currency)} a month` : `${label} limit removed`,
      errorTitle: 'Couldn’t save that limit',
    })
    setSaving(false)
    if (res && !res.ok) setError(res.error ?? 'Please try again.')
  }

  return (
    <form className={styles.limitForm} onSubmit={save} noValidate>
      <TextField
        label="Monthly limit"
        prefix={CURRENCY_SYMBOL[currency]}
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        placeholder="No limit"
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        error={error ?? undefined}
        hint="Applies from now on. 0 removes it."
        className={styles.limitField}
      />
      <Button type="submit" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={saving} className={styles.limitSave}>
        Save
      </Button>
    </form>
  )
}

/** A category up close: spent vs limit, an inline limit editor and the month's purchases. */
export function CategorySheet({ open, category, s, txns, currency, onClose, onAsk, onSeeAll }: CategorySheetProps) {
  if (!category) return null
  const meta = CATEGORIES[category]
  const row = s.byCategory.find((r) => r.category === category)
  const spent = row?.spent ?? 0
  const limit = row?.limit
  const prev = row?.prevMonth ?? 0
  const monthLong = monthName(s.month)
  const prevMonth = shiftMonth(s.month, -1)
  const count = txns.filter((t) => t.amount < 0).length
  const change = prev > 0 ? Math.round(((spent - prev) / prev) * 100) : null
  const over = limit !== undefined && spent > limit

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={meta.label}
      description={`${monthLong}${s.isCurrent ? ' so far' : ''} · ${count} ${count === 1 ? 'purchase' : 'purchases'}`}
      media={<span className={styles.avatar} aria-hidden="true">{meta.emoji}</span>}
      footer={
        <Button variant="soft" fullWidth iconStart={<MessageCircle />} onClick={() => onAsk(askAboutCategory(category, s.month))}>
          Ask Bun about {meta.label.toLowerCase()}
        </Button>
      }
    >
      <div className={styles.stack}>
        <div className={styles.figureBlock}>
          <div className={styles.figure}>
            <Money amount={spent} currency={currency} size="xl" tone={over ? 'over' : 'neutral'} />
            <span className={styles.figureNote}>
              {limit ? <>of <strong>{fmt(limit, currency)}</strong></> : 'no limit set'}
            </span>
          </div>
          {limit ? (
            <ProgressBar
              value={spent}
              max={limit}
              tone="budget"
              ariaLabel={`${meta.label} spending against its limit`}
              valueText={`${fmt(spent, currency)} of ${fmt(limit, currency)}${over ? `, ${fmt(spent - limit, currency)} over` : ''}`}
            />
          ) : null}
          <p className={styles.compare}>
            {over ? <strong className={styles.overText}>{fmt(spent - (limit ?? 0), currency)} over · </strong> : null}
            {prev > 0
              ? s.isCurrent
                ? `All of ${monthName(prevMonth)}: ${fmt(prev, currency)}`
                : `${monthName(prevMonth)}: ${fmt(prev, currency)}${change !== null && change !== 0 ? ` (${change > 0 ? '+' : '−'}${Math.abs(change)}% in ${monthName(s.month, 'short')})` : ''}`
              : `Nothing here in ${monthName(prevMonth)}.`}
          </p>
        </div>

        <LimitForm key={`${category}:${limit ?? 0}`} category={category} limit={limit} target={s.target} currency={currency} />

        <section aria-label={`${meta.label} purchases`}>
          <h3 className={styles.subhead}>Purchases</h3>
          {txns.length ? (
            <List card dividers>
              {txns.slice(0, PREVIEW).map((t) => (
                <ListItem
                  key={t.id}
                  leading={meta.emoji}
                  title={t.merchant}
                  subtitle={txnWhen(t)}
                  trailing={<Money amount={t.amount} currency={currency} tone="gain" size="sm" signed />}
                />
              ))}
            </List>
          ) : (
            <p className={styles.compare}>No purchases in {monthLong}.</p>
          )}
          {txns.length > PREVIEW ? (
            <Button variant="ghost" size="sm" iconEnd={<ArrowRight />} className={styles.seeAll} onClick={() => onSeeAll(category)}>
              See all {txns.length}
            </Button>
          ) : null}
        </section>
      </div>
    </Sheet>
  )
}
