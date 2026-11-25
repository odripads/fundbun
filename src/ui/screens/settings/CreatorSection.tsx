/**
 * "Creator Mode" in Settings (desktop app only): lets Bun draft dashboard widgets from a chat message. Turning it
 * on needs the PIN; every widget runs sandboxed with a read-only copy of the numbers and can be removed in one tap.
 */
import { Power, Puzzle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PluginIcon } from '../../components/plugins/icons'
import { refreshPlugins, usePluginsState } from '../../components/plugins/pluginStore'
import { Badge, Button, Callout, Card, IconButton, SectionHeader, Toggle } from '../../components/ds'
import { useApp } from '../../state'
import { PinSheet } from './PinSheet'
import styles from './Settings.module.css'

const SLOT_LABEL = { dashboard: 'Dashboard', home: 'Home', both: 'Dashboard and Home' } as const

export function CreatorSection() {
  const app = useApp()
  const st = usePluginsState(app.plugins)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // the hosted site has no plugin engine: the section is not shown at all
  if (!st.local) return null

  const after = async (r: { ok: boolean; error?: string }) => {
    setBusy(null)
    if (!r.ok) setError(r.error ?? 'That did not work.')
    await refreshPlugins(app.plugins)
  }
  const turn = async (on: boolean) => {
    setError(null)
    if (on) return setAsking(true)
    await after(await app.setCreatorMode(false))
  }
  const installed = new Set(st.plugins.map((p) => p.id))
  const starters = st.starters.filter((s) => !installed.has(s.id))

  return (
    <section id="set-creator" aria-labelledby="set-creator-h" className={styles.section}>
      <SectionHeader id="set-creator-h" eyebrow="Desktop app" title="Creator Mode" />
      <Card padding="none">
        <div className={styles.consentRow}>
          <span className={styles.rowIcon} aria-hidden="true"><Puzzle /></span>
          <span className={styles.consentText}>
            <span className={styles.consentTitle}>Build your own widgets by chatting</span>
            <span className={styles.consentSub}>
              Ask Bun for a card, like "a coffee tracker for this month". You see a live preview first and choose to install it.
              Widgets only read your numbers: they cannot move money, change settings or go online.
            </span>
          </span>
          <Badge variant={st.enabled ? 'under' : 'neutral'} size="sm">{st.enabled ? 'On' : 'Off'}</Badge>
        </div>
        <div className={styles.toggleRow}>
          <Toggle
            checked={st.enabled}
            onChange={(on) => void turn(on)}
            label="Creator Mode"
            description={st.enabled ? 'Bun can draft widgets in the chat.' : 'Turning it on asks for your PIN.'}
            tone="accent"
          />
        </div>
        {error ? <div className={styles.toggleRow}><Callout tone="block" title="Nothing changed">{error}</Callout></div> : null}
      </Card>

      {st.enabled ? (
        <Card padding="none">
          <div className={styles.consentRow}>
            <span className={styles.consentText}>
              <span className={styles.consentTitle}>Your widgets</span>
              <span className={styles.consentSub}>
                {st.plugins.length ? `${st.plugins.length} installed${st.pluginDir ? `, kept in ${st.pluginDir}` : ''}.` : 'None yet. Ask Bun in the chat, or start from one below.'}
              </span>
            </span>
          </div>
          {st.plugins.map((p) => (
            <div key={p.id} className={styles.consentRow} data-plugin-row={p.id}>
              <span className={styles.rowIcon} aria-hidden="true"><PluginIcon icon={p.icon} /></span>
              <span className={styles.consentText}>
                <span className={styles.consentTitle}>{p.name}</span>
                <span className={styles.consentSub}>{p.description} · {SLOT_LABEL[p.slot]}</span>
              </span>
              <IconButton
                size="sm"
                label={p.enabled ? `Switch ${p.name} off` : `Switch ${p.name} on`}
                icon={<Power />}
                aria-pressed={p.enabled}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(p.id)
                  await after(await app.changePlugin(p.id, p.enabled ? 'disable' : 'enable'))
                }}
              />
              <IconButton
                size="sm"
                label={`Remove ${p.name}`}
                icon={<Trash2 />}
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(p.id)
                  await after(await app.changePlugin(p.id, 'uninstall'))
                }}
              />
            </div>
          ))}
          {starters.length ? (
            <div className={styles.toggleRow}>
              <span className={styles.consentSub}>Starters</span>
              <div className={styles.starterRow}>
                {starters.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant="secondary"
                    iconStart={<PluginIcon icon={s.icon} />}
                    loading={busy === s.id}
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(s.id)
                      await after(await app.installStarterPlugin(s.id))
                    }}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      <PinSheet
        open={asking}
        title="Turn on Creator Mode"
        description="Bun will be able to draft widgets for your Dashboard and Home. You still install each one yourself."
        onSubmit={(pin) => app.setCreatorMode(true, pin)}
        onSuccess={() => void refreshPlugins(app.plugins)}
        onClose={() => setAsking(false)}
      />
    </section>
  )
}
