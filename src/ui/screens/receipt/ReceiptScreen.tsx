/**
 * Add from a receipt or a file (小票 / struk / statement): a camera photo, or any file — photo, PDF, Excel, Word,
 * CSV or text (readFile.ts). Everything is read on this device. A statement becomes rows to import (the same
 * importer and de-duplication as Bills); one receipt or bill becomes an editable draft: "I paid this" adds it as
 * spending, "A bill to pay" (no bank connected) adds it to Bills. Nothing is saved until the user confirms, and the
 * file itself is never kept. A document that carries instructions is flagged and cannot be added.
 */
import { Camera, Check, FileText, FileUp, ImageOff, ScanLine, ShieldAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, parseAmount } from '../../../core/money'
import {
  looksDuplicate,
  parseReceipt,
  parseReceiptDate,
  RECEIPT_SAMPLES,
  type ReceiptParseOk,
  type ReceiptSample,
} from '../../../core/receipt'
import type { Currency, SpendingCandidate } from '../../../core/types'
import { Button, Callout, Card, SectionHeader, Segmented, Spinner, TextField, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { importSummary } from '../bills/billsView'
import { FILE_ACCEPT, fileKind, readAnyFile } from './readFile'
import styles from './ReceiptScreen.module.css'

const CURRENCIES: Currency[] = ['CNY', 'IDR', 'USD']
const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: `${CURRENCY_SYMBOL[value]} ${value}` }))

function majorText(minor: number, currency: Currency): string {
  const major = minor / MINOR_PER_MAJOR[currency]
  return Number.isInteger(major) ? String(major) : major.toFixed(2)
}

const selectScan = (s: AppSnapshot) => ({
  allowed: s.state.settings.receiptScans,
  today: s.derived.today,
  transactions: s.state.bank.transactions,
  // with no bank connected a document can also be a bill to pay
  noBank: !s.state.bank.personaId,
})

