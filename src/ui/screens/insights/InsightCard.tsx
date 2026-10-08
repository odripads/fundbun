import { Check, ChevronDown, Lightbulb, MessageCircle, PartyPopper, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CATEGORIES } from '../../../core/categories'
import type { Currency, Insight, YearMonth } from '../../../core/types'
import { useProposeAction } from '../../components/agent'
import { DreamImage } from '../../components/brand'
import { AiBadge, Button, cx } from '../../components/ds'
import { shallowEqual, useSnapshot } from '../../state'
import { askAboutInsight, bodyWithoutDream, evidenceRows, severityView } from './model'
import styles from './InsightCard.module.css'

export interface InsightCardProps {
  insight: Insight
  month: YearMonth
  currency: Currency
  /** the lead card: bigger dream picture, title in display size */
  featured?: boolean
  /** current month only: past months' suggested actions would act on the present */
  actionable: boolean
  onAsk: (text: string) => void
  /** stagger index for the entrance */
  index?: number
  /** deep-linked (#/insights/<id>): scrolled into view, focused and briefly highlighted */
  focused?: boolean
}

const SEVERITY_ICON: Record<Insight['severity'], ReactNode> = {
  warn: <TriangleAlert />,
  positive: <PartyPopper />,
  neutral: <Lightbulb />,
}

/** One engine insight: what, what it's worth in dreams, why (rule + numbers), and what to do about it. */
export function InsightCard({ insight, month, currency, featured = false, actionable, onAsk, index = 0, focused = false }: InsightCardProps) {
  const propose = useProposeAction()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focused) return
    // after the shell's own scroll-to-top on navigation has run
    const t = window.setTimeout(() => {
      ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      ref.current?.focus({ preventScroll: true })
    }, 120)
    return () => window.clearTimeout(t)
  }, [focused])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // the PendingAction this card proposed: follow it so the button turns into "Done" (and back after an undo)
  const [pid, setPid] = useState<string | null>(null)
  const selectProposal = useCallback(
    (snap: AppSnapshot) => {
      const p = pid ? snap.state.pending.find((x) => x.id === pid) : undefined
      return { status: p?.status, tier: p?.decision.tier }
    },
    [pid],
  )
  const proposal = useSnapshot(selectProposal, shallowEqual)
  const done = proposal.status === 'executed' && (proposal.tier ?? 0) > 0
  const whyId = useId()
  const titleId = useId()
  const sev = severityView(insight.severity)
  const rows = evidenceRows(insight.evidence, currency)
  const category = insight.category ? CATEGORIES[insight.category] : null
  const action = actionable ? insight.suggestedAction : undefined

  async function run() {
    if (!action) return
    setBusy(true)
    try {
      const p = await propose(action)
      if (p) setPid(p.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      ref={ref}
      id={`insight-${insight.id}`}
      tabIndex={focused ? -1 : undefined}
      data-focused={focused || undefined}
      className={cx(styles.card, styles[insight.severity], featured && styles.featured, focused && styles.focused)}
      aria-labelledby={titleId}
      style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
    >
      <div className={styles.head}>
        <span className={cx(styles.sev, styles[`sev-${sev.tone}`])}>
          <span className={styles.sevIcon} aria-hidden="true">{SEVERITY_ICON[insight.severity]}</span>
          {sev.label}
        </span>
        {category ? (
          <span className={styles.cat}>
            <span aria-hidden="true">{category.emoji}</span> {category.label}
          </span>
        ) : null}
        <AiBadge engine="offline" className={styles.ai} />
      </div>

      <div className={styles.main}>
        <div className={styles.text}>
          <h3 id={titleId} className={styles.title}>{insight.title}</h3>
          <p className={styles.body}>{insight.dream ? bodyWithoutDream(insight.body, insight.dream.label) : insight.body}</p>
        </div>
        {featured && insight.dream ? (
          <div className={styles.featureArt} aria-hidden="true">
            <DreamImage image={insight.dream.image} alt="" size={76} glow />
          </div>
        ) : null}
      </div>

      {insight.dream ? (
        <p className={styles.dream}>
          {!featured ? <DreamImage image={insight.dream.image} alt="" size={30} className={styles.dreamPic} /> : null}
          <span className={styles.dreamText}>
            <span className={styles.dreamEq} aria-hidden="true">=</span>
            <span className="sr-only">That’s </span> {insight.dream.label}
          </span>
        </p>
      ) : null}

      {action && done ? (
        <p className={styles.done} role="status">
          <Check aria-hidden="true" />
          <span>
            <strong>Done</strong> · {action.label}
          </span>
        </p>
      ) : action ? (
        <Button size="sm" variant={featured ? 'primary' : 'secondary'} loading={busy} onClick={run} className={styles.cta}>
          {action.label}
        </Button>
      ) : null}

      <div className={styles.footer}>
        <Button size="sm" variant="ghost" className={styles.why} aria-label="Why am I seeing this?" aria-expanded={open} aria-controls={whyId} iconEnd={<ChevronDown />} onClick={() => setOpen((o) => !o)}>
          Why?
        </Button>
        <Button size="sm" variant="ghost" className={styles.ask} iconStart={<MessageCircle />} aria-label="Ask Bun about this" onClick={() => onAsk(askAboutInsight(insight, month))}>
          Ask Bun
        </Button>
      </div>

      <div id={whyId} className={styles.whyPanel} hidden={!open}>
        <p className={styles.whyText}>{insight.why}</p>
        {rows.length ? (
          <table className={styles.evidence}>
            <caption className="sr-only">The numbers behind “{insight.title}”</caption>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className={styles.whyFoot}>Worked out on your device from your own transactions.</p>
      </div>
    </article>
  )
}
