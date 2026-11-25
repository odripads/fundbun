/**
 * Data sources: the AUTO email toggle; on this computer (desktop app or local server) the user's own mailbox,
 * connected read only; and the synthetic sandbox mailbox. Every check is parsed on-device and shown for
 * Confirm/Edit. Nothing is added until Confirm, and nothing is fetched until the user presses a check button.
 */
import { Inbox, Mail, MailCheck, ShieldAlert, ShieldCheck, Unplug } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import {
  CHECK_DAYS,
  EMAIL_PRESETS,
  EmailClient,
  IMAP_TLS_PORT,
  isTrustableDomain,
  parseDomainList,
  presetById,
  processInbox,
  type EmailAccountState,
  type EmailAccountView,
  type EmailPresetId,
  type EmailState,
  type EmailTestResult,
  type InboxResult,
} from '../../../core/email'
import { sandboxEmailSource } from '../../../core/email/sandbox'
import type { EmailMessage } from '../../../core/email/types'
import { fmt } from '../../../core/money'
import type { Currency, SpendingCandidate } from '../../../core/types'
import { Badge, Button, Callout, Card, Dialog, SectionHeader, TextField, Toggle, cx, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import mine from './DataSourcesSection.module.css'
import styles from './Settings.module.css'

function selectDataSources(s: AppSnapshot) {
  return { emailAuto: s.state.settings.emailAuto, currency: (s.state.profile?.currency ?? 'CNY') as Currency }
}

type From = 'sandbox' | 'mailbox'

interface Review {
  from: From
  candidates: SpendingCandidate[]
  flagged: number
  ignored: number
  skipped: number
  otherCurrency: number
  /** of `ignored`, the ones the mail server marked as forged */
  forged: number
  /** candidate id to the platform it came through ('paypal.com'): never ticked in bulk */
  relayed: Record<string, string>
  selected: Set<string>
}

/** Plain names for the platforms in RELAY_SENDER_DOMAINS. */
const PLATFORM_NAMES: Record<string, string> = {
  'google.com': 'Google', 'apple.com': 'Apple', 'paypal.com': 'PayPal', 'stripe.com': 'Stripe', 'amazon.com': 'Amazon', 'booking.com': 'Booking.com',
}

/** The ids "Tick all" may tick: everything except what came through a platform a stranger can write in. */
const bulkIds = (r: Review): string[] => r.candidates.filter((c) => !r.relayed[c.id]).map((c) => c.id)

/**
 * The sandbox is synthetic, so its spendings start ticked. Those from a real mailbox start unticked: a stranger can
 * get text into a real bank or platform email (a shared document, an invoice), so the user picks each one.
 */
function reviewOf(from: From, r: InboxResult): Review {
  return {
    from,
    candidates: r.candidates,
    flagged: r.flagged.length,
    ignored: r.ignored,
    skipped: r.skipped ?? 0,
    otherCurrency: r.otherCurrency ?? 0,
    forged: r.forged ?? 0,
    relayed: r.relayed ?? {},
    selected: new Set(from === 'mailbox' ? [] : r.candidates.filter((c) => !r.relayed?.[c.id]).map((c) => c.id)),
  }
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** Fetch the sandbox mailbox: via the API route when a gateway is running, else the bundled on-device mailbox. */
async function loadSandboxMessages(): Promise<EmailMessage[]> {
  try {
    const res = await fetch('/api/email/fetch?source=sandbox')
    if (res.ok) {
      const json = (await res.json()) as { messages?: EmailMessage[] }
      if (Array.isArray(json.messages) && json.messages.length) return json.messages
    }
  } catch {
    // static build or gateway offline: fall through to the on-device mailbox
  }
  return sandboxEmailSource.fetch()
}

const defaultClient = new EmailClient()

/** `client` is for tests; the app uses the one that talks to /api on this page's own origin. */
export function DataSourcesSection({ client = defaultClient }: { client?: EmailClient }) {
  const app = useApp()
  const toast = useToast()
  const d = useSnapshot(selectDataSources, shallowEqual)
  const [email, setEmail] = useState<EmailState | null>(null)
  const [loading, setLoading] = useState<From | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<{ from: From; text: string } | null>(null)

  // is FundBun running on this computer? Asks once; it never reads the mailbox
  useEffect(() => {
    let alive = true
    void client.state().then((s) => {
      if (alive) setEmail(s)
    })
    return () => {
      alive = false
    }
  }, [client])

  async function checkSandbox() {
    setLoading('sandbox')
    setError(null)
    setReview(null)
    try {
      setReview(reviewOf('sandbox', processInbox(await loadSandboxMessages(), d.currency)))
    } catch (e) {
      setError({ from: 'sandbox', text: e instanceof Error ? e.message : 'Could not read the inbox.' })
    } finally {
      setLoading(null)
    }
  }

  async function checkMailbox(account: EmailAccountView) {
    if (!d.emailAuto) return
    setLoading('mailbox')
    setError(null)
    setReview(null)
    try {
      const r = await client.check(CHECK_DAYS.default)
      // the bodies are untrusted: allow-list, injection scan, then the on-device parser, as for the sandbox
      if (r.ok) setReview(reviewOf('mailbox', processInbox(r.messages, d.currency, { extraDomains: account.trustedDomains })))
      else setError({ from: 'mailbox', text: r.message })
    } finally {
      setLoading(null)
    }
    await refreshMailbox()
  }

  /** The server notes how the last sign-in went (okAt, lastError): show what it says now. */
  async function refreshMailbox() {
    const next = await client.state()
    if (next.local) mailboxChanged(next)
  }

  function mailboxChanged(next: EmailState) {
    setEmail(next)
    if (!next.local || !next.account) setReview((r) => (r?.from === 'mailbox' ? null : r))
  }

  function toggle(id: string) {
    setReview((r) => {
      if (!r) return r
      const next = new Set(r.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...r, selected: next }
    })
  }

  function toggleAll() {
    setReview((r) => {
      if (!r) return r
      const bulk = bulkIds(r)
      // "Untick all" clears everything; "Tick all" never ticks what came through a platform (see RELAY_SENDER_DOMAINS)
      if (bulk.length > 0 && bulk.every((id) => r.selected.has(id))) return { ...r, selected: new Set<string>() }
      return { ...r, selected: new Set([...r.selected, ...bulk]) }
    })
  }

  function confirm() {
    if (!review) return
    const toAdd = review.candidates.filter((c) => review.selected.has(c.id))
    const { added, duplicates } = app.addSpending(toAdd)
    toast.show({
      tone: 'success',
      title: `Added ${added} spending${added === 1 ? '' : 's'}`,
      message: duplicates
        ? `${duplicates} were already there and skipped.`
        : review.from === 'mailbox'
          ? 'Read on this computer. Nothing in your mailbox was changed.'
          : 'Read on this device. Nothing was uploaded.',
    })
    setReview(null)
  }

  const results = (from: From) => (
    <>
      {error?.from === from ? (
        <p className={cx(styles.reviewNote, styles.reviewError)} role="alert">
          <ShieldAlert aria-hidden="true" />
          {error.text}
        </p>
      ) : null}
      {review?.from === from ? <ReviewPanel review={review} onToggle={toggle} onToggleAll={toggleAll} onConfirm={confirm} /> : null}
    </>
  )

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

      {email?.local ? (
        <Card className={styles.card}>
          <h3 className={mine.cardTitle}>{email.account ? 'Your email' : 'Connect your email'}</h3>
          {email.account ? (
            <ConnectedMailbox
              state={email}
              account={email.account}
              client={client}
              consent={d.emailAuto}
              checking={loading === 'mailbox'}
              checkFailed={error?.from === 'mailbox'}
              onState={mailboxChanged}
              onRefresh={refreshMailbox}
              onCheck={(account) => void checkMailbox(account)}
            >
              {results('mailbox')}
            </ConnectedMailbox>
          ) : (
            <ConnectForm state={email} client={client} onState={mailboxChanged} />
          )}
        </Card>
      ) : null}

      <Card className={styles.card}>
        <h3 className={mine.cardTitle}>Synthetic sandbox mailbox</h3>
        <p className={styles.sandboxLead}>Try it now against a synthetic mailbox: the same flow a real bank would use, with none of the risk.</p>
        {email && !email.local ? (
          <p className={mine.lead}>Real email connections run in the FundBun desktop app, so your email password stays on your computer.</p>
        ) : null}
        <div>
          <Button variant="secondary" iconStart={loading === 'sandbox' ? undefined : <Inbox />} loading={loading === 'sandbox'} onClick={() => void checkSandbox()}>
            {loading === 'sandbox' ? 'Checking…' : 'Check inbox'}
          </Button>
        </div>
        {results('sandbox')}
      </Card>
    </section>
  )
}

// ───────────────────────────── the review checklist ─────────────────────────────

function Note({ children }: { children: ReactNode }) {
  return (
    <p className={styles.reviewNote}>
      <ShieldAlert aria-hidden="true" />
      {children}
    </p>
  )
}

function ReviewPanel({ review, onToggle, onToggleAll, onConfirm }: {
  review: Review
  onToggle: (id: string) => void
  onToggleAll: () => void
  onConfirm: () => void
}) {
  const n = review.candidates.length
  const bulk = bulkIds(review)
  const all = bulk.length > 0 && bulk.every((id) => review.selected.has(id))
  const notListed = review.ignored - review.forged
  const relayedCount = n - bulk.length
  return (
    <div className={styles.review} role="status">
      <p className={styles.reviewHead}>
        <MailCheck aria-hidden="true" />
        Bun found {n} new spending{n === 1 ? '' : 's'}. Check them.
      </p>
      {review.flagged ? (
        <Note>
          {review.flagged} {plural(review.flagged, 'email looked suspicious and was', 'emails looked suspicious and were')} skipped.
        </Note>
      ) : null}
      {review.forged ? (
        <Note>
          {review.forged} {plural(review.forged, 'email', 'emails')} failed your mail provider's sender check (the sender was forged), so Bun did not read {plural(review.forged, 'it', 'them')}.
        </Note>
      ) : null}
      {notListed > 0 ? (
        <Note>
          {notListed} {plural(notListed, 'email was', 'emails were')} not from a bank or wallet on the list, so Bun did not read {plural(notListed, 'it', 'them')}.
        </Note>
      ) : null}
      {review.skipped ? (
        <Note>
          {review.skipped} {plural(review.skipped, 'email', 'emails')} from your banks and wallets had no spending in {plural(review.skipped, 'it', 'them')} (refunds, top-ups, credits or a layout Bun does not know).
        </Note>
      ) : null}
      {review.otherCurrency ? (
        <Note>
          {review.otherCurrency} of those {plural(review.otherCurrency, 'was', 'were')} in another currency. FundBun does not convert currencies, so {plural(review.otherCurrency, 'it was', 'they were')} left out.
        </Note>
      ) : null}
      {n > 0 && review.from === 'mailbox' ? (
        <p className={styles.reviewNote}>These came from your real mailbox. Tick the ones that are yours, then Confirm.</p>
      ) : null}
      {relayedCount > 0 ? (
        <p className={styles.reviewNote}>
          {relayedCount === 1 ? 'One came' : `${relayedCount} came`} through a platform where anyone can send you an invoice, a request or a message. Tick {relayedCount === 1 ? 'it' : 'each one'} yourself only if you know {relayedCount === 1 ? 'it' : 'them'}.
        </p>
      ) : null}
      {n === 0 ? (
        <p className={styles.reviewNote}>Nothing new to add from these emails.</p>
      ) : (
        <ul className={styles.reviewList} role="list">
          {review.candidates.map((c) => (
            <li key={c.id} className={styles.reviewRow}>
              <label className={styles.reviewLabel}>
                <input type="checkbox" checked={review.selected.has(c.id)} onChange={() => onToggle(c.id)} />
                <span className={styles.reviewText}>
                  <span className={styles.reviewMerchant}>{c.merchant}</span>
                  <span className={styles.reviewMeta}>
                    {c.date}
                    {c.time ? ` · ${c.time}` : ''}
                    {review.relayed[c.id] ? ` · sent through ${PLATFORM_NAMES[review.relayed[c.id]] ?? review.relayed[c.id]}` : ''}
                  </span>
                </span>
                <span className={styles.reviewAmount}>{fmt(c.amount, c.currency)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.reviewActions}>
        <Badge variant="accent" icon={<ShieldCheck />}>Adds spending records only · no money moves</Badge>
        {bulk.length > 1 ? (
          <Button variant="ghost" size="sm" onClick={onToggleAll}>
            {all ? 'Untick all' : 'Tick all'}
          </Button>
        ) : null}
        <Button iconStart={<MailCheck />} disabled={review.selected.size === 0} onClick={onConfirm}>
          Confirm
        </Button>
      </div>
    </div>
  )
}

// ───────────────────────────── connect a mailbox ─────────────────────────────

function passwordLabel(id: EmailPresetId): string {
  if (id === 'qq' || id === '163') return '授权码 (authorization code)'
  if (id === 'custom') return 'Password or App Password'
  return 'App Password'
}

/** What reading the mailbox can and cannot do, in plain words. */
function ReadOnlyNote({ keyStorage }: { keyStorage: string }) {
  return (
    <Callout tone="safe" title="Read only, and it stays on this computer">
      <ul className={mine.promises}>
        <li>
          Your password stays on this computer and is only used to sign in to your mail server.
          {keyStorage ? ` How it is kept: ${keyStorage}` : ''}
        </li>
        <li>FundBun only reads. It opens your inbox with IMAP EXAMINE and BODY.PEEK, so it cannot send, delete, move or mark anything as read.</li>
        <li>Only emails from allow-listed bank and wallet senders are read.</li>
        <li>Nothing is added to your spending until you Confirm.</li>
      </ul>
    </Callout>
  )
}

function ConnectForm({ state, client, onState }: { state: EmailAccountState; client: EmailClient; onState: (s: EmailState) => void }) {
  const presets = state.presets.length ? state.presets : [...EMAIL_PRESETS]
  const [presetId, setPresetId] = useState<EmailPresetId>(presets[0].id)
  const [address, setAddress] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(IMAP_TLS_PORT))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectId = useId()
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]
  const custom = preset.id === 'custom'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await client.connect({
      presetId: preset.id,
      address: address.trim(),
      password,
      ...(custom ? { host: host.trim(), port: Number(port) || IMAP_TLS_PORT } : {}),
    })
    // the password is never kept in the page, whatever happened
    setPassword('')
    if (!r.ok) {
      setBusy(false)
      setError(r.message)
      return
    }
    const next = await client.state()
    const account = (next.local ? next.account : null) ?? r.account
    setBusy(false)
    if (!account) {
      setError('FundBun connected but did not show the mailbox. Close Settings and open it again.')
      return
    }
    onState({ ...(next.local ? next : state), account })
  }

  return (
    <form className={mine.form} onSubmit={(e) => void submit(e)} aria-label="Connect your email">
      <p className={mine.lead}>Bun reads receipts and bank alerts from your own mailbox, here on this computer.</p>
      <div className={mine.field}>
        <label htmlFor={selectId} className={mine.label}>Email provider</label>
        <select id={selectId} className={mine.select} value={preset.id} disabled={busy} onChange={(e) => setPresetId(e.currentTarget.value as EmailPresetId)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <p className={mine.help}>
        {preset.help}
        {preset.helpUrl ? (
          <>
            {' '}
            <a href={preset.helpUrl} target="_blank" rel="noreferrer">Open that page</a>
          </>
        ) : null}
      </p>
      <TextField label="Email address" type="email" value={address} onChange={(e) => setAddress(e.currentTarget.value)} autoComplete="off" spellCheck={false} required disabled={busy} />
      <TextField label={passwordLabel(preset.id)} type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="off" spellCheck={false} required disabled={busy} />
      {custom ? (
        <div className={mine.server}>
          <TextField label="IMAP server" placeholder="imap.example.com" value={host} onChange={(e) => setHost(e.currentTarget.value)} autoComplete="off" spellCheck={false} required disabled={busy} />
          <TextField label="Port" inputMode="numeric" value={port} onChange={(e) => setPort(e.currentTarget.value.replace(/\D/g, '').slice(0, 5))} autoComplete="off" required disabled={busy} />
        </div>
      ) : null}
      <ReadOnlyNote keyStorage={state.keyStorage} />
      {error ? <p className={cx(mine.result, mine.bad)} role="alert">{error}</p> : null}
      <Button type="submit" fullWidth loading={busy} disabled={busy}>Connect and test</Button>
    </form>
  )
}

// ───────────────────────────── a connected mailbox ─────────────────────────────

function testText(t: EmailTestResult): string {
  if (!t.ok) return t.message ?? 'FundBun could not sign in to this mailbox.'
  const found = typeof t.messageCount === 'number' ? ` and found ${t.messageCount} ${plural(t.messageCount, 'email', 'emails')} in your inbox` : ''
  return `Signed in${found} (${(t.ms / 1000).toFixed(1)} s). No email was opened or changed.`
}

function ConnectedMailbox({ state, account, client, consent, checking, checkFailed, onState, onRefresh, onCheck, children }: {
  state: EmailAccountState
  account: EmailAccountView
  client: EmailClient
  consent: boolean
  checking: boolean
  /** a check just failed and its message is on screen */
  checkFailed: boolean
  onState: (s: EmailState) => void
  /** reads the mailbox again from the server (how the last sign-in went) */
  onRefresh: () => Promise<void>
  onCheck: (account: EmailAccountView) => void
  children?: ReactNode
}) {
  const preset = state.presets.find((p) => p.id === account.presetId) ?? presetById(account.presetId)
  const [test, setTest] = useState<EmailTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [asking, setAsking] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const consentHint = useId()

  async function runTest() {
    setTesting(true)
    setTest(await client.test())
    setTesting(false)
    await onRefresh()
  }

  async function disconnect() {
    setLeaving(true)
    setLeaveError(null)
    const r = await client.disconnect()
    setLeaving(false)
    if (!r.ok) {
      setLeaveError(r.message)
      return
    }
    setAsking(false)
    onState({ ...state, account: null })
  }

  return (
    <>
      <div className={mine.who}>
        <span className={styles.rowIcon} aria-hidden="true"><Mail /></span>
        <span className={styles.consentText}>
          <span className={cx(styles.consentTitle, mine.address)}>{account.address}</span>
          <span className={styles.consentSub}>{preset?.name ?? account.label} · read only · on this computer</span>
        </span>
        <Badge variant="under" size="sm">Connected</Badge>
      </div>
      {/* a fresh Test result or check error already says how it went */}
      {account.lastError && !test && !checkFailed ? <p className={cx(mine.result, mine.bad)}>Last time: {account.lastError}</p> : null}
      <div className={mine.actions}>
        <Button iconStart={<MailCheck />} loading={checking} disabled={!consent || checking} aria-describedby={consent ? undefined : consentHint} onClick={() => onCheck(account)}>
          Check my inbox
        </Button>
        <Button variant="secondary" loading={testing} onClick={() => void runTest()}>Test</Button>
        <Button variant="ghost" iconStart={<Unplug />} onClick={() => setAsking(true)}>Disconnect</Button>
      </div>
      {!consent ? (
        <p id={consentHint} className={mine.hint}>Turn on “Read my bank & payment emails” above first: that switch is your yes for Bun to read them.</p>
      ) : (
        <p className={mine.hint}>Bun looks at the last {CHECK_DAYS.default} days. Only bank and wallet senders are read, and you confirm every spending.</p>
      )}
      {test ? <p className={cx(mine.result, test.ok ? mine.ok : mine.bad)} role="status">{testText(test)}</p> : null}
      {children}
      <DomainsForm account={account} client={client} onSaved={(a) => onState({ ...state, account: a })} />
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        alert
        tone="danger"
        title="Disconnect this mailbox?"
        description={`FundBun forgets ${account.address} and deletes its password from this computer. Spending you already added stays.`}
        actions={
          <>
            <Button variant="danger" iconStart={<Unplug />} loading={leaving} onClick={() => void disconnect()}>Disconnect</Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>Keep it connected</Button>
          </>
        }
      >
        {leaveError ? <p className={cx(mine.result, mine.bad)} role="alert">{leaveError}</p> : null}
      </Dialog>
    </>
  )
}

/** Extra sender domains the user trusts, beyond the built-in bank and wallet list. */
function DomainsForm({ account, client, onSaved }: { account: EmailAccountView; client: EmailClient; onSaved: (a: EmailAccountView) => void }) {
  const [text, setText] = useState(account.trustedDomains.join(', '))
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const { domains, invalid } = parseDomainList(text)
    const keep = domains.filter((d) => isTrustableDomain(d))
    const open = domains.filter((d) => !isTrustableDomain(d))
    setBusy(true)
    const r = await client.update({ trustedDomains: keep })
    setBusy(false)
    if (!r.ok) {
      setNote({ ok: false, text: r.message })
      return
    }
    const saved = r.account?.trustedDomains ?? keep
    const problems = [
      invalid.length ? `Not a domain, so not saved: ${invalid.join(', ')}.` : '',
      open.length ? `Anyone can send from ${open.join(', ')}, so it was not saved.` : '',
    ].filter(Boolean)
    setNote({ ok: problems.length === 0, text: [saved.length ? `Saved: ${saved.join(', ')}.` : 'No extra domains.', ...problems].join(' ') })
    setText(saved.join(', '))
    onSaved(r.account ?? { ...account, trustedDomains: saved })
  }

  return (
    <form className={mine.domains} onSubmit={(e) => void save(e)} aria-label="Extra bank or merchant domains">
      <TextField
        label="Extra bank or merchant domains"
        placeholder="bca.co.id, grab.com"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
        hint="Optional. Emails from these sender addresses are read too. Only the address counts, never the name shown."
      />
      <div className={mine.actions}>
        <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={busy}>Save domains</Button>
      </div>
      {note ? <p className={cx(mine.result, note.ok ? mine.ok : mine.bad)} role="status">{note.text}</p> : null}
    </form>
  )
}
