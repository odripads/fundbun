import { ArrowDown, ArrowUp, Camera, ChevronDown, EyeOff, FlaskConical, GripVertical, Plus } from 'lucide-react'
import { Fragment, useCallback, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { LogOutDialog } from '../../components/account/LogOut'
import { AddDreamSheet } from '../../components/dreams'
import { SandboxPanel } from '../../components/sandbox'
import type { AppSnapshot } from '../../../core/app-api'
import { monthLabel } from '../../../core/dates'
import type { YearMonth } from '../../../core/types'
import { Button, Callout, IconButton, Sheet } from '../../components/ds'
import { navigate } from '../../router'
import { useSnapshot } from '../../state'
import { BillsStrip } from './BillsStrip'
import { CheckInCard } from './CheckInCard'
import { DailyPlanSheet } from './DailyPlanSheet'
import { CouldveStrip } from './CouldveStrip'
import { InsightsPeek } from './InsightsPeek'
import { MirrorHero, type CheckRequest } from './MirrorHero'
import { ModeBar } from './ModeBar'
import { MonthCard } from './MonthCard'
import { QuickAdd } from './QuickAdd'
import { QuickCheck } from './QuickCheck'
import { TripwireStack, useTripwireToasts } from './TripwireStack'
import { HOME_BLOCK_LABEL, useHomeLayout, type HomeBlockId } from './layoutPrefs'
import styles from './HomeScreen.module.css'

/**
 * Home: Dream Mirror hero (in Goal & Mirror mode, hidden in Daily tracking mode), quick actions, mode switch,
 * and the ordered, customizable stack of daily blocks.
 */
const PULL_OPEN_PX = 140

/** Set when the analyses look back at an older month (an imported statement with nothing in the current month). */
const selectLookBack = (s: AppSnapshot): string | null => (s.derived.viewDate !== s.derived.today ? s.derived.viewDate.slice(0, 7) : null)

/** A demo persona: the bank is simulated, so the app shows its "bank connected" side. */
const selectBankDemo = (s: AppSnapshot): boolean => s.derived.clock === 'sandbox'

const selectTracking = (s: AppSnapshot): boolean => s.state.profile?.mode === 'tracking'

export function HomeScreen() {
  const [sandbox, setSandbox] = useState(false)
  const lookBack = useSnapshot(selectLookBack)
  const bankDemo = useSnapshot(selectBankDemo)
  const tracking = useSnapshot(selectTracking)
  const { layout, move, reorder, toggleHide, reset, isDefault } = useHomeLayout()
  const [adding, setAdding] = useState(false)
  const [addingGoal, setAddingGoal] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  const [dragged, setDragged] = useState<HomeBlockId | null>(null)
  const [dropOver, setDropOver] = useState<HomeBlockId | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [check, setCheck] = useState<CheckRequest | null>(null)
  const [pull, setPull] = useState(0)
  const touchY = useRef<number | null>(null)
  const clearCheck = useCallback(() => setCheck(null), [])
  // the open sandbox sheet shows each purchase's tripwires inline, and "Add spending" answers with Bun's own
  // reaction; a toast on top would only hide them
  useTripwireToasts({ quiet: sandbox || adding })

  // swipe down when the page is already at the top opens the camera: the quick way to scan a receipt
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

  const scopedOrder = tracking ? layout.order.filter((id) => id !== 'couldve') : layout.order
  const hiddenSet = new Set(layout.hidden)
  const visibleBlocks = scopedOrder.filter((id) => !hiddenSet.has(id))
  const hiddenBlocks = scopedOrder.filter((id) => hiddenSet.has(id)).map((id) => ({ id, label: HOME_BLOCK_LABEL[id] }))

  function renderBlock(id: HomeBlockId): ReactNode {
    switch (id) {
      case 'checkin':
        return <CheckInCard onAddSpending={() => setAdding(true)} onPlan={() => setPlanning(true)} />
      case 'trip':
        return <TripwireStack />
      case 'month':
        return <MonthCard />
      case 'check':
        return <QuickCheck request={check} onRequestHandled={clearCheck} />
      case 'bills':
        return <BillsStrip />
      case 'insights':
        return <InsightsPeek />
      case 'couldve':
        return <CouldveStrip />
    }
  }

  const modeBar = (
    <div className={styles.modeWrap} data-tracking={tracking ? 'true' : undefined}>
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
        onShowBlock={(id) => toggleHide(id as HomeBlockId)}
        onResetLayout={reset}
        isDefaultLayout={isDefault}
      />
    </div>
  )

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
      {!tracking ? (
        <MirrorHero onCheck={setCheck} onSandbox={() => setSandbox(true)} onPlan={() => setPlanning(true)} onAddGoal={() => setAddingGoal(true)} />
      ) : (
        modeBar
      )}
      <div className={styles.scanRow} data-tracking={tracking ? 'true' : undefined}>
        <Button variant="soft" size="lg" iconStart={<Plus />} onClick={() => setAdding(true)}>
          Add spending
        </Button>
        <Button variant="soft" size="lg" iconStart={<Camera />} onClick={() => navigate('receipt')}>
          Receipt or file
        </Button>
      </div>
      {!tracking ? modeBar : null}
      <QuickAdd open={adding} onClose={() => setAdding(false)} />
      <AddDreamSheet open={addingGoal} onClose={() => setAddingGoal(false)} />
      <div className={styles.sections}>
        {visibleBlocks.map((id, idx) => {
          const content = renderBlock(id)
          if (!customizing) return <Fragment key={id}>{content}</Fragment>
          const label = HOME_BLOCK_LABEL[id]
          const first = idx === 0
          const last = idx === visibleBlocks.length - 1
          return (
            <div
              key={id}
              className={styles.customBlock}
              data-home-block={id}
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
              <div className={styles.customBlockBar}>
                <span className={styles.customHandle}>
                  <GripVertical aria-hidden="true" />
                  <span>{label}</span>
                </span>
                <div className={styles.customCtrls}>
                  <IconButton
                    size="sm"
                    label={`Move ${label} up`}
                    icon={<ArrowUp />}
                    disabled={first}
                    onClick={() => move(id, -1, layout.hidden)}
                  />
                  <IconButton
                    size="sm"
                    label={`Move ${label} down`}
                    icon={<ArrowDown />}
                    disabled={last}
                    onClick={() => move(id, 1, layout.hidden)}
                  />
                  <IconButton
                    size="sm"
                    label={`Hide ${label}`}
                    icon={<EyeOff />}
                    onClick={() => toggleHide(id)}
                  />
                </div>
              </div>
              {content}
            </div>
          )
        })}
      </div>

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
