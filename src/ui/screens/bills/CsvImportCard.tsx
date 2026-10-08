import { CircleCheck, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { Button, useToast } from '../../components/ds'
import { readCsvFile } from '../../lib/csvFile'
import { errorText, useApp } from '../../state'
import { importSummary, MAX_CSV_BYTES, type ImportOutcome } from './billsView'
import { SECTION_IDS } from './jump'
import styles from './csv.module.css'

/** Bring in a bank / WeChat Pay / Alipay CSV so Bun can spot more bills and subscriptions. Parsed on-device. */
export function CsvImportCard() {
  const app = useApp()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<ImportOutcome | null>(null)
  const titleId = `${SECTION_IDS.import}-title`

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    if (file.size > MAX_CSV_BYTES) {
      toast.show({ tone: 'danger', title: 'That file is too big', message: 'Try a statement under 5 MB — one or two years of transactions.' })
      return
    }
    setBusy(true)
    try {
      // bytes, not file.text(): Alipay and many bank exports are GBK, which a UTF-8 read turns into mojibake
      const text = await readCsvFile(file)
      const outcome = importSummary(file.name, app.importCsv(text))
      setLast(outcome)
      toast.show({ tone: outcome.tone, title: outcome.title, message: outcome.message })
    } catch (err) {
      toast.show({ tone: 'danger', title: 'Couldn’t read that file', message: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id={SECTION_IDS.import} aria-labelledby={titleId} className={styles.card}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <FileSpreadsheet />
        </span>
        <div className={styles.text}>
          <h2 id={titleId} className={styles.title}>
            Import a statement
          </h2>
          <p className={styles.body}>A CSV from your bank, WeChat Pay or Alipay. Bun looks for new bills and subscriptions — the file never leaves this device.</p>
        </div>
      </div>
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} />
      <Button variant="secondary" iconStart={<Upload />} loading={busy} onClick={() => input.current?.click()} fullWidth>
        Choose a CSV file
      </Button>
      {last ? (
        <div className={styles.result} role="status" data-tone={last.tone}>
          {last.tone === 'success' ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <div>
            <p className={styles.resultTitle}>
              {last.fileName}: {last.title.toLowerCase()}
            </p>
            {last.message ? <p className={styles.resultBody}>{last.message}</p> : null}
            {last.errors.length > 0 ? (
              <ul className={styles.errors}>
                {last.errors.map((er) => (
                  <li key={er}>{er}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
