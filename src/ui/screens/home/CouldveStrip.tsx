import { useId, useMemo, useState, type CSSProperties } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { couldveCollection, goalEquivalent, mirrorHistory } from '../../../core/finance'
import { ym } from '../../../core/dates'
import { DreamImage } from '../../components/brand'
import { shallowEqual, useSnapshot } from '../../state'
import { barPx, couldveHeadline, divergingScale, historyBars, type CouldveTotals, type HistoryPoint } from './model'
import styles from './CouldveStrip.module.css'

const MONTHS = 6

const selectCouldve = (s: AppSnapshot) => ({
  ctx: s.derived.ctx,
  history: s.derived.mirrorHistory,
  couldve: s.derived.couldve,
  currency: s.state.profile?.currency ?? 'CNY',
})

/**
 * "Could've collection": six months of mirror verdicts as a diverging strip (over above the line, under below),
 * each month wearing the dream it was worth. Uses derived.mirrorHistory/couldve when the controller provides them,
 * else computes them from the same pure core functions.
 */
export function CouldveStrip() {
  const { ctx, history, couldve, currency } = useSnapshot(selectCouldve, shallowEqual)
  const headingId = useId()
  const captionId = useId()

  const data = useMemo(() => {
    if (!ctx) return null
    const points: HistoryPoint[] = history ?? mirrorHistory(ctx, MONTHS)
    const totals: CouldveTotals = couldve ?? couldveCollection(ctx, MONTHS)
    // kept money is framed as goal progress only — never as treats to go and buy
    const goals = ctx.dreams.filter((d) => d.kind === 'goal' && !d.achievedAt)
    const kept = totals.totalOver <= 0 && totals.totalUnder > 0 ? goalEquivalent(totals.totalUnder, goals) : undefined
    return { points, totals, kept, current: ym(ctx.bank.today) }
  }, [ctx, history, couldve])

  const bars = useMemo(() => (data ? historyBars(data.points, data.current, currency) : []), [data, currency])
  const [picked, setPicked] = useState<string | null>(null)
  if (!data || bars.length === 0 || bars.every((b) => b.status === 'no_data')) return null

  const selected = bars.find((b) => b.month === picked) ?? bars.find((b) => b.current) ?? bars[bars.length - 1]
  const scale = divergingScale(bars)
  const shelf = data.totals.totalOver > 0 ? data.totals.equivalents : []

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <p className={styles.eyebrow}>Last {MONTHS} months</p>
      <h2 id={headingId} className={styles.title}>{couldveHeadline(data.totals, MONTHS, currency)}</h2>

      <div
        className={styles.chart}
        role="group"
        aria-label="Over and under target by month"
        aria-describedby={captionId}
        style={{ '--up': `${scale.up}px`, '--down': `${scale.down}px` } as CSSProperties}
      >
        <span className={styles.axis} aria-hidden="true" />
        {bars.map((b) => (
          <button
            key={b.month}
            type="button"
            className={styles.col}
            data-direction={b.direction}
            data-current={b.current || undefined}
            aria-pressed={b.month === selected.month}
            aria-label={b.caption}
            onClick={() => setPicked(b.month)}
            style={{ '--bar': `${barPx(b.direction === 'even' ? 0 : b.delta, scale)}px` } as CSSProperties}
          >
            <span className={styles.thumb} aria-hidden="true">
              {b.item ? <DreamImage image={b.item.image} alt="" size={30} /> : <span className={styles.dot} />}
            </span>
            <span className={styles.upper} aria-hidden="true">
              {b.direction === 'over' ? <span className={styles.bar} /> : null}
            </span>
            <span className={styles.lower} aria-hidden="true">
              {b.direction === 'under' ? <span className={styles.bar} /> : null}
            </span>
            <span className={styles.amount} aria-hidden="true">{b.amountText}</span>
            <span className={styles.month} aria-hidden="true">{b.short}</span>
          </button>
        ))}
      </div>
      <p id={captionId} className={styles.caption} aria-live="polite" data-direction={selected.direction}>
        {selected.item ? <DreamImage image={selected.item.image} alt="" size={36} /> : null}
        <span>{selected.caption}</span>
      </p>

      {data.kept ? (
        <p className={styles.kept}>
          <DreamImage image={data.kept.image} alt="" size={48} />
          <span>
            That’s <strong>{data.kept.label}</strong> — kept, not spent.
          </span>
        </p>
      ) : null}

      {shelf.length > 0 ? (
        <div className={styles.shelf}>
          <p className={styles.shelfTitle}>Your could’ve collection</p>
          <ul className={styles.shelfList} role="list">
            {shelf.map((e, i) => (
              <li key={e.itemId} className={styles.trophy} style={{ '--i': i } as CSSProperties}>
                <DreamImage image={e.image} alt="" size={56} />
                <span>{e.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
