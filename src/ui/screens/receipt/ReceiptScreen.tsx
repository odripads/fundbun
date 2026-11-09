/**
 * Scan a receipt (小票 / struk): take a photo with the phone camera, OCR it on-device, and show an editable
 * draft (total / currency / shop / date) next to the photo. Nothing is saved until the user taps Confirm, and
 * the photo is revoked (never persisted) on confirm, reject or unmount. A receipt that carries instructions is
 * flagged and cannot be added.
 */
import { Camera, Check, ImageOff, ScanLine, ShieldAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CURRENCY_SYMBOL, MINOR_PER_MAJOR, parseAmount } from '../../../core/money'
import {
  looksDuplicate,
  parseReceipt,
  parseReceiptDate,
  recognizeReceipt,
  RECEIPT_SAMPLES,
  type ReceiptParseOk,
  type ReceiptSample,
} from '../../../core/receipt'
import type { Currency, SpendingCandidate } from '../../../core/types'
import { Button, Callout, Card, SectionHeader, Segmented, Spinner, TextField, useToast } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
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
})

export function ReceiptScreen() {
  const app = useApp()
  const toast = useToast()
  const { allowed, today, transactions } = useSnapshot(selectScan, shallowEqual)

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
  }

  function applyParse(r: ReceiptParseOk) {
    setParseResult(r)
    setAmountText(majorText(r.candidate.amount, r.candidate.currency))
    setCurrency(r.candidate.currency)
    setMerchant(r.candidate.merchant)
    setDate(r.candidate.date)
  }

  async function handleFile(file: File) {
    reset()
    setSourceLabel('Camera photo')
    setPhoto(URL.createObjectURL(file))
    setScanning(true)
    try {
      const { text } = await recognizeReceipt(file)
      const r = parseReceipt(text, { today })
      if (r.ok) applyParse(r)
      else setError(r.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be read.')
    } finally {
      setScanning(false)
    }
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
  const duplicate = draftCandidate && !blocked ? looksDuplicate(draftCandidate, transactions) : false
  const canConfirm = Boolean(draftCandidate) && !blocked && !scanning

  function confirm() {
    if (!draftCandidate || blocked) return
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

  if (!allowed) {
    return (
      <div className={styles.page}>
        <SectionHeader eyebrow="Camera scan" title="Scan a receipt" />
        <Callout tone="warn" title="Receipt scans are off" icon={<ShieldAlert />}>
          Turn on “Receipt scans” in Settings to photograph a receipt and turn it into a spending item. The
          photo is processed on this device and never kept.
        </Callout>
        <Button iconStart={<Camera />} onClick={() => navigate('settings', { query: { s: 'receipt' } })}>Open receipt settings</Button>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <SectionHeader eyebrow="Camera scan" title="Scan a receipt" />

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.hiddenInput}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (f) void handleFile(f)
          e.currentTarget.value = ''
        }}
      />

      {!photoUrl && !parseResult ? (
        <Card className={styles.choose}>
          <p className={styles.lead}>
            Photograph a 小票 / struk and Bun turns it into a spending item — on this device, never uploaded. You
            confirm before anything is added.
          </p>
          <Button iconStart={<Camera />} onClick={() => inputRef.current?.click()}>Take a photo</Button>
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
                  <ImageOff aria-hidden="true" />
                  <span>Sample text — no photo</span>
                </div>
              )}
              {sourceLabel ? <p className={styles.source}>{sourceLabel}</p> : null}
              {scanning ? (
                <div className={styles.scanning}>
                  <Spinner size={20} label="Reading the receipt" />
                  <span>Reading the receipt…</span>
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
                    <Segmented<Currency>
                      label="Currency"
                      options={CURRENCY_OPTIONS}
                      value={currency}
                      onChange={setCurrency}
                    />
                    <TextField
                      label="Total"
                      prefix={CURRENCY_SYMBOL[currency]}
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountText}
                      onChange={(e) => setAmountText(e.currentTarget.value)}
                    />
                    <TextField
                      label="Shop"
                      autoComplete="off"
                      value={merchant}
                      onChange={(e) => setMerchant(e.currentTarget.value)}
                    />
                    <TextField
                      label="Date"
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
                Confirm{duplicate ? ' anyway' : ''}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
