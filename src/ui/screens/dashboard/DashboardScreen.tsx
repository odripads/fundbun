import { ArrowLeft, ArrowRight, Columns2, EyeOff, FlaskConical, GripVertical, Square } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { monthLabel } from '../../../core/dates'
import type { YearMonth } from '../../../core/types'
import { LogOutDialog } from '../../components/account/LogOut'
import { useDeskActions } from '../../components/desk/deskActions'
import { AddDreamSheet } from '../../components/dreams'
import { Button, Callout, IconButton, Sheet } from '../../components/ds'
import { SandboxPanel } from '../../components/sandbox'
import { useSnapshot } from '../../state'
import { CheckInCard } from '../home/CheckInCard'
import { DailyPlanSheet } from '../home/DailyPlanSheet'
import { MirrorHero, type CheckRequest } from '../home/MirrorHero'
import { ModeBar } from '../home/ModeBar'
import { QuickAdd } from '../home/QuickAdd'
import { QuickCheck } from '../home/QuickCheck'
import { TripwireStack, useTripwireToasts } from '../home/TripwireStack'
import { canToggleWide, DASH_BLOCK_LABEL, useDashLayout, type DashBlockId } from '../home/layoutPrefs'
import { BillsCard } from './BillsCard'
import { CategoryCard, DailyCard, MonthsCard } from './ChartCards'
import { DashCell, DashTileContext } from './DashCard'
import { GoalsCard } from './GoalsCard'
import { MonthPanel } from './MonthPanel'
import { TransactionsCard } from './TransactionsCard'
import styles from './Dashboard.module.css'

/** Set when the analyses look back at an older month (an imported statement with nothing in the current month). */
const selectLookBack = (s: AppSnapshot): string | null => (s.derived.viewDate !== s.derived.today ? s.derived.viewDate.slice(0, 7) : null)

/** A demo persona: the bank is simulated, so the app shows its "bank connected" side. */
const selectBankDemo = (s: AppSnapshot): boolean => s.derived.clock === 'sandbox'

const selectTracking = (s: AppSnapshot): boolean => s.state.profile?.mode === 'tracking'

/**
 * The desk Dashboard: what the Home screen tells in one column, laid out as a grid of cards, plus the charts and
 * the ledger a wide screen has room for. In Daily tracking mode the Dream Mirror is hidden. Every card can be
 * reordered, resized (2-column span), or hidden in Customize mode.
 */
