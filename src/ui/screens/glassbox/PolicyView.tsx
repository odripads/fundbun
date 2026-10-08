/**
 * Glass box · Policy: the user's mandate as the policy engine sees it right now (autonomy, caps and their use,
 * freeze / breaker state) and the latest decisions it made.
 */
import { Gauge, OctagonPause, Play, Scale, Snowflake } from 'lucide-react'
import { useMemo } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { Currency } from '../../../core/types'
import { Money, ProgressBar, TierBadge, cx } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { timeLabel } from '../activity/logic'
import { AUTONOMY_META, AUTONOMY_ORDER } from '../settings/logic'
import { DECISION_META, decisionCounts, recentDecisions } from './logic'
import styles from './GlassBox.module.css'

function selectPolicy(s: AppSnapshot) {
  return {
    mandate: s.state.mandate,
    // counted exactly as the policy engine counts it (security/policy.agentMoneyUsed via derived.capUsage)
    usedToday: s.derived.capUsage.today,
    usedMonth: s.derived.capUsage.month,
    audit: s.state.audit,
    awaiting: s.derived.awaiting.length,
    currency: (s.state.profile?.currency ?? 'CNY') as Currency,
  }
}

export function PolicyView() {
  const { mandate, usedToday, usedMonth, audit, awaiting, currency } = useSnapshot(selectPolicy, shallowEqual)
  const usage = { today: usedToday, month: usedMonth }
  const counts = useMemo(() => decisionCounts(audit), [audit])
  const recent = useMemo(() => recentDecisions(audit, 5), [audit])
  const total = counts.allow + counts.confirm + counts.step_up + counts.deny
  const level = AUTONOMY_ORDER.indexOf(mandate.autonomy)
  const state = mandate.frozen ? (mandate.breakerTrippedAt ? 'breaker' : 'frozen') : 'active'

  return (
    <div className={styles.stack}>
      <section className={cx(styles.mandate, state !== 'active' && styles.mandateFrozen)} aria-labelledby="gb-mandate">
        <div className={styles.mandateHead}>
          <h3 id="gb-mandate" className={styles.blockTitle}>Mandate</h3>
          <span className={cx(styles.state, styles[`state_${state}`])}>
            {state === 'active' ? <Play aria-hidden="true" /> : state === 'breaker' ? <OctagonPause aria-hidden="true" /> : <Snowflake aria-hidden="true" />}
            {state === 'active' ? 'Active' : state === 'breaker' ? 'Breaker tripped' : 'Frozen'}
          </span>
        </div>
        {mandate.breakerReason ? <p className={styles.breaker}>{mandate.breakerReason}</p> : null}
        <div className={styles.autonomy}>
          <span className={styles.autonomyLabel}>
            <Gauge aria-hidden="true" /> Autonomy <strong>{AUTONOMY_META[mandate.autonomy]?.label ?? mandate.autonomy}</strong>
          </span>
          <span className={styles.ladder} role="img" aria-label={`Level ${level + 1} of ${AUTONOMY_ORDER.length}`}>
            {AUTONOMY_ORDER.map((a, i) => (
              <span key={a} className={cx(styles.rung, i <= level && styles.rungOn, i === level && styles.rungNow)} title={AUTONOMY_META[a].label} />
            ))}
          </span>
        </div>
        <div className={styles.caps}>
          <div className={styles.capRow}>
            <span className={styles.capLabel}>Per action</span>
            <span className={styles.capValue}><Money amount={mandate.perActionCap} currency={currency} size="sm" /></span>
          </div>
          <ProgressBar
            size="sm"
            tone="budget"
            value={usage.today}
            max={mandate.dailyCap}
            label="Moved today"
            valueLabel={<><Money amount={usage.today} currency={currency} size="xs" /> of <Money amount={mandate.dailyCap} currency={currency} size="xs" /></>}
          />
          <ProgressBar
            size="sm"
            tone="budget"
            value={usage.month}
            max={mandate.monthlyCap}
            label="Moved this month"
            valueLabel={<><Money amount={usage.month} currency={currency} size="xs" /> of <Money amount={mandate.monthlyCap} currency={currency} size="xs" /></>}
          />
        </div>
        <dl className={styles.counts}>
          <div>
            <dt>Waiting</dt>
            <dd>{awaiting}</dd>
          </div>
          <div className={counts.deny ? styles.countBad : undefined}>
            <dt>Denied</dt>
            <dd>{counts.deny}</dd>
          </div>
          <div>
            <dt>Tools off</dt>
            <dd>{mandate.disabledTools.length}</dd>
          </div>
          <div>
            <dt>PIN fails</dt>
            <dd>{mandate.failedPinAttempts}</dd>
          </div>
        </dl>
        <button type="button" className={styles.linkish} onClick={() => navigate('settings')}>Change permissions in Settings</button>
      </section>

      {total > 0 ? (
        <section aria-labelledby="gb-mix" className={styles.block}>
          <h3 id="gb-mix" className={styles.blockTitle}>Every decision so far <span className={styles.mini}>{total}</span></h3>
          <div className={styles.mix} role="img" aria-label={`Allowed ${counts.allow}, confirm ${counts.confirm}, step-up ${counts.step_up}, denied ${counts.deny}`}>
            {(['allow', 'confirm', 'step_up', 'deny'] as const).map((d) =>
              counts[d] ? <span key={d} className={styles[`mix_${DECISION_META[d].tone}`]} style={{ flexGrow: counts[d] }} /> : null,
            )}
          </div>
          <ul className={styles.mixLegend} role="list">
            {(['allow', 'confirm', 'step_up', 'deny'] as const).map((d) => (
              <li key={d}>
                <span className={cx(styles.pill, styles[`pill_${DECISION_META[d].tone}`])}>{DECISION_META[d].label}</span>
                <span className={styles.mixNum}>{counts[d]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="gb-recent" className={styles.block}>
        <h3 id="gb-recent" className={styles.blockTitle}>Latest decisions</h3>
        {recent.length ? (
          <ol className={styles.decisions}>
            {recent.map((d) => (
              <li key={d.seq} className={styles.decision}>
                <span className={cx(styles.pill, styles[`pill_${DECISION_META[d.decision].tone}`])}>{DECISION_META[d.decision].label}</span>
                <span className={styles.decisionMain}>
                  <span className={styles.decisionTop}>
                    <code className={styles.tool}>{d.tool}</code>
                    {d.tier !== undefined ? <TierBadge tier={d.tier} size="sm" showLabel={false} /> : null}
                    {d.tainted ? <span className={styles.flag}>tainted</span> : null}
                  </span>
                  <span className={styles.chips}>
                    {d.ruleIds.map((r) => <code key={r} className={styles.rule}>{r}</code>)}
                  </span>
                </span>
                <time className={styles.decisionTime} dateTime={d.ts}>{timeLabel(d.ts)}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.quiet}>
            <Scale aria-hidden="true" /> No decisions yet. Every tool call Bun proposes is checked here first.
          </p>
        )}
      </section>
    </div>
  )
}
