/**
 * Profile: name, income, spending target, payday and Bun's tone. The tone switch previews the real Dream
 * Mirror line (computed by the finance engine with the draft target and tone) before anything is saved.
 */
import { CircleCheck, RotateCcw } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CURRENCY_SYMBOL } from '../../../core/money'
import type { Profile } from '../../../core/types'
import { BunMascot, DreamImage } from '../../components/brand'
import { Button, Card, SectionHeader, Segmented, TextField } from '../../components/ds'
import { useApp, useSafeAction, useSnapshot } from '../../state'
import { TONE_OPTIONS, checkProfileDraft, mirrorPreview, parseMoneyInput, profileDraft, toneLine, type ProfileDraft } from './logic'
import styles from './Settings.module.css'

const selectProfile = (s: AppSnapshot) => s.state.profile
const selectCtx = (s: AppSnapshot) => s.derived.ctx

export function ProfileSection() {
  const profile = useSnapshot(selectProfile)
  if (!profile) return null
  // remount the form when the saved profile changes underneath (persona switch, reset)
  return <ProfileForm key={`${profile.onboardedAt}|${profile.personaId ?? ''}`} profile={profile} />
}

function ProfileForm({ profile }: { profile: Profile }) {
  const app = useApp()
  const run = useSafeAction()
  const ctx = useSnapshot(selectCtx)
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraft(profile))
  const [showErrors, setShowErrors] = useState(false)
  const { patch, errors } = checkProfileDraft(draft, profile)
  const dirty = Object.keys(patch).length > 0
  const symbol = CURRENCY_SYMBOL[profile.currency]

  const target = parseMoneyInput(draft.target, profile.currency) ?? undefined
  const preview = useMemo(() => mirrorPreview(ctx, draft.tone, target), [ctx, draft.tone, target])

  const set = (k: keyof ProfileDraft) => (e: { currentTarget: { value: string } }) => {
    const value = e.currentTarget.value
    setDraft((d) => ({ ...d, [k]: value }))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (Object.keys(errors).length) {
      setShowErrors(true)
      return
    }
    if (!dirty) return
    const r = await run(() => app.setProfile(patch), {
      success: toneLine(draft.tone, { gentle: 'Saved. Bun’s got it.', cheeky: 'Noted. Bun’s taking notes.', numbers: 'Profile saved.' }),
    })
    if (r?.ok) setShowErrors(false)
  }

  const err = (k: keyof ProfileDraft) => (showErrors ? errors[k] : undefined)

  return (
    <section id="set-profile" aria-labelledby="set-profile-h" className={styles.section}>
      <SectionHeader id="set-profile-h" eyebrow="You" title="Profile" />
      <Card className={styles.card}>
        <form className={styles.profileForm} onSubmit={save} noValidate>
          <TextField label="Name" value={draft.name} onChange={set('name')} error={err('name')} autoComplete="given-name" className={styles.span2} />
          <TextField label="Monthly income" prefix={symbol} inputMode="decimal" value={draft.income} onChange={set('income')} error={err('income')} hint="After tax" />
          <TextField label="Spending target" prefix={symbol} inputMode="decimal" value={draft.target} onChange={set('target')} error={err('target')} hint="Per month, not savings" />
          <TextField label="Payday" inputMode="numeric" value={draft.payday} onChange={set('payday')} error={err('payday')} hint="Day of the month, 1–28" />

          <fieldset className={styles.toneField}>
            <legend className={styles.fieldLabel}>Bun’s tone</legend>
            <Segmented
              label="Bun’s tone"
              value={draft.tone}
              onChange={(tone) => setDraft((d) => ({ ...d, tone }))}
              options={TONE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <p className={styles.fieldHint}>{TONE_OPTIONS.find((o) => o.value === draft.tone)?.blurb}</p>
          </fieldset>

          {preview ? (
            <figure className={styles.preview} aria-live="polite">
              <figcaption className={styles.previewCaption}>Preview · what Home will say</figcaption>
              <div className={styles.previewBody} key={`${draft.tone}|${preview.headline}`}>
                <span className={styles.previewArt} aria-hidden="true">
                  {preview.image ? <DreamImage image={preview.image} alt="" size={56} /> : <BunMascot mood={preview.mood} size={56} animated />}
                </span>
                <span className={styles.previewText}>
                  <span className={styles.previewHeadline}>{preview.headline}</span>
                  <span className={styles.previewSub}>{preview.subline}</span>
                </span>
              </div>
            </figure>
          ) : null}

          <div className={styles.formActions}>
            {dirty ? (
              <>
                <Button type="submit">Save changes</Button>
                <Button type="button" variant="ghost" iconStart={<RotateCcw />} onClick={() => { setDraft(profileDraft(profile)); setShowErrors(false) }}>
                  Undo edits
                </Button>
              </>
            ) : (
              <p className={styles.savedNote} role="status">
                <CircleCheck aria-hidden="true" /> All changes saved
              </p>
            )}
          </div>
        </form>
      </Card>
    </section>
  )
}
