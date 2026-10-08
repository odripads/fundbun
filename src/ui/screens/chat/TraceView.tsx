import { BadgeCheck, Brain, CornerDownRight, Cpu, EyeOff, Route, Scale, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { TOOL_SPECS } from '../../../core/agent/specs'
import type { Currency, GroundingReport, ToolName, TraceKind, TraceStep } from '../../../core/types'
import { Disclosure } from '../../components/agent'
import { Badge, TierBadge, cx } from '../../components/ds'
import { DECISION_META, digestTrace, humanize, proposerLabel, summarizeTrace, summaryText, type TraceRow } from './model'
import styles from './TraceView.module.css'

export interface TraceViewProps {
  trace: TraceStep[]
  grounding?: GroundingReport
  engine?: 'offline' | 'llm'
  currency: Currency
}

const ICON: Record<TraceKind, ReactNode> = {
  intent: <Brain />,
  tool_call: <Wrench />,
  tool_result: <CornerDownRight />,
  policy: <Scale />,
  grounding: <BadgeCheck />,
  injection: <ShieldAlert />,
  llm: <Cpu />,
  redaction: <EyeOff />,
  error: <TriangleAlert />,
}

/** The glass box for one reply: intent, tool calls with tiers, policy decisions, taint/injection, grounding. */
export function TraceView({ trace, grounding, engine = 'offline', currency }: TraceViewProps) {
  const rows = digestTrace(trace, currency)
  const summary = summarizeTrace(rows, grounding)
  return (
    <Disclosure summary="How Bun got this" meta={summaryText(summary) || undefined} icon={<Route />} className={styles.root}>
      <div className={styles.panel}>
        <p className={styles.engine}>
          {engine === 'llm'
            ? 'Answered via the LLM gateway with minimised, redacted context. The model can only propose — FundBun’s policy engine decides.'
            : 'Answered by the on-device Bun Engine (intent classifier + rules). Nothing left this device.'}
        </p>
        <ol className={styles.list}>
          {rows.map((row, i) => (
            <li key={i} className={cx(styles.row, styles[`k-${row.kind}`], isAlarm(row) && styles.alarm)}>
              <span className={styles.icon} aria-hidden="true">{ICON[row.kind]}</span>
              <div className={styles.body}>
                <Row row={row} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Disclosure>
  )
}

function isAlarm(row: TraceRow): boolean {
  return (row.kind === 'policy' && row.decision === 'deny') || (row.kind === 'injection' && row.signals.length > 0) || (row.kind === 'grounding' && !row.ok) || row.kind === 'error'
}

function Chips({ items, tone }: { items: { key: string; value: string }[]; tone?: 'mono' }) {
  if (!items.length) return null
  return (
    <span className={styles.chips}>
      {items.map((c) => (
        <span key={c.key} className={cx(styles.chip, tone === 'mono' && styles.mono)}>
          <span className={styles.chipKey}>{c.key}</span> {c.value}
        </span>
      ))}
    </span>
  )
}

function Row({ row }: { row: TraceRow }) {
  switch (row.kind) {
    case 'intent':
      return (
        <>
          <p className={styles.title}>{row.intent ? <span>Understood: <strong>{humanize(row.intent)}</strong></span> : row.label}</p>
          {row.confidence !== undefined ? (
            <span className={styles.meter}>
              <span className={styles.meterTrack} aria-hidden="true">
                <span style={{ width: `${Math.round(row.confidence * 100)}%` }} />
              </span>
              <span>{Math.round(row.confidence * 100)}% confident</span>
              {row.rule ? <code className={styles.code}>{row.rule}</code> : null}
            </span>
          ) : null}
          <Chips items={row.slots} />
          {row.alternatives.length ? (
            <p className={styles.note}>Also considered: {row.alternatives.map((a) => `${humanize(a.intent)} ${Math.round(a.confidence * 100)}%`).join(' · ')}</p>
          ) : null}
        </>
      )
    case 'tool_call': {
      const tier = TOOL_SPECS[row.tool as ToolName]?.tier
      return (
        <>
          <p className={styles.title}>
            Called <code className={styles.code}>{row.tool}</code>
            {tier !== undefined ? <TierBadge tier={tier} size="sm" /> : null}
          </p>
          {row.proposedBy ? <p className={styles.note}>{proposerLabel(row.proposedBy)}</p> : null}
          <Chips items={row.args} tone="mono" />
        </>
      )
    }
    case 'tool_result':
      return (
        <p className={styles.title}>
          {row.label}
          {row.untrusted ? <Badge size="sm" variant="warn">Untrusted text</Badge> : null}
        </p>
      )
    case 'policy': {
      const meta = row.decision ? DECISION_META[row.decision] : null
      return (
        <>
          <p className={styles.title}>
            {meta ? <span className={cx(styles.decision, styles[`d-${meta.tone}`])}>{meta.label}</span> : null}
            {row.tool ? <code className={styles.code}>{row.tool}</code> : row.label}
            {row.tier !== undefined ? <TierBadge tier={row.tier} size="sm" showLabel={false} /> : null}
          </p>
          {row.reasons.length ? (
            <ul className={styles.reasons}>
              {row.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          ) : !meta ? null : <p className={styles.note}>{row.label}</p>}
          {row.ruleIds.length ? (
            <span className={styles.chips}>
              {row.ruleIds.map((id) => <code key={id} className={styles.code}>{id}</code>)}
            </span>
          ) : null}
          {row.tainted ? <p className={styles.note}>Tainted turn: outside text was in context, so actions wait for your tap.</p> : null}
        </>
      )
    }
    case 'injection':
      return (
        <>
          <p className={styles.title}>{row.label}</p>
          {row.reason ? <p className={styles.note}>{row.reason}</p> : null}
          {row.signals.length ? (
            <span className={styles.chips}>
              {row.signals.map((s) => <span key={s} className={cx(styles.chip, styles.danger)}>{humanize(s)}</span>)}
              {row.score !== undefined ? <span className={styles.chip}>score {Math.round(row.score * 100) / 100}</span> : null}
            </span>
          ) : null}
        </>
      )
    case 'grounding':
      return (
        <>
          <p className={styles.title}>{row.ok ? `Every number checked against tool results${row.checked ? ` (${row.checked})` : ''}` : 'Some numbers couldn’t be traced to a tool result'}</p>
          {row.ungrounded.length ? (
            <span className={styles.chips}>
              {row.ungrounded.map((u) => <span key={u} className={cx(styles.chip, styles.struck)}>{u}</span>)}
            </span>
          ) : null}
        </>
      )
    default:
      return (
        <>
          <p className={styles.title}>{row.label}</p>
          <Chips items={row.counts} />
        </>
      )
  }
}
