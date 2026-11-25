import { Check, Code2, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { ChatCard } from '../../../core/types'
import { Button, Callout } from '../ds'
import { useApp } from '../../state'
import { PluginIcon } from './icons'
import { PluginFrame } from './PluginFrame'
import { refreshPlugins } from './pluginStore'
import styles from './Plugins.module.css'

const SLOT_LABEL = { dashboard: 'Dashboard', home: 'Home', both: 'Dashboard and Home' } as const

type DraftCard = Extract<ChatCard, { type: 'plugin_draft' }>
type ActionCard = Extract<ChatCard, { type: 'plugin_action' }>

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
