/**
 * Data sources: the AUTO email toggle and a "check inbox" action that fetches the synthetic sandbox mailbox,
 * parses it on-device and shows the new spendings for Confirm/Edit. Nothing is added until Confirm.
 */
import { Inbox, MailCheck, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { processInbox } from '../../../core/email'
import { sandboxEmailSource } from '../../../core/email/sandbox'
import type { EmailMessage } from '../../../core/email/types'
import { fmt } from '../../../core/money'
import type { Currency, SpendingCandidate } from '../../../core/types'
import { Badge, Button, Card, SectionHeader, Toggle, cx, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import styles from './Settings.module.css'

function selectDataSources(s: AppSnapshot) {
  return { emailAuto: s.state.settings.emailAuto, currency: (s.state.profile?.currency ?? 'CNY') as Currency }
}

interface Review {
  candidates: SpendingCandidate[]
  flagged: number
  ignored: number
  selected: Set<string>
}

/** Fetch the sandbox mailbox: via the API route when a gateway is running, else the bundled on-device mailbox. */
async function loadSandboxMessages(): Promise<EmailMessage[]> {
  try {
    const res = await fetch('/api/email/fetch?source=sandbox')
    if (res.ok) {
      const json = (await res.json()) as { messages?: EmailMessage[] }
      if (Array.isArray(json.messages) && json.messages.length) return json.messages
    }
  } catch {
    // static build / gateway offline — fall through to the on-device mailbox
  }
  return sandboxEmailSource.fetch()
}

export function DataSourcesSection() {
  const app = useApp()
  const toast = useToast()
  const d = useSnapshot(selectDataSources, shallowEqual)
  const [loading, setLoading] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    setLoading(true)
    setError(null)
    try {
      const result = processInbox(await loadSandboxMessages(), d.currency)
      setReview({ candidates: result.candidates, flagged: result.flagged.length, ignored: result.ignored, selected: new Set(result.candidates.map((c) => c.id)) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the inbox.')
    } finally {
      setLoading(false)
    }
  }

  function confirm() {
    if (!review) return
    const toAdd = review.candidates.filter((c) => review.selected.has(c.id))
    const { added, duplicates } = app.addSpending(toAdd)
    toast.show({
      tone: 'success',
      title: `Added ${added} spending${added === 1 ? '' : 's'}`,
      message: duplicates ? `${duplicates} were already there and skipped.` : 'Read on this device. Nothing was uploaded.',
    })
    setReview(null)
  }

  return (
    <section id="set-sources" aria-labelledby="set-sources-h" className={styles.section}>
      <SectionHeader id="set-sources-h" eyebrow="AUTO" title="Data sources" />
      <Card padding="none">
        <div className={styles.toggleRow}>
          <Toggle
            label="Read my bank & payment emails"
            description="Bun reads transaction emails and e-statements from banks and payment apps only. Read-only; nothing is added until you confirm."
            checked={d.emailAuto}
            onChange={(emailAuto) => app.setSettings({ emailAuto })}
            tone="accent"
          />
        </div>
      </Card>

      <Card className={styles.card}>
        <p className={styles.sandboxLead}>Try it now against a synthetic mailbox — the same flow a real bank would use, with none of the risk.</p>
        <div>
          <Button variant="secondary" iconStart={loading ? undefined : <Inbox />} loading={loading} onClick={check}>
            {loading ? 'Checking…' : 'Check inbox'}
          </Button>
        </div>

        {error ? (
          <p className={cx(styles.reviewNote, styles.reviewError)} role="alert">
            <ShieldAlert aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {review ? (
          <div className={styles.review} role="status">
            <p className={styles.reviewHead}>
              <MailCheck aria-hidden="true" />
              Bun found {review.candidates.length} new spending{review.candidates.length === 1 ? '' : 's'} — check them.
            </p>
            {review.flagged ? (
              <p className={styles.reviewNote}>
                <ShieldAlert aria-hidden="true" />
                {review.flagged} email{review.flagged === 1 ? '' : 's'} looked suspicious and was skipped.
              </p>
            ) : null}
            {review.candidates.length === 0 ? (
              <p className={styles.reviewNote}>Nothing new to add — the mailbox is already covered.</p>
            ) : (
              <ul className={styles.reviewList} role="list">
                {review.candidates.map((c) => (
                  <li key={c.id} className={styles.reviewRow}>
                    <label className={styles.reviewLabel}>
                      <input
                        type="checkbox"
                        checked={review.selected.has(c.id)}
                        onChange={() =>
                          setReview((r) => {
                            if (!r) return r
                            const next = new Set(r.selected)
                            if (next.has(c.id)) next.delete(c.id)
                            else next.add(c.id)
                            return { ...r, selected: next }
                          })
                        }
                      />
                      <span className={styles.reviewText}>
                        <span className={styles.reviewMerchant}>{c.merchant}</span>
                        <span className={styles.reviewMeta}>
                          {c.date}
                          {c.time ? ` · ${c.time}` : ''}
                        </span>
                      </span>
                      <span className={styles.reviewAmount}>{fmt(c.amount, c.currency)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.reviewActions}>
              <Badge variant="accent" icon={<ShieldCheck />}>Adds spending records only — no money moves</Badge>
              <Button iconStart={<MailCheck />} disabled={review.candidates.length === 0} onClick={confirm}>
                Confirm
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </section>
  )
}
