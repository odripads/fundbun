import { Ban, ChevronRight, CircleAlert, Cpu, EyeOff, Funnel, Receipt, Smartphone, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, cx, Toggle } from '../../../components/ds'
import type { OnboardingDraft } from '../draft'
import type { StepProps } from '../OnboardingScreen'
import s from './Steps.module.css'

type ConsentKey = keyof OnboardingDraft['consent']

const NEVER_DO: readonly string[] = [
  'Sell, rent or share your data',
  'Send money to other people or add new payees',
  'Give investment advice or offer you credit',
  'Show shopping links or nudge you to spend',
]

function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className={s.labelRow}>
      {children}
      <Badge size="sm" variant={required ? 'accent' : 'neutral'}>{required ? 'Required' : 'Optional'}</Badge>
    </span>
  )
}

/** Separate, un-ticked consents: financial data (required, PIPL Art. 29), LLM processing and notifications. */
export function ConsentStep({ draft, update, errors }: StepProps) {
  const c = draft.consent
  const set = (key: ConsentKey) => (value: boolean) => update((d) => ({ ...d, consent: { ...d.consent, [key]: value } }))
  return (
    <>
      <p className={s.lede}>Nothing here is pre-ticked. Switch on what you’re comfortable with — you can change any of it later in Settings.</p>
      <div className={s.stack}>
        <section id="ob-financialData" className={cx(s.card, c.financialData && s.cardOn, errors.financialData && s.cardError)} aria-label="Financial data consent">
          <Toggle
            checked={c.financialData}
            onChange={set('financialData')}
            label={<Label required>Use my financial data</Label>}
            description="A separate consent for sensitive data, as PIPL Art. 29 requires."
          />
          <dl className={s.facts}>
            <div className={s.fact}>
              <dt><span className={s.factIcon}><Receipt /></span>What</dt>
              <dd>Transactions, balances and bills — plus the dreams you add.</dd>
            </div>
            <div className={s.fact}>
              <dt><span className={s.factIcon}><Target /></span>Why</dt>
              <dd>To mirror your month, keep your budget and fire your tripwires.</dd>
            </div>
            <div className={s.fact}>
              <dt><span className={s.factIcon}><Smartphone /></span>Where</dt>
              <dd>On this device. Never sold or shared, and you can delete it any time.</dd>
            </div>
          </dl>
          {errors.financialData ? (
            <p className={s.error} role="alert">
              <CircleAlert aria-hidden="true" />
              {errors.financialData}
            </p>
          ) : null}
        </section>

        <section className={cx(s.card, c.llmProcessing && s.cardOn)} aria-label="AI model consent">
          <Toggle
            checked={c.llmProcessing}
            onChange={set('llmProcessing')}
            label={<Label>Let AI help in chat</Label>}
            description="Leave it off and Bun’s on-device engine answers everything."
          />
          <ul className={s.bullets}>
            <li className={s.bullet}><EyeOff aria-hidden="true" />Redacted first: card numbers, names and memos are masked.</li>
            <li className={s.bullet}><Funnel aria-hidden="true" />Minimised: only the figures a question needs leave the device.</li>
            <li className={s.bullet}><Cpu aria-hidden="true" />Never required: Bun works fully offline without it.</li>
          </ul>
        </section>

        <section className={cx(s.card, c.notifications && s.cardOn)} aria-label="Notification consent">
          <Toggle
            checked={c.notifications}
            onChange={set('notifications')}
            label={<Label>Tripwire reminders</Label>}
            description="A nudge with your dream’s picture when you cross a line you set. Never marketing."
          />
        </section>

        <details className={s.disclosure}>
          <summary>
            <ChevronRight aria-hidden="true" />
            What Bun will never do
          </summary>
          <ul className={cx(s.bullets, s.never, s.disclosureBody)}>
            {NEVER_DO.map((t) => (
              <li key={t} className={s.bullet}><Ban aria-hidden="true" />{t}</li>
            ))}
          </ul>
        </details>
      </div>
    </>
  )
}
