import { Check, Code2, Palette, RotateCcw, ShieldAlert, Trash2, Undo2, X } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import {
  DEFAULT_APP_NAME,
  SHELL_THEMES,
  describeShellAppearancePatch,
  isDefaultShellAppearance,
  resolvedShellTokens,
  sameShellAppearance,
  validateShellAppearancePatch,
} from '../../../core/plugins/appearance'
import type { AppSnapshot } from '../../../core/app-api'
import type { ChatCard, PluginAppearanceCard as AppearanceCard, PluginLifecycleCard, ShellAppearance } from '../../../core/types'
import { BunMascot } from '../brand/BunMascot'
import { Button, Callout } from '../ds'
import { useApp, useSnapshot } from '../../state'
import { PluginIcon } from './icons'
import { PluginFrame } from './PluginFrame'
import { refreshPlugins } from './pluginStore'
import { applyShellAppearancePatchNow, previewShellAppearance, resetShellAppearance, restoreShellAppearance, useShellAppearance } from './shellAppearance'
import styles from './Plugins.module.css'

const SLOT_LABEL = { dashboard: 'Dashboard', home: 'Home', both: 'Dashboard and Home' } as const

type DraftCard = Extract<ChatCard, { type: 'plugin_draft' }>
type ActionCard = PluginLifecycleCard

/**
 * A widget Bun drafted: a live preview with the user's own numbers, the code behind it, and Install. Nothing is
 * installed until the user presses it.
 */
