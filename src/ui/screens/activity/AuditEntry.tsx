/**
 * One audit-log entry, in two densities: the Activity timeline row (expandable details: data JSON, hash links)
 * and the glass box's compact live-tail row. Shared so both views read the chain the same way.
 */
import { Bot, ChevronDown, Landmark, Link2, Scale, Settings2, User } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import type { AuditActor, AuditEntry } from '../../../core/types'
import { Badge, cx } from '../../components/ds'
import { ACTOR_LABEL, hashHead, isBlocked, prettyData, shortHash, timeLabel, typeLabel, typeVariant } from './logic'
import styles from './Activity.module.css'

const ACTOR_ICON: Record<AuditActor, ReactNode> = {
  user: <User />,
  agent: <Bot />,
  system: <Settings2 />,
  bank: <Landmark />,
  policy: <Scale />,
}

export function ActorIcon({ actor, size = 'md' }: { actor: AuditActor; size?: 'sm' | 'md' }) {
  return (
    <span className={cx(styles.actor, styles[`actor_${actor}`], size === 'sm' && styles.actorSm)} aria-hidden="true">
      {ACTOR_ICON[actor] ?? <Settings2 />}
    </span>
  )
}

export interface AuditEntryRowProps {
  entry: AuditEntry
  /** briefly highlight (a new entry arriving live) */
  fresh?: boolean
}

/** Activity timeline row: actor, type badge, summary, time; expands to the raw data and the hash link. */
export function AuditEntryRow({ entry, fresh = false }: AuditEntryRowProps) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const blocked = isBlocked(entry)
  return (
    <li className={cx(styles.entry, open && styles.entryOpen, blocked && styles.entryBlocked, fresh && styles.fresh)}>
      <button type="button" className={styles.entryButton} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>
        <ActorIcon actor={entry.actor} />
        <span className={styles.entryMain}>
          <span className={styles.entrySummary}>{entry.summary}</span>
          <span className={styles.entryMeta}>
            <Badge variant={typeVariant(entry)} size="sm">{typeLabel(entry)}</Badge>
            <span className={styles.entryActor}>{ACTOR_LABEL[entry.actor] ?? entry.actor}</span>
          </span>
        </span>
        <span className={styles.entryAside}>
          <time dateTime={entry.ts} className={styles.entryTime}>{timeLabel(entry.ts)}</time>
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </span>
      </button>
      <div id={detailsId} className={styles.details} hidden={!open}>
        {open ? <EntryDetails entry={entry} /> : null}
      </div>
    </li>
  )
}

function EntryDetails({ entry }: { entry: AuditEntry }) {
  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>Entry</dt>
          <dd>#{entry.seq} · {timeLabel(entry.ts, true)}</dd>
        </div>
        <div>
          <dt>Recorded by</dt>
          <dd>{ACTOR_LABEL[entry.actor] ?? entry.actor}</dd>
        </div>
      </dl>
      <div className={styles.hashLink} aria-label="Hash chain link">
        <span className={styles.hashBox}>
          <span className={styles.hashLabel}>Previous</span>
          <code title={entry.prevHash}>{shortHash(entry.prevHash, 8, 6)}</code>
        </span>
        <Link2 aria-hidden="true" className={styles.hashJoin} />
        <span className={cx(styles.hashBox, styles.hashBoxSelf)}>
          <span className={styles.hashLabel}>This entry</span>
          <code title={entry.hash}>{shortHash(entry.hash, 8, 6)}</code>
        </span>
      </div>
      <p className={styles.hashNote}>sha256(previous hash + this entry). Change one byte anywhere and every later link breaks.</p>
      <pre className={styles.json} tabIndex={0} aria-label="Entry data (JSON)">{prettyData(entry.data)}</pre>
    </>
  )
}

/** Glass-box live tail row: dense, one line of summary, the hash link as a chip. */
export function AuditTailRow({ entry, fresh = false }: AuditEntryRowProps) {
  return (
    <li className={cx(styles.tail, isBlocked(entry) && styles.entryBlocked, fresh && styles.fresh)}>
      <span className={styles.tailSeq}>#{entry.seq}</span>
      <ActorIcon actor={entry.actor} size="sm" />
      <span className={styles.tailMain}>
        <span className={styles.tailTop}>
          <Badge variant={typeVariant(entry)} size="sm">{typeLabel(entry)}</Badge>
          <time dateTime={entry.ts} className={styles.tailTime}>{timeLabel(entry.ts, true)}</time>
        </span>
        <span className={styles.tailSummary} title={entry.summary}>{entry.summary}</span>
      </span>
      <code className={styles.tailHash} title={`prev ${entry.prevHash}\nhash ${entry.hash}`}>
        <span className={styles.tailPrev}>{hashHead(entry.prevHash)}</span>
        <span aria-hidden="true">→</span>
        {hashHead(entry.hash)}
      </code>
    </li>
  )
}
