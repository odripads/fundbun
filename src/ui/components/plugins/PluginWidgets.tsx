import { useId } from 'react'
import type { PluginManifest } from '../../../core/plugins/types'
import { useApp } from '../../state'
import { PluginIcon } from './icons'
import { PluginFrame } from './PluginFrame'
import { usePluginsState } from './pluginStore'
import styles from './Plugins.module.css'

export type WidgetPlace = 'dashboard' | 'home'

/** The installed, switched-on widgets for one screen (none on the hosted site or with Creator Mode off). */
export function useWidgets(place: WidgetPlace): PluginManifest[] {
  const app = useApp()
  const st = usePluginsState(app.plugins)
  if (!st.local || !st.enabled) return []
  return st.plugins.filter((p) => p.enabled && (p.slot === place || p.slot === 'both'))
}

export function frameSrcOf(baseUrl: string, id: string): string {
  return `${baseUrl}/plugins/installed/${encodeURIComponent(id)}/frame`
}

/** One installed widget as a card with its own heading, like the built-in cards around it. */
export function WidgetCard({ plugin, place }: { plugin: PluginManifest; place: WidgetPlace }) {
  const app = useApp()
  const headingId = useId()
  if (!app.plugins) return null
  return (
    <section
      className={styles.widget}
      aria-labelledby={headingId}
      data-card={place === 'dashboard' ? `plugin-${plugin.id}` : undefined}
      data-wide={place === 'dashboard' && plugin.wide ? 'true' : undefined}
      data-plugin={plugin.id}
    >
      <header className={styles.widgetHead}>
        <span className={styles.widgetIcon}><PluginIcon icon={plugin.icon} /></span>
        <h2 id={headingId} className={styles.widgetTitle}>{plugin.name}</h2>
        <span className={styles.widgetTag}>Your widget</span>
      </header>
      <PluginFrame src={frameSrcOf(app.plugins.baseUrl, plugin.id)} title={plugin.name} />
    </section>
  )
}

/** Every widget for a screen, in install order. */
export function PluginWidgets({ place }: { place: WidgetPlace }) {
  const widgets = useWidgets(place)
  if (!widgets.length) return null
  return <>{widgets.map((p) => <WidgetCard key={p.id} plugin={p} place={place} />)}</>
}
