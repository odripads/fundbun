/**
 * Activity: the tamper-evident audit timeline. Chain verdict on top, what's waiting for the user, then every
 * recorded step (newest first, grouped by day), filterable and exportable.
 */
import { Ban, Download, Eye, FileJson, Hand, ShieldCheck, Sparkles, Snowflake } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { ActionCard } from '../../components/agent'
import { Badge, Button, Callout, Card, Chip, EmptyState, SectionHeader, Sheet, Stat, useToast } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { GlassBoxContent } from '../glassbox/GlassBoxContent'
import { downloadText, exportFileName } from '../settings/download'
import { AuditEntryRow } from './AuditEntry'
import { ChainBanner } from './ChainBanner'
import { FILTERS, PAGE_SIZE, activityStats, filterCounts, groupByDay, matchesFilter, type ActivityFilter } from './logic'
import styles from './Activity.module.css'

const EMPTY_COPY: Record<ActivityFilter, { title: string; body: string }> = {
  all: { title: 'Nothing recorded yet', body: 'Every step Bun or you take lands here, hash-chained.' },
  agent: { title: 'Bun hasn’t acted yet', body: 'Ask Bun for something and each step it takes will show up here.' },
  blocked: { title: 'Nothing blocked', body: 'No risky attempts so far. When the policy engine says no, it’s logged here.' },
  security: { title: 'All quiet', body: 'Permission changes, PIN checks and injection alerts will appear here.' },
  tripwires: { title: 'No tripwires fired', body: 'When a spending threshold trips, the reminder is logged here.' },
  you: { title: 'No changes from you yet', body: 'Your approvals, edits and settings changes are recorded here.' },
}

function selectHeader(s: AppSnapshot) {
  return { frozen: s.state.mandate.frozen, breakerReason: s.state.mandate.breakerReason }
}

const selectAudit = (s: AppSnapshot) => s.state.audit
const selectAwaiting = (s: AppSnapshot) => s.derived.awaiting

