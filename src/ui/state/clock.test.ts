import { describe, expect, it } from 'vitest'
import { createTestApp, memoryStorage } from '../../core/app'
import { eventSandboxDate, localDate, onSandboxCalendar, sandboxRelative, sandboxToday, secondsOfDay } from './clock'

/** A device-clock timestamp at local time on a local date (what `new Date().toISOString()` records). */
const at = (date: string, time = '07:36:00') => new Date(`${date}T${time}`).toISOString()

describe('sandboxToday (F55: one clock for every date on screen)', () => {
  it('is the bank’s sandbox clock, not the device date', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    expect(sandboxToday(app.getSnapshot())).toBe('2026-10-22')
  })

  it('prefers derived.today when the controller provides it', () => {
    const app = createTestApp({ storage: memoryStorage() })
    app.loadDemo('mei')
    const s = app.getSnapshot()
    expect(sandboxToday({ state: s.state, derived: { ...s.derived, today: '2026-10-25' } as typeof s.derived })).toBe('2026-10-25')
    expect(sandboxToday({ state: s.state, derived: { ...s.derived, today: 'nope' } as unknown as typeof s.derived })).toBe('2026-10-22')
  })
})

describe('placing device-clock timestamps on the sandbox calendar', () => {
  const now = new Date('2026-10-08T09:00:00')

  it('localDate / secondsOfDay read the device’s local calendar and wall clock', () => {
    expect(localDate(at('2026-10-08'))).toBe('2026-10-08')
    expect(secondsOfDay(at('2026-10-08', '07:36:10'))).toBe(7 * 3600 + 36 * 60 + 10)
    expect(localDate('nope')).toBeNull()
    expect(secondsOfDay('nope')).toBeNull()
  })

  it('the device’s today is the sandbox’s today; yesterday is the sandbox’s yesterday', () => {
    expect(onSandboxCalendar(at('2026-10-08'), '2026-10-22', now)).toBe('2026-10-22')
    expect(onSandboxCalendar(at('2026-10-07'), '2026-10-22', now)).toBe('2026-10-21')
  })

  it('a timestamp already on the sandbox clock (after the device’s today) is not shifted twice', () => {
    expect(onSandboxCalendar(at('2026-10-22'), '2026-10-22', now)).toBe('2026-10-22')
  })
})

describe('eventSandboxDate', () => {
  const today = '2026-10-22'
  const base = { tripwireId: 'tw_1', firedAt: at('2026-10-08') }

  it('a purchase alert is dated by the purchase', () => {
    expect(eventSandboxDate({ ...base, id: 'twe_tw_1_txn_9', txnId: 'txn_9' }, today, [{ id: 'txn_9', date: '2026-10-20' }])).toBe('2026-10-20')
  })

  it('a day alert by its day; a month alert by today (this month) or the month’s last day', () => {
    expect(eventSandboxDate({ ...base, id: 'twe_tw_1_2026-10-19' }, today)).toBe('2026-10-19')
    expect(eventSandboxDate({ ...base, id: 'twe_tw_1_2026-10' }, today)).toBe('2026-10-22')
    expect(eventSandboxDate({ ...base, id: 'twe_tw_1_2026-09' }, today)).toBe('2026-09-30')
  })

  it('never the device date (Oct 8) while the sandbox says Oct 22', () => {
    expect(eventSandboxDate({ ...base, id: 'something-else' }, today)).not.toBe('2026-10-08')
  })
})

describe('sandboxRelative', () => {
  const today = '2026-10-22'
  it('same sandbox day: wall-clock minutes; earlier days: yesterday / d ago / a date', () => {
    const now = new Date('2026-10-08T09:00:00')
    expect(sandboxRelative(today, at('2026-10-08', '08:59:40'), today, now)).toBe('just now')
    expect(sandboxRelative(today, at('2026-10-08', '08:50:00'), today, now)).toBe('10 min ago')
    expect(sandboxRelative(today, at('2026-10-08', '06:00:00'), today, now)).toBe('3 h ago')
    expect(sandboxRelative('2026-10-21', at('2026-10-07'), today, now)).toBe('yesterday')
    expect(sandboxRelative('2026-10-19', at('2026-10-05'), today, now)).toBe('3 d ago')
    expect(sandboxRelative('2026-10-01', at('2026-09-17'), today, now)).toBe('Oct 1')
  })
})

describe('syncClockOnVisible', () => {
  it('asks the controller to catch up with the device date when the page comes back, and cleans up', async () => {
    const { syncClockOnVisible } = await import('./clock')
    const listeners = new Set<() => void>()
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }
    let calls = 0
    const stop = syncClockOnVisible({ syncClock: () => ++calls }, doc as unknown as Document)
    for (const l of listeners) l()
    expect(calls).toBe(0)
    doc.visibilityState = 'visible'
    for (const l of listeners) l()
    expect(calls).toBe(1)
    stop()
    expect(listeners.size).toBe(0)
    // an older controller without syncClock is fine
    expect(() => syncClockOnVisible({}, doc as unknown as Document)()).not.toThrow()
  })
})
