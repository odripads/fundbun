import { CircleAlert, FileSpreadsheet, FileText, Landmark, ShieldCheck, Sprout, Upload, type LucideIcon } from 'lucide-react'
import { useState, type ChangeEvent, type ReactNode } from 'react'
import { CURRENCY_SYMBOL } from '../../../../core/money'
import { Badge, cx, Spinner, TextField } from '../../../components/ds'
import type { DataKind, OnboardingDraft, PersonaId } from '../draft'
import { CSV_FORMAT_LABEL, decodeCsvBytes, groupAmount, SANDBOX_LEDGERS, type CsvSummary } from '../logic'
import type { StepProps } from '../OnboardingScreen'
import dd from './DataStep.module.css'
import s from './Steps.module.css'

export interface DataStepProps extends StepProps {
  csv: CsvSummary | null
}

const MAX_CSV_BYTES = 5 * 1024 * 1024

const OPTIONS: readonly { kind: DataKind; icon: LucideIcon; title: string; body: string; badge?: string }[] = [
  { kind: 'persona', icon: Landmark, title: 'Connect a sandbox bank', body: 'A simulated account with six months of history — the quickest way to see Bun work.', badge: 'Simulated' },
  { kind: 'csv', icon: FileSpreadsheet, title: 'Import a CSV', body: 'A WeChat Pay, Alipay or bank export.' },
  { kind: 'empty', icon: Sprout, title: 'Start empty', body: 'Begin with a balance and let spending arrive as it happens.' },
]

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className={s.error} role="alert">
      <CircleAlert aria-hidden="true" />
      {children}
    </p>
  )
}

/** Where the transactions come from: a sandbox ledger (Mei's or Arif's), an on-device CSV import, or nothing yet. */
export function DataStep({ draft, update, errors, csv }: DataStepProps) {
  const [reading, setReading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const kind = draft.data.kind
  const setData = (patch: Partial<OnboardingDraft['data']>) => update((d) => ({ ...d, data: { ...d.data, ...patch } }))

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    setFileError(null)
    if (file.size > MAX_CSV_BYTES) {
      setFileError('That file is over 5 MB — try exporting a shorter period.')
      return
    }
    setReading(true)
    try {
      const text = decodeCsvBytes(await file.arrayBuffer())
      setData({ csvName: file.name.slice(0, 120), csvText: text })
    } catch {
      setFileError('Couldn’t read that file. Try exporting it again as CSV.')
    } finally {
      setReading(false)
    }
  }

  const balanceField = (
    <TextField
      id="ob-balance"
      label="Current balance"
      hint="What’s in the account today, so Bun can plan around your bills."
      prefix={CURRENCY_SYMBOL[draft.currency]}
      inputMode="decimal"
      autoComplete="off"
      placeholder="6,500"
      value={draft.data.balance}
      error={errors.balance}
      onChange={(e) => setData({ balance: e.currentTarget.value })}
      onBlur={() => update((d) => ({ ...d, data: { ...d.data, balance: groupAmount(d.data.balance, d.currency) } }))}
    />
  )

  return (
    <>
      <p className={s.lede}>Bun needs transactions to mirror. Everything is read and kept on this device.</p>
      <fieldset id="ob-source" className={dd.options}>
        <legend className="sr-only">Data source</legend>
        {errors.source ? <FieldError>{errors.source}</FieldError> : null}
        {OPTIONS.map((o) => {
          const checked = kind === o.kind
          const Icon = o.icon
          return (
            <div key={o.kind} className={dd.option} data-checked={checked || undefined}>
              <label className={dd.head}>
                <input
                  type="radio"
                  name="ob-data-source"
                  value={o.kind}
                  checked={checked}
                  className="sr-only"
                  onChange={() => setData({ kind: o.kind, ...(o.kind === 'persona' && !draft.data.personaId ? { personaId: 'mei' as PersonaId } : {}) })}
                />
                <span className={dd.icon} aria-hidden="true"><Icon /></span>
                <span className={dd.text}>
                  <span className={dd.title}>
                    {o.title}
                    {o.badge ? <Badge size="sm" variant="info">{o.badge}</Badge> : null}
                  </span>
                  <span className={dd.body}>{o.body}</span>
                </span>
                <span className={dd.radio} aria-hidden="true" />
              </label>

              {checked && o.kind === 'persona' ? (
                <div className={dd.panel}>
                  <fieldset id="ob-persona" className={dd.ledgers}>
                    <legend className={dd.panelLabel}>Whose ledger?</legend>
                    {SANDBOX_LEDGERS.map((l) => (
                      <label key={l.id} className={dd.ledger} data-checked={draft.data.personaId === l.id || undefined}>
                        <input type="radio" name="ob-ledger" value={l.id} checked={draft.data.personaId === l.id} onChange={() => setData({ personaId: l.id })} className="sr-only" />
                        <span className={dd.ledgerOwner}>{l.owner}</span>
                        <span className={dd.ledgerAccount}>{l.account}</span>
                        <span className={dd.ledgerBlurb}>{l.blurb}</span>
                      </label>
                    ))}
                  </fieldset>
                  {errors.persona ? <FieldError>{errors.persona}</FieldError> : null}
                  <p className={s.note}>
                    <ShieldCheck aria-hidden="true" />
                    Simulated transactions only. Your income, target and dreams stay yours.
                  </p>
                </div>
              ) : null}

              {checked && o.kind === 'csv' ? (
                <div className={dd.panel}>
                  <div id="ob-csv" className={dd.fileRow}>
                    <label className={cx(dd.fileButton, reading && dd.busy)}>
                      <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={onFile} disabled={reading} />
                      {reading ? <Spinner size={16} /> : <Upload aria-hidden="true" />}
                      {reading ? 'Reading…' : draft.data.csvText ? 'Choose another file' : 'Choose a CSV file'}
                    </label>
                  </div>
                  {draft.data.csvText && csv ? (
                    <div className={dd.summary} data-ok={csv.count > 0 || undefined} role="status">
                      <FileText aria-hidden="true" />
                      <span className={dd.summaryText}>
                        <span className={dd.fileName}>{draft.data.csvName || 'Your file'}</span>
                        {csv.count > 0 ? (
                          <span className={dd.fileMeta}>
                            {csv.count} transactions{csv.from && csv.to ? ` · ${csv.from} – ${csv.to}` : ''} · {CSV_FORMAT_LABEL[csv.format]}
                            {csv.skipped ? ` · ${csv.skipped} rows skipped` : ''}
                          </span>
                        ) : (
                          <span className={dd.fileMeta}>{csv.errors[0] ?? 'No transactions found in this file.'}</span>
                        )}
                      </span>
                    </div>
                  ) : null}
                  {fileError ? <FieldError>{fileError}</FieldError> : errors.csv ? <FieldError>{errors.csv}</FieldError> : null}
                  {balanceField}
                  <p className={s.note}>
                    <ShieldCheck aria-hidden="true" />
                    Read on this device — nothing is uploaded. Memos are treated as data, never as instructions.
                  </p>
                </div>
              ) : null}

              {checked && o.kind === 'empty' ? <div className={dd.panel}>{balanceField}</div> : null}
            </div>
          )
        })}
      </fieldset>
    </>
  )
}
