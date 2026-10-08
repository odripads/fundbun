/**
 * #/onboarding — the first-run flow: Welcome → Consent → Your money → Dreams → Tripwires & tone →
 * Bun's permissions → Your data → Done. Full-height steps with a sticky progress bar and a sticky primary action,
 * per-step validation (errors appear after the first "Continue" and focus moves to the first problem), and a
 * draft persisted in sessionStorage (the PIN never is). The step lives in the URL (?step=…) so back works.
 */
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { Result } from '../../../core/app-api'
import { BunMascot } from '../../components/brand'
import { Button, cx, IconButton, useToast } from '../../components/ds'
import { navigate, useRoute } from '../../router'
import { errorText, useApp } from '../../state'
import { clearDraft, emptyDraft, hasProgress, isStepId, loadDraft, saveDraft, type OnboardingDraft, type PersonaId, type StepId } from './draft'
import { backTo, pushStep, replaceStep } from './history'
import {
  buildOnboardingInput,
  clampStep,
  firstInvalidStep,
  FLOW,
  flowPosition,
  nextStep,
  prevStep,
  STEP_META,
  stepErrors,
  stepIndex,
  summarizeCsv,
  type Errors,
  type Problem,
} from './logic'
import { ConsentStep } from './steps/ConsentStep'
import { DataStep } from './steps/DataStep'
import { DoneStep } from './steps/DoneStep'
import { DreamsStep } from './steps/DreamsStep'
import { MoneyStep } from './steps/MoneyStep'
import { PermissionsStep } from './steps/PermissionsStep'
import { TripwiresStep } from './steps/TripwiresStep'
import { DreamOrbit, type OrbitItem } from './steps/DreamOrbit'
import { WelcomeStep } from './steps/WelcomeStep'
import styles from './Onboarding.module.css'

export type Patch = (fn: (d: OnboardingDraft) => OnboardingDraft) => void

export interface StepProps {
  draft: OnboardingDraft
  update: Patch
  /** errors to show (empty until the user tried to continue) */
  errors: Errors
  /** hide the sticky Continue while the step has its own primary action in progress (e.g. the dream editor) */
  setBusy?: (busy: boolean) => void
}

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 40))

const TEXTY = 'input:not([type=file]):not([type=radio]):not([type=checkbox]), select, textarea'
const FOCUSABLE = 'input, select, textarea, button, [tabindex]'

/** Focus the first invalid control: `#ob-<key>` itself, a text field inside it, or its first focusable thing. */
function focusFirstError(errors: Errors) {
  for (const key of Object.keys(errors)) {
    const el = document.getElementById(`ob-${key}`)
    if (!el) continue
    const target = el.matches(FOCUSABLE) ? el : (el.querySelector<HTMLElement>(TEXTY) ?? el.querySelector<HTMLElement>(FOCUSABLE))
    if (target) {
      target.focus({ preventScroll: true })
      target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      return
    }
  }
}

