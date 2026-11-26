/**
 * Compact quick controls anchored in the desktop sidebar right above "Bun's engine":
 * - Goal & Mirror / Daily tracking mode switcher
 * - Change AI model launcher (opens AiSheet)
 * - Creator Mode toggle (desktop app only, synced with Settings and gated by PIN)
 */
import { CalendarDays, ChevronRight, Cpu, Puzzle, Sparkles } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { SpendMode } from '../../../core/types'
import { PinSheet } from '../../screens/settings/PinSheet'
import { shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import { AiSheet, answeringLabel } from '../ai'
import { ProviderLogo } from '../ai/ProviderLogo'
import { Toggle, cx, useToast } from '../ds'
import { rovingIndex } from '../ds/roving'
import { refreshPlugins, usePluginsState } from '../plugins/pluginStore'
import styles from './DeskShell.module.css'

const selectControls = (s: AppSnapshot) => ({
  mode: (s.state.profile?.mode ?? 'target') as SpendMode,
  llm: s.derived.llm,
  engine: s.derived.engine,
})

const MODE_OPTIONS: ReadonlyArray<{ value: SpendMode; label: string; icon: typeof Sparkles }> = [
  { value: 'target', label: 'Goal & Mirror', icon: Sparkles },
  { value: 'tracking', label: 'Daily tracking', icon: CalendarDays },
]

export function SidebarControls() {
  const app = useApp()
  const run = useSafeAction()
  const toast = useToast()
  const { mode, llm, engine } = useSnapshot(selectControls, shallowEqual)
  const plugins = usePluginsState(app.plugins)
  const [aiOpen, setAiOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [creatorBusy, setCreatorBusy] = useState(false)
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([])

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

  function onModeKey(e: KeyboardEvent<HTMLDivElement>) {
    const idx = Math.max(0, MODE_OPTIONS.findIndex((o) => o.value === mode))
    const next = rovingIndex(idx, e.key, MODE_OPTIONS.length, () => false)
    if (next === null) return
    e.preventDefault()
    switchMode(MODE_OPTIONS[next].value)
    radioRefs.current[next]?.focus()
  }

  async function toggleCreator(on: boolean) {
    if (on) {
      setPinOpen(true)
      return
    }
    setCreatorBusy(true)
    try {
      const r = await app.setCreatorMode(false)
      await refreshPlugins(app.plugins)
      if (!r.ok) {
        toast.show({ tone: 'danger', title: 'Couldn’t switch off Creator Mode', message: r.error ?? 'That did not work.' })
        return
      }
      toast.show({ id: 'creator-mode', tone: 'neutral', title: 'Creator Mode off', message: 'You can switch it back on anytime with your PIN.' })
    } finally {
      setCreatorBusy(false)
    }
  }

  const aiIcon =
    engine === 'llm' && llm.local
      ? <ProviderLogo presetId={llm.presetId} provider={llm.provider} model={llm.model} kind={llm.kind} local={llm.onDevice} size={16} />
      : <Cpu aria-hidden="true" />

  return (
    <>
      <section className={styles.sideControls} aria-label="Quick controls" data-slot="sidebar-controls">
        <div role="radiogroup" aria-label="How you use Bun" className={styles.sideModeGroup} onKeyDown={onModeKey}>
          {MODE_OPTIONS.map((opt, i) => {
            const Icon = opt.icon
            const checked = opt.value === mode
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  radioRefs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                className={cx(styles.sideModeBtn, checked && styles.sideModeBtnActive)}
                onClick={() => switchMode(opt.value)}
              >
                <Icon aria-hidden="true" />
                <span>{opt.label}</span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className={styles.sideModelBtn}
          aria-haspopup="dialog"
          onClick={() => setAiOpen(true)}
        >
          <span className={styles.sideModelIcon} aria-hidden="true">{aiIcon}</span>
          <span className={styles.sideModelText}>
            <span className={styles.sideModelTitle}>Change AI model</span>
            <span className={styles.sideModelSub}>{answeringLabel(llm, engine)}</span>
          </span>
          <ChevronRight aria-hidden="true" className={styles.sideModelChevron} />
        </button>

        {plugins.local ? (
          <div className={styles.sideCreatorRow}>
            <span className={styles.sideCreatorLabel}>
              <Puzzle aria-hidden="true" />
              <span>Creator Mode</span>
            </span>
            <Toggle
              ariaLabel="Creator Mode"
              tone="accent"
              checked={plugins.enabled}
              disabled={creatorBusy}
              onChange={(on) => void toggleCreator(on)}
            />
          </div>
        ) : null}
      </section>

      <AiSheet open={aiOpen} onClose={() => setAiOpen(false)} />

      {plugins.local ? (
        <PinSheet
          open={pinOpen}
          title="Turn on Creator Mode"
          description="Bun will be able to draft widgets and restyle the app from chat. You still confirm every change."
          onSubmit={(pin) => app.setCreatorMode(true, pin)}
          onSuccess={() => {
            void refreshPlugins(app.plugins)
            toast.show({
              id: 'creator-mode',
              tone: 'success',
              title: 'Creator Mode on',
              message: 'Ask Bun in the chat to draft widgets or restyle the app.',
            })
          }}
          onClose={() => setPinOpen(false)}
        />
      ) : null}
    </>
  )
}
