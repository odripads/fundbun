/**
 * The audit hash-chain verdict: re-verified whenever the log grows (and on demand), drawn as the last few
 * links of the chain so "tamper-evident" is something you can see, not just read.
 */
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import type { AuditEntry } from '../../../core/types'
import { Button, cx } from '../../components/ds'
import { useApp, useSnapshot } from '../../state'
import { chainHeadline, chainTail, hashHead, type ChainCheck } from './logic'
import styles from './Activity.module.css'

const selectAudit = (s: { state: { audit: AuditEntry[] } }) => s.state.audit

/** Verify the chain with the controller; recomputed when the log changes or `recheck` is called. */
export function useChainCheck(): { check: ChainCheck; audit: AuditEntry[]; recheck: () => void; checks: number } {
  const app = useApp()
  const live = useSnapshot(selectAudit)
  // re-hashing the whole chain on every append is ~15ms at 200+ entries: let bursts (an agent turn) settle first
  const audit = useDeferredValue(live)
  const [checks, setChecks] = useState(0)
  const check = useMemo<ChainCheck>(() => {
    void checks
    try {
      return app.verifyAudit()
    } catch (e) {
      return { ok: false, count: audit.length, reason: e instanceof Error ? e.message : 'Verification failed' }
    }
  }, [app, audit, checks])
  return { check, audit, recheck: () => setChecks((n) => n + 1), checks }
}

export interface ChainBannerProps {
  /** dense one-line version for the glass box */
  compact?: boolean
}

export function ChainBanner({ compact = false }: ChainBannerProps) {
  const { check, audit, recheck, checks } = useChainCheck()
  const head = audit.length ? audit[audit.length - 1] : undefined
  const { title, detail } = chainHeadline(check, head?.hash)
  const links = chainTail(audit, compact ? 6 : 5)
  const Icon = check.ok ? ShieldCheck : ShieldAlert

  return (
    <section
      className={cx(styles.chain, !check.ok && styles.chainBroken, compact && styles.chainCompact)}
      aria-label="Audit chain verification"
    >
      <div className={styles.chainHead}>
        <span className={styles.chainIcon} aria-hidden="true"><Icon /></span>
        <div className={styles.chainText} role="status" aria-live="polite">
          <p className={styles.chainTitle}>{title}</p>
          <p className={styles.chainDetail}>{detail}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          iconStart={<RefreshCw key={checks} className={cx(checks > 0 && styles.spinOnce)} />}
          onClick={recheck}
          aria-label="Verify the audit chain again"
        >
          Verify
        </Button>
      </div>
      {links.length ? (
        <ol className={styles.links} aria-label={`The newest ${links.length} links of the chain`} key={checks}>
          {links.map((e, i) => {
            const broken = !check.ok && check.brokenAt !== undefined && e.seq >= check.brokenAt
            return (
              <li key={e.seq} className={cx(styles.link, broken && styles.linkBroken)} style={{ ['--i' as string]: i }}>
                <span className={styles.linkSeq}>#{e.seq}</span>
                <code className={styles.linkHash} title={e.hash}>{hashHead(e.hash)}</code>
              </li>
            )
          })}
        </ol>
      ) : null}
    </section>
  )
}
