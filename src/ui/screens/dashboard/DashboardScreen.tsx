import { FlaskConical } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { monthLabel } from '../../../core/dates'
import type { YearMonth } from '../../../core/types'
import { LogOutDialog } from '../../components/account/LogOut'
import { useDeskActions } from '../../components/desk/deskActions'
import { Button, Callout, Sheet } from '../../components/ds'
import { SandboxPanel } from '../../components/sandbox'
import { useSnapshot } from '../../state'
import { CheckInCard } from '../home/CheckInCard'
import { DailyPlanSheet } from '../home/DailyPlanSheet'
import { MirrorHero, type CheckRequest } from '../home/MirrorHero'
import { QuickAdd } from '../home/QuickAdd'
import { QuickCheck } from '../home/QuickCheck'
import { TripwireStack, useTripwireToasts } from '../home/TripwireStack'
import { BillsCard } from './BillsCard'
import { CategoryCard, DailyCard, MonthsCard } from './ChartCards'
import { DashCell } from './DashCard'
import { GoalsCard } from './GoalsCard'
import { MonthPanel } from './MonthPanel'
import { TransactionsCard } from './TransactionsCard'
import styles from './Dashboard.module.css'

/** Set when the analyses look back at an older month (an imported statement with nothing in the current month). */
const selectLookBack = (s: AppSnapshot): string | null => (s.derived.viewDate !== s.derived.today ? s.derived.viewDate.slice(0, 7) : null)

/** A demo persona: the bank is simulated, so the app shows its "bank connected" side. */
const selectBankDemo = (s: AppSnapshot): boolean => s.derived.clock === 'sandbox'

/**
 * The desk Dashboard: what the Home screen tells in one column, laid out as a grid of cards, plus the charts and
 * the ledger a wide screen has room for. The Dream Mirror keeps the top-left; every number comes from the snapshot.
 */
export function DashboardScreen() {
  const desk = useDeskActions()
  const lookBack = useSnapshot(selectLookBack)
  const bankDemo = useSnapshot(selectBankDemo)
  const [sandbox, setSandbox] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [check, setCheck] = useState<CheckRequest | null>(null)
  // outside the desk shell (a test, a preview) the screen brings its own "Add spending" sheet
  const [addingHere, setAddingHere] = useState(false)
  const adding = desk ? desk.addingSpending : addingHere
  const addSpending = useCallback(() => (desk ? desk.addSpending() : setAddingHere(true)), [desk])
  const clearCheck = useCallback(() => setCheck(null), [])
  // the open sandbox sheet shows each purchase's tripwires inline, and "Add spending" answers with Bun's own
  // reaction; a toast on top would only hide them
  useTripwireToasts({ quiet: sandbox || adding })

  return (
    <div className={styles.dash}>
      {lookBack ? (
        <Callout tone="info" title={`Showing ${monthLabel(lookBack as YearMonth)}`}>
          That is the latest month in your data. Import a newer statement in Bills to see this month.
        </Callout>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.hero} style={{ gridArea: 'hero' }} data-card="hero">
          <MirrorHero onCheck={setCheck} onSandbox={() => setSandbox(true)} onPlan={() => setPlanning(true)} />
        </div>
        <MonthPanel area="month" />
        <DashCell area="checkin">
          <CheckInCard onAddSpending={addSpending} onPlan={() => setPlanning(true)} />
        </DashCell>
        <DashCell area="trip" className={styles.plain}>
          <TripwireStack />
        </DashCell>
        <DailyCard area="daily" />
        <CategoryCard area="cats" />
        <MonthsCard area="six" />
        <BillsCard area="bills" />
        <GoalsCard area="goals" />
        <DashCell area="check">
          <QuickCheck request={check} onRequestHandled={clearCheck} />
        </DashCell>
        <TransactionsCard area="txns" />
      </div>

      {desk ? null : <QuickAdd open={addingHere} onClose={() => setAddingHere(false)} />}
      <Sheet
        open={sandbox}
        onClose={() => setSandbox(false)}
        title={bankDemo ? 'Bank demo' : 'Sandbox'}
        description={
          bankDemo
            ? 'This persona’s bank is simulated, so you can see what Bun does once a bank is connected: pay bills and move money, behind your PIN. Use the controls to add purchases and move the calendar. No real money moves.'
            : 'Demo controls: simulated purchases and days in the sandbox bank. No real money moves.'
        }
        media={<span className={styles.sandboxIcon} aria-hidden="true"><FlaskConical /></span>}
        footer={
          bankDemo ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setSandbox(false)
                  setLeaving(true)
                }}
              >
                Leave the demo
              </Button>
              <Button onClick={() => setSandbox(false)}>Done</Button>
            </>
          ) : (
            <Button fullWidth onClick={() => setSandbox(false)}>Done</Button>
          )
        }
      >
        {/* stays open after a purchase: the new transaction and the tripwires it fired show inline */}
        <SandboxPanel />
      </Sheet>
      <LogOutDialog open={leaving} onClose={() => setLeaving(false)} />
      <DailyPlanSheet open={planning} onClose={() => setPlanning(false)} />
    </div>
  )
}