export function OnboardingScreen() {
  const app = useApp()
  const toast = useToast()
  const loc = useRoute()
  const [draft, setDraft] = useState<OnboardingDraft>(loadDraft)
  // the PIN lives in memory only — never in the persisted draft
  const [pin, setPin] = useState<string | null>(null)
  const [attempted, setAttempted] = useState<Partial<Record<StepId, boolean>>>({})
  const [finishing, setFinishing] = useState(false)
  const [finish, setFinish] = useState<{ problems: Problem[]; error: string | null }>({ problems: [], error: null })
  const [demoLoading, setDemoLoading] = useState<PersonaId | null>(null)
  const [stepBusy, setStepBusy] = useState(false)
  // set when the user jumps from the summary to fix something: Continue then goes straight back to it
  const [returnToSummary, setReturnToSummary] = useState(false)

  useEffect(() => {
    saveDraft(draft)
  }, [draft])

  const update: Patch = useCallback((fn) => setDraft((d) => fn(d)), [])

  const csv = useMemo(
    () => (draft.data.kind === 'csv' && draft.data.csvText ? summarizeCsv(draft.data.csvText, draft.currency) : null),
    [draft.data.kind, draft.data.csvText, draft.currency],
  )
  const flowCtx = useMemo(() => ({ pinSet: pin !== null, csv }), [pin, csv])
  const requested: StepId = isStepId(loc.query.step) ? loc.query.step : 'welcome'
  const step = clampStep(requested, draft, flowCtx)

  useEffect(() => {
    if (step !== requested) replaceStep(step)
  }, [step, requested])

  // slide direction follows the step index, whatever moved it (buttons, browser back, deep link)
  const [view, setView] = useState<{ step: StepId; dir: 'fwd' | 'back' }>({ step, dir: 'fwd' })
  if (view.step !== step) setView({ step, dir: stepIndex(step) > stepIndex(view.step) ? 'fwd' : 'back' })

  const rootRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // on a step change (not on first load): back to the top, focus on the new heading for screen readers
  const lastStep = useRef(step)
  useEffect(() => {
    if (lastStep.current === step) return
    lastStep.current = step
    rootRef.current?.scrollIntoView?.({ block: 'start' })
    headingRef.current?.focus({ preventScroll: true })
  }, [step])

  const errors: Errors = attempted[step] ? stepErrors(step, draft, flowCtx) : {}

  useEffect(() => {
    if (step === 'done' || step === 'welcome') setReturnToSummary(false)
    // a fix happens elsewhere: the summary re-checks on the next "Show me my mirror"
    if (step !== 'done') setFinish({ problems: [], error: null })
  }, [step])

  function goNext() {
    const errs = stepErrors(step, draft, flowCtx)
    if (Object.keys(errs).length) {
      setAttempted((a) => ({ ...a, [step]: true }))
      requestAnimationFrame(() => focusFirstError(errs))
      return
    }
    pushStep(returnToSummary ? clampStep('done', draft, flowCtx) : nextStep(step))
  }

  const goBack = () => backTo(prevStep(step))
  const editFromSummary = (target: StepId) => {
    setReturnToSummary(true)
    pushStep(target)
  }

  /** Enter in a plain field means "Continue" (forms and widgets that handle Enter themselves are left alone). */
  function onBodyKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.key !== 'Enter' || e.defaultPrevented || target.closest('form')) return
    if (!target.matches('input:not([type=radio]):not([type=checkbox]):not([type=file]), select')) return
    e.preventDefault()
    goNext()
  }

  async function loadDemo(id: PersonaId) {
    setDemoLoading(id)
    await nextFrame()
    try {
      app.loadDemo(id)
      clearDraft()
      navigate('home', { replace: true })
    } catch (e) {
      toast.show({ tone: 'danger', title: 'The demo didn’t load', message: errorText(e) })
    } finally {
      setDemoLoading(null)
    }
  }

  async function complete() {
    const built = buildOnboardingInput(draft, pin, csv)
    if (!built.ok) {
      setFinish({ problems: built.problems, error: null })
      return
    }
    setFinishing(true)
    setFinish({ problems: [], error: null })
    await nextFrame()
    let result: Result
    try {
      result = app.completeOnboarding(built.input)
    } catch (e) {
      result = { ok: false, error: errorText(e) }
    }
    setFinishing(false)
    if (!result.ok) {
      setFinish({ problems: [], error: result.error ?? 'Something went wrong. Please try again.' })
      return
    }
    clearDraft()
    const mirrored = app.getSnapshot().derived.mirror?.status
    toast.show({
      tone: 'success',
      title: `Welcome, ${built.input.name}`,
      message: mirrored && mirrored !== 'no_data' ? 'Here’s your month, mirrored.' : 'Your mirror fills in as this month’s spending arrives.',
      // a greeting, not a task: brief, so it doesn't sit on the first Home's tiles and CTA (F39)
      duration: 3500,
    })
    navigate('home', { replace: true })
  }

  const props: StepProps = { draft, update, errors, setBusy: setStepBusy }

  if (step === 'welcome') {
    return (
      <div ref={rootRef} className={styles.root}>
        <WelcomeStep
          headingRef={headingRef}
          resumable={hasProgress(draft)}
          onboarded={app.isOnboarded()}
          demoLoading={demoLoading}
          onStart={() => pushStep(hasProgress(draft) ? firstInvalidStep(draft, flowCtx) : 'consent')}
          onRestart={() => {
            setDraft(emptyDraft())
            setPin(null)
            setAttempted({})
            pushStep('consent')
          }}
          onDemo={loadDemo}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  const meta = STEP_META[step]
  const position = flowPosition(step)
  const errorCount = Object.keys(errors).length
  let body: ReactNode
  let action: ReactNode = (
    <Button size="lg" fullWidth onClick={goNext} iconEnd={<ArrowRight />}>
      {returnToSummary ? 'Back to summary' : step === 'data' ? 'Review my setup' : 'Continue'}
    </Button>
  )
  switch (step) {
    case 'consent':
      body = <ConsentStep {...props} />
      break
    case 'money':
      body = <MoneyStep {...props} />
      break
    case 'dreams':
      body = <DreamsStep {...props} />
      break
    case 'tripwires':
      body = <TripwiresStep {...props} />
      break
    case 'permissions':
      body = <PermissionsStep {...props} pinSet={pin !== null} onPin={setPin} />
      break
    case 'data':
      body = <DataStep {...props} csv={csv} />
      break
    case 'done':
      body = <DoneStep draft={draft} pinSet={pin !== null} problems={finish.problems} error={finish.error} onEdit={editFromSummary} />
      action = (
        <Button size="lg" fullWidth onClick={complete} loading={finishing} iconEnd={<ArrowRight />}>
          {finishing ? 'Setting up your mirror…' : 'Show me my mirror'}
        </Button>
      )
      break
  }

  return (
    <div ref={rootRef} className={styles.root} data-step={step}>
      <StepBar step={step} onBack={goBack} />
      <div key={step} className={styles.body} data-dir={view.dir} onKeyDown={onBodyKeyDown}>
        <StepIntro
          headingRef={headingRef}
          eyebrow={position ? `Step ${position} of ${FLOW.length}` : 'Ready when you are'}
          title={step === 'done' && draft.name.trim() ? `You’re all set, ${draft.name.trim()}` : meta.title}
          mood={meta.mood}
          big={step === 'done'}
          art={step === 'done' ? <DreamOrbit items={doneOrbit(draft)} mascotSize={112} radius={96} height={draft.dreams.length <= 2 ? 184 : 232} /> : undefined}
        />
        {body}
      </div>
      <footer className={styles.footer} hidden={stepBusy && step === 'dreams'}>
        {errorCount ? (
          <p className={styles.footNote} role="status">
            {errorCount === 1 ? 'One thing needs your attention above.' : `${errorCount} things need your attention above.`}
          </p>
        ) : null}
        {action}
      </footer>
    </div>
  )
}

/** Sticky top bar: back, segmented progress over the six flow steps, "n of 6". */
function StepBar({ step, onBack }: { step: StepId; onBack: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null)
  const stuck = useStuck(sentinel)
  const position = flowPosition(step) ?? FLOW.length + 1
  const done = Math.min(FLOW.length, position - 1)
  return (
    <>
      <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <div className={cx(styles.bar, stuck && styles.stuck)}>
        <div className={styles.barRow}>
          <IconButton label={step === 'consent' ? 'Back to welcome' : 'Previous step'} icon={<ChevronLeft />} onClick={onBack} />
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={FLOW.length}
            aria-valuenow={done}
            aria-valuetext={step === 'done' ? 'All steps complete' : `Step ${position} of ${FLOW.length}: ${STEP_META[step].short}`}
          >
            {FLOW.map((s, i) => (
              <span key={s} className={styles.seg} data-state={i < done ? 'done' : i === done && step !== 'done' ? 'current' : 'todo'} />
            ))}
          </div>
          <span className={styles.count} aria-hidden="true">
            {step === 'done' ? 'Done' : `${position}/${FLOW.length}`}
          </span>
        </div>
      </div>
    </>
  )
}

function useStuck(sentinel: RefObject<HTMLElement | null>): boolean {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [sentinel])
  return stuck
}

interface StepIntroProps {
  headingRef: RefObject<HTMLHeadingElement | null>
  eyebrow: string
  title: string
  mood: OnboardingMood
  /** the finish line: centred, bigger, art on top */
  big?: boolean
  /** replaces the mascot (e.g. the user's dreams orbiting Bun) */
  art?: ReactNode
}

function StepIntro({ headingRef, eyebrow, title, mood, big, art }: StepIntroProps) {
  return (
    <header className={cx(styles.intro, big && styles.introBig)}>
      <div className={styles.introText}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        {/* onboarding has no shell TopBar, so the step title is the page's h1 */}
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
      </div>
      {art ?? <BunMascot mood={mood} size={big ? 132 : 64} className={styles.mascot} />}
    </header>
  )
}

type OnboardingMood = (typeof STEP_META)[StepId]['mood']

/** the user's own dreams (up to six) circling Bun at the finish line; the main goal glows */
function doneOrbit(d: OnboardingDraft): OrbitItem[] {
  const mainKey = d.dreams.find((x) => x.kind === 'goal')?.key
  return d.dreams.slice(0, 6).map((x) => ({ image: x.image, size: x.key === mainKey ? 54 : 44, glow: x.key === mainKey }))
}
