import { FileSpreadsheet, Mail, type LucideIcon } from 'lucide-react'
import { Badge } from '../../../components/ds'
import type { ModeKind } from '../draft'
import type { StepProps } from '../OnboardingScreen'
import dd from './DataStep.module.css'
import s from './Steps.module.css'
import { EmailConsentStep } from './EmailConsentStep'

const MODES: readonly { kind: ModeKind; icon: LucideIcon; title: string; body: string; badge?: string }[] = [
  { kind: 'manual', icon: FileSpreadsheet, title: 'Manual', body: 'Upload a CSV from your bank whenever you want to add spending.' },
  { kind: 'auto', icon: Mail, title: 'Auto', body: 'Bun reads your bank emails and shows you new spendings to confirm.', badge: 'Read-only' },
]

/** MANUAL vs AUTO data-source mode. Choosing AUTO reveals the WHAT/WHY/WHERE consent screen below. */
export function ModeStep({ draft, update }: StepProps) {
  const setMode = (mode: ModeKind) => update((d) => ({ ...d, mode }))
  return (
    <>
      <p className={s.lede}>How should your spending arrive? You can change this any time in Settings.</p>
      <div className={s.stack}>
        {MODES.map((m) => {
          const checked = draft.mode === m.kind
          const Icon = m.icon
          return (
            <div key={m.kind} className={dd.option} data-checked={checked || undefined}>
              <label className={dd.head}>
                <input type="radio" name="ob-mode" value={m.kind} checked={checked} className="sr-only" onChange={() => setMode(m.kind)} />
                <span className={dd.icon} aria-hidden="true"><Icon /></span>
                <span className={dd.text}>
                  <span className={dd.title}>
                    {m.title}
                    {m.badge ? <Badge size="sm" variant="info">{m.badge}</Badge> : null}
                  </span>
                  <span className={dd.body}>{m.body}</span>
                </span>
                <span className={dd.radio} aria-hidden="true" />
              </label>
            </div>
          )
        })}
      </div>
      {draft.mode === 'auto' ? <EmailConsentStep draft={draft} update={update} /> : null}
    </>
  )
}
