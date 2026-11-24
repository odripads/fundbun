/**
 * Consent toggle for "Receipt scans" — off by default. Scanning a receipt (camera → on-device OCR → confirm)
 * only becomes available once the user opts in. The photo is processed on-device and never kept.
 */
import { Camera } from 'lucide-react'
import type { AppSnapshot } from '../../../core/app-api'
import { Badge, Card, SectionHeader, Toggle } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import styles from './Settings.module.css'

function selectReceipt(s: AppSnapshot) {
  return { receiptScans: s.state.settings.receiptScans }
}

export function ReceiptSettingsSection() {
  const app = useApp()
  const { receiptScans } = useSnapshot(selectReceipt, shallowEqual)

  return (
    <section id="set-receipt" aria-labelledby="set-receipt-h" className={styles.section}>
      <SectionHeader id="set-receipt-h" eyebrow="Camera" title="Receipt scans" />
      <Card padding="none">
        <div className={styles.consentRow}>
          <span className={styles.rowIcon} aria-hidden="true"><Camera /></span>
          <span className={styles.consentText}>
            <span className={styles.consentTitle}>Receipt scans</span>
            <span className={styles.consentSub}>
              {receiptScans ? 'On: photographs are read on this device and never kept.' : 'Off by default.'}
            </span>
          </span>
          <Badge variant={receiptScans ? 'under' : 'neutral'} size="sm">{receiptScans ? 'On' : 'Off'}</Badge>
        </div>
        <div className={styles.toggleRow}>
          <Toggle
            label="Scan receipts with the camera"
            description="Photograph a paper receipt; Bun turns it into a spending item on this device. You confirm before anything is added, and the photo is discarded afterwards."
            checked={receiptScans}
            onChange={(receiptScans) => app.setSettings({ receiptScans })}
            tone="accent"
          />
        </div>
      </Card>
    </section>
  )
}
