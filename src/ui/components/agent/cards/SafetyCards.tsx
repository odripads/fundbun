import { Check, Info, Landmark, ScanLine, ShieldAlert, ShieldX, Sparkles, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AppSnapshot } from '../../../../core/app-api'
import { dateLabel, monthLabel } from '../../../../core/dates'
import { fmt } from '../../../../core/money'
import type { DreamItem } from '../../../../core/types'
import { useSnapshot } from '../../../state'
import { DreamImage } from '../../brand'
import { Badge, Callout, Card, CardHeader, Money, cx, type CalloutTone } from '../../ds'
import { signalLabel } from '../logic'
import { useCurrency, useSend, type CardProps } from './shared'
import styles from './cards.module.css'

// ───────────────────────────── bill x-ray ─────────────────────────────

export function XrayCard({ card }: CardProps<'xray'>) {
  const r = card.result
  const currency = useCurrency()
  const otherWarnings = r.warnings.filter((w) => !/instruction|assistant/i.test(w))
  const lineTotal = r.lineItems.reduce((s, l) => s + l.amount, 0)
  return (
    <Card as="section" className={styles.xray}>
      <CardHeader
        title="Bill X-ray"
        subtitle={[r.merchant, r.period ? monthLabel(r.period, 'short') : null].filter(Boolean).join(' · ') || 'Pasted bill'}
        icon={<ScanLine />}
      />
      {r.injection.suspicious ? (
        <Callout tone="block" icon={<ShieldAlert />} title="Hidden instructions found — ignored" className={styles.gapBelow}>
          This bill tries to give orders to AI assistants. FundBun reads bill text as data, never as commands — nothing was moved.
          {r.injection.signals.length ? (
            <span className={styles.signals}>
              {r.injection.signals.map((s) => (
                <span key={s} className={styles.signal}>{signalLabel(s)}</span>
              ))}
            </span>
          ) : null}
        </Callout>
      ) : null}
      <div className={styles.totalRow}>
        {r.total !== undefined ? <Money amount={r.total} currency={currency} size="lg" /> : <span className={styles.totalOf}>No total found</span>}
        {r.dueDate ? <span className={styles.totalOf}>due {dateLabel(r.dueDate)}</span> : null}
        {r.comparison ? (
          <Badge size="sm" variant={r.comparison.changePct > 10 ? 'over' : 'neutral'} icon={<TrendingUp />} className={styles.push}>
            {r.comparison.changePct > 0 ? '+' : ''}{Math.round(r.comparison.changePct)}% vs usual
          </Badge>
        ) : null}
      </div>
      {r.maskedAccount ? (
        <p className={styles.minorRow}>
          <Landmark aria-hidden="true" /> Account {r.maskedAccount}
          {r.comparison ? ` · your usual is ${fmt(r.comparison.previousAverage, currency)}` : ''}
        </p>
      ) : null}
      {r.lineItems.length ? (
        <table className={cx(styles.table, styles.lineItems)}>
          <caption className="sr-only">Line items</caption>
          <tbody>
            {r.lineItems.map((l, i) => (
              <tr key={i}>
                <th scope="row">{l.label}</th>
                <td>{fmt(l.amount, currency)}</td>
              </tr>
            ))}
          </tbody>
          {r.lineItems.length > 1 ? (
            <tfoot>
              <tr>
                <th scope="row">Line items total</th>
                <td>{fmt(lineTotal, currency)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      ) : null}
      {otherWarnings.length ? (
        <ul className={styles.bullets}>
          {otherWarnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      ) : null}
    </Card>
  )
}

// ───────────────────────────── notice ─────────────────────────────

const NOTICE: Record<'info' | 'warn' | 'block', { tone: CalloutTone; icon: ReactNode }> = {
  info: { tone: 'info', icon: <Info /> },
  warn: { tone: 'warn', icon: <ShieldAlert /> },
  block: { tone: 'block', icon: <ShieldX /> },
}

export function NoticeCard({ card }: CardProps<'notice'>) {
  const n = NOTICE[card.level]
  return (
    <Callout tone={n.tone} icon={n.icon} title={card.title} className={cx(styles.notice, card.level === 'block' && styles.noticeBlock)}>
      {card.text}
    </Callout>
  )
}

// ───────────────────────────── clarify ─────────────────────────────

const selectDreams = (s: AppSnapshot): DreamItem[] => s.state.dreams

function same(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
}

/** "Which one?" — options are real choices (dream pictures when they name a dream); the answer is sent as chat. */
export function ClarifyCard({ card, context }: CardProps<'clarify'>) {
  const send = useSend(context)
  const dreams = useSnapshot(selectDreams)
  const answered = context.answer !== undefined && context.answer !== null
  const showQuestion = !same(context.messageText, card.question)
  return (
    <div className={styles.clarify} role="group" aria-label={card.question}>
      {showQuestion ? <p className={styles.clarifyQ}>{card.question}</p> : null}
      <div className={styles.options}>
        {card.options.map((o) => {
          const dream = dreams.find((d) => same(d.name, o.label))
          const picked = answered && same(context.answer, o.value)
          return (
            <button
              key={o.value}
              type="button"
              className={cx(styles.option, picked && styles.optionPicked)}
              disabled={answered}
              aria-pressed={answered ? picked : undefined}
              onClick={() => send(o.value)}
            >
              {dream ? <DreamImage image={dream.image} alt="" size={30} /> : <span className={styles.optionIcon} aria-hidden="true"><Sparkles /></span>}
              <span>{o.label}</span>
              {picked ? <Check aria-hidden="true" className={styles.optionCheck} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
