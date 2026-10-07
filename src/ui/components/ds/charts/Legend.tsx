import styles from './Charts.module.css'

export interface LegendItem {
  id: string
  label: string
  color: string
  value?: string
  share?: string
}

/** Swatch + text legend. Text stays in text tokens; the swatch carries identity. Decorative for AT (the table twin speaks). */
export function Legend({ items, onHover }: { items: LegendItem[]; onHover?: (id: string | null) => void }) {
  return (
    <ul className={styles.legend} aria-hidden="true" onPointerLeave={() => onHover?.(null)}>
      {items.map((it) => (
        <li key={it.id} className={styles.legendItem} onPointerEnter={() => onHover?.(it.id)}>
          <span className={styles.swatch} style={{ background: it.color }} />
          <span className={styles.legendLabel}>{it.label}</span>
          {it.value ? <span className={styles.legendValue}>{it.value}</span> : null}
          {it.share ? <span className={styles.legendShare}>{it.share}</span> : null}
        </li>
      ))}
    </ul>
  )
}
