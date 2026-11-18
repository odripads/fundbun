import { MessageCircleHeart, Plus } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CATEGORIES } from '../../../core/categories'
import { checkAffordability } from '../../../core/finance/affordability'
import { categorize } from '../../../core/finance/categorize'
import { MIRROR_PLAN_PROMPT } from '../../../core/finance/mirror'
import { dateLabel } from '../../../core/dates'
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, fmt, parseAmount } from '../../../core/money'
import { similarSpend } from '../../../core/receipt/dedupe'
import type { BunMood, CategoryId } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { MAX_PRICE_MAJOR } from '../../components/dreams/logic'
import { Button, Callout, Sheet, TextField } from '../../components/ds'
import { useToast } from '../../components/ds/Toast'
import { PURCHASE_CATEGORIES } from '../../components/sandbox/logic'
import { navigate } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { MOOD_WORDS, isAngry, manualCandidate, shout, spendReaction, type SpendReaction } from './model'
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

/** How long Bun keeps the old face before it changes, so the change is seen. */
const FACE_CHANGE_MS = 520

/**
 * Add spending by hand in five seconds: an amount, what it was, and a category Bun guesses from the words. No file,
 * no bank. The purchase lands on today, updates the Dream Mirror and can trip a wire like any other.
 *
 * Then Bun reacts, at once: the consequence right after the behaviour is what makes it stick. Over budget or a
 * tripped wire gets the stick (what it cost in the user's dream, and the way back); a purchase that fits gets the
 * carrot (what is still safe today, and the streak it keeps). See home/model.spendReaction.
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
  const [reaction, setReaction] = useState<(SpendReaction & { added: string }) | null>(null)
  const [face, setFace] = useState<BunMood>('calm')

  // show the face Bun had, then let it change: the mascot squashes and its colour runs to the new mood
  useEffect(() => {
    if (!reaction || reaction.mood === reaction.from) return
    const timer = window.setTimeout(() => setFace(reaction.mood), FACE_CHANGE_MS)
    return () => window.clearTimeout(timer)
  }, [reaction])

  const guess = useMemo(() => (what.trim() ? categorize(what, what, -1, rules).category : null), [what, rules])
  // the same amount a day or two away is probably already here (from a statement, or typed earlier): say so, don't block
  const repeat = useMemo(() => {
    const amount = parseAmount(amountText, currency)
    return amount && amount > 0 ? similarSpend(amount, today, transactions) : undefined
  }, [amountText, currency, today, transactions])

  function close() {
    setError(null)
    setReaction(null)
    onClose()
  }

  function plan() {
    close()
    void app.sendMessage(MIRROR_PLAN_PROMPT.prompt).catch(() => undefined)
    navigate('chat')
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
    const before = app.getSnapshot()
    // "Should I buy it?" for this purchase, worked out before it lands: what it does to today, the month and the dream
    const check = before.derived.ctx ? checkAffordability(before.derived.ctx, candidate.amount, candidate.merchant, candidate.category) : null
    const { added } = app.addSpending([candidate])
    setAmountText('')
    setWhat('')
    setCategory('')
    const after = app.getSnapshot()
    const label = `${candidate.merchant} · ${CATEGORIES[candidate.category].label}`
    if (added > 0 && check && before.derived.mirror && after.derived.mirror && after.derived.summary) {
      const known = new Set(before.derived.unseenEvents.map((e) => e.id))
      const r = spendReaction({
        amount: candidate.amount,
        currency,
        tone: after.derived.mirror.tone,
        check,
        before: before.derived.mirror,
        after: after.derived.mirror,
        safeAfter: after.derived.summary.safeToSpendToday,
        tripped: after.derived.unseenEvents.filter((e) => !known.has(e.id)).length,
      })
      setFace(r.from)
      setReaction({ ...r, added: `Added ${fmt(candidate.amount, currency)} · ${label}` })
      return
    }
    toast.show({
      tone: added > 0 ? 'success' : 'neutral',
      title: added > 0 ? `Added ${fmt(candidate.amount, currency)}` : 'Nothing added',
      message: added > 0 ? `${label}. You can change the category in Insights.` : 'That one could not be added.',
    })
    close()
  }

  if (reaction) {
    // an angry Bun shouts what it cost; the way back stays calm
    const loud = isAngry(reaction.mood)
    return (
      <Sheet open={open} onClose={close} title={loud ? shout(reaction.title) : reaction.title} description={reaction.added}>
        <div className={styles.reaction} data-kind={reaction.kind}>
          <div className={styles.face} data-mood={face}>
            <span className={styles.faceGlow} aria-hidden="true" />
            <BunMascot mood={face} size={136} title={MOOD_WORDS[face]} />
          </div>
          <p className="sr-only" role="status">{MOOD_WORDS[reaction.mood]}.</p>
          <ul className={styles.costs}>
            {reaction.lines.map((line, i) => (
              <li key={line} className={styles.cost} data-lead={i === 0 || undefined}>
                {i === 0 && reaction.dream ? <DreamImage image={reaction.dream.image} alt="" size={44} /> : null}
                <span>{loud ? shout(line) : line}</span>
              </li>
            ))}
          </ul>
          {reaction.wayBack ? <Callout tone="info" title="The way back">{reaction.wayBack}</Callout> : null}
          {reaction.thanks ? <p className={styles.note}>{reaction.thanks}</p> : null}
          <div className={styles.reactionActions}>
            {reaction.plan ? (
              <Button variant="secondary" size="lg" fullWidth iconStart={<MessageCircleHeart />} onClick={plan}>
                {MIRROR_PLAN_PROMPT.label}
              </Button>
            ) : null}
            <Button size="lg" fullWidth onClick={close}>{reaction.kind === 'carrot' ? 'Nice' : 'Got it'}</Button>
          </div>
        </div>
      </Sheet>
    )
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
