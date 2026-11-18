import { Camera, ChevronDown, FlaskConical, Plus } from 'lucide-react'
import { useCallback, useRef, useState, type TouchEvent } from 'react'
import { SandboxPanel } from '../../components/sandbox'
import type { AppSnapshot } from '../../../core/app-api'
import { monthLabel } from '../../../core/dates'
import type { YearMonth } from '../../../core/types'
import { Button, Callout, Sheet } from '../../components/ds'
import { navigate } from '../../router'
import { useSnapshot } from '../../state'
import { BillsStrip } from './BillsStrip'
import { CouldveStrip } from './CouldveStrip'
import { InsightsPeek } from './InsightsPeek'
import { MirrorHero, type CheckRequest } from './MirrorHero'
import { MonthCard } from './MonthCard'
import { QuickAdd } from './QuickAdd'
import { QuickCheck } from './QuickCheck'
import { TripwireStack, useTripwireToasts } from './TripwireStack'
import styles from './HomeScreen.module.css'

/**
 * Home — the Dream Mirror. Hero first (the month reflected as a dream), then live tripwires, the month in numbers,
 * the "Should I buy it?" check, bills, two insights and the six-month could've collection.
 */
const PULL_OPEN_PX = 140

/** Set when the analyses look back at an older month (an imported statement with nothing in the current month). */
const selectLookBack = (s: AppSnapshot): string | null => (s.derived.viewDate !== s.derived.today ? s.derived.viewDate.slice(0, 7) : null)

export function HomeScreen() {
  const [sandbox, setSandbox] = useState(false)
  const lookBack = useSnapshot(selectLookBack)
  const [adding, setAdding] = useState(false)
  const [check, setCheck] = useState<CheckRequest | null>(null)
  const [pull, setPull] = useState(0)
  const touchY = useRef<number | null>(null)
  const clearCheck = useCallback(() => setCheck(null), [])
  // the open sandbox sheet shows each purchase's tripwires inline, and "Add spending" answers with Bun's own
  // reaction; a toast on top would only hide them
  useTripwireToasts({ quiet: sandbox || adding })

  // swipe down when the page is already at the top opens the camera — the quick way to scan a receipt
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
  }
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (touchY.current == null) return
    const dy = e.touches[0].clientY - touchY.current
    setPull(dy > 0 ? Math.min(1, dy / PULL_OPEN_PX) : 0)
  }
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchY.current
    touchY.current = null
    setPull(0)
    if (start == null) return
    if (e.changedTouches[0].clientY - start > PULL_OPEN_PX) navigate('receipt')
  }
  const cancelPull = () => {
    touchY.current = null
    setPull(0)
  }

  return (
    <div className={styles.page} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={cancelPull}>
      <div className={styles.pullHint} style={{ opacity: pull }} aria-hidden="true">
        <ChevronDown className={styles.pullIcon} />
        <span>Pull to scan a receipt</span>
      </div>
      {lookBack ? (
        <div className={styles.lookBack}>
          <Callout tone="info" title={`Showing ${monthLabel(lookBack as YearMonth)}`}>
            That is the latest month in your data. Import a newer statement in Bills to see this month.
          </Callout>
        </div>
      ) : null}
      <MirrorHero onCheck={setCheck} onSandbox={() => setSandbox(true)} />
      <div className={styles.scanRow}>
        <Button variant="soft" size="lg" iconStart={<Plus />} onClick={() => setAdding(true)}>
          Add spending
        </Button>
        <Button variant="soft" size="lg" iconStart={<Camera />} onClick={() => navigate('receipt')}>
          Scan a receipt
        </Button>
      </div>
      <QuickAdd open={adding} onClose={() => setAdding(false)} />
      <div className={styles.sections}>
        <TripwireStack />
        <MonthCard />
        <QuickCheck request={check} onRequestHandled={clearCheck} />
        <BillsStrip />
        <InsightsPeek />
        <CouldveStrip />
      </div>

      <Sheet
        open={sandbox}
        onClose={() => setSandbox(false)}
        title="Sandbox"
        description="Demo controls: simulated purchases and days in the sandbox bank. No real money moves."
        media={<span className={styles.sandboxIcon} aria-hidden="true"><FlaskConical /></span>}
        footer={<Button fullWidth onClick={() => setSandbox(false)}>Done</Button>}
      >
        {/* stays open after a purchase: the new transaction and the tripwires it fired show inline */}
        <SandboxPanel />
      </Sheet>
    </div>
  )
}
