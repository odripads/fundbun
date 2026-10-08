import { BellRing } from 'lucide-react'
import { useEffect, useId, useRef, type CSSProperties } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { TripwireEvent } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { Button, useToast } from '../../components/ds'
import { navigate } from '../../router'
import { eventSandboxDate, sandboxRelative, sandboxToday, shallowEqual, useApp, useSnapshot } from '../../state'
import { freshEvents, leadEvent, newestFirst, sameIds } from './model'
import styles from './TripwireStack.module.css'

const selectUnseen = (s: AppSnapshot) => s.derived.unseenEvents
const selectClock = (s: AppSnapshot) => ({ today: sandboxToday(s), txns: s.state.bank.transactions })

/** Settings › Tripwires, scrolled to and focused (the section id SettingsScreen jumps to). */
export function openTripwireSettings(): void {
  navigate('settings', { query: { s: 'tripwires' } })
}

/**
 * Where focus goes after a dismissal: the new top card's heading, or — once the deck is gone — the heading of
 * whatever follows it on the page, so keyboard and screen-reader users keep their place.
 */
function focusAfterDismiss(card: HTMLElement | null, after: Element | null): void {
  const target = card?.querySelector<HTMLElement>('h3') ?? after?.querySelector<HTMLElement>('h2, h3') ?? (after instanceof HTMLElement ? after : null)
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus()
}

function EventArt({ event, size }: { event: TripwireEvent; size: number }) {
  return event.dream ? <DreamImage image={event.dream.image} alt="" size={size} /> : <BunMascot mood="worried" size={size} />
}

/**
 * Toast a tripwire the moment it fires while Home is open (e.g. after a sandbox purchase). Events already
 * unseen when the screen mounts are shown in the stack instead, so they never toast twice.
 */
export interface TripwireToastOptions {
  /**
   * Don't toast new events (they still land in the Tripwires deck) — e.g. while the sandbox sheet is open and
   * already shows each purchase's tripwires inline, where a toast would only cover them.
   */
  quiet?: boolean
}

export function useTripwireToasts(opts: TripwireToastOptions = {}) {
  const events = useSnapshot(selectUnseen, sameIds)
  const toast = useToast()
  const app = useApp()
  const known = useRef<Set<string> | null>(null)
  const quiet = opts.quiet === true

  useEffect(() => {
    if (!known.current) {
      known.current = new Set(events.map((e) => e.id))
      return
    }
    const fresh = freshEvents(known.current, events)
    for (const e of fresh) known.current.add(e.id)
    const lead = leadEvent(fresh)
    if (!lead || quiet) return
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
  }, [events, toast, app, quiet])
}

/** Unseen tripwire reminders as a stacked deck: the newest on top, the rest peeking out behind. */
export function TripwireStack() {
  const app = useApp()
  const events = useSnapshot(selectUnseen, sameIds)
  const clock = useSnapshot(selectClock, shallowEqual)
  const headingId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLElement>(null)
  // set by a dismissal: the element after the deck, captured before the deck can disappear
  const refocus = useRef<{ after: Element | null } | null>(null)

  useEffect(() => {
    const pending = refocus.current
    if (!pending) return
    refocus.current = null
    focusAfterDismiss(events.length ? cardRef.current : null, pending.after)
  }, [events])

  if (events.length === 0) return null
  const ordered = newestFirst(events)
  const top = ordered[0]
  const behind = Math.min(2, ordered.length - 1)
  const topDate = eventSandboxDate(top, clock.today, clock.txns)

  function dismiss(ids: string[]) {
    refocus.current = { after: rootRef.current?.nextElementSibling ?? null }
    app.markEventsSeen(ids)
  }

  return (
    <section ref={rootRef} className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          <BellRing aria-hidden="true" />
          Tripwires
          <span className={styles.count}>{events.length}</span>
        </h2>
        {events.length > 1 ? (
          <Button size="sm" variant="ghost" className={styles.tap} onClick={() => dismiss(events.map((e) => e.id))}>
            Clear all
          </Button>
        ) : null}
      </div>

      <div className={styles.deck} style={{ '--behind': behind } as CSSProperties}>
        {Array.from({ length: behind }, (_, i) => (
          <span key={i} className={styles.ghost} style={{ '--n': i + 1 } as CSSProperties} aria-hidden="true" />
        ))}
        <article key={top.id} ref={cardRef} className={styles.card} aria-label={`Tripwire: ${top.title}`}>
          <span className={styles.art}>
            <EventArt event={top} size={64} />
          </span>
          <div className={styles.body}>
            <p className={styles.meta}>
              <span className={styles.pulse} aria-hidden="true" />
              Tripwire · <time dateTime={topDate}>{sandboxRelative(topDate, top.firedAt, clock.today)}</time>
            </p>
            <h3 className={styles.cardTitle}>{top.title}</h3>
            <p className={styles.message}>{top.message}</p>
            <div className={styles.actions}>
              <Button size="sm" className={styles.tap} onClick={() => dismiss([top.id])}>Got it</Button>
              <Button size="sm" variant="ghost" className={styles.tap} onClick={openTripwireSettings}>Edit tripwires</Button>
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
