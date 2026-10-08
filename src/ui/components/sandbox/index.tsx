/**
 * Sandbox controls (demo only): simulate a purchase, advance the sandbox clock, switch persona, reset.
 * Everything here drives the simulated bank through AppApi; results (new transaction + any tripwire events
 * that fired) are shown inline so a judge sees cause and effect in one place.
 */
import { CalendarClock, CalendarPlus, FlaskConical, Moon, RotateCcw, ShoppingBag, Sparkles, Zap } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CATEGORIES } from '../../../core/categories'
import { dateLabel } from '../../../core/dates'
import { CURRENCY_SYMBOL } from '../../../core/money'
import type { CategoryId, Currency } from '../../../core/types'
import { sandboxToday, shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import type { AppSnapshot } from '../../../core/app-api'
import { DreamImage } from '../brand'
import { Badge, Button, Money, Segmented, TextField, cx, useToast } from '../ds'
import { DEMO_PIN, PERSONAS, PRESETS, PURCHASE_CATEGORIES, advanceTotals, checkPurchase, type SandboxPreset, type SandboxResult } from './logic'
import styles from './Sandbox.module.css'

export interface SandboxPanelProps {
  /** compact layout for the desktop glass box */
  compact?: boolean
  /**
   * Shows a "Done" button that calls this. Results never close the panel on their own: the new transaction and
   * the tripwires it fired stay visible until the user is done looking.
   */
  onDone?: () => void
}

function selectSandbox(s: AppSnapshot) {
  return {
    currency: (s.state.profile?.currency ?? 'CNY') as Currency,
    today: sandboxToday(s),
    personaId: s.state.bank.personaId ?? s.state.profile?.personaId ?? null,
  }
}

const RESET_CONFIRM_MS = 3500

export function SandboxPanel({ compact = false, onDone }: SandboxPanelProps) {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { currency, today, personaId } = useSnapshot(selectSandbox, shallowEqual)
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<CategoryId | ''>('')
  const [errors, setErrors] = useState<{ merchant?: string; amount?: string }>({})
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [resultKey, setResultKey] = useState(0)
  const [armedReset, setArmedReset] = useState(false)
  const armTimer = useRef<number | undefined>(undefined)
  const ids = { buy: useId(), clock: useId(), persona: useId(), category: useId() }

  useEffect(() => () => window.clearTimeout(armTimer.current), [])

  function show(r: SandboxResult) {
    setResult(r)
    setResultKey((k) => k + 1)
  }

  async function buy(p: SandboxPreset['purchase']) {
    const out = await run(() => app.simulatePurchase(p), { errorTitle: 'The sandbox said no' })
    if (out) show({ kind: 'purchase', txn: out.txn, events: out.events })
  }

  async function submitCustom(e: FormEvent) {
    e.preventDefault()
    const check = checkPurchase(merchant, amount, category, currency)
    if (!check.ok) {
      setErrors(check.errors)
      return
    }
    setErrors({})
    await buy(check.purchase)
  }

  async function advance(days: number) {
    const from = today
    const out = await run(() => app.advanceDays(days), { errorTitle: 'The clock is stuck' })
    if (out) show({ kind: 'advance', days, from, to: sandboxToday(app.getSnapshot()), txns: out.txns, events: out.events })
  }

  async function loadPersona(id: string) {
    const ok = await run(() => {
      app.loadDemo(id)
      return true
    }, { errorTitle: 'That persona didn’t load' })
    if (!ok) return
    const label = PERSONAS.find((p) => p.id === id)?.label ?? id
    toast.show({ id: 'sandbox-persona', tone: 'neutral', title: `${label}’s sandbox is loaded`, message: `Fresh data, demo PIN ${DEMO_PIN}.` })
    show({ kind: 'persona', personaId: id })
  }

  function reset() {
    if (!armedReset) {
      setArmedReset(true)
      window.clearTimeout(armTimer.current)
      armTimer.current = window.setTimeout(() => setArmedReset(false), RESET_CONFIRM_MS)
      return
    }
    window.clearTimeout(armTimer.current)
    setArmedReset(false)
    void loadPersona(personaId ?? 'mei')
  }

  const personaValue = PERSONAS.some((p) => p.id === personaId) ? (personaId as 'mei' | 'arif') : 'mei'

  return (
    <div className={cx(styles.root, compact && styles.compact)}>
      <section className={styles.block} aria-labelledby={ids.buy}>
        <div className={styles.blockHead}>
          <ShoppingBag aria-hidden="true" />
          <h3 id={ids.buy} className={styles.blockTitle}>Simulate a purchase</h3>
        </div>
        <ul className={styles.presets} role="list">
          {PRESETS.map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.preset} onClick={() => buy(p.purchase)} title={p.demo}>
                <span className={styles.presetName}>
                  {p.label}
                  {p.note ? (
                    <span className={styles.presetNote}>
                      <Moon aria-hidden="true" />
                      {p.note}
                    </span>
                  ) : null}
                </span>
                <Money amount={p.purchase.amount} currency={currency} size="sm" className={styles.presetAmount} />
                <span className="sr-only">. {p.demo}</span>
              </button>
            </li>
          ))}
        </ul>
        <form className={styles.custom} onSubmit={submitCustom} noValidate>
          <TextField
            label="Merchant"
            placeholder="e.g. Luckin Coffee"
            value={merchant}
            onChange={(e) => setMerchant(e.currentTarget.value)}
            error={errors.merchant}
            autoComplete="off"
            className={styles.fieldMerchant}
          />
          <TextField
            label="Amount"
            inputMode="decimal"
            placeholder="128"
            prefix={CURRENCY_SYMBOL[currency]}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            error={errors.amount}
            autoComplete="off"
            className={styles.fieldAmount}
          />
          <div className={styles.selectField}>
            <label htmlFor={ids.category} className={styles.selectLabel}>Category</label>
            <select id={ids.category} className={styles.select} value={category} onChange={(e) => setCategory(e.currentTarget.value as CategoryId | '')}>
              <option value="">Let Bun guess</option>
              {PURCHASE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORIES[c].emoji} {CATEGORIES[c].label}</option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="secondary" iconStart={<Zap />} className={styles.submit}>
            Simulate purchase
          </Button>
        </form>
      </section>

      <SandboxResultView key={resultKey} result={result} currency={currency} />
      {onDone ? (
        <Button variant="secondary" fullWidth onClick={onDone} className={styles.done}>
          Done
        </Button>
      ) : null}

      <section className={styles.block} aria-labelledby={ids.clock}>
        <div className={styles.blockHead}>
          <CalendarClock aria-hidden="true" />
          <h3 id={ids.clock} className={styles.blockTitle}>Sandbox clock</h3>
          <span className={styles.today}>Today is {dateLabel(today)}</span>
        </div>
        <div className={styles.row}>
          <Button size="sm" variant="secondary" iconStart={<CalendarPlus />} onClick={() => advance(1)}>Next day</Button>
          <Button size="sm" variant="secondary" iconStart={<CalendarPlus />} onClick={() => advance(7)}>+7 days</Button>
        </div>
      </section>

      <section className={styles.block} aria-labelledby={ids.persona}>
        <div className={styles.blockHead}>
          <FlaskConical aria-hidden="true" />
          <h3 id={ids.persona} className={styles.blockTitle}>Demo persona</h3>
        </div>
        <Segmented
          label="Demo persona"
          size="sm"
          value={personaValue}
          onChange={(id) => {
            if (id !== personaId) void loadPersona(id)
          }}
          options={PERSONAS.map((p) => ({ value: p.id, label: p.label }))}
        />
        <p className={styles.personaBlurb}>{PERSONAS.find((p) => p.id === personaValue)?.blurb}</p>
        {personaId ? (
          <p className={styles.demoPin}>
            Demo PIN <strong className={styles.demoPinValue}>{DEMO_PIN}</strong> — approves payments and loosens permissions in this sandbox.
          </p>
        ) : null}
        <Button
          size="sm"
          variant={armedReset ? 'danger' : 'ghost'}
          iconStart={<RotateCcw />}
          onClick={reset}
          aria-live="polite"
        >
          {armedReset ? 'Tap again to reset everything' : 'Reset demo'}
        </Button>
      </section>
    </div>
  )
}

