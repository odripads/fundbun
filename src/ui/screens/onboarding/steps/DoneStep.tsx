import { Bell, FileSpreadsheet, Landmark, Lock, ShieldCheck, Sparkles, Sprout, Wallet, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { fmt } from '../../../../core/money'
import { DreamImage } from '../../../components/brand'
import { Button, Callout } from '../../../components/ds'
import type { OnboardingDraft, StepId } from '../draft'
import { AUTONOMY_STEPS, CSV_FORMAT_LABEL, ordinal, parseBalance, parseCaps, parseIncome, parseTarget, SANDBOX_LEDGERS, STEP_META, summarizeCsv, TONE_COPY, type Problem } from '../logic'
import s from './Steps.module.css'
import x from './DoneStep.module.css'

export interface DoneStepProps {
  draft: OnboardingDraft
  pinSet: boolean
  /** what's still missing (after "Show me my mirror") */
  problems: Problem[]
  /** the controller's Result.error, verbatim */
  error: string | null
  onEdit: (step: StepId) => void
}

interface Row {
  step: StepId
  icon: LucideIcon
  label: string
  value: ReactNode
}

function dataLine(d: OnboardingDraft): string {
  const bal = parseBalance(d)
  const balance = bal.ok ? fmt(bal.minor, d.currency) : null
  switch (d.data.kind) {
    case 'persona':
      return `${SANDBOX_LEDGERS.find((l) => l.id === d.data.personaId)?.owner ?? 'Sandbox ledger'} · simulated`
    case 'csv': {
      const csv = d.data.csvText ? summarizeCsv(d.data.csvText, d.currency) : null
      return csv && csv.count ? `${csv.count} transactions · ${CSV_FORMAT_LABEL[csv.format]}` : 'CSV import'
    }
    case 'empty':
      return balance ? `Starting fresh with ${balance}` : 'Starting fresh'
    default:
      return 'Not chosen yet'
  }
}

/** The recap before committing: every choice in one place, each a tap away from editing. */
export function DoneStep({ draft, pinSet, problems, error, onEdit }: DoneStepProps) {
  const f = (m: number) => fmt(m, draft.currency)
  const income = parseIncome(draft)
  const target = parseTarget(draft)
  const caps = parseCaps(draft).values
  const main = draft.dreams.find((d) => d.kind === 'goal') ?? draft.dreams[0]
  const on = draft.tripwires.filter((t) => t.enabled).length
  const autonomy = AUTONOMY_STEPS.find((a) => a.value === draft.autonomy)?.label ?? draft.autonomy
  const DataIcon = draft.data.kind === 'csv' ? FileSpreadsheet : draft.data.kind === 'empty' ? Sprout : Landmark

  const rows: Row[] = [
    {
      step: 'money',
      icon: Wallet,
      label: 'Your month',
      value: income.ok && target.ok ? `${f(income.minor)} in · ${f(target.minor)} to spend · paid on the ${ordinal(draft.payday)}` : 'Needs your numbers',
    },
    {
      step: 'dreams',
      icon: Sparkles,
      label: draft.dreams.length === 1 ? '1 dream' : `${draft.dreams.length} dreams`,
      value: (
        <span className={x.dreams}>
          <span className={x.thumbs} aria-hidden="true">
            {draft.dreams.slice(0, 5).map((d) => (
              <DreamImage key={d.key} image={d.image} alt="" size={34} className={x.thumb} />
            ))}
          </span>
          {main ? <span>Main goal: {main.name}</span> : null}
        </span>
      ),
    },
    { step: 'tripwires', icon: Bell, label: 'Tripwires & tone', value: `${on} of ${draft.tripwires.length} tripwires on · ${TONE_COPY[draft.tone].label} tone` },
    {
      step: 'permissions',
      icon: ShieldCheck,
      label: 'Bun’s permissions',
      value: `${autonomy} · ${caps.perAction !== undefined && caps.daily !== undefined && caps.monthly !== undefined ? `${f(caps.perAction)} / ${f(caps.daily)} / ${f(caps.monthly)}` : 'caps need a look'} · ${pinSet ? 'PIN set' : 'PIN needed'}`,
    },
    { step: 'data', icon: DataIcon, label: 'Your data', value: dataLine(draft) },
    {
      step: 'consent',
      icon: Lock,
      label: 'Consent',
      value: `Financial data${draft.consent.llmProcessing ? ' · AI model in chat' : ' · on-device only'}${draft.consent.notifications ? ' · reminders' : ''}`,
    },
  ]

  return (
    <>
      <p className={x.lede}>Here’s everything Bun knows. Tap a row to change it — then meet your mirror.</p>

      {error ? (
        <Callout tone="block" title="Bun couldn’t finish setting up">
          {error}
        </Callout>
      ) : null}
      {problems.length ? (
        <Callout tone="warn" title={problems.length === 1 ? 'One thing to finish first' : `${problems.length} things to finish first`}>
          <ul className={x.problems}>
            {problems.map((p) => (
              <li key={`${p.step}-${p.message}`}>
                <span>{p.message}</span>
                <Button variant="soft" size="sm" onClick={() => onEdit(p.step)}>
                  Fix in {STEP_META[p.step].short}
                </Button>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <ul className={x.summary}>
        {rows.map((r) => {
          const Icon = r.icon
          return (
            <li key={r.step} className={x.row}>
              <span className={x.icon} aria-hidden="true">
                <Icon />
              </span>
              <span className={x.text}>
                <span className={x.label}>{r.label}</span>
                <span className={x.value}>{r.value}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => onEdit(r.step)} aria-label={`Edit ${STEP_META[r.step].short}`}>
                Edit
              </Button>
            </li>
          )
        })}
      </ul>

      <p className={s.note}>
        <ShieldCheck aria-hidden="true" />
        Everything above stays on this device. Your PIN is stored only as a salted hash.
      </p>
    </>
  )
}
