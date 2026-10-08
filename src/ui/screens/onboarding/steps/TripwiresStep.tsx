import { HeartHandshake } from 'lucide-react'
import { fmt } from '../../../../core/money'
import type { Tone } from '../../../../core/types'
import { BunMascot, DreamImage } from '../../../components/brand'
import { AiBadge, cx, Segmented, Toggle } from '../../../components/ds'
import type { TripwireDraft } from '../draft'
import { previewMirror, targetOrFallback, thresholdOf, thresholdRange, TONE_COPY, TRIPWIRE_META, tripwireDetail } from '../logic'
import type { StepProps } from '../OnboardingScreen'
import { ThresholdStepper } from './ThresholdStepper'
import s from './Steps.module.css'
import t from './TripwiresStep.module.css'

const TONES: readonly Tone[] = ['gentle', 'cheeky', 'numbers']

/** Default tripwires as toggles with editable thresholds, then the tone picker with a live Mirror preview. */
export function TripwiresStep({ draft, update, errors }: StepProps) {
  const target = targetOrFallback(draft)
  const mainDream = draft.dreams.find((x) => x.kind === 'goal') ?? draft.dreams[0]
  const preview = previewMirror(draft)
  const f = (m: number) => fmt(m, draft.currency)

  const patch = (key: TripwireDraft['key'], change: Partial<TripwireDraft>) =>
    update((d) => ({ ...d, tripwires: d.tripwires.map((x) => (x.key === key ? { ...x, ...change } : x)) }))

  return (
    <>
      <p className={s.lede}>Tripwires are lines you draw. Cross one and Bun nudges you with your dream’s picture — no lectures.</p>

      <section className={s.section} aria-labelledby="ob-tw-title">
        <div className={s.sectionHead}>
          <h2 id="ob-tw-title" className={s.h2}>Your tripwires</h2>
          <p className={s.sub}>Against your {f(target)} monthly target. Change them any time.</p>
        </div>
        <ul className={t.list}>
          {draft.tripwires.map((tw) => {
            const meta = TRIPWIRE_META[tw.key]
            const value = thresholdOf(tw, target, draft.currency)
            const detailId = `ob-${tw.key}-detail`
            return (
              <li key={tw.key} className={cx(t.row, tw.enabled && t.on, errors[tw.key] && s.cardError)}>
                <Toggle
                  checked={tw.enabled}
                  onChange={(enabled) => patch(tw.key, { enabled })}
                  label={meta.title}
                  description={<span id={detailId}>{tripwireDetail(tw.key, value, target, draft.currency, mainDream?.name)}</span>}
                  tone="accent"
                />
                {tw.enabled ? (
                  <div className={t.control}>
                    <span className={t.controlLabel}>{meta.unit === 'pct' ? (tw.key === 'pace' ? 'Forecast at' : 'Alert at') : 'Purchases over'}</span>
                    <ThresholdStepper
                      id={`ob-${tw.key}`}
                      label={`${meta.title} threshold`}
                      value={value}
                      unit={meta.unit}
                      currency={draft.currency}
                      range={thresholdRange(tw.key, target, draft.currency)}
                      onChange={(threshold) => patch(tw.key, { threshold })}
                      invalid={Boolean(errors[tw.key])}
                      describedBy={detailId}
                    />
                  </div>
                ) : null}
                {errors[tw.key] ? <p className={s.error} role="alert">{errors[tw.key]}</p> : null}
              </li>
            )
          })}
        </ul>
      </section>

      <section className={s.section} aria-labelledby="ob-tone-title">
        <div className={s.sectionHead}>
          <h2 id="ob-tone-title" className={s.h2}>Bun’s tone</h2>
          <p className={s.sub}>How the Dream Mirror talks to you.</p>
        </div>
        <Segmented<Tone>
          label="Bun’s tone"
          value={draft.tone}
          onChange={(tone) => update((d) => ({ ...d, tone }))}
          options={TONES.map((v) => ({ value: v, label: TONE_COPY[v].label }))}
        />
        <p className={t.toneHint}>{TONE_COPY[draft.tone].hint}</p>

        <figure className={t.preview} data-tone={draft.tone} aria-labelledby="ob-preview-caption">
          <div className={t.previewTop}>
            <span className={t.previewArt}>
              <DreamImage key={preview.dream.image} image={preview.dream.image} alt="" size={64} glow />
              <BunMascot mood={preview.mood} size={38} className={t.previewBun} />
            </span>
            <figcaption id="ob-preview-caption" className={t.caption}>
              <span className={t.captionKicker}>Preview</span>
              <span className={t.captionLine}>
                {f(preview.overspend)} over a {f(preview.target)} target
              </span>
            </figcaption>
          </div>
          <div className={t.previewText} aria-live="polite">
            <p key={`${draft.tone}-${preview.headline}`} className={t.headline}>{preview.headline}</p>
            <p className={t.subline}>{preview.subline}</p>
            <AiBadge engine="offline" className={t.ai} />
          </div>
        </figure>

        <p className={s.note}>
          <HeartHandshake aria-hidden="true" />
          {draft.tone === 'cheeky'
            ? 'You opted in to Cheeky. It’s blunt on purpose — if it ever stings, switch back to Gentle in Settings.'
            : 'Cheeky is opt-in only. Blunt copy can backfire, so Bun starts gentle and never shames.'}
        </p>
      </section>
    </>
  )
}
