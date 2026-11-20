import { CalendarClock, Check, Target, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { dayLimitOf, planFor, planImpact, planOptions, usualDaily } from '../../../core/finance'
import { delayPhrase } from '../../../core/finance/copy'
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, fmtCopy, parseAmount } from '../../../core/money'
import { BunMascot } from '../../components/brand'
import { Button, Chip, Sheet, TextField, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import styles from './DailyPlanSheet.module.css'

const selectPlan = (s: AppSnapshot) => ({
  ctx: s.derived.ctx,
  summary: s.derived.summary,
  currency: s.state.profile?.currency ?? ('CNY' as const),
})

export interface DailyPlanSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * "A daily amount you can live with": when the month runs over, spending nothing until the 1st is not realistic.
 * The user picks what they need a day for the rest of the month and sees, as they choose, where the month ends and
 * how far it pushes their goal. Bun then judges each day by that amount (core/finance/dailyplan).
 */
export function DailyPlanSheet({ open, onClose }: DailyPlanSheetProps) {
  const app = useApp()
  const toast = useToast()
  const { ctx, summary: s, currency } = useSnapshot(selectPlan, shallowEqual)
  const plan = ctx && s ? planFor(ctx, s.month) : undefined
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const data = useMemo(() => {
    if (!ctx || !s) return null
    // the options never depend on the plan already chosen
    const base = { ...ctx, dailyPlan: undefined }
    const evenShare = dayLimitOf(base, s)
    const options = planOptions(base, s, evenShare)
    const usual = usualDaily(base)
    // the chip closest to the usual day carries the tag (options are rounded to whole tens)
    const usualOption = usual > 0 ? options.reduce((best, o) => (Math.abs(o - usual) < Math.abs(best - usual) ? o : best), options[0]) : undefined
    return { options, usual, evenShare, usualOption: usualOption !== undefined && Math.abs(usualOption - usual) <= usual * 0.1 ? usualOption : undefined }
  }, [ctx, s])

  if (!ctx || !s || !data) return null
  const f = (m: number) => fmtCopy(m, currency)
  const typed = text.trim() ? parseAmount(text, currency) : null
  const amount = typed ?? plan?.amount ?? data.options[Math.min(1, data.options.length - 1)] ?? data.evenShare
  const impact = amount > 0 ? planImpact(ctx, s, amount) : null
  const usualImpact = data.usual > 0 && data.usual !== amount ? planImpact(ctx, s, data.usual) : null
  const unit = MINOR_PER_MAJOR[currency]

  function use() {
    if (!amount || amount <= 0) {
      setError('Type an amount, like 80')
      return
    }
    const r = app.setDailyPlan(amount)
    if (!r.ok) {
      setError(r.error ?? 'That didn’t work. Try again.')
      return
    }
    toast.show({ tone: 'success', title: `${f(amount)} a day it is`, message: 'Bun now judges your days by this amount, until the month ends.' })
    setText('')
    onClose()
  }

  function remove() {
    app.setDailyPlan(null)
    toast.show({ tone: 'neutral', title: 'Daily amount removed', message: 'Bun goes back to an even share of your target.' })
    setText('')
    onClose()
  }

  const good = impact ? impact.vsTarget <= 0 : false
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="A daily amount you can live with"
      description="Spending nothing until the month ends isn’t realistic. Pick what you need a day, and see what it costs your goal."
      media={<BunMascot mood={good ? 'happy' : impact && impact.goal && impact.goal.delayDays > 0 ? 'worried' : 'calm'} size={56} />}
    >
      <div className={styles.body}>
        <div className={styles.options} role="group" aria-label="Suggested amounts">
          {data.options.map((o) => (
            <Chip key={o} selected={!text.trim() ? amount === o : typed === o} onClick={() => setText(String(o / unit))}>
              {f(o)}
              {o === data.usualOption ? ' · your usual' : ''}
            </Chip>
          ))}
        </div>
        <TextField
          label="Per day, for the rest of the month"
          prefix={CURRENCY_SYMBOL[currency]}
          inputMode="decimal"
          autoComplete="off"
          placeholder={String(amount / unit)}
          value={text}
          error={error ?? undefined}
          hint={data.usual > 0 ? `Your usual day lately: ${f(data.usual)}, not counting rent and bills.` : undefined}
          onChange={(e) => {
            setText(e.currentTarget.value)
            setError(null)
          }}
        />

        {impact ? (
          <div className={styles.impact} data-good={good || undefined}>
            <p className={styles.lead}>{impact.text}</p>
            {impact.goal?.targetDate && impact.goal.etaDate ? (
              <p className={styles.line}>
                <CalendarClock aria-hidden="true" />
                <span>
                  {impact.goal.afterTarget ? 'Lands after' : 'Still within'} your date for {impact.goal.name} ({monthYear(impact.goal.targetDate)}). New estimate: {monthYear(impact.goal.etaDate)}.
                </span>
              </p>
            ) : null}
            {usualImpact && usualImpact.goal ? (
              <p className={styles.line}>
                <Target aria-hidden="true" />
                <span>
                  At your usual {f(data.usual)} a day it would be {usualImpact.vsTarget > 0 ? `${f(usualImpact.vsTarget)} over` : 'within target'}
                  {usualImpact.goal.delayDays > 0 ? `, and ${usualImpact.goal.name} would move ${delayPhrase(usualImpact.goal.delayDays)}` : ''}.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        <Button size="lg" fullWidth iconStart={<Check />} onClick={use}>
          {plan && plan.amount === amount ? `Keep ${f(amount)} a day` : `Use ${f(amount)} a day`}
        </Button>
        {plan ? (
          <Button variant="ghost" iconStart={<Trash2 />} onClick={remove}>
            Remove my daily amount
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}

function monthYear(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
