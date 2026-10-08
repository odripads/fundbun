import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Logo } from '../brand'
import { cx } from '../ds/cx'
import { IconButton } from '../ds/IconButton'
import styles from './TopBar.module.css'

export interface TopBarProps {
  /** the page's h1 */
  title: ReactNode
  subtitle?: ReactNode
  /** show the FundBun logo instead of the title (the title stays as the screen-reader h1) */
  brand?: boolean
  onBack?: () => void
  backLabel?: string
  /** right-aligned controls (icon buttons, the agent status pill) */
  actions?: ReactNode
  className?: string
}

/** Turns true once the page scrolls past the top, so the bar can pick up its glass background. */
function useScrolledPast(sentinel: RefObject<HTMLElement | null>): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    // the newest entry decides: a page that jumps on open (#/settings?s=…) gets "at top" and "scrolled" in one batch
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      if (last) setScrolled(!last.isIntersecting)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [sentinel])
  return scrolled
}

export function TopBar({ title, subtitle, brand = false, onBack, backLabel = 'Back', actions, className }: TopBarProps) {
  const sentinel = useRef<HTMLDivElement>(null)
  const scrolled = useScrolledPast(sentinel)
  return (
    <>
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <header className={cx(styles.bar, scrolled && styles.scrolled, className)}>
        <div className={styles.row}>
          {onBack ? <IconButton label={backLabel} icon={<ChevronLeft />} onClick={onBack} className={styles.back} /> : null}
          <div className={styles.titles}>
            {brand ? (
              <>
                <Logo size={30} withWordmark className={styles.logo} />
                <h1 className="sr-only">{title}</h1>
              </>
            ) : (
              <h1 className={styles.title}>{title}</h1>
            )}
            {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
      </header>
    </>
  )
}
