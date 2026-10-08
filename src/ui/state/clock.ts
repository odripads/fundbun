/**
 * One clock for everything the user reads. The sandbox bank has its own calendar ("today" is Oct 22 for the demo
 * personas) while timestamps such as tripwire fires and audit entries are taken from the device clock. Dates on
 * screen always follow the sandbox calendar; times of day stay the device's wall-clock time.
 */
import type { AppSnapshot } from '../../core/app-api'
import { addDays, dateLabel, diffDays, endOfMonth, ym } from '../../core/dates'
import type { ISODate, Transaction, TripwireEvent } from '../../core/types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-\d{2}$/

/** "Today" on the sandbox clock: `derived.today` when the controller provides it, else the bank's clock. */
export function sandboxToday(s: Pick<AppSnapshot, 'state' | 'derived'>): ISODate {
  const derived = s.derived as { today?: unknown }
  return typeof derived.today === 'string' && ISO_DATE.test(derived.today) ? derived.today : s.state.bank.today
}

/** The device's local calendar date of a timestamp, or null when it can't be parsed. */
export function localDate(ts: string | number | Date): ISODate | null {
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Seconds since local midnight (the wall-clock part both clocks share). */
export function secondsOfDay(ts: string | number | Date): number | null {
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}

/**
 * The sandbox date of a device-clock timestamp: the sandbox calendar runs at the device's pace, shifted so the
 * device's today is the sandbox's today. A timestamp already past the device's today can only have been written
 * on the sandbox clock, so it is taken as is.
 */
export function onSandboxCalendar(ts: string | number | Date, today: ISODate, now: number | Date = Date.now()): ISODate | null {
  const real = localDate(ts)
  const realToday = localDate(now)
  if (!real || !realToday) return null
  if (real > realToday) return real
  return addDays(real, diffDays(realToday, today))
}

/** The dedupe key at the end of a tripwire event id (`twe_<tripwireId>_<key>`). */
function eventKey(e: Pick<TripwireEvent, 'id' | 'tripwireId'>): string {
  const prefix = `twe_${e.tripwireId}_`
  return e.id.startsWith(prefix) ? e.id.slice(prefix.length) : ''
}

/**
 * The sandbox date a tripwire event belongs to: the purchase's date, else the day it is keyed on, else (month-level
 * alerts) today for the current month or the month's last day for an earlier one.
 */
export function eventSandboxDate(
  e: Pick<TripwireEvent, 'id' | 'tripwireId' | 'txnId' | 'firedAt'>,
  today: ISODate,
  txns: readonly Pick<Transaction, 'id' | 'date'>[] = [],
): ISODate {
  if (e.txnId) {
    const t = txns.find((x) => x.id === e.txnId)
    if (t) return t.date
  }
  const key = eventKey(e)
  if (ISO_DATE.test(key)) return key
  if (ISO_MONTH.test(key)) return key < ym(today) ? endOfMonth(key) : today
  const mapped = onSandboxCalendar(e.firedAt, today)
  return mapped && mapped <= today ? mapped : today
}

/** "just now", "5 min ago", "3 h ago" (same sandbox day), "yesterday", "2 d ago", else "Oct 7". */
export function sandboxRelative(date: ISODate, firedAt: string, today: ISODate, now: number | Date = Date.now()): string {
  const days = diffDays(date, today)
  if (days <= 0) {
    const a = secondsOfDay(firedAt)
    const b = secondsOfDay(now)
    const sec = a === null || b === null ? 0 : Math.max(0, b - a)
    if (sec < 45) return 'just now'
    const min = Math.round(sec / 60)
    if (min < 60) return `${min} min ago`
    return `${Math.round(min / 60)} h ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} d ago`
  return dateLabel(date)
}

/** Calls app.syncClock() whenever the page becomes visible again; returns the cleanup. */
export function syncClockOnVisible(app: { syncClock?: () => unknown }, doc: Document | undefined = globalThis.document): () => void {
  if (!doc || !app.syncClock) return () => {}
  const onVisible = () => {
    if (doc.visibilityState !== 'visible') return
    try {
      app.syncClock?.()
    } catch {
      // a clock that can't move right now (locked vault, …) is not worth a crash; the next action syncs it
    }
  }
  doc.addEventListener('visibilitychange', onVisible)
  return () => doc.removeEventListener('visibilitychange', onVisible)
}
