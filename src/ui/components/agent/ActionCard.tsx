import {
    Ban,
  CircleCheck,
  CircleDashed,
  Clock3,
  Fingerprint,
  Hand,
  KeyRound,
  Landmark,
  LoaderCircle,
  Lock,
  OctagonX,
  RotateCcw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Target,
  Undo2,
} from 'lucide-react'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { PendingAction } from '../../../core/types'
import { fmt } from '../../../core/money'
import { useApp, useSnapshot } from '../../state'
import { AiBadge, Badge, Button, Money, TierBadge, cx } from '../ds'
import { useToast } from '../ds/Toast'
import { openApproval } from './approvalStore'
import { Disclosure } from './Disclosure'
import { undoWithToast, useApprovalFlow, useNow } from './hooks'
import {
  PHASE_META,
  RISK_META,
  actionPhase,
  approveLabel,
  clockTime,
  needsPin,
  secondsLeft,
  shortHash,
  timingLine,
  type ActionPhase,
} from './logic'
import styles from './ActionCard.module.css'

export interface ActionCardProps {
  pendingId: string
  /** a one-line receipt (status + Undo) instead of the full card */
  compact?: boolean
  /** 'sheet' drops the title and buttons (the approval sheet owns them) */
  variant?: 'card' | 'sheet' | 'receipt'
  /** sheet only: 'summary' = what, how much, from → to · 'assurance' = effects, risk, why, seal (the PIN pad sits between) */
  part?: 'all' | 'summary' | 'assurance'
  className?: string
}

const PHASE_ICON: Record<ActionPhase, ReactNode> = {
  pending: <Hand />,
  running: <LoaderCircle className={styles.spin} />,
  undoable: <CircleCheck />,
  done: <CircleCheck />,
  blocked: <OctagonX />,
  failed: <Ban />,
  expired: <Clock3 />,
  rejected: <CircleDashed />,
  undone: <RotateCcw />,
}

const AGENT = new Set(['offline', 'llm'])

/**
 * Structured confirmation card for a PendingAction — every word and number comes from PendingAction.preview /
 * decision (built by code, never LLM prose), so what you read is bound (bindingHash) to what runs.
 */
export function ActionCard({ pendingId, compact = false, variant, part = 'all', className }: ActionCardProps) {
  const p = useSnapshot((s) => s.state.pending.find((x) => x.id === pendingId))
  const mode = variant ?? (compact ? 'receipt' : 'card')
  if (!p) return null
  return mode === 'receipt' ? <Receipt p={p} className={className} /> : <FullCard p={p} sheet={mode === 'sheet'} part={mode === 'sheet' ? part : 'all'} className={className} />
}

const selectCurrency = (s: AppSnapshot) => s.state.profile?.currency ?? 'CNY'

function usePhase(p: PendingAction): { phase: ActionPhase; now: number } {
  const ticking = p.status === 'executed' && secondsLeft(p.undoUntil, Date.now()) > 0
  const now = useNow(ticking, 1000)
  return { phase: actionPhase(p, ticking ? now : Date.now()), now }
}