export function DashboardScreen() {
  const desk = useDeskActions()
  const lookBack = useSnapshot(selectLookBack)
  const bankDemo = useSnapshot(selectBankDemo)
  const tracking = useSnapshot(selectTracking)
  const { layout, move, reorder, toggleHide, toggleWide, reset, isDefault } = useDashLayout()
  const [sandbox, setSandbox] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [addingGoal, setAddingGoal] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [dragged, setDragged] = useState<DashBlockId | null>(null)
  const [dropOver, setDropOver] = useState<DashBlockId | null>(null)
  const [check, setCheck] = useState<CheckRequest | null>(null)
  // outside the desk shell (a test, a preview) the screen brings its own "Add spending" sheet
  const [addingHere, setAddingHere] = useState(false)
  const adding = desk ? desk.addingSpending : addingHere
  const addSpending = useCallback(() => (desk ? desk.addSpending() : setAddingHere(true)), [desk])
  const clearCheck = useCallback(() => setCheck(null), [])
  // the open sandbox sheet shows each purchase's tripwires inline, and "Add spending" answers with Bun's own
  // reaction; a toast on top would only hide them
  useTripwireToasts({ quiet: sandbox || adding })

  const scopedOrder = tracking ? layout.order.filter((id) => id !== 'hero') : layout.order
  const hiddenSet = new Set(layout.hidden)
  const visibleBlocks = scopedOrder.filter((id) => !hiddenSet.has(id))
  const hiddenBlocks = scopedOrder.filter((id) => hiddenSet.has(id)).map((id) => ({ id, label: DASH_BLOCK_LABEL[id] }))

  function renderBlockContent(id: DashBlockId, framed: boolean): ReactNode {
    switch (id) {
      case 'hero':
        return (
          <div className={styles.hero} data-card={framed ? undefined : 'hero'}>
            <MirrorHero onCheck={setCheck} onSandbox={() => setSandbox(true)} onPlan={() => setPlanning(true)} onAddGoal={() => setAddingGoal(true)} />
          </div>
        )
      case 'month':
        return <MonthPanel area="month" />
      case 'checkin':
        return (
          <DashCell area="checkin">
            <CheckInCard onAddSpending={addSpending} onPlan={() => setPlanning(true)} />
          </DashCell>
        )
      case 'trip':
        return (
          <DashCell area="trip" className={styles.plain}>
            <TripwireStack />
          </DashCell>
        )
      case 'daily':
        return <DailyCard area="daily" />
      case 'cats':
        return <CategoryCard area="cats" />
      case 'six':
        return <MonthsCard area="six" />
      case 'bills':
        return <BillsCard area="bills" />
      case 'goals':
        return <GoalsCard area="goals" onAddGoal={() => setAddingGoal(true)} />
      case 'check':
        return (
          <DashCell area="check">
            <QuickCheck request={check} onRequestHandled={clearCheck} />
          </DashCell>
        )
      case 'txns':
        return <TransactionsCard area="txns" />
    }
  }

  return (
    <div className={styles.dash}>
      {lookBack ? (
        <Callout tone="info" title={`Showing ${monthLabel(lookBack as YearMonth)}`}>
          That is the latest month in your data. Import a newer statement in Bills to see this month.
        </Callout>
      ) : null}

      <ModeBar
        onAddGoal={() => setAddingGoal(true)}
        customizing={customizing}
        onToggleCustomize={() => {
          setCustomizing((c) => !c)
          setDragged(null)
          setDropOver(null)
        }}
        onSandbox={() => setSandbox(true)}
        hiddenBlocks={hiddenBlocks}
        onShowBlock={(id) => toggleHide(id as DashBlockId)}
        onResetLayout={reset}
        isDefaultLayout={isDefault}
      />

      <div className={styles.grid}>
        {visibleBlocks.map((id, idx) => {
          const wide = layout.wide.includes(id)
          if (!customizing) {
            return (
              <DashTileContext.Provider key={id} value={{ framed: false, wide }}>
                {renderBlockContent(id, false)}
              </DashTileContext.Provider>
            )
          }
          const label = DASH_BLOCK_LABEL[id]
          const first = idx === 0
          const last = idx === visibleBlocks.length - 1
          return (
            <div
              key={id}
              className={styles.customTile}
              data-card={id}
              data-wide={wide ? 'true' : undefined}
              data-dragging={dragged === id ? 'true' : undefined}
              data-drop-target={dropOver === id && dragged !== id ? 'true' : undefined}
              draggable
              onDragStart={(e) => {
                setDragged(id)
                try {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', id)
                } catch {
                  // jsdom or restricted drag environment
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragged && dragged !== id) setDropOver(id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragged && dragged !== id) reorder(dragged, id)
                setDragged(null)
                setDropOver(null)
              }}
              onDragEnd={() => {
                setDragged(null)
                setDropOver(null)
              }}
            >
              <div className={styles.customBar}>
                <span className={styles.customHandle}>
                  <GripVertical aria-hidden="true" />
                  <span>{label}</span>
                </span>
                <div className={styles.customCtrls}>
                  <IconButton
                    size="sm"
                    label={`Move ${label} earlier`}
                    icon={<ArrowLeft />}
                    disabled={first}
                    onClick={() => move(id, -1, layout.hidden)}
                  />
                  <IconButton
                    size="sm"
                    label={`Move ${label} later`}
                    icon={<ArrowRight />}
                    disabled={last}
                    onClick={() => move(id, 1, layout.hidden)}
                  />
                  {canToggleWide(id) ? (
                    <IconButton
                      size="sm"
                      label={wide ? `Make ${label} 1 column` : `Make ${label} wide`}
                      icon={wide ? <Square /> : <Columns2 />}
                      aria-pressed={wide}
                      onClick={() => toggleWide(id)}
                    />
                  ) : null}
                  <IconButton
                    size="sm"
                    label={`Hide ${label}`}
                    icon={<EyeOff />}
                    onClick={() => toggleHide(id)}
                  />
                </div>
              </div>
              <div className={styles.customTileBody}>
                <DashTileContext.Provider value={{ framed: true, wide }}>
                  {renderBlockContent(id, true)}
                </DashTileContext.Provider>
              </div>
            </div>
          )
        })}
      </div>

      {desk ? null : <QuickAdd open={addingHere} onClose={() => setAddingHere(false)} />}
      <AddDreamSheet open={addingGoal} onClose={() => setAddingGoal(false)} />
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