export function ReceiptScreen() {
  const app = useApp()
  const toast = useToast()
  const { allowed, today, transactions, noBank } = useSnapshot(selectScan, shallowEqual)

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [parseResult, setParseResult] = useState<ReceiptParseOk | null>(null)
  const [error, setError] = useState<string | null>(null)

  // editable draft
  const [amountText, setAmountText] = useState('')
  const [currency, setCurrency] = useState<Currency>('CNY')
  const [merchant, setMerchant] = useState('')
  const [date, setDate] = useState('')

  const inputRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // a file of many rows (a statement), and whether a single document is a bill to pay
  const [statement, setStatement] = useState<{ csv: string; rows: number; source: string; name: string } | null>(null)
  const [asBill, setAsBill] = useState(false)
  const photoUrlRef = useRef<string | null>(null)

  const revokePhoto = useCallback(() => {
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current)
      photoUrlRef.current = null
    }
  }, [])

  // the photo is never persisted: revoke its object URL on unmount and whenever it is replaced/cleared
  useEffect(() => () => revokePhoto(), [revokePhoto])

  function setPhoto(url: string | null) {
    revokePhoto()
    photoUrlRef.current = url
    setPhotoUrl(url)
  }

  function reset() {
    setPhoto(null)
    setSourceLabel(null)
    setScanning(false)
    setParseResult(null)
    setError(null)
    setAmountText('')
    setMerchant('')
    setDate('')
    setStatement(null)
    setAsBill(false)
  }

  function applyParse(r: ReceiptParseOk) {
    setParseResult(r)
    setAmountText(majorText(r.candidate.amount, r.candidate.currency))
    setCurrency(r.candidate.currency)
    setMerchant(r.candidate.merchant)
    setDate(r.candidate.date)
  }

  async function handleFile(file: File, camera = false) {
    reset()
    // reading photos is the user's choice (Settings → Receipts); files with text are always fine
    if (fileKind(file) === 'image' && !allowed) {
      setError('Reading photos is off. Turn it on with the button above, or choose a PDF, Excel, Word or CSV file.')
      return
    }
    setSourceLabel(camera ? 'Camera photo' : file.name)
    if (fileKind(file) === 'image') setPhoto(URL.createObjectURL(file))
    setScanning(true)
    try {
      const r = await readAnyFile(file, { today, base: import.meta.env.BASE_URL })
      if (r.kind === 'error') setError(r.error)
      else if (r.kind === 'statement') setStatement({ csv: r.csv, rows: r.rows, source: r.source, name: file.name })
      else {
        const p = parseReceipt(r.text, { today })
        if (p.ok) {
          applyParse(p)
          setAsBill(noBank && r.bill)
        } else setError(p.error)
      }
    } finally {
      setScanning(false)
    }
  }

  function importStatement() {
    if (!statement) return
    const r = app.importCsv(statement.csv)
    const out = importSummary(statement.name, r)
    toast.show({ tone: out.tone === 'danger' ? 'danger' : out.tone === 'warn' ? 'warn' : 'success', title: out.title, message: out.message })
    reset()
  }

  function handleSample(sample: ReceiptSample) {
    reset()
    setSourceLabel(sample.label)
    const r = parseReceipt(sample.text, { today })
    if (r.ok) applyParse(r)
    else setError(r.error)
  }

  // the candidate that would be added, rebuilt from the live (editable) draft
  const draftCandidate = useMemo<SpendingCandidate | null>(() => {
    if (!parseResult) return null
    const amount = parseAmount(amountText, currency) ?? parseResult.candidate.amount
    const dateText = parseReceiptDate(date) ?? parseResult.candidate.date
    return {
      ...parseResult.candidate,
      amount: Math.abs(amount),
      currency,
      merchant: merchant.trim() || parseResult.candidate.merchant,
      date: dateText,
    }
  }, [parseResult, amountText, currency, merchant, date])

  const blocked = parseResult?.blocked ?? false
  const duplicate = draftCandidate && !blocked && !asBill ? looksDuplicate(draftCandidate, transactions) : false
  const canConfirm = Boolean(draftCandidate) && !blocked && !scanning

  function confirm() {
    if (!draftCandidate || blocked) return
    if (asBill) {
      const r = app.addBill({ name: draftCandidate.merchant, amount: draftCandidate.amount, dueDate: draftCandidate.date })
      toast.show(
        r.ok
          ? { tone: 'success', title: 'Bill added', message: `${draftCandidate.merchant}, due ${draftCandidate.date}. It’s in Bills with “Mark as paid”. The file was not kept.` }
          : { tone: 'danger', title: 'Couldn’t add the bill', message: r.error ?? 'Try again.' },
      )
      if (r.ok) reset()
      return
    }
    const { added } = app.addSpending([draftCandidate])
    toast.show({
      tone: added > 0 ? 'success' : 'neutral',
      title: added > 0 ? 'Receipt added' : 'Already added',
      message: added > 0 ? 'Recorded as a spending item. The photo was discarded.' : 'This receipt was already on your ledger, so nothing was added.',
    })
    reset()
  }

  function reject() {
    setPhoto(null)
    reset()
  }

  return (
    <div className={styles.page}>
      <SectionHeader eyebrow="Receipt or file" title="Add from a receipt or file" />

      <input
        ref={fileRef}
        type="file"
        accept={FILE_ACCEPT}
        className={styles.hiddenInput}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (f) void handleFile(f)
          e.currentTarget.value = ''
        }}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.hiddenInput}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (f) void handleFile(f, true)
          e.currentTarget.value = ''
        }}
      />

      {statement ? (
        <Card className={styles.choose}>
          <p className={styles.lead}>
            <strong>{statement.rows === 1 ? '1 row' : `${statement.rows} rows`}</strong> found in {statement.source}. Rows you already have, from
            this file or another one, are skipped, and so is anything you typed in by hand.
          </p>
          <pre className={styles.preview}>{statement.csv.split(/\r?\n/).slice(0, 5).join('\n')}</pre>
          <div className={styles.actions}>
            <Button variant="ghost" iconStart={<Trash2 />} onClick={reset}>Discard</Button>
            <Button iconStart={<Check />} onClick={importStatement}>Import {statement.rows === 1 ? 'it' : 'them'}</Button>
          </div>
        </Card>
      ) : !photoUrl && !parseResult && !scanning && !error ? (
        <Card className={styles.choose}>
          <p className={styles.lead}>
            A receipt, a bill or a statement: as a photo, PDF, Excel, Word, CSV or text file. Bun reads it on this
            device and doesn’t keep the file, only the numbers you confirm.
          </p>
          <div className={styles.pickers}>
            {allowed ? (
              <Button iconStart={<Camera />} onClick={() => inputRef.current?.click()}>Take a photo</Button>
            ) : (
              <Button iconStart={<Camera />} onClick={() => app.setSettings({ receiptScans: true })}>Turn on photo reading</Button>
            )}
            <Button variant="secondary" iconStart={<FileUp />} onClick={() => fileRef.current?.click()}>Choose a file</Button>
          </div>
          {!allowed ? (
            <p className={styles.lead}>
              <ShieldAlert aria-hidden="true" className={styles.inlineIcon} /> Photo reading is off until you turn it on. Photos are read on this device and
              never kept; you can turn it off again in Settings.
            </p>
          ) : null}
          <div className={styles.samples}>
            <p className={styles.samplesTitle}>Or try a sample receipt</p>
            <div className={styles.sampleChips}>
              {RECEIPT_SAMPLES.map((s) => (
                <button key={s.id} type="button" className={styles.sampleChip} onClick={() => handleSample(s)}>
                  <ScanLine aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div className={styles.split}>
            <div className={styles.photo}>
              {photoUrl ? (
                <img src={photoUrl} alt="Receipt photo" className={styles.img} />
              ) : (
                <div className={styles.noPhoto}>
                  {sourceLabel && !RECEIPT_SAMPLES.some((s) => s.label === sourceLabel) ? <FileText aria-hidden="true" /> : <ImageOff aria-hidden="true" />}
                  <span>{sourceLabel && !RECEIPT_SAMPLES.some((s) => s.label === sourceLabel) ? 'Read from the file' : 'Sample text — no photo'}</span>
                </div>
              )}
              {sourceLabel ? <p className={styles.source}>{sourceLabel}</p> : null}
              {scanning ? (
                <div className={styles.scanning}>
                  <Spinner size={20} label="Reading it" />
                  <span>Reading it on this device… a photo can take half a minute the first time.</span>
                </div>
              ) : null}
            </div>

            <div className={styles.draft}>
              {error ? (
                <Callout tone="warn" title="Couldn’t read this receipt">{error}</Callout>
              ) : parseResult ? (
                <>
                  {blocked ? (
                    <Callout tone="block" title="This receipt is trying to give instructions" icon={<ShieldAlert />}>
                      It contains text that tells Bun to do things a receipt has no business doing. Bun won’t add
                      it. The text is data, not instructions.
                    </Callout>
                  ) : null}
                  {duplicate ? (
                    <Callout tone="info" title="Looks like a duplicate">
                      You already have this merchant and amount within a few days of this date.
                    </Callout>
                  ) : null}

                  <form className={styles.form} onSubmit={(e) => { e.preventDefault(); confirm() }}>
                    {noBank ? (
                      <Segmented<'paid' | 'bill'>
                        label="What is it?"
                        options={[
                          { value: 'paid', label: 'I paid this' },
                          { value: 'bill', label: 'A bill to pay' },
                        ]}
                        value={asBill ? 'bill' : 'paid'}
                        onChange={(v) => setAsBill(v === 'bill')}
                      />
                    ) : null}
                    <Segmented<Currency>
                      label="Currency"
                      options={CURRENCY_OPTIONS}
                      value={currency}
                      onChange={setCurrency}
                    />
                    <TextField
                      label={asBill ? 'Amount due' : 'Total'}
                      prefix={CURRENCY_SYMBOL[currency]}
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountText}
                      onChange={(e) => setAmountText(e.currentTarget.value)}
                    />
                    <TextField
                      label={asBill ? 'Pay to' : 'Shop'}
                      autoComplete="off"
                      value={merchant}
                      onChange={(e) => setMerchant(e.currentTarget.value)}
                    />
                    <TextField
                      label={asBill ? 'Due date' : 'Date'}
                      autoComplete="off"
                      value={date}
                      onChange={(e) => setDate(e.currentTarget.value)}
                    />
                  </form>
                </>
              ) : null}
            </div>
          </div>

          {parseResult || error ? (
            <div className={styles.actions}>
              <Button variant="ghost" iconStart={<Trash2 />} onClick={reject}>Discard</Button>
              <Button iconStart={<Check />} disabled={!canConfirm} onClick={confirm}>
                {asBill ? 'Add to Bills' : `Confirm${duplicate ? ' anyway' : ''}`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