export function PluginDraftCard({ card }: { card: DraftCard }) {
  const app = useApp()
  const [status, setStatus] = useState<'idle' | 'busy' | 'installed' | 'discarded'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)

  async function install() {
    setStatus('busy')
    setError(null)
    const r = await app.installPlugin(card.draftId)
    if (r.ok) {
      setStatus('installed')
      void refreshPlugins(app.plugins)
    } else {
      setStatus('idle')
      setError(r.error ?? 'Could not install it.')
    }
  }
  async function discard() {
    setStatus('discarded')
    await app.plugins?.discardDraft(card.draftId)
  }

  const done = status === 'installed' || status === 'discarded'
  return (
    <div className={styles.draft} data-status={status}>
      <header className={styles.draftHead}>
        <span className={styles.widgetIcon}><PluginIcon icon={card.icon} /></span>
        <span className={styles.draftTitles}>
          <span className={styles.draftName}>{card.name}</span>
          <span className={styles.draftSub}>
            {card.mode === 'update' ? 'Update' : 'New widget'} · {SLOT_LABEL[card.slot]}{card.wide ? ' · wide' : ''}
          </span>
        </span>
      </header>
      <p className={styles.draftDesc}>{card.description}</p>
      {status === 'discarded' ? null : (
        <div className={styles.previewBox}>
          <span className={styles.previewTag}>Live preview</span>
          {status === 'installed' && app.plugins
            ? <PluginFrame src={`${app.plugins.baseUrl}/plugins/installed/${encodeURIComponent(card.pluginId)}/frame`} title={card.name} />
            : <PluginFrame src={card.previewUrl} title={`${card.name} preview`} />}
        </div>
      )}
      {showCode ? (
        <pre className={styles.code}><code>{card.code}{card.css ? `\n\n/* style.css */\n${card.css}` : ''}</code></pre>
      ) : null}
      {error ? <Callout tone="block" title="Not installed">{error}</Callout> : null}
      <div className={styles.draftActions}>
        {status === 'installed' ? (
          <span className={styles.doneLine}><Check aria-hidden="true" /> Installed on {SLOT_LABEL[card.slot]}</span>
        ) : status === 'discarded' ? (
          <span className={styles.doneLine}><X aria-hidden="true" /> Discarded</span>
        ) : null}
        {done ? null : (
          <>
            <Button size="sm" variant="ghost" iconStart={<Code2 />} aria-expanded={showCode} onClick={() => setShowCode((v) => !v)}>
              {showCode ? 'Hide code' : 'See code'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void discard()} disabled={status === 'busy'}>Discard</Button>
            <Button size="sm" onClick={() => void install()} loading={status === 'busy'}>
              {card.mode === 'update' ? 'Update widget' : 'Install'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

const ACTION_COPY = {
  uninstall: { title: 'Remove this widget?', button: 'Remove', done: 'Removed' },
  disable: { title: 'Switch this widget off?', button: 'Switch off', done: 'Switched off' },
  enable: { title: 'Switch this widget back on?', button: 'Switch on', done: 'Switched on' },
} as const

/** Bun proposed removing or switching a widget: nothing changes until the user confirms. */
export function PluginActionCard({ card }: { card: ActionCard }) {
  const app = useApp()
  const copy = ACTION_COPY[card.action]
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'kept'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setStatus('busy')
    setError(null)
    const r = await app.changePlugin(card.pluginId, card.action)
    if (r.ok) {
      setStatus('done')
      void refreshPlugins(app.plugins)
    } else {
      setStatus('idle')
      setError(r.error ?? 'That did not work.')
    }
  }

  return (
    <div className={styles.draft}>
      <header className={styles.draftHead}>
        <span className={styles.widgetIcon}>{card.action === 'uninstall' ? <Trash2 aria-hidden="true" /> : <Check aria-hidden="true" />}</span>
        <span className={styles.draftTitles}>
          <span className={styles.draftName}>{copy.title}</span>
          <span className={styles.draftSub}>{card.name}</span>
        </span>
      </header>
      {error ? <Callout tone="block" title="Nothing changed">{error}</Callout> : null}
      <div className={styles.draftActions}>
        {status === 'done' ? <span className={styles.doneLine}><Check aria-hidden="true" /> {copy.done}</span> : null}
        {status === 'kept' ? <span className={styles.doneLine}>Kept as it is</span> : null}
        {status === 'idle' || status === 'busy' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setStatus('kept')} disabled={status === 'busy'}>Keep it</Button>
            <Button size="sm" variant={card.action === 'uninstall' ? 'danger' : 'primary'} onClick={() => void confirm()} loading={status === 'busy'}>
              {copy.button}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

const selectFrozen = (s: AppSnapshot): boolean => s.state.mandate.frozen

/** The theme the device asks for, so a preview of "follows your device" is painted like the real thing. */
function deviceTheme(): 'light' | 'dark' {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The colours a look paints the page with, as inline variables for the small preview (never for the page itself). */
function previewVars(look: ShellAppearance): CSSProperties {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(resolvedShellTokens(look))) if (value) vars[name] = value
  return vars
}

/**
 * A shell appearance plugin Bun proposed (theme, what Bun wears, the app name): a preview of the result, the list
 * of changes, and Apply. Nothing changes until Apply is pressed; Undo puts the look before it back, Reset goes
 * back to FundBun's own look. A blocked proposal (untrusted content in the turn, or Bun paused) cannot be applied.
 */
export function PluginAppearanceCard({ card }: { card: AppearanceCard }) {
  const current = useShellAppearance()
  const frozen = useSnapshot(selectFrozen)
  const [before, setBefore] = useState<ShellAppearance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const checked = validateShellAppearancePatch(card.patch)
  if (!checked.ok) {
    return (
      <div className={styles.draft}>
        <Callout tone="block" title="This look cannot be applied">{checked.issues[0] ?? 'It is outside what a shell appearance plugin may change.'}</Callout>
      </div>
    )
  }
  const patch = checked.patch
  const result = before ? current : previewShellAppearance(patch)
  const applied = before !== null
  const alreadyOn = !applied && sameShellAppearance(current, result)
  const blocked = card.blocked ?? (frozen ? 'FundBun is paused by the kill switch, so the look cannot be changed right now.' : null)
  const preset = SHELL_THEMES[result.theme]
  const lines = describeShellAppearancePatch(patch)

  function apply() {
    setError(null)
    const r = applyShellAppearancePatchNow(patch)
    if (r.ok) setBefore(r.previous)
    else setError(r.issues[0] ?? 'That look could not be applied.')
  }
  function undo() {
    if (before) restoreShellAppearance(before)
    setBefore(null)
  }
  function reset() {
    resetShellAppearance()
    setBefore(null)
  }

  return (
    <div className={styles.draft} data-appearance-card={card.proposalId} data-status={applied ? 'applied' : blocked ? 'blocked' : 'idle'}>
      <header className={styles.draftHead}>
        <span className={styles.widgetIcon}><Palette aria-hidden="true" /></span>
        <span className={styles.draftTitles}>
          <span className={styles.draftName}>{patch.reset && lines.length === 1 ? "Back to FundBun's own look?" : 'A new look for the app'}</span>
          <span className={styles.draftSub}>Shell appearance · {card.by === 'ai' ? 'proposed by your AI' : 'read from your message on this device'}</span>
        </span>
      </header>

      <div
        className={styles.lookPreview}
        data-theme={preset.base === 'system' ? deviceTheme() : preset.base}
        data-look-theme={result.theme}
        style={previewVars(result)}
        role="img"
        aria-label={`Preview: ${preset.label} theme, ${result.mascotHat === 'none' ? 'no headwear' : lines.find((l) => l.kind === 'mascot')?.value ?? result.mascotHat}, named ${result.appName ?? DEFAULT_APP_NAME}`}
      >
        <span className={styles.previewTag}>Preview</span>
        <BunMascot size={64} hat={result.mascotHat} animated={false} />
        <span className={styles.lookTitles}>
          <span className={styles.lookName}>{result.appName ?? DEFAULT_APP_NAME}</span>
          <span className={styles.lookTheme}>{preset.label}</span>
        </span>
        <span className={styles.lookSwatches} aria-hidden="true">
          <i className={styles.swatchBg} />
          <i className={styles.swatchSurface} />
          <i className={styles.swatchAccent} />
          <i className={styles.swatchText} />
        </span>
      </div>

      <dl className={styles.lookChanges}>
        {lines.map((l) => (
          <div key={l.kind} className={styles.lookChange} data-change={l.kind}>
            <dt>{l.label}</dt>
            <dd>{l.value}</dd>
          </div>
        ))}
      </dl>

      {blocked ? <Callout tone="block" icon={<ShieldAlert />} title="Apply is blocked">{blocked}</Callout> : null}
      {error ? <Callout tone="block" title="Nothing changed">{error}</Callout> : null}

      <div className={styles.draftActions}>
        {applied ? <span className={styles.doneLine}><Check aria-hidden="true" /> Applied. It stays after a reload.</span> : null}
        {alreadyOn ? <span className={styles.doneLine}><Check aria-hidden="true" /> This look is already on</span> : null}
        {isDefaultShellAppearance(current) ? null : (
          <Button size="sm" variant="ghost" iconStart={<RotateCcw />} onClick={reset}>Reset look</Button>
        )}
        {applied ? (
          <Button size="sm" variant="secondary" iconStart={<Undo2 />} onClick={undo}>Undo</Button>
        ) : (
          <Button size="sm" onClick={apply} disabled={Boolean(blocked) || alreadyOn}>Apply</Button>
        )}
      </div>
    </div>
  )
}