export function ActivityScreen() {
  const app = useApp()
  const toast = useToast()
  const audit = useSnapshot(selectAudit)
  const awaiting = useSnapshot(selectAwaiting)
  const { frozen, breakerReason } = useSnapshot(selectHeader, shallowEqual)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [glassOpen, setGlassOpen] = useState(false)
  // entries newer than what was on screen when the page opened get a brief highlight
  const baseline = useRef(audit.length ? audit[audit.length - 1].seq : 0)

  const counts = useMemo(() => filterCounts(audit), [audit])
  const stats = useMemo(() => activityStats(audit), [audit])
  const filtered = useMemo(() => audit.filter((e) => matchesFilter(e, filter)).sort((a, b) => b.seq - a.seq), [audit, filter])
  const groups = useMemo(() => groupByDay(filtered.slice(0, limit)), [filtered, limit])
  const hidden = Math.max(0, filtered.length - limit)

  function exportAudit() {
    const ok = downloadText(exportFileName('audit-log', 'jsonl'), app.exportAuditJSONL(), 'application/x-ndjson')
    toast.show({ tone: ok ? 'success' : 'warn', title: ok ? 'Audit log exported' : 'Downloads aren’t available here', message: ok ? 'One JSON line per entry, hashes included.' : undefined })
  }

  function exportAll() {
    const ok = downloadText(exportFileName('data', 'json'), app.exportData())
    toast.show({ tone: ok ? 'success' : 'warn', title: ok ? 'Your data is exported' : 'Downloads aren’t available here', message: ok ? 'Built on this device; nothing was uploaded.' : undefined })
  }

  return (
    <div className={styles.page}>
      {frozen ? (
        <Callout
          tone={breakerReason ? 'block' : 'warn'}
          icon={<Snowflake />}
          title={breakerReason ? 'The circuit breaker froze Bun' : 'Bun is frozen'}
          action={<Button size="sm" variant="secondary" onClick={() => navigate('settings')}>Unfreeze in Settings</Button>}
        >
          {breakerReason ?? 'Bun can read and explain, but every action is blocked until you unfreeze it with your PIN.'}
        </Callout>
      ) : null}

      <ChainBanner />

      <Card padding="none" className={styles.stats}>
        <Stat size="sm" icon={<Sparkles />} label="Bun did" value={<span className={styles.statValue}>{stats.agentActions}</span>} hint="actions" />
        <Stat size="sm" icon={<Ban />} label="Blocked" value={<span className={styles.statValue}>{stats.blocked}</span>} hint="attempts" />
        <Stat size="sm" icon={<Hand />} label="Approved" value={<span className={styles.statValue}>{stats.approvals}</span>} hint="by you" />
      </Card>

      <button type="button" className={styles.glassEntry} onClick={() => setGlassOpen(true)}>
        <span className={styles.glassEntryIcon} aria-hidden="true"><Eye /></span>
        <span className={styles.glassEntryText}>
          <span className={styles.glassEntryTitle}>Open the glass box</span>
          <span className={styles.glassEntrySub}>Bun’s latest reasoning, policy calls and the live log</span>
        </span>
      </button>

      {awaiting.length ? (
        <section aria-labelledby="activity-waiting" className={styles.section}>
          <SectionHeader
            id="activity-waiting"
            title="Waiting for you"
            eyebrow="Pending approvals"
            action={<Badge variant="accent">{awaiting.length}</Badge>}
          />
          <ul className={styles.pending} role="list">
            {awaiting.map((p) => (
              <li key={p.id}>
                <ActionCard pendingId={p.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="activity-timeline" className={styles.section}>
        <SectionHeader
          id="activity-timeline"
          title="Timeline"
          eyebrow="Everything, hash-chained"
          action={<Button size="sm" variant="ghost" iconStart={<Download />} onClick={exportAudit}>Export</Button>}
        />
        <div className={styles.filters} role="group" aria-label="Filter the timeline">
          {FILTERS.map((f) => (
            <Chip key={f.id} size="sm" selected={filter === f.id} onClick={() => { setFilter(f.id); setLimit(PAGE_SIZE) }}>
              {f.label}
              <span className={styles.count}>{counts[f.id]}</span>
            </Chip>
          ))}
        </div>

        {groups.length === 0 ? (
          <EmptyState compact mood="calm" title={EMPTY_COPY[filter].title} body={EMPTY_COPY[filter].body} />
        ) : (
          <div className={styles.days}>
            {groups.map((g) => (
              <section key={g.key} className={styles.day} aria-label={g.label}>
                <h3 className={styles.dayLabel}>
                  {g.label}
                  <span className={styles.dayCount}>{g.entries.length}</span>
                </h3>
                <ol className={styles.timeline}>
                  {g.entries.map((e) => (
                    <AuditEntryRow key={e.seq} entry={e} fresh={e.seq > baseline.current} />
                  ))}
                </ol>
              </section>
            ))}
            {hidden > 0 ? (
              <Button variant="secondary" fullWidth onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                Show {Math.min(hidden, PAGE_SIZE)} older {Math.min(hidden, PAGE_SIZE) === 1 ? 'entry' : 'entries'}
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <Card variant="sunken" className={styles.takeaway}>
        <div className={styles.takeawayHead}>
          <ShieldCheck aria-hidden="true" />
          <p>Your log stays on this device. Take a copy any time.</p>
        </div>
        <div className={styles.takeawayActions}>
          <Button size="sm" variant="secondary" iconStart={<Download />} onClick={exportAudit}>Audit log (JSONL)</Button>
          <Button size="sm" variant="secondary" iconStart={<FileJson />} onClick={exportAll}>All my data (JSON)</Button>
        </div>
      </Card>

      <Sheet open={glassOpen} onClose={() => setGlassOpen(false)} title="Glass box" description="What Bun sees, decides and records, live." size="full">
        <div className={styles.sheetGlass}>
          <GlassBoxContent />
        </div>
      </Sheet>
    </div>
  )
}
