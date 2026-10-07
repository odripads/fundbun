import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx'
import { rovingIndex } from './roving'
import styles from './Tabs.module.css'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  /** small count next to the label */
  badge?: number | string
  disabled?: boolean
  /** panel content; omit to render panels yourself */
  content?: ReactNode
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** accessible name of the tab list */
  label: string
  variant?: 'underline' | 'pill'
  /** stretch tabs to fill the row */
  fill?: boolean
  className?: string
}

/** WAI-ARIA tabs: arrow keys move focus and select (automatic activation), Home/End jump. */
export function Tabs<T extends string>({ items, value, onChange, label, variant = 'underline', fill = false, className }: TabsProps<T>) {
  const base = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const index = Math.max(0, items.findIndex((t) => t.id === value))
  const active = items[index]
  const tabId = (id: string) => `${base}-tab-${id}`
  const panelId = (id: string) => `${base}-panel-${id}`

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = rovingIndex(index, e.key, items.length, (i) => Boolean(items[i].disabled))
    if (next === null) return
    e.preventDefault()
    onChange(items[next].id)
    refs.current[next]?.focus()
  }

  return (
    <div className={cx(styles.root, className)}>
      <div role="tablist" aria-label={label} className={cx(styles.list, styles[variant], fill && styles.fill)} onKeyDown={onKeyDown}>
        {items.map((t, i) => {
          const selected = t.id === value
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              id={tabId(t.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={t.content !== undefined ? panelId(t.id) : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={t.disabled}
              className={cx(styles.tab, selected && styles.selected)}
              onClick={() => onChange(t.id)}
            >
              <span>{t.label}</span>
              {t.badge !== undefined && t.badge !== 0 ? <span className={styles.badge}>{t.badge}</span> : null}
            </button>
          )
        })}
      </div>
      {active && active.content !== undefined ? (
        <div role="tabpanel" id={panelId(active.id)} aria-labelledby={tabId(active.id)} tabIndex={0} className={styles.panel} key={active.id}>
          {active.content}
        </div>
      ) : null}
    </div>
  )
}
