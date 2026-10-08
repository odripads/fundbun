import { BellRing } from 'lucide-react'
import { useEffect, useId, useRef, type CSSProperties } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { TripwireEvent } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { Button, useToast } from '../../components/ds'
import { navigate } from '../../router'
import { useApp, useSnapshot } from '../../state'
import { freshEvents, leadEvent, newestFirst, relativeTime, sameIds } from './model'
import styles from './TripwireStack.module.css'

const selectUnseen = (s: AppSnapshot) => s.derived.unseenEvents

function EventArt({ event, size }: { event: TripwireEvent; size: number }) {
  return event.dream ? <DreamImage image={event.dream.image} alt="" size={size} /> : <BunMascot mood="worried" size={size} />
}

/**
 * Toast a tripwire the moment it fires while Home is open (e.g. after a sandbox purchase). Events already
 * unseen when the screen mounts are shown in the stack instead, so they never toast twice.
 */
export function useTripwireToasts() {
  const events = useSnapshot(selectUnseen, sameIds)
  const toast = useToast()
  const app = useApp()
  const known = useRef<Set<string> | null>(null)

  useEffect(() => {
    if (!known.current) {
      known.current = new Set(events.map((e) => e.id))
      return
    }
    const fresh = freshEvents(known.current, events)
    for (const e of fresh) known.current.add(e.id)
    const lead = leadEvent(fresh)
    if (!lead) return
    const more = fresh.length - 1
    toast.show({
      id: 'tripwire',
      tone: 'warn',
      title: lead.title,
      message: more > 0 ? `${lead.message} (+${more} more)` : lead.message,
      image: <EventArt event={lead} size={56} />,
      duration: 9000,
      actions: [{ label: 'Got it', onClick: () => app.markEventsSeen(fresh.map((e) => e.id)) }],
    })
  }, [events, toast, app])
}

/** Unseen tripwire reminders as a stacked deck: the newest on top, the rest peeking out behind. */
export function TripwireStack() {
  const app = useApp()
  const events = useSnapshot(selectUnseen, sameIds)
  const headingId = useId()
  if (events.length === 0) return null
  const ordered = newestFirst(events)
  const top = ordered[0]
  const behind = Math.min(2, ordered.length - 1)
  const now = Date.now()

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          <BellRing aria-hidden="true" />
          Tripwires
          <span className={styles.count}>{events.length}</span>
        </h2>
        {events.length > 1 ? (
          <Button size="sm" variant="ghost" className={styles.tap} onClick={() => app.markEventsSeen(events.map((e) => e.id))}>
            Clear all
          </Button>
        ) : null}
      </div>

      <div className={styles.deck} style={{ '--behind': behind } as CSSProperties}>
        {Array.from({ length: behind }, (_, i) => (
          <span key={i} className={styles.ghost} style={{ '--n': i + 1 } as CSSProperties} aria-hidden="true" />
        ))}
        <article key={top.id} className={styles.card} aria-label={`Tripwire: ${top.title}`}>
          <span className={styles.art}>
            <EventArt event={top} size={64} />
          </span>
          <div className={styles.body}>
            <p className={styles.meta}>
              <span className={styles.pulse} aria-hidden="true" />
              Tripwire · <time dateTime={top.firedAt}>{relativeTime(top.firedAt, now)}</time>
            </p>
            <h3 className={styles.cardTitle}>{top.title}</h3>
            <p className={styles.message}>{top.message}</p>
            <div className={styles.actions}>
              <Button size="sm" className={styles.tap} onClick={() => app.markEventsSeen([top.id])}>Got it</Button>
              <Button size="sm" variant="ghost" className={styles.tap} onClick={() => navigate('settings')}>Edit tripwires</Button>
            </div>
          </div>
        </article>
      </div>
      {ordered.length > 1 ? (
        <p className={styles.more}>{ordered.length - 1} more behind this one</p>
      ) : null}
    </section>
  )
}
