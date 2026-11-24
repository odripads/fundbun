import { useId, type PointerEvent, type ReactNode } from 'react'
import { useActiveMark } from './useActiveMark'
import { useChartWidth } from './useChartWidth'
import styles from './charts.module.css'

export interface MarkTip {
  /** what the mark is: "Thu, Oct 22" */
  title: string
  /** the value, the strong line of the tooltip */
  value: string
  /** one more line, e.g. "Over the ¥128 day limit" */
  note?: string
}

export interface BarFrameProps {
  /** the chart's accessible name */
  label: string
  /** one sentence that carries the key numbers for anyone who cannot see the chart */
  summary: string
  height: number
  /** number of marks along the x axis */
  count: number
  /** marks with nothing to read (days that have not happened) are skipped by the keyboard and the pointer */
  selectable?: (index: number) => boolean
  tip: (index: number) => MarkTip
  /** the mark under a pointer `px` from the plot's left edge, for a plot `width` px wide */
  hit: (px: number, width: number) => number
  /** where the tooltip points, in px of the chart box */
  anchor: (index: number, width: number) => { x: number; y: number }
  /** draws the SVG contents for a chart `width` px wide */
  children: (ctx: { width: number; active: number | null }) => ReactNode
  /** the visually hidden table twin (DataTable) */
  table: ReactNode
}

/**
 * The frame the dashboard's column charts share: the SVG at its measured size, one tab stop whose arrow keys read
 * the chart mark by mark, a hover/focus tooltip, a polite live region and the hidden table. A tooltip only repeats
 * what the table and the direct labels already say.
 */
export function BarFrame({ label, summary, height, count, selectable, tip, hit, anchor, children, table }: BarFrameProps) {
  const [ref, width] = useChartWidth<HTMLDivElement>()
  const { active, setActive, onKeyDown, onBlur } = useActiveMark(count, selectable)
  const summaryId = useId()
  const current = active !== null && active < count ? active : null
  const shown = current !== null ? tip(current) : null
  const at = current !== null ? anchor(current, width) : null

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const i = hit(e.clientX - box.left, width)
    setActive(i >= 0 && i < count && (selectable?.(i) ?? true) ? i : null)
  }

  return (
    <div className={styles.frame}>
      <div
        ref={ref}
        className={styles.plot}
        style={{ height }}
        role="group"
        tabIndex={0}
        aria-label={`${label}. Use the left and right arrow keys to read it.`}
        aria-describedby={summaryId}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
      >
        <svg className={styles.svg} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
          {children({ width, active: current })}
        </svg>
        {shown && at ? (
          <div className={styles.tip} style={{ left: Math.max(76, Math.min(width - 76, at.x)), top: at.y }} aria-hidden="true">
            <span className={styles.tipValue}>{shown.value}</span>
            <span className={styles.tipTitle}>{shown.title}</span>
            {shown.note ? <span className={styles.tipNote}>{shown.note}</span> : null}
          </div>
        ) : null}
      </div>
      <p id={summaryId} className="sr-only">{summary}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {shown ? `${shown.title}: ${shown.value}${shown.note ? `. ${shown.note}` : ''}` : ''}
      </p>
      {table}
    </div>
  )
}
