import { Monitor } from 'lucide-react'
import { setViewPreference } from './useDeskMode'
import styles from './ViewSwitch.module.css'

/**
 * Shown beside the device frame when the phone view was picked on a window wide enough for the desk layout: the
 * way back. Small and out of the way, in the corner of the stage.
 */
export function DesktopViewButton() {
  return (
    <button type="button" className={styles.switch} onClick={() => setViewPreference('desk')} aria-label="Switch to the desktop view" title="Switch to the desktop view">
      <Monitor aria-hidden="true" />
      <span className={styles.label} aria-hidden="true">Desktop view</span>
    </button>
  )
}
