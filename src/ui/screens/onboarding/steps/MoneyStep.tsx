import { ChevronDown, CircleAlert, PiggyBank, Scale } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { CURRENCY_SYMBOL } from '../../../../core/money'
import type { Currency, Minor } from '../../../../core/types'
import { Money, TextField } from '../../../components/ds'
import { groupAmount, incomeHint, ordinal, parseIncome, parseTarget, type IncomeHint } from '../logic'
import type { StepProps } from '../OnboardingScreen'
import m from './MoneyStep.module.css'
import s from './Steps.module.css'

export const CURRENCIES: readonly { code: Currency; name: string }[] = [
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'USD', name: 'US dollar' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'MYR', name: 'Malaysian ringgit' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'AUD', name: 'Australian dollar' },
]

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

export interface SelectFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint?: ReactNode
  children: ReactNode
}

/** A native <select> (best on phones: the OS wheel / sheet) dressed like the design-system TextField. */
export function SelectField({ id, label, value, onChange, hint, children }: SelectFieldProps) {
  return (
    <div className={s.selectField}>
      <label htmlFor={id} className={s.selectLabel}>{label}</label>
      <div className={s.selectBox}>
        <select id={id} className={s.select} value={value} onChange={(e) => onChange(e.currentTarget.value)} aria-describedby={hint ? `${id}-hint` : undefined}>
          {children}
        </select>
        <ChevronDown className={s.selectChevron} aria-hidden="true" />
      </div>
      {hint ? <p id={`${id}-hint`} className={s.hint}>{hint}</p> : null}
    </div>
  )
}

const HINT_ICON = { save: PiggyBank, tight: Scale, over: CircleAlert } as const

/** Income split into spend vs save, live as the user types. Text carries the meaning; the bar only echoes it. */
function SplitPreview({ hint, target, currency }: { hint: IncomeHint; target: Minor; currency: Currency }) {
  const Icon = HINT_ICON[hint.tone]
  const spendPct = Math.min(100, hint.spendPct)
  return (
    <div className={m.split} data-tone={hint.tone}>
      <div className={m.bar} aria-hidden="true" style={{ '--spend': `${spendPct}%` } as CSSProperties}>
        <span className={m.spend} />
        <span className={m.save} />
      </div>
      <div className={m.legend} aria-hidden="true">
        <span className={m.key}>
          <i className={m.dotSpend} />
          Spend <Money amount={target} currency={currency} size="sm" />
        </span>
        <span className={m.key}>
          <i className={m.dotSave} />
          {hint.save >= 0 ? `Save ${Math.max(0, 100 - hint.spendPct)}%` : `${hint.spendPct - 100}% over income`}
        </span>
      </div>
      <p className={m.text} aria-live="polite">
        <Icon aria-hidden="true" />
        {hint.text}
      </p>
    </div>
  )
}

export function MoneyStep({ draft, update, errors }: StepProps) {
  const symbol = CURRENCY_SYMBOL[draft.currency]
  const income = parseIncome(draft)
  const target = parseTarget(draft)
  const hint = income.ok && target.ok ? incomeHint(income.minor, target.minor, draft.currency) : null
  const set = <K extends 'name' | 'income' | 'target'>(key: K) => (value: string) => update((d) => ({ ...d, [key]: value }))
  return (
    <>
      <p className={s.lede}>Two numbers drive everything: what lands in your account each month, and what you’re happy to spend of it.</p>
      <div className={s.stack}>
        <TextField
          id="ob-name"
          label="What should Bun call you?"
          placeholder="Your first name"
          autoComplete="given-name"
          maxLength={40}
          value={draft.name}
          error={errors.name}
          onChange={(e) => set('name')(e.currentTarget.value)}
        />
        <SelectField
          id="ob-currency"
          label="Currency"
          value={draft.currency}
          onChange={(v) => update((d) => ({ ...d, currency: v as Currency }))}
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} {CURRENCY_SYMBOL[c.code]} · {c.name}
            </option>
          ))}
        </SelectField>
        <TextField
          id="ob-income"
          label="Monthly take-home pay"
          hint="After tax — what actually lands in your account."
          prefix={symbol}
          inputMode="decimal"
          autoComplete="off"
          placeholder="18,500"
          value={draft.income}
          error={errors.income}
          onChange={(e) => set('income')(e.currentTarget.value)}
          onBlur={() => update((d) => ({ ...d, income: groupAmount(d.income, d.currency) }))}
        />
        <div className={m.targetGroup}>
          <TextField
            id="ob-target"
            label="Monthly spending target"
            hint={hint ? undefined : 'Everything except savings: rent, food, fun.'}
            prefix={symbol}
            inputMode="decimal"
            autoComplete="off"
            placeholder="9,500"
            value={draft.target}
            error={errors.target}
            onChange={(e) => set('target')(e.currentTarget.value)}
            onBlur={() => update((d) => ({ ...d, target: groupAmount(d.target, d.currency) }))}
          />
          {hint && target.ok ? <SplitPreview hint={hint} target={target.minor} currency={draft.currency} /> : null}
        </div>
        <SelectField
          id="ob-payday"
          label="Payday"
          value={String(draft.payday)}
          onChange={(v) => update((d) => ({ ...d, payday: Number(v) }))}
          hint="When your pay lands. Paid at month-end? Pick the 28th."
        >
          {DAYS.map((n) => (
            <option key={n} value={n}>
              The {ordinal(n)} of each month
            </option>
          ))}
        </SelectField>
      </div>
    </>
  )
}