function SandboxResultView({ result, currency }: { result: SandboxResult | null; currency: Currency }) {
  const ref = useRef<HTMLDivElement>(null)
  // a preset tapped at the top lands its result below the form: bring it into view inside the sheet / panel
  useEffect(() => {
    if (result) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [result])
  return (
    <div ref={ref} className={styles.resultSlot} aria-live="polite" aria-atomic="true">
      {result ? <ResultBody result={result} currency={currency} /> : null}
    </div>
  )
}

function ResultBody({ result, currency }: { result: SandboxResult; currency: Currency }) {
  if (result.kind === 'persona') {
    const p = PERSONAS.find((x) => x.id === result.personaId)
    return (
      <div className={styles.result}>
        <p className={styles.resultTitle}>
          <Sparkles aria-hidden="true" />
          {p?.label ?? result.personaId}’s sandbox loaded
        </p>
        <p className={styles.resultMeta}>{p?.blurb}</p>
      </div>
    )
  }
  const events = result.events
  const head =
    result.kind === 'purchase' ? (
      <div className={styles.resultTxn}>
        <span className={styles.resultEmoji} aria-hidden="true">{CATEGORIES[result.txn.category]?.emoji ?? '🧾'}</span>
        <span className={styles.resultMain}>
          <span className={styles.resultTitle}>{result.txn.merchant}</span>
          <span className={styles.resultMeta}>
            {CATEGORIES[result.txn.category]?.label ?? result.txn.category} · {dateLabel(result.txn.date)}
          </span>
        </span>
        <Money amount={result.txn.amount} currency={currency} tone="sign" signed />
      </div>
    ) : (
      <div className={styles.resultTxn}>
        <span className={styles.resultEmoji} aria-hidden="true">🗓️</span>
        <AdvanceSummary result={result} currency={currency} />
      </div>
    )
  return (
    <div className={styles.result}>
      {head}
      {events.length ? (
        <ul className={styles.events} role="list">
          {events.map((ev) => (
            <li key={ev.id} className={styles.event}>
              {ev.dream ? <DreamImage image={ev.dream.image} alt="" size={40} /> : <span className={styles.eventIcon} aria-hidden="true"><Zap /></span>}
              <span className={styles.eventText}>
                <span className={styles.eventTitle}>
                  <Badge variant="warn" size="sm">Tripwire</Badge> {ev.title}
                </span>
                <span className={styles.eventMsg}>{ev.message}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.noEvents}>No tripwires fired.</p>
      )}
    </div>
  )
}

function AdvanceSummary({ result, currency }: { result: Extract<SandboxResult, { kind: 'advance' }>; currency: Currency }) {
  const t = advanceTotals(result.txns)
  return (
    <span className={styles.resultMain}>
      <span className={styles.resultTitle}>
        {dateLabel(result.from)} → {dateLabel(result.to)}
      </span>
      <span className={styles.resultMeta}>
        {t.count === 0 ? 'A quiet stretch: no new transactions' : (
          <>
            {t.count} new transaction{t.count === 1 ? '' : 's'} · <Money amount={t.out} currency={currency} size="xs" /> out
            {t.in > 0 ? <> · <Money amount={t.in} currency={currency} size="xs" /> in</> : null}
          </>
        )}
      </span>
    </span>
  )
}