function FullCard({ p, sheet, part, className }: { p: PendingAction; sheet: boolean; part: 'all' | 'summary' | 'assurance'; className?: string }) {
  const currency = useSnapshot(selectCurrency)
  const { phase, now } = usePhase(p)
  const titleId = useId()
  const meta = PHASE_META[phase]
  const { preview, decision } = p
  const agentProposed = AGENT.has(p.call.proposedBy)
  // the sheet's title already names the amount ("Pay Electricity ¥486.20") — don't say it twice
  const showAmount = preview.amount !== undefined && !(sheet && preview.title.includes(fmt(preview.amount, currency)))
  const assurance = (
    <>
      {preview.effects.length ? (
        <ul className={styles.effects} aria-label="What changes">
          {preview.effects.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.facts}>
        <Badge size="sm" variant={preview.reversible ? 'under' : 'warn'} icon={preview.reversible ? <Undo2 /> : <Lock />}>
          {preview.reversible ? 'Reversible' : 'Final once done'}
        </Badge>
        <Badge size="sm" variant={RISK_META[preview.risk].tone} icon={preview.risk === 'high' ? <ShieldAlert /> : <ShieldCheck />}>
          {RISK_META[preview.risk].label}
        </Badge>
        {phase === 'pending' ? <span className={styles.timing}>{timingLine(p, clockTime)}</span> : null}
      </div>
      <Disclosure summary={whyLabel(p)} icon={<Scale />} meta={decision.ruleIds.length ? `${decision.ruleIds.length} rule${decision.ruleIds.length === 1 ? '' : 's'}` : undefined}>
        <ul className={styles.reasons}>
          {decision.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {decision.tainted ? <li>This conversation included outside text (a bill or memo), so nothing runs without your tap.</li> : null}
        </ul>
        {decision.ruleIds.length ? (
          <p className={styles.rules}>
            <span className="sr-only">Policy rules: </span>
            {decision.ruleIds.map((id) => (
              <code key={id} className={styles.rule}>{id}</code>
            ))}
          </p>
        ) : null}
      </Disclosure>
      {p.bindingHash ? <Seal hash={p.bindingHash} /> : null}
    </>
  )
  if (part === 'assurance') return <div className={cx(styles.card, styles.sheet, className)} data-tier={decision.tier}>{assurance}</div>
  return (
    <article
      className={cx(styles.card, sheet && styles.sheet, meta.muted && styles.muted, className)}
      data-phase={phase}
      data-tier={decision.tier}
      aria-labelledby={sheet ? undefined : titleId}
      aria-label={sheet ? preview.title : undefined}
    >
      <div className={styles.top}>
        <TierBadge tier={decision.tier} size="sm" />
        {agentProposed ? <AiBadge engine={p.call.proposedBy === 'llm' ? 'llm' : 'offline'} /> : <Badge size="sm" variant="outline">Your tap</Badge>}
        {phase !== 'pending' ? (
          <span className={cx(styles.phase, styles[`tone-${meta.tone}`])}>
            <span className={styles.phaseIcon} aria-hidden="true">{PHASE_ICON[phase]}</span>
            {meta.label}
          </span>
        ) : null}
      </div>

      {!sheet ? <h3 id={titleId} className={styles.title}>{preview.title}</h3> : null}
      {showAmount ? (
        <div className={styles.amount}>
          <Money amount={preview.amount!} currency={currency} size="xl" strike={phase === 'undone'} />
        </div>
      ) : null}

      {preview.from || preview.to ? (
        <dl className={styles.route}>
          {preview.from ? (
            <div className={styles.leg}>
              <dt>From</dt>
              <dd>
                <span className={styles.legIcon} aria-hidden="true"><Landmark /></span>
                <span>{preview.from}</span>
              </dd>
            </div>
          ) : null}
          {preview.to ? (
            <div className={cx(styles.leg, styles.legTo)}>
              <dt>To</dt>
              <dd>
                <span className={styles.legIcon} aria-hidden="true"><Target /></span>
                <span>{preview.to}</span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className={styles.summary}>{preview.summary}</p>
      )}

      {part === 'all' ? assurance : null}

      {!sheet ? <CardState p={p} phase={phase} now={now} /> : null}
    </article>
  )
}

function whyLabel(p: PendingAction): string {
  switch (p.decision.decision) {
    case 'allow': return 'Why Bun could do this on its own'
    case 'deny': return 'Why this was blocked'
    default: return p.status === 'pending' ? 'Why does this need approval?' : 'Why it needed your OK'
  }
}

/** The binding fingerprint: tap to learn what it guarantees. */
function Seal({ hash }: { hash: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={styles.seal}>
      <button type="button" className={styles.sealButton} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Fingerprint aria-hidden="true" />
        <span>
          Signed · <span className={styles.hash}>{shortHash(hash)}…</span>
        </span>
        <span className={styles.sealHint}>{open ? 'Hide' : 'What’s this?'}</span>
      </button>
      {open ? (
        <div id={id} className={styles.sealPanel}>
          <p>
            This seal is a SHA-256 fingerprint of exactly this action — the tool, the amount and the payee. FundBun checks it again
            right before running: <strong>what you approve is exactly what runs.</strong> If anything changed, nothing runs.
          </p>
          <code className={styles.fullHash}>{hash}</code>
        </div>
      ) : null}
    </div>
  )
}

function CardState({ p, phase, now }: { p: PendingAction; phase: ActionPhase; now: number }) {
  const flow = useApprovalFlow(p.id)
  const app = useApp()
  const toast = useToast()
  switch (phase) {
    case 'pending':
      return (
        <div className={styles.footer}>
          {flow.error ? <p className={styles.inlineError} role="alert">{flow.error}</p> : null}
          <div className={styles.buttons}>
            <Button variant="ghost" onClick={flow.reject} disabled={flow.busy}>Not now</Button>
            {needsPin(p) ? (
              <Button iconStart={<KeyRound />} onClick={() => openApproval(p.id)}>{approveLabel(p)}</Button>
            ) : (
              <Button iconStart={<CircleCheck />} loading={flow.busy} onClick={() => void flow.approve()}>{approveLabel(p)}</Button>
            )}
          </div>
        </div>
      )
    case 'undoable':
      return (
        <div className={cx(styles.footer, styles.successRow)}>
          <span className={styles.successText}>
            <CircleCheck aria-hidden="true" />
            Done{p.executedAt ? ` at ${clockTime(p.executedAt)}` : ''}
          </span>
          <UndoButton p={p} now={now} onUndo={() => undoWithToast(app, toast, p)} />
        </div>
      )
    case 'done':
      return (
        <div className={cx(styles.footer, styles.successRow)}>
          <span className={styles.successText}>
            <CircleCheck aria-hidden="true" />
            Done{p.executedAt ? ` at ${clockTime(p.executedAt)}` : ''} · logged in your activity
          </span>
        </div>
      )
    case 'blocked':
    case 'failed':
      return (
        <div className={cx(styles.footer, styles.blockedRow)} role="status">
          <OctagonX aria-hidden="true" />
          <p>
            <strong>{phase === 'blocked' ? 'Blocked.' : 'Didn’t run.'}</strong> {p.error ?? p.decision.reasons[0] ?? 'Nothing was moved.'}
          </p>
        </div>
      )
    case 'running':
      return <div className={cx(styles.footer, styles.mutedRow)}>Running…</div>
    default:
      return <div className={cx(styles.footer, styles.mutedRow)}>{PHASE_META[phase].label}</div>
  }
}

/** Undo with a draining ring: the window is real (the bank reverses the transfer). */
function UndoButton({ p, now, onUndo, small = false }: { p: PendingAction; now: number; onUndo: () => void; small?: boolean }) {
  const left = secondsLeft(p.undoUntil, now)
  const total = Math.max(1, Math.round((Date.parse(p.undoUntil ?? '') - Date.parse(p.executedAt ?? p.createdAt)) / 1000) || left)
  const frac = Math.min(1, left / total)
  return (
    <button
      type="button"
      className={cx(styles.undo, small && styles.undoSmall)}
      onClick={onUndo}
      aria-label={`Undo ${p.preview.title} (${left} seconds left)`}
      style={{ '--undo-frac': frac } as CSSProperties}
    >
      <span className={styles.undoRing} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" className={styles.undoTrack} />
          <circle cx="12" cy="12" r="10" className={styles.undoFill} pathLength={100} />
        </svg>
        <span className={styles.undoSecs}>{left}</span>
      </span>
      <span aria-hidden="true">Undo</span>
    </button>
  )
}

function Receipt({ p, className }: { p: PendingAction; className?: string }) {
  const currency = useSnapshot(selectCurrency)
  const app = useApp()
  const toast = useToast()
  const { phase, now } = usePhase(p)
  const meta = PHASE_META[phase]
  return (
    <div className={cx(styles.receipt, meta.muted && styles.muted, className)} data-phase={phase}>
      <span className={cx(styles.receiptIcon, styles[`tone-${meta.tone}`])} aria-hidden="true">{PHASE_ICON[phase]}</span>
      <div className={styles.receiptText}>
        <p className={styles.receiptTitle}>{p.preview.title}</p>
        <p className={styles.receiptMeta}>
          {phase === 'pending' && needsPin(p) ? 'Needs your PIN' : meta.label}
          {p.preview.amount !== undefined ? (
            <>
              {' · '}
              <Money amount={p.preview.amount} currency={currency} size="xs" strike={phase === 'undone'} />
            </>
          ) : null}
          {(phase === 'blocked' || phase === 'failed') && (p.error ?? p.decision.reasons[0]) ? ` · ${p.error ?? p.decision.reasons[0]}` : ''}
        </p>
      </div>
      {phase === 'undoable' ? <UndoButton p={p} now={now} small onUndo={() => undoWithToast(app, toast, p)} /> : null}
      {phase === 'pending' ? (
        <Button size="sm" variant="secondary" onClick={() => openApproval(p.id)}>Review</Button>
      ) : null}
    </div>
  )
}
