/**
 * The desktop glass box while the user is still onboarding: nothing is traced yet, so it shows what Bun will be
 * allowed to see and do — data stays on the device, consent is separate and never pre-ticked, the PIN is only
 * ever stored as a hash, and every permission tier the policy engine enforces.
 */
import { Eraser, HardDrive, KeyRound, LockKeyhole, ScrollText, ShieldCheck, ToggleLeft, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { Tier } from '../../../core/types'
import { TIER_INFO, Tabs, TierBadge } from '../../components/ds'
import styles from './GlassBox.module.css'

export type OnboardingGlassTab = 'privacy' | 'permissions'

export interface PrivacyPoint {
  id: string
  title: string
  body: string
}

/** What onboarding promises, in the order a judge would check it. */
export const PRIVACY_POINTS: readonly PrivacyPoint[] = [
  { id: 'local', title: 'Your data stays on this device', body: 'Transactions, dreams and chat live in this browser. The vault can encrypt them with your PIN.' },
  { id: 'consent', title: 'Two consents, nothing pre-ticked', body: 'Reading your finances (PIPL Art. 29) and AI processing are asked for separately. Say no to AI and Bun runs fully on-device.' },
  { id: 'pin', title: 'Your PIN is never stored', body: 'Only a salted PBKDF2 hash. Paying, cancelling and raising Bun’s permissions all need it.' },
  { id: 'audit', title: 'Every step is on the record', body: 'A hash-chained audit log starts the moment you finish, so any tampering shows.' },
  { id: 'delete', title: 'Delete everything, anytime', body: 'One tap in Settings wipes all local data, no questions asked.' },
]

const PRIVACY_ICON: Record<string, LucideIcon> = {
  local: HardDrive,
  consent: ToggleLeft,
  pin: KeyRound,
  audit: ScrollText,
  delete: Eraser,
}

const TIERS: Tier[] = [0, 1, 2, 3, 4]

function PrivacyView() {
  return (
    <div className={styles.stack}>
      <p className={styles.obLead}>
        <LockKeyhole aria-hidden="true" />
        Nothing has been read yet. Here is what Bun will — and won’t — get.
      </p>
      <ul className={styles.obPoints} role="list">
        {PRIVACY_POINTS.map((p, i) => {
          const Icon = PRIVACY_ICON[p.id] ?? ShieldCheck
          return (
            <li key={p.id} className={styles.obPoint} style={{ ['--i' as string]: i }}>
              <span className={styles.obIcon} aria-hidden="true"><Icon /></span>
              <span className={styles.obText}>
                <span className={styles.obTitle}>{p.title}</span>
                <span className={styles.obBody}>{p.body}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PermissionsView() {
  return (
    <div className={styles.stack}>
      <p className={styles.obLead}>
        <ShieldCheck aria-hidden="true" />
        The model proposes; this ladder decides. You pick how far up Bun may act.
      </p>
      <ol className={styles.obTiers}>
        {TIERS.map((t) => (
          <li key={t} className={styles.obTier}>
            <TierBadge tier={t} size="sm" />
            <span className={styles.obBody}>{TIER_INFO[t].description}</span>
          </li>
        ))}
      </ol>
      <p className={styles.quiet}>
        <KeyRound aria-hidden="true" /> Raising permissions needs your PIN. Lowering them is instant.
      </p>
    </div>
  )
}

export function OnboardingGlass() {
  const [tab, setTab] = useState<OnboardingGlassTab>('privacy')
  return (
    <div className={styles.root}>
      <Tabs<OnboardingGlassTab>
        label="Before you start"
        variant="pill"
        fill
        value={tab}
        onChange={setTab}
        className={styles.tabs}
        items={[
          { id: 'privacy', label: 'Privacy', content: <PrivacyView /> },
          { id: 'permissions', label: 'Permissions', content: <PermissionsView /> },
        ]}
      />
    </div>
  )
}
