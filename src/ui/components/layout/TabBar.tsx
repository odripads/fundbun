import { ChartColumn, Gem, House, ReceiptText } from 'lucide-react'
import type { ReactNode } from 'react'
import { href, type TabId } from '../../router'
import { BunMascot } from '../brand'
import { cx } from '../ds/cx'
import { badgeText } from '../ds/IconButton'
import styles from './TabBar.module.css'

export interface TabBarProps {
  active: TabId | null
  /** counts (or true for a dot) per tab, e.g. awaiting actions on Ask Bun */
  badges?: Partial<Record<TabId, number | boolean>>
  className?: string
}

interface TabDef {
  id: Exclude<TabId, 'chat'>
  label: string
  icon: ReactNode
}

const LEFT: TabDef[] = [
  { id: 'home', label: 'Home', icon: <House /> },
  { id: 'insights', label: 'Insights', icon: <ChartColumn /> },
]

const RIGHT: TabDef[] = [
  { id: 'bills', label: 'Bills', icon: <ReceiptText /> },
  { id: 'goals', label: 'Goals', icon: <Gem /> },
]

function TabBadge({ value }: { value: number | boolean | undefined }) {
  const text = badgeText(value)
  if (text === null) return null
  return <span className={cx(styles.badge, text === '' && styles.dot)} aria-hidden="true">{text}</span>
}

function badgeSuffix(value: number | boolean | undefined): string {
  const text = badgeText(value)
  return text === null ? '' : text === '' ? ', new' : `, ${text} new`
}

function Tab({ def, active, badge }: { def: TabDef; active: boolean; badge?: number | boolean }) {
  return (
    <li className={styles.slot}>
      <a
        href={href(def.id)}
        className={cx(styles.tab, active && styles.active)}
        aria-current={active ? 'page' : undefined}
        aria-label={`${def.label}${badgeSuffix(badge)}`}
      >
        <span className={styles.iconWrap} aria-hidden="true">
          {def.icon}
          <TabBadge value={badge} />
        </span>
        <span className={styles.label} aria-hidden="true">{def.label}</span>
      </a>
    </li>
  )
}

/** Five slots: Home · Insights · raised "Ask Bun" · Bills · Goals. Floating glass bar above the safe area. */
export function TabBar({ active, badges = {}, className }: TabBarProps) {
  const askActive = active === 'chat'
  return (
    <nav className={cx(styles.nav, className)} aria-label="Primary">
      <ul className={styles.list}>
        {LEFT.map((t) => <Tab key={t.id} def={t} active={active === t.id} badge={badges[t.id]} />)}
        <li className={cx(styles.slot, styles.askSlot)}>
          <a
            href={href('chat')}
            className={cx(styles.ask, askActive && styles.active)}
            aria-current={askActive ? 'page' : undefined}
            aria-label={`Ask Bun, your AI money buddy${badgeSuffix(badges.chat)}`}
          >
            <span className={styles.bun} aria-hidden="true">
              <BunMascot size={46} mood="happy" animated />
              <TabBadge value={badges.chat} />
            </span>
            <span className={styles.label} aria-hidden="true">Ask Bun</span>
          </a>
        </li>
        {RIGHT.map((t) => <Tab key={t.id} def={t} active={active === t.id} badge={badges[t.id]} />)}
      </ul>
    </nav>
  )
}
