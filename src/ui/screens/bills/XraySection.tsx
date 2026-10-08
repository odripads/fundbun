import { Bell, BellRing, CircleCheck, CreditCard, Lock, ScanLine, ShieldCheck, Sparkles, TrendingDown, TrendingUp, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { CATEGORIES } from '../../../core/categories'
import { dateLabel, monthLabel } from '../../../core/dates'
import { fmt } from '../../../core/money'
import { scanForInjection } from '../../../core/security/injection'
import type { Bill, BillFinding, ChatCard, ChatMessage, Currency, ISODate, Payee, PendingAction, XrayResult } from '../../../core/types'
import { BunMascot } from '../../components/brand'
import { AiBadge, Badge, Button, Callout, Chip, Money, TextField, cx } from '../../components/ds'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { errorText, useApp } from '../../state'
import { PinHint, ProposeButton, type ActionRunner } from './actions'
import {
  billIcon,
  displayStatus,
  flaggedLines,
  matchBill,
  otherWarnings,
  payAction,
  payeeOf,
  primaryExcerpt,
  receiptClean,
  relativeDay,
  reminderAction,
  REMINDER_DAYS,
  safetyReceipt,
  signalLabel,
  xraySamples,
  type SafetyReceipt,
} from './billsView'
import { BILL_ICON } from './icons'
import { BillsSection } from './Section'
import styles from './xray.module.css'

export interface XraySectionProps {
  currency: Currency
  profileName: string
  today: ISODate
  bills: Bill[]
  payees: Payee[]
  findings: BillFinding[]
  reminders: Record<string, number>
  awaiting: PendingAction[]
  runner: ActionRunner
}

type RunState =
  | { status: 'idle' }
  | { status: 'running'; sampleId?: string }
  | { status: 'done'; message: ChatMessage; text: string; receipt: SafetyReceipt }
  | { status: 'error'; error: string }

/** Long enough to see the scan happen; the offline engine itself answers instantly. */
const MIN_SCAN_MS = 650
const MAX_TEXT = 20_000

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Bill X-ray: paste a bill (or load a sandbox one) → app.xrayBill → merchant, period, total, line items, the
 * comparison with history and — when the text hides instructions for an AI — a calm, unmissable banner.
 */
export function XraySection({ currency, profileName, today, bills, payees, findings, reminders, awaiting, runner }: XraySectionProps) {
  const app = useApp()
  const reduced = useReducedMotion()
  const [text, setText] = useState('')
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const outcomeRef = useRef<HTMLDivElement>(null)
  const samples = xraySamples(bills, findings, profileName)
  const busy = run.status === 'running'

  useEffect(() => {
    if (run.status !== 'done') return
    const target = outcomeRef.current?.querySelector<HTMLElement>('h3')
    target?.focus({ preventScroll: true })
    outcomeRef.current?.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [run, reduced])

  async function xray(input: string, sampleId?: string) {
    const clean = input.trim().slice(0, MAX_TEXT)
    if (!clean || busy) return
    const before = app.getSnapshot().state
    setRun({ status: 'running', sampleId })
    try {
      const [message] = await Promise.all([app.xrayBill(clean), wait(reduced ? 0 : MIN_SCAN_MS)])
      setRun({ status: 'done', message, text: clean, receipt: safetyReceipt(before, app.getSnapshot().state) })
    } catch (e) {
      setRun({ status: 'error', error: errorText(e) })
    }
  }

  function loadSample(bill: Bill) {
    if (!bill.rawText) return
    setText(bill.rawText)
    void xray(bill.rawText, bill.id)
  }

  function clear() {
    setText('')
    setRun({ status: 'idle' })
  }

  return (
    <BillsSection
      section="xray"
      eyebrow="Paste · scan · understand"
      title="Bill X-ray"
      aside={<AiBadge engine="offline" />}
      lead={<span>Bun pulls out the total, due date and line items, compares them with your history — and reads every bill as data, never as instructions.</span>}
    >
      <div className={styles.panel}>
        {samples.length > 0 ? (
          <div className={styles.samples}>
            <p className={styles.samplesLabel} id="xray-samples">
              Try a bill from your sandbox bank
            </p>
            <div className={styles.chips} role="group" aria-labelledby="xray-samples">
              {samples.map((s) => (
                <Chip
                  key={s.bill.id}
                  tone={s.featured ? 'accent' : 'default'}
                  icon={s.featured ? <Sparkles /> : BILL_ICON[billIcon(s.bill)]}
                  onClick={() => loadSample(s.bill)}
                  disabled={busy}
                  className={cx(s.featured && styles.featured)}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            void xray(text)
          }}
        >
          <div className={styles.fieldWrap} data-scanning={busy || undefined}>
            <TextField
              multiline
              label="Paste a bill or statement"
              value={text}
              maxLength={MAX_TEXT}
              rows={6}
              spellCheck={false}
              placeholder="e.g. the text of an electricity bill, phone bill or card statement"
              hint="Stays on this device. Anything written to an AI inside a bill is ignored."
              onChange={(e) => setText(e.currentTarget.value)}
              className={styles.field}
            />
            <span className={styles.beam} aria-hidden="true" />
          </div>
          <div className={styles.formActions}>
            <Button type="submit" iconStart={<ScanLine />} loading={busy} disabled={!text.trim()} className={styles.go}>
              {busy ? 'Reading it as data…' : 'X-ray this bill'}
            </Button>
            {text || run.status !== 'idle' ? (
              <Button type="button" variant="ghost" iconStart={<X />} onClick={clear} disabled={busy}>
                Clear
              </Button>
            ) : null}
          </div>
        </form>
      </div>

      {/* a short announcement; the full result is reached by moving focus to its heading */}
      <p className="sr-only" role="status">
        {statusLine(run)}
      </p>
      <div ref={outcomeRef} className={styles.outcome} data-xray-outcome aria-busy={busy}>
        {run.status === 'error' ? (
          <Callout tone="warn" title="Bun couldn’t read that bill">
            {run.error}
          </Callout>
        ) : null}
        {run.status === 'done' ? (
          <Outcome
            message={run.message}
            text={run.text}
            receipt={run.receipt}
            currency={currency}
            today={today}
            bills={bills}
            payees={payees}
            reminders={reminders}
            awaiting={awaiting}
            runner={runner}
          />
        ) : null}
      </div>
    </BillsSection>
  )
}

function statusLine(run: RunState): string {
  if (run.status === 'running') return 'Reading the bill as data…'
  if (run.status === 'error') return 'Bun couldn’t read that bill.'
  if (run.status !== 'done') return ''
  const result = xrayOf(run.message.cards)
  if (result?.injection.suspicious) return 'X-ray done. Hidden instructions found and ignored — nothing was paid or moved.'
  return result ? `X-ray done: ${result.merchant ?? 'unknown sender'}.` : 'X-ray done.'
}

// ───────────────────────────── outcome ─────────────────────────────

interface OutcomeProps {
  message: ChatMessage
  text: string
  receipt: SafetyReceipt
  currency: Currency
  today: ISODate
  bills: Bill[]
  payees: Payee[]
  reminders: Record<string, number>
  awaiting: PendingAction[]
  runner: ActionRunner
}

function xrayOf(cards: ChatCard[] | undefined): XrayResult | undefined {
  const card = cards?.find((c): c is Extract<ChatCard, { type: 'xray' }> => c.type === 'xray')
  return card?.result
}

function Outcome({ message, text, receipt, currency, today, bills, payees, reminders, awaiting, runner }: OutcomeProps) {
  const result = xrayOf(message.cards)
  const suspicious = Boolean(result?.injection.suspicious)
  // the banner already says what an injection notice would; keep any other notice the agent attached
  const notices = (message.cards ?? []).filter((c): c is Extract<ChatCard, { type: 'notice' }> => c.type === 'notice' && !(suspicious && /instruction/i.test(`${c.title} ${c.text}`)))

  return (
    <div className={styles.outcomeInner}>
      {result && suspicious ? <InjectionBanner result={result} text={text} receipt={receipt} /> : null}

      <div className={styles.reply}>
        <BunMascot size={40} mood={suspicious ? 'calm' : 'happy'} className={styles.replyBun} />
        <div className={styles.bubble}>
          <AiBadge engine={message.engine ?? 'offline'} />
          <p>{message.text}</p>
        </div>
      </div>

      {notices.map((n, i) => (
        <Callout key={i} tone={n.level === 'block' ? 'block' : n.level === 'warn' ? 'warn' : 'info'} title={n.title}>
          {n.text}
        </Callout>
      ))}

      {result ? (
        <XrayCard result={result} currency={currency} today={today} bills={bills} payees={payees} reminders={reminders} awaiting={awaiting} runner={runner} suspicious={suspicious} />
      ) : (
        <h3 className="sr-only" tabIndex={-1}>
          X-ray reply
        </h3>
      )}
    </div>
  )
}

// ───────────────────────────── injection banner ─────────────────────────────

function InjectionBanner({ result, text, receipt }: { result: XrayResult; text: string; receipt: SafetyReceipt }) {
  const titleId = useId()
  const lines = flaggedLines(text, scanForInjection)
  const fallback = lines.length === 0 ? primaryExcerpt(result.injection.excerpts) : undefined
  const clean = receiptClean(receipt)
  const scannerDown = result.injection.signals.includes('scanner-unavailable')

  return (
    <section className={styles.inject} aria-labelledby={titleId}>
      <div className={styles.injHead}>
        <span className={styles.shield} aria-hidden="true">
          <ShieldCheck />
        </span>
        <div className={styles.injTitles}>
          <p className={styles.injKicker}>{scannerDown ? 'Treated as untrusted' : 'Prompt injection blocked'}</p>
          <h3 id={titleId} className={styles.injTitle} tabIndex={-1}>
            Hidden instructions ignored
          </h3>
        </div>
      </div>

      <p className={styles.injBody}>
        {clean
          ? 'This bill contains hidden instructions aimed at AI assistants. FundBun ignored them — nothing was paid or moved.'
          : 'This bill contains hidden instructions aimed at AI assistants. FundBun did not follow them — check Activity for what changed while it ran.'}
      </p>

      {lines.length > 0 || fallback ? (
        <figure className={styles.quote}>
          <figcaption>What the bill tried to tell Bun</figcaption>
          {lines.length > 0 ? (
            lines.map((l, i) => (
              <blockquote key={i}>
                {l.text}
              </blockquote>
            ))
          ) : (
            <blockquote>{fallback}</blockquote>
          )}
        </figure>
      ) : null}

      {result.injection.signals.length > 0 ? (
        <div className={styles.signals}>
          <p className={styles.signalsLabel} id={`${titleId}-signals`}>
            What the scanner caught
          </p>
          <ul aria-labelledby={`${titleId}-signals`}>
            {result.injection.signals.map((s) => (
              <li key={s}>{signalLabel(s)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className={styles.receipt} aria-label="Checked after the scan">
        <ReceiptItem ok={receipt.txnsAdded === 0} okText="No money moved" badText={`${receipt.txnsAdded} new transactions`} />
        <ReceiptItem ok={receipt.payeesAdded === 0} okText="No payee added" badText={`${receipt.payeesAdded} new payees`} />
        <ReceiptItem ok={receipt.actionsQueued === 0} okText="Nothing queued" badText={`${receipt.actionsQueued} actions waiting for you`} />
        {receipt.auditSeq !== undefined ? <ReceiptItem ok okText={`Logged · audit #${receipt.auditSeq}`} badText="" /> : null}
      </ul>
    </section>
  )
}

function ReceiptItem({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <li data-ok={ok || undefined}>
      {ok ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
      {ok ? okText : badText}
    </li>
  )
}

// ───────────────────────────── the x-ray card ─────────────────────────────

interface XrayCardProps {
  result: XrayResult
  currency: Currency
  today: ISODate
  bills: Bill[]
  payees: Payee[]
  reminders: Record<string, number>
  awaiting: PendingAction[]
  runner: ActionRunner
  suspicious: boolean
}

function XrayCard({ result, currency, today, bills, payees, reminders, awaiting, runner, suspicious }: XrayCardProps) {
  const titleId = useId()
  const icon = billIcon({ name: result.merchant ?? '', category: result.category ?? 'other' })
  const category = result.category ? CATEGORIES[result.category].label : 'Bill'
  const meta = [result.period ? monthLabel(result.period, 'short') : null, result.maskedAccount ? `account ${result.maskedAccount}` : null].filter(Boolean).join(' · ')
  const warnings = otherWarnings(result)
  const bill = matchBill(result, bills)
  const payee = bill ? payeeOf(bill, payees) : undefined
  const billStatus = bill ? displayStatus(bill, today) : undefined
  const payable = billStatus === 'upcoming' || billStatus === 'overdue'
  const itemsTotal = result.lineItems.reduce((s, li) => s + li.amount, 0)

  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <header className={styles.cardHead}>
        <span className={styles.cardIcon} data-icon={icon} aria-hidden="true">
          {BILL_ICON[icon]}
        </span>
        <div className={styles.cardTitles}>
          <p className={styles.cardKicker}>X-ray · {category}</p>
          <h3 id={titleId} className={styles.cardTitle} tabIndex={-1}>
            {result.merchant ?? 'Unknown sender'}
          </h3>
          {meta ? (
            <p className={styles.cardMeta}>
              {result.maskedAccount ? <Lock aria-hidden="true" /> : null}
              {meta}
            </p>
          ) : null}
        </div>
      </header>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Total due</dt>
          <dd>{result.total !== undefined ? <Money amount={result.total} currency={currency} size="xl" /> : <span className={styles.missing}>Not found</span>}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Due</dt>
          <dd>
            {result.dueDate ? (
              <>
                <span className={styles.factBig}>{dateLabel(result.dueDate)}</span>
                <span className={styles.factSub}>{relativeDay(result.dueDate, today)}</span>
              </>
            ) : (
              <span className={styles.missing}>Not found</span>
            )}
          </dd>
        </div>
      </dl>

      {result.comparison && result.total !== undefined ? <Comparison total={result.total} usual={result.comparison.previousAverage} pct={result.comparison.changePct} currency={currency} /> : null}

      {result.lineItems.length > 0 ? (
        <div className={styles.items}>
          <p className={styles.itemsLabel} aria-hidden="true">
            Line items
          </p>
          <table>
            <caption className="sr-only">Line items on this bill</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {result.lineItems.map((li, i) => (
                <tr key={i}>
                  <th scope="row">{li.label}</th>
                  <td>
                    <Money amount={li.amount} currency={currency} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
            {result.lineItems.length > 1 ? (
              <tfoot>
                <tr>
                  <th scope="row">Adds up to</th>
                  <td>
                    <Money amount={itemsTotal} currency={currency} size="sm" />
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <ul className={styles.warnings}>
          {warnings.map((w) => (
            <li key={w}>
              <TriangleAlert aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {bill && payable ? (
        <div className={styles.cardActions}>
          <p className={styles.payNote}>
            <ShieldCheck aria-hidden="true" />
            <span>
              {suspicious ? 'Paying goes to ' : 'Matches your bill from '}
              <strong>{payee?.name ?? bill.name}</strong>
              {payee?.verified ? ' (verified)' : ''}
              {suspicious ? ' — never to an account written in the bill.' : '.'}
            </span>
          </p>
          <div className={styles.actionRow}>
            <ProposeButton
              action={payAction(bill, currency)}
              awaiting={awaiting}
              run={runner.run}
              busy={runner.busy}
              size="sm"
              icon={<CreditCard />}
              className={styles.grow}
              ariaLabel={`Pay ${bill.name} ${fmt(bill.amountDue, currency)} to ${payee?.name ?? 'the verified payee'}`}
            />
            {reminders[bill.id] === undefined ? (
              <ProposeButton
                action={reminderAction(bill)}
                awaiting={awaiting}
                run={runner.run}
                busy={runner.busy}
                variant="secondary"
                size="sm"
                icon={<Bell />}
                label="Remind me"
                ariaLabel={`Remind me ${REMINDER_DAYS} days before ${bill.name} is due`}
              />
            ) : (
              <span className={styles.reminderOn}>
                <BellRing aria-hidden="true" />
                Reminder set
              </span>
            )}
          </div>
          <PinHint tool="pay_bill" />
        </div>
      ) : bill && billStatus === 'scheduled' ? (
        <p className={styles.payNote}>
          <CircleCheck aria-hidden="true" />
          <span>Already scheduled for {dateLabel(bill.scheduledFor ?? bill.dueDate)}.</span>
        </p>
      ) : bill && billStatus === 'paid' ? (
        <p className={styles.payNote}>
          <CircleCheck aria-hidden="true" />
          <span>Already paid — nothing to do.</span>
        </p>
      ) : !bill ? (
        <p className={styles.payNote}>
          <Lock aria-hidden="true" />
          <span>Not one of your sandbox bills, so there’s nothing to pay here. Bun only ever pays payees you’ve already verified.</span>
        </p>
      ) : null}
    </article>
  )
}

function Comparison({ total, usual, pct, currency }: { total: number; usual: number; pct: number; currency: Currency }) {
  const max = Math.max(total, usual, 1)
  const rounded = Math.round(pct)
  const tone = rounded >= 25 ? 'over' : rounded >= 10 ? 'warn' : rounded <= -10 ? 'under' : 'flat'
  const label = rounded === 0 ? 'Same as usual' : `${rounded > 0 ? '+' : ''}${rounded}% vs usual`
  return (
    <div className={styles.compare} data-tone={tone}>
      <div className={styles.compareHead}>
        <p className={styles.compareLabel}>Compared with your last bills</p>
        <Badge size="sm" variant={tone === 'flat' ? 'neutral' : tone} icon={rounded >= 0 ? <TrendingUp /> : <TrendingDown />}>
          {label}
        </Badge>
      </div>
      <div className={styles.bars} role="img" aria-label={`This bill ${fmt(total, currency)} against your usual ${fmt(usual, currency)}: ${label}.`}>
        <span className={styles.barLabel}>Your usual</span>
        <span className={styles.track}>
          <span className={styles.barUsual} style={{ inlineSize: `${(usual / max) * 100}%` }} />
        </span>
        <span className={styles.barValue}>{fmt(usual, currency)}</span>
        <span className={styles.barLabel}>This bill</span>
        <span className={styles.track}>
          <span className={styles.barThis} style={{ inlineSize: `${(total / max) * 100}%` }} />
        </span>
        <span className={styles.barValue}>{fmt(total, currency)}</span>
      </div>
    </div>
  )
}
