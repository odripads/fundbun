import { Check, Eye, FlaskConical, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { AppSnapshot } from '../../../core/app-api'
import { dateLabel } from '../../../core/dates'
import type { SpendMode } from '../../../core/types'
import { Button, Chip, Segmented, cx, useToast } from '../../components/ds'
import { useApp, useSafeAction, useSnapshot } from '../../state'
import styles from './ModeBar.module.css'

export interface HiddenBlockInfo {
  id: string
  label: string
}

export interface ModeBarProps {
  onAddGoal: () => void
  customizing: boolean
  onToggleCustomize: () => void
  onSandbox?: () => void
  hiddenBlocks: readonly HiddenBlockInfo[]
  onShowBlock: (id: string) => void
  onResetLayout: () => void
  isDefaultLayout: boolean
  className?: string
}

const selectModeBar = (s: AppSnapshot) => ({
  mode: (s.state.profile?.mode ?? 'target') as SpendMode,
  sandboxDate: s.derived.clock === 'sandbox' ? dateLabel(s.derived.today) : null,
})

/**
 * Quick controls shared across Home and Dashboard:
 * - switch cleanly between Daily tracking (no Dream Mirror) and Goal & Mirror
 * - add a goal or dream from either mode in one tap
 * - enter Customize mode to reorder or hide blocks
 */
export function ModeBar({
  onAddGoal,
  customizing,
  onToggleCustomize,
  onSandbox,
  hiddenBlocks,
  onShowBlock,
  onResetLayout,
  isDefaultLayout,
  className,
}: ModeBarProps) {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { mode, sandboxDate } = useSnapshot(selectModeBar)

  function switchMode(next: SpendMode) {
    if (next === mode) return
    const before = mode
    void run(() => app.setProfile({ mode: next }), { errorTitle: 'Couldn’t switch mode' }).then((r) => {
      if (!r?.ok) return
      toast.show({
        id: 'mode-saved',
        tone: 'success',
        title: next === 'tracking' ? 'Daily tracking on' : 'Goal & Mirror on',
        message:
          next === 'tracking'
            ? 'Dream Mirror is hidden. Bun keeps count of your spending day by day.'
            : 'Dream Mirror is back. Bun measures your month against your goals.',
        actions: [{ label: 'Undo', onClick: () => void app.setProfile({ mode: before }) }],
      })
    })
  }

  return (
    <div className={cx(styles.wrap, className)}>
      <div className={styles.bar}>
        <Segmented<SpendMode>
          size="sm"
          label="How you use Bun"
          value={mode}
          onChange={switchMode}
          className={styles.mode}
          options={[
            { value: 'tracking', label: 'Daily tracking' },
            { value: 'target', label: 'Goal & Mirror' },
          ]}
        />
        <div className={styles.actions}>
          {mode === 'tracking' && onSandbox ? (
            <Chip
              size="sm"
              icon={<FlaskConical />}
              onClick={onSandbox}
              aria-label={sandboxDate ? 'Bank demo: open the demo controls' : 'Open the sandbox (demo controls)'}
            >
              {sandboxDate ? `Bank demo · ${sandboxDate}` : 'Sandbox'}
            </Chip>
          ) : null}
          <Button size="sm" variant="secondary" iconStart={<Plus />} onClick={onAddGoal}>
            Add goal
          </Button>
          <Button
            size="sm"
            variant={customizing ? 'primary' : 'ghost'}
            iconStart={customizing ? <Check /> : <SlidersHorizontal />}
            aria-pressed={customizing}
            onClick={onToggleCustomize}
          >
            {customizing ? 'Done' : 'Customize'}
          </Button>
        </div>
      </div>

      {customizing ? (
        <div className={styles.customizePanel} role="region" aria-label="Customize layout">
          <div className={styles.customizeText}>
            <p className={styles.customizeLead}>Drag any block or use the arrows to reorder. Hide blocks you don’t need.</p>
            {hiddenBlocks.length > 0 ? (
              <div className={styles.hiddenRow}>
                <span className={styles.hiddenLabel}>Hidden:</span>
                {hiddenBlocks.map((b) => (
                  <Chip key={b.id} size="sm" icon={<Eye />} onClick={() => onShowBlock(b.id)} aria-label={`Show ${b.label}`}>
                    Show {b.label}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.customizeActions}>
            <Button size="sm" variant="ghost" iconStart={<RotateCcw />} disabled={isDefaultLayout} onClick={onResetLayout}>
              Reset layout
            </Button>
            <Button size="sm" variant="secondary" iconStart={<Check />} onClick={onToggleCustomize}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
