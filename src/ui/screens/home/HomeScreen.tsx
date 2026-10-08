import { FlaskConical } from 'lucide-react'
import { useCallback, useState } from 'react'
import { SandboxPanel } from '../../components/sandbox'
import { Sheet } from '../../components/ds'
import { BillsStrip } from './BillsStrip'
import { CouldveStrip } from './CouldveStrip'
import { InsightsPeek } from './InsightsPeek'
import { MirrorHero, type CheckRequest } from './MirrorHero'
import { MonthCard } from './MonthCard'
import { QuickCheck } from './QuickCheck'
import { TripwireStack, useTripwireToasts } from './TripwireStack'
import styles from './HomeScreen.module.css'

/**
 * Home — the Dream Mirror. Hero first (the month reflected as a dream), then live tripwires, the month in numbers,
 * the "Should I buy it?" check, bills, two insights and the six-month could've collection.
 */
export function HomeScreen() {
  const [sandbox, setSandbox] = useState(false)
  const [check, setCheck] = useState<CheckRequest | null>(null)
  const clearCheck = useCallback(() => setCheck(null), [])
  useTripwireToasts()

  return (
    <div className={styles.page}>
      <MirrorHero onCheck={setCheck} onSandbox={() => setSandbox(true)} />
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
      >
        <SandboxPanel onDone={() => setSandbox(false)} />
      </Sheet>
    </div>
  )
}
