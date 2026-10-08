import { Info, ReceiptText, Lightbulb, OctagonAlert, Sparkles, TriangleAlert, Zap } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { BillFinding, Insight, SuggestedAction } from '../../../../core/types'
import { DreamImage } from '../../brand'
import { Button, Card, CardHeader, Money, cx } from '../../ds'
import { Disclosure } from '../Disclosure'
import { useProposeAction } from '../useProposeAction'
import { EvidenceChips, useCurrency, useMore, type CardProps } from './shared'
import styles from './cards.module.css'

const SEVERITY: Record<BillFinding['severity'], { icon: ReactNode; label: string }> = {
  alert: { icon: <OctagonAlert />, label: 'Needs action' },
  warn: { icon: <TriangleAlert />, label: 'Worth a look' },
  info: { icon: <Info />, label: 'Heads-up' },
}

const INSIGHT_SEVERITY: Record<Insight['severity'], { icon: ReactNode; label: string; tone: 'under' | 'warn' | 'info' }> = {
  positive: { icon: <Sparkles />, label: 'Good news', tone: 'under' },
  warn: { icon: <TriangleAlert />, label: 'Watch out', tone: 'warn' },
  neutral: { icon: <Lightbulb />, label: 'Insight', tone: 'info' },
}

/** A suggested fix — always routed through the policy engine (approval sheet / PIN as the tier requires). */
function ActionButton({ action, disabled }: { action?: SuggestedAction; disabled?: boolean }) {
  const propose = useProposeAction()
  const [busy, setBusy] = useState(false)
  if (!action) return null
  return (
    <Button
      size="sm"
      variant="soft"
      iconStart={<Zap />}
      loading={busy}
      disabled={disabled}
      className={styles.itemAction}
      onClick={async () => {
        setBusy(true)
        try {
          await propose(action)
        } finally {
          setBusy(false)
        }
      }}
    >
      {action.label}
    </Button>
  )
}

export function FindingsCard({ card }: CardProps<'findings'>) {
  const currency = useCurrency()
  const order = { alert: 0, warn: 1, info: 2 }
  const findings = [...card.findings].sort((a, b) => order[a.severity] - order[b.severity])
  const { shown, toggle } = useMore(findings, 3)
  const urgent = findings.filter((f) => f.severity === 'alert').length
  return (
    <Card as="section">
      <CardHeader
        title="Bill check"
        subtitle={findings.length ? `${findings.length} thing${findings.length === 1 ? '' : 's'} to look at${urgent ? ` · ${urgent} urgent` : ''}` : 'All clear'}
        icon={<ReceiptText />}
      />
      <ul className={styles.items}>
        {shown.map((f) => (
          <li key={f.id} className={cx(styles.item, styles[`sev-${f.severity}`])}>
            <span className={styles.itemIcon} aria-hidden="true">{SEVERITY[f.severity].icon}</span>
            <div className={styles.itemBody}>
              <p className={styles.itemKicker}>{SEVERITY[f.severity].label}</p>
              <div className={styles.itemHead}>
                <p className={styles.itemTitle}>{f.title}</p>
                {f.amount !== undefined ? <Money amount={f.amount} currency={currency} size="sm" /> : null}
              </div>
              <p className={styles.itemText}>{f.detail}</p>
              <div className={styles.itemFoot}>
                <ActionButton action={f.suggestedAction} />
                {Object.keys(f.evidence ?? {}).length ? (
                  <Disclosure summary="Why?">
                    <EvidenceChips evidence={f.evidence} currency={currency} />
                  </Disclosure>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {toggle}
    </Card>
  )
}

export function InsightsCard({ card }: CardProps<'insights'>) {
  const currency = useCurrency()
  const { shown, toggle } = useMore(card.insights, 3)
  return (
    <Card as="section">
      <CardHeader title="What Bun noticed" subtitle={`${card.insights.length} insight${card.insights.length === 1 ? '' : 's'} from your own numbers`} icon={<Lightbulb />} />
      <ul className={styles.items}>
        {shown.map((ins) => {
          const sev = INSIGHT_SEVERITY[ins.severity]
          return (
            <li key={ins.id} className={cx(styles.item, styles[`sev-${sev.tone}`])}>
              <span className={styles.itemIcon} aria-hidden="true">{sev.icon}</span>
              <div className={styles.itemBody}>
                <p className={styles.itemKicker}>{sev.label}</p>
                <p className={styles.itemTitle}>{ins.title}</p>
                <p className={styles.itemText}>{ins.body}</p>
                {ins.dream ? (
                  <p className={styles.dreamChip}>
                    <DreamImage image={ins.dream.image} alt="" size={28} />
                    <span>{ins.dream.label}</span>
                  </p>
                ) : null}
                <div className={styles.itemFoot}>
                  <ActionButton action={ins.suggestedAction} />
                  <Disclosure summary="Why am I seeing this?">
                    <p className={styles.itemText}>{ins.why}</p>
                    <EvidenceChips evidence={ins.evidence} currency={currency} />
                  </Disclosure>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {toggle}
    </Card>
  )
}
