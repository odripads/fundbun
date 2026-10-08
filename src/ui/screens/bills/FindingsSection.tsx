import { ArrowDownRight, ChevronDown, LockKeyhole } from 'lucide-react'
import { useId, useState } from 'react'
import { toolTier } from '../../../core/agent/specs'
import type { BillFinding, Currency, DreamItem, PendingAction, Tone } from '../../../core/types'
import { DreamImage } from '../../components/brand'
import { AiBadge, Badge, Button, EmptyState } from '../../components/ds'
import { PinHint, ProposeButton, type ActionRunner } from './actions'
import { evidenceRows, findingEquivalent, KIND_LABEL, SEVERITY_META, severityCounts, trimEquivalent } from './billsView'
import { KIND_ICON, SEVERITY_ICON } from './icons'
import type { SectionKey } from './jump'
import { BillsSection } from './Section'
import shared from './sections.module.css'
import styles from './findings.module.css'

export interface FindingsSectionProps {
  currency: Currency
  tone: Tone
  findings: BillFinding[]
  dreams: DreamItem[]
  awaiting: PendingAction[]
  runner: ActionRunner
  onJump: (key: SectionKey) => void
}

/** One loud button per screen region: only urgent findings get the gold primary. */
const ACTION_VARIANT: Record<BillFinding['severity'], 'primary' | 'soft' | 'secondary'> = { alert: 'primary', warn: 'soft', info: 'secondary' }

const CALM_COPY: Record<Tone, string> = {
  gentle: 'No price hikes, double charges or surprise bills. Bun keeps checking every day.',
  cheeky: 'Not a single sneaky charge. Bun is almost disappointed.',
  numbers: '0 price hikes · 0 duplicates · 0 spikes.',
}

/** What the bill analysis found: each finding with its evidence ("Why?"), dream equivalent and one action. */
export function FindingsSection({ currency, tone, findings, dreams, awaiting, runner, onJump }: FindingsSectionProps) {
  const counts = severityCounts(findings)
  const parts = [
    counts.alert ? `${counts.alert} to act on now` : null,
    counts.warn ? `${counts.warn} worth a look` : null,
    counts.info ? `${counts.info} good to know` : null,
  ].filter(Boolean)

  return (
    <BillsSection
      section="findings"
      eyebrow="Bun’s bill check"
      title="What Bun found"
      aside={<AiBadge engine="offline" />}
      lead={
        findings.length > 0 ? (
          <>
            <span>{parts.join(' · ')}. Tap “Why?” for the numbers behind each one.</span>
            {findings.some((f) => f.suggestedAction && toolTier(f.suggestedAction.tool) === 3) ? <PinHint tool="pay_bill">Paying, cancelling and disputing need your PIN</PinHint> : null}
          </>
        ) : undefined
      }
    >
      {findings.length === 0 ? (
        <div className={styles.calm}>
          <EmptyState compact mood="happy" title="All calm on the bills front" body={CALM_COPY[tone]} />
        </div>
      ) : (
        <ul className={shared.list}>
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} currency={currency} dreams={dreams} awaiting={awaiting} runner={runner} onJump={onJump} />
          ))}
        </ul>
      )}
    </BillsSection>
  )
}

interface FindingCardProps {
  finding: BillFinding
  currency: Currency
  dreams: DreamItem[]
  awaiting: PendingAction[]
  runner: ActionRunner
  onJump: (key: SectionKey) => void
}

function FindingCard({ finding, currency, dreams, awaiting, runner, onJump }: FindingCardProps) {
  const [open, setOpen] = useState(false)
  const whyId = useId()
  const titleId = useId()
  const meta = SEVERITY_META[finding.severity]
  const rows = evidenceRows(finding, currency)
  const eq = findingEquivalent(finding, dreams)
  const action = finding.suggestedAction
  const readOnly = action ? toolTier(action.tool) === 0 : false
  const needsPin = action ? toolTier(action.tool) === 3 : false

  return (
    <li className={styles.card} data-severity={finding.severity} aria-labelledby={titleId}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          {KIND_ICON[finding.kind]}
        </span>
        <div className={styles.titles}>
          <p className={styles.kicker}>
            <Badge size="sm" variant={meta.tone} icon={SEVERITY_ICON[finding.severity]}>
              {meta.label}
            </Badge>
            <span>{KIND_LABEL[finding.kind]}</span>
          </p>
          <h3 id={titleId} className={styles.title}>
            {finding.title}
          </h3>
        </div>
      </div>

      <p className={styles.detail}>{trimEquivalent(finding.detail, eq?.label)}</p>

      {eq ? (
        <p className={styles.dream}>
          <DreamImage image={eq.image} alt="" size={40} />
          <span className={styles.dreamText}>
            <span className={styles.dreamCap}>Every year, that’s</span>
            <strong>{eq.label}</strong>
          </span>
        </p>
      ) : null}

      <div className={styles.actions}>
        {action && readOnly && action.tool === 'list_recurring' ? (
          <Button variant="secondary" size="sm" iconEnd={<ArrowDownRight />} onClick={() => onJump('subscriptions')}>
            {action.label}
          </Button>
        ) : action && !readOnly ? (
          <ProposeButton
            action={action}
            awaiting={awaiting}
            run={runner.run}
            busy={runner.busy}
            variant={ACTION_VARIANT[finding.severity]}
            size="sm"
            icon={needsPin ? <LockKeyhole /> : undefined}
            ariaLabel={needsPin ? `${action.label} (needs your PIN)` : undefined}
          />
        ) : null}
        {rows.length > 0 ? (
          <button type="button" className={styles.why} aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((v) => !v)}>
            Why?
            <ChevronDown aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div id={whyId} className={styles.whyPanel} data-open={open || undefined} inert={!open} aria-hidden={!open}>
          <div className={styles.whyInner}>
            <p className={styles.whyTitle}>The numbers behind this</p>
            <dl className={styles.evidence}>
              {rows.map((r) => (
                <div key={r.key} className={styles.row}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.whyNote}>Rule-based check, done on your device</p>
          </div>
        </div>
      ) : null}
    </li>
  )
}
