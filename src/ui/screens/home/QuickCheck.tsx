import { ArrowRight, CalendarClock, CircleCheck, CircleHelp, CircleX, Clock3, Sparkles, Wallet } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { checkAffordability } from '../../../core/finance'
import { CURRENCY_SYMBOL, parseAmount } from '../../../core/money'
import type { AffordabilityResult, Currency, Tone } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { AiBadge, Badge, Button, Money, Sheet, TextField, type BadgeVariant } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import type { CheckRequest } from './MirrorHero'
import { affordabilityQuestion, hoursText, shortDelay, verdictMeta, type StatusTone } from './model'
import styles from './QuickCheck.module.css'

const VERDICT_ICON: Record<AffordabilityResult['verdict'], ReactNode> = {
  go: <CircleCheck />,
  think: <CircleHelp />,
  skip: <CircleX />,
}

const BADGE: Record<StatusTone, BadgeVariant> = { over: 'over', warn: 'warn', under: 'under', accent: 'accent', neutral: 'neutral' }

export interface QuickCheckProps {
  /** a check requested from elsewhere on Home (e.g. the mirror's treat button) */
  request: CheckRequest | null
  onRequestHandled: () => void
}

const selectCheck = (s: AppSnapshot) => ({
  ctx: s.derived.ctx,
  currency: s.state.profile?.currency ?? 'CNY',
  tone: s.state.profile?.tone ?? 'gentle',
})

/** "Should I buy it?" — amount + optional label in, a local, code-computed verdict out (checkAffordability). */
export function QuickCheck({ request, onRequestHandled }: QuickCheckProps) {
  const app = useApp()
  const { ctx, currency, tone } = useSnapshot(selectCheck, shallowEqual)
  const headingId = useId()
  const [amountText, setAmountText] = useState('')
  const [what, setWhat] = useState('')
  const [error, setError] = useState<string | null>(null)
  // the request stays set while the sheet animates out, so its content doesn't flash
  const [req, setReq] = useState<CheckRequest | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!request) return
    setReq(request)
    setOpen(true)
    onRequestHandled()
  }, [request, onRequestHandled])

  const result = useMemo(() => (ctx && req ? checkAffordability(ctx, req.amount, req.label) : null), [ctx, req])
  const meta = result ? verdictMeta(result.verdict, tone) : null

  function submit(e: FormEvent) {
    e.preventDefault()
    const amount = parseAmount(amountText, currency)
    if (amount === null || amount <= 0) {
      setError('Type a price, like 299')
      return
    }
    setError(null)
    setReq({ amount, label: what.trim() || 'this' })
    setOpen(true)
  }

  function askBun() {
    if (!req) return
    setOpen(false)
    void app.sendMessage(affordabilityQuestion(req.amount, req.label, currency)).catch(() => undefined)
    navigate('chat')
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        <span className={styles.mascot} aria-hidden="true">
          <BunMascot mood="calm" size={48} />
        </span>
        <div className={styles.headText}>
          <h2 id={headingId} className={styles.title}>Should I buy it?</h2>
          <p className={styles.sub}>Weigh it against your month and your dreams first.</p>
        </div>
      </div>
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          label="Price"
          prefix={CURRENCY_SYMBOL[currency]}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={amountText}
          onChange={(e) => {
            setAmountText(e.currentTarget.value)
            if (error) setError(null)
          }}
          error={error ?? undefined}
          className={styles.amount}
        />
        <TextField
          label="What is it? (optional)"
          autoComplete="off"
          placeholder="New jacket"
          maxLength={60}
          value={what}
          onChange={(e) => setWhat(e.currentTarget.value)}
          className={styles.what}
        />
        <Button type="submit" iconEnd={<ArrowRight />} className={styles.submit} disabled={!ctx} fullWidth>
          Check it
        </Button>
      </form>

      <Sheet
        open={open && Boolean(result)}
        onClose={() => setOpen(false)}
        title={meta?.title ?? 'Should I buy it?'}
        description="Bun’s read on your own numbers. The decision is yours."
        media={meta ? <BunMascot mood={meta.mood} size={56} /> : null}
        footer={
          <>
            <Button variant="secondary" iconStart={<Sparkles />} onClick={askBun}>Ask Bun</Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </>
        }
      >
        {result && req ? <Verdict result={result} label={req.label} currency={currency} tone={tone} /> : null}
      </Sheet>
    </section>
  )
}

interface VerdictProps {
  result: AffordabilityResult
  label: string
  currency: Currency
  tone: Tone
}

function Verdict({ result, label, currency, tone }: VerdictProps) {
  const meta = verdictMeta(result.verdict, tone)
  const named = label !== 'this' ? label : null

  return (
    <div className={styles.verdict} data-verdict={result.verdict}>
      <div className={styles.verdictTop}>
        <div className={styles.item}>
          <Money amount={result.amount} currency={currency} size="xl" decimals={false} />
          {named ? <span className={styles.itemLabel}>{named}</span> : null}
        </div>
        <Badge variant={BADGE[meta.tone]} icon={VERDICT_ICON[result.verdict]}>{meta.badge}</Badge>
      </div>

      <dl className={styles.facts}>
        <div className={styles.fact} data-tone={result.remainingAfter < 0 ? 'over' : undefined}>
          <dt><Wallet aria-hidden="true" />Left after</dt>
          <dd><Money amount={result.remainingAfter} currency={currency} size="md" decimals={false} tone={result.remainingAfter < 0 ? 'over' : 'neutral'} /></dd>
        </div>
        <div className={styles.fact}>
          <dt><Clock3 aria-hidden="true" />Work time</dt>
          <dd>{hoursText(result.hoursOfWork)}</dd>
        </div>
        {result.goalName ? (
          <div className={styles.fact} data-tone={result.goalDelayDays ? 'warn' : undefined}>
            <dt><CalendarClock aria-hidden="true" />{result.goalName}</dt>
            <dd>{result.goalDelayDays ? `+${shortDelay(result.goalDelayDays)}` : 'No delay'}</dd>
          </div>
        ) : null}
      </dl>

      {result.equivalents.length > 0 ? (
        <div className={styles.block}>
          <p className={styles.blockTitle}>Same money as</p>
          <ul className={styles.equivList}>
            {result.equivalents.map((e) => (
              <li key={e.itemId} className={styles.equiv}>
                <DreamImage image={e.image} alt="" size={56} />
                <span>{e.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={styles.block}>
        <div className={styles.blockHead}>
          <p className={styles.blockTitle}>How Bun worked it out</p>
          <AiBadge engine="offline" />
        </div>
        <ul className={styles.reasons}>
          {result.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
    </div>
  )
}
