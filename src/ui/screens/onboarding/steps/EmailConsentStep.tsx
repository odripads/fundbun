import { ChevronRight, EyeOff, KeyRound, Mail, Smartphone, Target } from 'lucide-react'
import { Badge, cx, Toggle } from '../../../components/ds'
import type { StepProps } from '../OnboardingScreen'
import s from './Steps.module.css'

type Props = Pick<StepProps, 'draft' | 'update'>

/**
 * The AUTO consent screen, in the existing WHAT / WHY / WHERE style. Off by default: nothing is read until the
 * user switches it on, and even then only allow-listed bank/payment senders are ever parsed.
 */
export function EmailConsentStep({ draft, update }: Props) {
  const set = (on: boolean) => update((d) => ({ ...d, emailConsent: on }))
  return (
    <section className={cx(s.card, draft.emailConsent && s.cardOn)} aria-label="Email auto-read consent">
      <Toggle
        checked={draft.emailConsent}
        onChange={set}
        label={
          <span className={s.labelRow}>
            Read my bank & payment emails
            <Badge size="sm" variant="neutral">Optional</Badge>
          </span>
        }
        description="Bun reads transaction emails and e-statements from banks and payment apps only. Off by default."
      />
      <dl className={s.facts}>
        <div className={s.fact}>
          <dt><span className={s.factIcon}><Mail /></span>What</dt>
          <dd>Transaction emails and e-statements (电子账单) from your bank and payment apps only — no other emails are opened.</dd>
        </div>
        <div className={s.fact}>
          <dt><span className={s.factIcon}><Target /></span>Why</dt>
          <dd>Only to add your spending. Nothing else.</dd>
        </div>
        <div className={s.fact}>
          <dt><span className={s.factIcon}><Smartphone /></span>Where</dt>
          <dd>Read on this device; never sold, never shared, never used to train any AI. Turn it off and delete everything any time.</dd>
        </div>
      </dl>
      <details className={s.disclosure}>
        <summary>
          <ChevronRight aria-hidden="true" />
          How to get your QQ / 163 授权码
        </summary>
        <ul className={cx(s.bullets, s.disclosureBody)}>
          <li className={s.bullet}><KeyRound aria-hidden="true" />QQ Mail: Settings → Account → POP3/IMAP/SMTP → generate an 授权码 (authorization code).</li>
          <li className={s.bullet}><KeyRound aria-hidden="true" />163 Mail: Settings → POP3/SMTP/IMAP → enable IMAP, then set an 授权码.</li>
          <li className={s.bullet}><EyeOff aria-hidden="true" />Bun uses the 授权码, never your password. It is held in memory only and never saved.</li>
        </ul>
      </details>
    </section>
  )
}
