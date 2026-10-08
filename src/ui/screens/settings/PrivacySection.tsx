/**
 * Privacy & data: consent for LLM processing (separate from the financial-data consent), which engine answers,
 * exports (PIPL access/portability) and "Delete everything" (PIPL deletion) behind a typed confirmation.
 */
import { Cloud, Cpu, Download, FileJson, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { BunMascot } from '../../components/brand'
import { Badge, Button, Card, Dialog, List, ListItem, SectionHeader, TextField, Toggle, useToast } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { byteSize, downloadText, exportFileName } from './download'
import { DELETE_PHRASE, consentVersionLabel, deleteConfirmed, engineCopy } from './logic'
import styles from './Settings.module.css'

function selectPrivacy(s: AppSnapshot) {
  const c = s.state.profile?.consent
  return {
    financial: c?.financialData ?? false,
    grantedAt: c?.grantedAt,
    version: c?.version,
    llmConsent: c?.llmProcessing ?? false,
    llmEnabled: s.state.settings.llmEnabled,
    llm: s.derived.llm,
    engine: s.derived.engine,
    auditCount: s.state.audit.length,
    txnCount: s.state.bank.transactions.length,
  }
}

export function PrivacySection() {
  const app = useApp()
  const toast = useToast()
  const p = useSnapshot(selectPrivacy, shallowEqual)
  const [checking, setChecking] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function check() {
    setChecking(true)
    try {
      await app.checkLlm()
    } finally {
      setChecking(false)
    }
  }

  function setLlmConsent(on: boolean) {
    app.setConsent({ llmProcessing: on })
    if (on && !p.llmEnabled) app.setSettings({ llmEnabled: true })
    toast.show({
      tone: on ? 'ai' : 'neutral',
      title: on ? 'Cloud AI allowed' : 'On-device only',
      message: on ? 'Only minimised, redacted context leaves the device.' : 'Nothing is sent to an LLM. The Bun Engine answers on this device.',
    })
    void check()
  }

  function exportAll() {
    const text = app.exportData()
    const ok = downloadText(exportFileName('data', 'json'), text)
    toast.show({ tone: ok ? 'success' : 'warn', title: ok ? `Exported ${byteSize(text)}` : 'Downloads aren’t available here', message: ok ? 'Built on this device. Nothing was uploaded.' : undefined })
  }

  function exportAudit() {
    const text = app.exportAuditJSONL()
    const ok = downloadText(exportFileName('audit-log', 'jsonl'), text, 'application/x-ndjson')
    toast.show({ tone: ok ? 'success' : 'warn', title: ok ? 'Audit log exported' : 'Downloads aren’t available here', message: ok ? `${p.auditCount} entries, one JSON line each, hashes included.` : undefined })
  }

  const engine = engineCopy(p)
  const version = consentVersionLabel(p.version)

  return (
    <section id="set-privacy" aria-labelledby="set-privacy-h" className={styles.section}>
      <SectionHeader id="set-privacy-h" eyebrow="Your data" title="Privacy & data" />
      <Card padding="none" className={styles.clip}>
        <div className={styles.consentRow}>
          <span className={styles.rowIcon} aria-hidden="true"><ShieldCheck /></span>
          <span className={styles.consentText}>
            <span className={styles.consentTitle}>Financial data processing</span>
            <span className={styles.consentSub}>
              {p.financial ? `Granted${p.grantedAt ? ` ${new Date(p.grantedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}${version ? ` · ${version}` : ''} · required. To withdraw, delete your data.` : 'Not granted.'}
            </span>
          </span>
          <Badge variant={p.financial ? 'under' : 'neutral'} size="sm">{p.financial ? 'On' : 'Off'}</Badge>
        </div>
        <div className={styles.toggleRow}>
          <Toggle
            label="Cloud AI (LLM) processing"
            description="Lets Bun send minimised, redacted context to the LLM gateway for richer answers. Off means everything stays on this device."
            checked={p.llmConsent}
            onChange={setLlmConsent}
            tone="accent"
          />
        </div>
        <div className={styles.engineRow}>
          <span className={styles.rowIcon} aria-hidden="true">{p.engine === 'llm' ? <Cloud /> : <Cpu />}</span>
          <span className={styles.consentText} role="status" aria-live="polite">
            <span className={styles.consentTitle}>{engine.line}</span>
            <span className={styles.consentSub}>{engine.why}</span>
            {engine.detail ? (
              <details className={styles.engineDetail}>
                <summary>Details</summary>
                <span>{engine.detail}</span>
              </details>
            ) : null}
          </span>
          <Button size="sm" variant="ghost" iconStart={<RefreshCw />} loading={checking} onClick={check}>Check</Button>
        </div>
      </Card>

      <List card>
          <ListItem
            leading={<FileJson />}
            title="Export my data"
            subtitle={`JSON · ${p.txnCount} transactions, goals, settings`}
            trailing={<Download className={styles.trailIcon} aria-hidden="true" />}
            chevron={false}
            onClick={exportAll}
          />
          <ListItem
            leading={<Download />}
            title="Export audit log"
            subtitle={`JSONL · ${p.auditCount} hash-chained entries`}
            trailing={<Download className={styles.trailIcon} aria-hidden="true" />}
            chevron={false}
            onClick={exportAudit}
          />
      </List>

      <div className={styles.danger}>
        <div>
          <p className={styles.dangerTitle}>Delete everything</p>
          <p className={styles.dangerSub}>Wipes your profile, transactions, goals, chat and log from this device.</p>
        </div>
        <Button variant="danger" iconStart={<Trash2 />} onClick={() => setDeleting(true)} className={styles.dangerButton}>Delete</Button>
      </div>

      <DeleteDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => {
        setDeleting(false)
        app.resetAll()
        navigate('onboarding', { replace: true })
      }} />
    </section>
  )
}

function DeleteDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  const [text, setText] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setText('')
  }
  const ok = deleteConfirmed(text)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      alert
      tone="danger"
      media={<BunMascot mood="worried" size={72} animated />}
      title="Delete all your data?"
      description="This can’t be undone. Export first if you want a copy."
      actions={
        <>
          <Button variant="danger" iconStart={<Trash2 />} disabled={!ok} onClick={onConfirm}>Delete all data</Button>
          <Button variant="ghost" onClick={onClose}>Keep my data</Button>
        </>
      }
    >
      <TextField
        label={<>Type <strong>{DELETE_PHRASE}</strong> to confirm</>}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ok) onConfirm()
        }}
      />
    </Dialog>
  )
}
