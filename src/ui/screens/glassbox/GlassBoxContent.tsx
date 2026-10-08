/**
 * The desktop glass box (right of the phone) — a judge-facing, live window into the agent:
 * Trace (latest turn + task plan), Policy (mandate, caps, decisions), Audit (hash-chained tail), Sandbox.
 */
import { ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { AuditEntry } from '../../../core/types'
import { SandboxPanel } from '../../components/sandbox'
import { Button, Tabs } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useSnapshot } from '../../state'
import { AuditTailRow } from '../activity/AuditEntry'
import { ChainBanner } from '../activity/ChainBanner'
import { PolicyView } from './PolicyView'
import { TraceView } from './TraceView'
import { latestTurn } from './logic'
import styles from './GlassBox.module.css'

export type GlassTab = 'trace' | 'policy' | 'audit' | 'sandbox'

const TAB_KEY = 'fundbun.glassbox.tab'
const TAIL = 15

function readTab(): GlassTab {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    return v === 'trace' || v === 'policy' || v === 'audit' || v === 'sandbox' ? v : 'trace'
  } catch {
    return 'trace'
  }
}

function selectBadges(s: AppSnapshot) {
  const audit = s.state.audit
  return {
    headSeq: audit.length ? audit[audit.length - 1].seq : 0,
    turnId: latestTurn(s.state.chat)?.message.id ?? null,
    awaiting: s.derived.awaiting.length,
  }
}

export function GlassBoxContent() {
  const [tab, setTab] = useState<GlassTab>(readTab)
  const { headSeq, turnId, awaiting } = useSnapshot(selectBadges, shallowEqual)
  // what the viewer has already seen, so other tabs can say "new"
  const [seenSeq, setSeenSeq] = useState(headSeq)
  const [seenTurn, setSeenTurn] = useState(turnId)

  useEffect(() => {
    if (tab === 'audit') setSeenSeq(headSeq)
    if (tab === 'trace') setSeenTurn(turnId)
  }, [tab, headSeq, turnId])

  function choose(next: GlassTab) {
    setTab(next)
    try {
      sessionStorage.setItem(TAB_KEY, next)
    } catch {
      // per-viewer convenience only
    }
  }

  const unseenAudit = Math.max(0, headSeq - seenSeq)
  return (
    <div className={styles.root}>
      <Tabs<GlassTab>
        label="Glass box views"
        variant="pill"
        fill
        value={tab}
        onChange={choose}
        className={styles.tabs}
        items={[
          { id: 'trace', label: 'Trace', badge: tab !== 'trace' && turnId !== seenTurn ? 'new' : undefined, content: <TraceView /> },
          { id: 'policy', label: 'Policy', badge: awaiting || undefined, content: <PolicyView /> },
          { id: 'audit', label: 'Audit', badge: tab !== 'audit' && unseenAudit ? (unseenAudit > 99 ? '99+' : unseenAudit) : undefined, content: <AuditTail /> },
          { id: 'sandbox', label: 'Sandbox', content: <SandboxPanel compact /> },
        ]}
      />
    </div>
  )
}

const selectAudit = (s: AppSnapshot) => s.state.audit

function AuditTail() {
  const audit = useSnapshot(selectAudit)
  const tail: AuditEntry[] = audit.slice(-TAIL).reverse()
  const baseline = useRef(audit.length ? audit[audit.length - 1].seq : 0)
  return (
    <div className={styles.stack}>
      <ChainBanner compact />
      <section aria-labelledby="gb-tail" className={styles.block}>
        <div className={styles.tailHead}>
          <h3 id="gb-tail" className={styles.blockTitle}>Live tail <span className={styles.mini}>newest {Math.min(TAIL, audit.length)} of {audit.length}</span></h3>
          <Button size="sm" variant="ghost" iconEnd={<ArrowRight />} onClick={() => navigate('activity')}>Full log</Button>
        </div>
        <ol className={styles.tailList}>
          {tail.map((e) => (
            <AuditTailRow key={e.seq} entry={e} fresh={e.seq > baseline.current} />
          ))}
        </ol>
      </section>
    </div>
  )
}
