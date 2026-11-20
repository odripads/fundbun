import { HardDrive } from 'lucide-react'
import type { AppSnapshot } from '../../../core/app-api'
import { useApp, useSnapshot } from '../../state'
import { Callout, ProgressBar } from '../ds'
import styles from './StorageMeter.module.css'

// re-render whenever the saved state changes (the size is measured on each save)
const selectVersion = (s: AppSnapshot) => s.state

function sizeText(chars: number): string {
  return chars < 1024 * 1024 ? `${Math.max(1, Math.round(chars / 1024))} KB` : `${(chars / (1024 * 1024)).toFixed(1)} MB`
}

function lastsText(months: number | undefined): string {
  if (months === undefined) return 'Bun can estimate how long it lasts after your first month.'
  if (months >= 120) return 'At your pace that lasts well over ten years.'
  if (months >= 24) return `At your pace that lasts about ${Math.floor(months / 12)} more years.`
  return `At your pace that lasts about ${months} more months. Save a copy, then start fresh when it fills up.`
}

/**
 * How much of this device's storage FundBun uses. Everything lives in the browser's storage for this site, about
 * 5 MB: a year of typing in six purchases a day is about 0.7 MB. Files are read, never stored.
 */
export function StorageMeter() {
  const app = useApp()
  useSnapshot(selectVersion)
  const s = app.storageStatus()
  return (
    <div className={styles.meter}>
      <p className={styles.head}>
        <HardDrive aria-hidden="true" />
        <span>
          <strong>{sizeText(s.used)}</strong> of about {sizeText(s.limit)} on this device
        </span>
      </p>
      <ProgressBar value={Math.max(1, Math.round(s.share * 100))} label="Storage used" tone={s.share > 0.8 ? 'over' : 'accent'} />
      <p className={styles.note}>{lastsText(s.monthsLeft)} Receipts and files are read, not kept, so they take no space.</p>
      {s.error ? (
        <Callout tone="block" title="Your latest changes couldn’t be saved">
          This device’s storage for FundBun is full. Save a copy now, before closing the app.
        </Callout>
      ) : null}
    </div>
  )
}

/** A banner on every screen when a save failed, so the user never loses changes silently. */
export function SaveFailedBanner() {
  const app = useApp()
  useSnapshot(selectVersion)
  const s = app.storageStatus()
  if (!s.error) return null
  return (
    <div className={styles.banner} role="alert">
      <Callout tone="block" title="Not saved on this device">
        Storage is full, so your latest changes will be lost when you close the app. Open Settings → Privacy and tap
        “Export my data” to keep a copy.
      </Callout>
    </div>
  )
}
