import { Ban, Check, CircleAlert, Hand, KeyRound, ShieldCheck, Zap, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { CURRENCY_SYMBOL } from '../../../../core/money'
import type { Autonomy } from '../../../../core/types'
import { Button, cx, PinPad, Slider, TextField, TIER_INFO } from '../../../components/ds'
import { AUTONOMY_STEPS, CAP_LABEL, groupAmount, lanes, NEVER, PIN_RULES, pinProblem, type CapKey, type Lane } from '../logic'
import type { StepProps } from '../OnboardingScreen'
import p from './PermissionsStep.module.css'
import s from './Steps.module.css'

export interface PermissionsStepProps extends StepProps {
  pinSet: boolean
  /** the confirmed PIN (kept in memory by the screen, never persisted), or null to clear it */
  onPin: (pin: string | null) => void
}

const LANES: readonly { id: Exclude<Lane, 'off'>; title: string; icon: LucideIcon }[] = [
  { id: 'auto', title: 'Runs on its own', icon: Zap },
  { id: 'tap', title: 'Waits for your tap', icon: Hand },
  { id: 'pin', title: 'Needs your tap + PIN', icon: KeyRound },
]

const CAP_HINT: Record<CapKey, string> = { perAction: 'each move', daily: 'in total', monthly: 'in total' }

/** Autonomy dial + what-runs-where matrix, money caps, and a confirmed 4–6 digit PIN. */
export function PermissionsStep({ draft, update, errors, pinSet, onPin }: PermissionsStepProps) {
  const byLane = lanes(draft.autonomy)
  const symbol = CURRENCY_SYMBOL[draft.currency]
  return (
    <>
      <p className={s.lede}>You decide how much Bun does on its own. Loosening later needs your PIN; tightening never does.</p>

      <section className={s.section} aria-labelledby="ob-autonomy-title">
        <h2 id="ob-autonomy-title" className="sr-only">Autonomy</h2>
        <div className={p.dial}>
          <Slider<Autonomy>
            label="How much may Bun do?"
            steps={AUTONOMY_STEPS}
            value={draft.autonomy}
            onChange={(autonomy) => update((d) => ({ ...d, autonomy }))}
            risk
          />
        </div>

        <div className={p.matrix}>
          {LANES.map((lane) => {
            const items = byLane[lane.id]
            const Icon = lane.icon
            return (
              <div key={lane.id} className={p.lane} data-lane={lane.id} role="group" aria-labelledby={`ob-lane-${lane.id}`}>
                <h3 id={`ob-lane-${lane.id}`} className={p.laneHead}>
                  <Icon aria-hidden="true" />
                  {lane.title}
                </h3>
                {items.length ? (
                  <ul className={p.chips}>
                    {items.map((a) => (
                      <li key={`${lane.id}-${a.id}`} className={p.chip} data-tier={a.tier}>
                        <span aria-hidden="true">{TIER_INFO[a.tier].icon}</span>
                        {a.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={p.empty}>
                    {lane.id === 'tap' && draft.autonomy === 'autopilot'
                      ? 'Only after Bun reads outside text — a bill, memo or import. Then every move waits for you.'
                      : 'Nothing at this level'}
                  </p>
                )}
              </div>
            )
          })}
          {byLane.off.length ? (
            <div className={p.lane} data-lane="off" role="group" aria-labelledby="ob-lane-off">
              <h3 id="ob-lane-off" className={p.laneHead}>Switched off while Bun only observes</h3>
              <ul className={p.chips}>
                {byLane.off.map((a) => (
                  <li key={`off-${a.id}`} className={p.chip} data-tier={a.tier}>
                    <span aria-hidden="true">{TIER_INFO[a.tier].icon}</span>
                    {a.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className={p.lane} data-lane="never" role="group" aria-labelledby="ob-lane-never">
            <h3 id="ob-lane-never" className={p.laneHead}>
              <Ban aria-hidden="true" />
              Never, at any level
            </h3>
            <ul className={p.chips}>
              {NEVER.map((label) => (
                <li key={label} className={p.chip} data-tier={4}>
                  <span aria-hidden="true">{TIER_INFO[4].icon}</span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={s.section} aria-labelledby="ob-caps-title">
        <div className={s.sectionHead}>
          <h2 id="ob-caps-title" className={s.h2}>Money limits</h2>
          <p className={s.sub}>The most Bun may move between your own pots. Raising them later needs your PIN.</p>
        </div>
        <div className={p.caps}>
          {(['perAction', 'daily', 'monthly'] as const).map((k) => (
            <TextField
              key={k}
              id={`ob-${k}`}
              label={CAP_LABEL[k]}
              prefix={symbol}
              inputMode="decimal"
              autoComplete="off"
              size={5}
              value={draft.caps[k]}
              error={errors[k]}
              hint={CAP_HINT[k]}
              onChange={(e) => {
                const value = e.currentTarget.value
                update((d) => ({ ...d, caps: { ...d.caps, [k]: value } }))
              }}
              onBlur={() => update((d) => ({ ...d, caps: { ...d.caps, [k]: groupAmount(d.caps[k], d.currency) } }))}
            />
          ))}
        </div>
      </section>

      <section id="ob-pin" className={s.section} aria-labelledby="ob-pin-title">
        <div className={s.sectionHead}>
          <h2 id="ob-pin-title" className={s.h2}>Your PIN</h2>
          <p className={s.sub}>Guards every payment and any loosening of these limits. It stays in memory until you finish — never saved as you go.</p>
        </div>
        {errors.pin ? (
          <p className={s.error} role="alert">
            <CircleAlert aria-hidden="true" />
            {errors.pin}
          </p>
        ) : null}
        <div className={cx(p.pinCard, errors.pin && s.cardError)}>
          <PinSetup pinSet={pinSet} onPin={onPin} />
        </div>
      </section>
    </>
  )
}

/** Create → confirm. A mismatch or an easy-to-guess PIN shakes the dots and starts again. */
function PinSetup({ pinSet, onPin }: { pinSet: boolean; onPin: (pin: string | null) => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)
  const phase = first === null ? 'create' : 'confirm'

  const fail = (message: string) => {
    setError(message)
    setErrorKey((k) => k + 1)
  }

  if (pinSet) {
    return (
      <div className={p.pinDone} role="status">
        <span className={p.pinDoneIcon} aria-hidden="true">
          <ShieldCheck />
        </span>
        <span className={p.pinDoneText}>
          <span className={p.pinDoneTitle}>PIN set</span>
          <span className={p.pinDoneSub}>Kept only as a salted hash on this device — never in plain text.</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onPin(null)}>
          Change
        </Button>
      </div>
    )
  }

  return (
    <div className={p.pinSetup}>
      <PinPad
        key={phase}
        minLength={4}
        maxLength={6}
        autoFocus={phase === 'confirm'}
        label={phase === 'create' ? 'Create a PIN' : 'Type it once more'}
        description={phase === 'create' ? 'Tap ✓ when you’re done.' : 'Just to be sure it’s the one you meant.'}
        error={error}
        errorKey={errorKey}
        onCancel={phase === 'confirm' ? () => setFirst(null) : undefined}
        onComplete={(pin) => {
          if (phase === 'create') {
            const problem = pinProblem(pin)
            if (problem) return fail(problem)
            setError(null)
            setFirst(pin)
            return
          }
          if (pin !== first) {
            setFirst(null)
            fail('Those didn’t match — let’s start again.')
            return
          }
          setFirst(null)
          setError(null)
          onPin(pin)
        }}
      />
      {phase === 'confirm' ? (
        <Button variant="ghost" size="sm" onClick={() => setFirst(null)}>
          Start over
        </Button>
      ) : (
        <ul className={p.rules} aria-label="PIN rules">
          {PIN_RULES.map((r) => (
            <li key={r}>
              <Check aria-hidden="true" />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
