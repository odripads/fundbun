/**
 * Bun's permissions: the autonomy dial, the tier matrix it implies, spending caps with live usage and the
 * per-tool switches. Loosening anything opens the PIN sheet; tightening is instant (asymmetric friction).
 */
import { Ban, ChevronDown, Fingerprint, Hand, Lock, LockKeyhole, Pencil, Zap } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { CURRENCY_SYMBOL, fmt } from '../../../core/money'
import type { Autonomy, Currency, ToolName } from '../../../core/types'
import { Button, Card, CardHeader, Money, ProgressBar, SectionHeader, Sheet, Slider, TextField, TierBadge, TierCode, Toggle, cx, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSafeAction, useSnapshot } from '../../state'
import {
  AUTONOMY_META,
  AUTONOMY_ORDER,
  AUTONOMY_STEPS,
  CAP_KEYS,
  CAP_META,
  GATE_META,
  TIERS,
  TIER_SHORT,
  capsDraft,
  capsRaise,
  changedCaps,
  checkCapsDraft,
  gateChanges,
  isRaise,
  tierGate,
  toneLine,
  toolGroups,
  toolToggleNeedsPin,
  type Caps,
  type CapsDraft,
  type Gate,
} from './logic'
import { PinSheet } from './PinSheet'
import styles from './Settings.module.css'

const GATE_ICON: Record<Gate, ReactNode> = {
  auto: <Zap />,
  tap: <Hand />,
  pin: <Fingerprint />,
  never: <Ban />,
}

function selectPerms(s: AppSnapshot) {
  const m = s.state.mandate
  return {
    autonomy: m.autonomy,
    frozen: m.frozen,
    perActionCap: m.perActionCap,
    dailyCap: m.dailyCap,
    monthlyCap: m.monthlyCap,
    disabledTools: m.disabledTools,
    // the policy engine's own count (derived.capUsage): what the next cap check will see
    usedToday: s.derived.capUsage.today,
    usedMonth: s.derived.capUsage.month,
    currency: (s.state.profile?.currency ?? 'CNY') as Currency,
    tone: s.state.profile?.tone,
  }
}

type PinTask =
  | { kind: 'autonomy'; to: Autonomy }
  | { kind: 'caps'; caps: Partial<Caps> }
  | { kind: 'tool'; tool: ToolName; label: string }

export function PermissionsSection() {
  const app = useApp()
  const toast = useToast()
  const run = useSafeAction()
  const p = useSnapshot(selectPerms, shallowEqual)
  const caps: Caps = { perActionCap: p.perActionCap, dailyCap: p.dailyCap, monthlyCap: p.monthlyCap }
  const usage = { today: p.usedToday, month: p.usedMonth }
  const [pinTask, setPinTask] = useState<PinTask | null>(null)
  const [editing, setEditing] = useState(false)

  function pickAutonomy(next: Autonomy) {
    if (next === p.autonomy) return
    if (isRaise(p.autonomy, next)) {
      setPinTask({ kind: 'autonomy', to: next })
      return
    }
    void run(() => app.setAutonomy(next), {
      success: toneLine(p.tone, {
        gentle: `Bun is on ${AUTONOMY_META[next].label} now`,
        cheeky: `Shorter leash: ${AUTONOMY_META[next].label}`,
        numbers: `Autonomy: ${AUTONOMY_META[next].label}`,
      }),
    })
  }

  function saveCaps(next: Caps) {
    const diff = changedCaps(caps, next)
    if (!Object.keys(diff).length) return
    if (capsRaise(caps, diff)) {
      setPinTask({ kind: 'caps', caps: diff })
      return
    }
    void run(() => app.setCaps(diff), { success: 'Limits tightened. No PIN needed for that.' })
  }

  function toggleTool(tool: ToolName, label: string, enable: boolean) {
    if (toolToggleNeedsPin(tool, enable)) {
      setPinTask({ kind: 'tool', tool, label })
      return
    }
    void run(() => app.setToolEnabled(tool, enable), { success: enable ? `${label}: on` : `${label}: off for Bun` })
  }

  const pinCopy = pinTask ? pinSheetCopy(pinTask, p.autonomy, p.frozen, caps, p.currency) : null

  return (
    <section id="set-perms" aria-labelledby="set-perms-h" className={styles.section}>
      <SectionHeader id="set-perms-h" eyebrow="Safety" title="Bun’s permissions" />

      <Card className={styles.card}>
        <Slider
          risk
          label="Autonomy"
          steps={AUTONOMY_STEPS.map((a) => ({ value: a.value, label: a.label, hint: a.hint }))}
          value={p.autonomy}
          onChange={pickAutonomy}
        />
        <p className={styles.asym}>
          <LockKeyhole aria-hidden="true" />
          Raising needs your PIN. Lowering is instant.
        </p>
        <TierMatrix autonomy={p.autonomy} frozen={p.frozen} />
      </Card>

      <Card className={styles.card}>
        <CardHeader
          title="Spending limits for Bun"
          subtitle="Only money Bun moves counts. Your own spending isn’t capped."
          action={<Button size="sm" variant="secondary" iconStart={<Pencil />} onClick={() => setEditing(true)}>Edit</Button>}
        />
        <div className={styles.caps}>
          <div className={styles.capLine}>
            <span>
              <span className={styles.capName}>{CAP_META.perActionCap.label}</span>
              <span className={styles.capHint}>{CAP_META.perActionCap.hint}</span>
            </span>
            <Money amount={p.perActionCap} currency={p.currency} size="md" />
          </div>
          <ProgressBar
            size="sm"
            tone="budget"
            value={usage.today}
            max={p.dailyCap}
            label={CAP_META.dailyCap.label}
            valueLabel={<><Money amount={usage.today} currency={p.currency} size="sm" /> <span className={styles.of}>of</span> <Money amount={p.dailyCap} currency={p.currency} size="sm" /></>}
            valueText={`${fmt(usage.today, p.currency)} of ${fmt(p.dailyCap, p.currency)} used today`}
          />
          <ProgressBar
            size="sm"
            tone="budget"
            value={usage.month}
            max={p.monthlyCap}
            label={CAP_META.monthlyCap.label}
            valueLabel={<><Money amount={usage.month} currency={p.currency} size="sm" /> <span className={styles.of}>of</span> <Money amount={p.monthlyCap} currency={p.currency} size="sm" /></>}
            valueText={`${fmt(usage.month, p.currency)} of ${fmt(p.monthlyCap, p.currency)} used this month`}
          />
        </div>
      </Card>

      <ToolsCard disabled={p.disabledTools} onToggle={toggleTool} />

      <CapsEditor open={editing} caps={caps} currency={p.currency} onClose={() => setEditing(false)} onSave={(c) => { setEditing(false); saveCaps(c) }} />

      <PinSheet
        open={pinTask !== null}
        title={pinCopy?.title ?? ''}
        description={pinCopy?.description}
        onClose={() => setPinTask(null)}
        onSubmit={(pin) => {
          if (!pinTask) return { ok: false, error: 'Nothing to confirm' }
          if (pinTask.kind === 'autonomy') return app.setAutonomy(pinTask.to, pin)
          if (pinTask.kind === 'caps') return app.setCaps(pinTask.caps, pin)
          return app.setToolEnabled(pinTask.tool, true, pin)
        }}
        onSuccess={() => {
          if (!pinTask) return
          const title = pinTask.kind === 'autonomy' ? `Bun is on ${AUTONOMY_META[pinTask.to].label}` : pinTask.kind === 'caps' ? 'Limits raised' : `${pinTask.label}: on`
          toast.show({ tone: 'success', title, message: 'PIN verified and logged. Lower it again any time, no PIN needed.' })
        }}
      >
        {pinCopy?.body}
      </PinSheet>
    </section>
  )
}

function pinSheetCopy(task: PinTask, current: Autonomy, frozen: boolean, caps: Caps, currency: Currency): { title: string; description: string; body: ReactNode } {
  if (task.kind === 'autonomy') {
    const changes = gateChanges(current, task.to, frozen)
    return {
      title: `Raise Bun to ${AUTONOMY_META[task.to].label}?`,
      description: AUTONOMY_META[task.to].hint,
      body: changes.length ? (
        <ul className={styles.diff} role="list" aria-label="What changes">
          {changes.map((c) => (
            <li key={c.tier}>
              <TierBadge tier={c.tier} size="sm" />
              <span className={cx(styles.gate, styles[`gate_${c.from}`])}>{GATE_META[c.from].label}</span>
              <span aria-hidden="true">→</span>
              <span className="sr-only">becomes</span>
              <span className={cx(styles.gate, styles[`gate_${c.to}`])}>{GATE_META[c.to].label}</span>
            </li>
          ))}
        </ul>
      ) : null,
    }
  }
  if (task.kind === 'caps') {
    return {
      title: 'Raise Bun’s limits?',
      description: 'Bun will be able to move more of your money between your own pots.',
      body: (
        <ul className={styles.diff} role="list" aria-label="What changes">
          {CAP_KEYS.filter((k) => task.caps[k] !== undefined).map((k) => (
            <li key={k}>
              <span className={styles.diffName}>{CAP_META[k].label}</span>
              <Money amount={caps[k]} currency={currency} size="sm" strike />
              <span aria-hidden="true">→</span>
              <span className="sr-only">becomes</span>
              <Money amount={task.caps[k] as number} currency={currency} size="sm" />
            </li>
          ))}
        </ul>
      ),
    }
  }
  return {
    title: `Switch on “${task.label}”?`,
    description: 'This tool can move money or make payments, so turning it back on needs your PIN.',
    body: null,
  }
}

/** Tier × autonomy: what the policy engine does. Text + icon in every cell; the current level is highlighted. */
function TierMatrix({ autonomy, frozen }: { autonomy: Autonomy; frozen: boolean }) {
  return (
    <div className={styles.matrixWrap}>
      <table className={styles.matrix}>
        <caption className={styles.matrixCaption}>
          What Bun may do at each level{frozen ? ' (frozen: only reading works right now)' : ''}
        </caption>
        <thead>
          <tr>
            <th scope="col"><span className="sr-only">Permission tier</span></th>
            {AUTONOMY_ORDER.map((a) => (
              <th key={a} scope="col" className={cx(a === autonomy && styles.colNow)} aria-current={a === autonomy ? 'true' : undefined}>
                {AUTONOMY_META[a].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIERS.map((t) => (
            <tr key={t}>
              <th scope="row">
                <span className={styles.tierHead}>
                  <span className={styles.tierCode} data-tier={t}><TierCode tier={t} /></span>
                  <span className={styles.tierName}>{TIER_SHORT[t]}</span>
                </span>
              </th>
              {AUTONOMY_ORDER.map((a) => {
                const g = tierGate(t, a, frozen && a === autonomy)
                return (
                  <td key={a} className={cx(styles.cell, styles[`gate_${g}`], a === autonomy && styles.colNow)}>
                    <span className={styles.cellIcon} aria-hidden="true">{GATE_ICON[g]}</span>
                    <span className={styles.cellText}>{GATE_META[g].label}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.legend} role="list" aria-label="Legend">
        {(['auto', 'tap', 'pin', 'never'] as const).map((g) => (
          <li key={g} className={styles[`gate_${g}`]}>
            <span className={styles.cellIcon} aria-hidden="true">{GATE_ICON[g]}</span>
            {GATE_META[g].long}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ToolsCard({ disabled, onToggle }: { disabled: ToolName[]; onToggle: (tool: ToolName, label: string, enable: boolean) => void }) {
  const groups = useMemo(() => toolGroups(), [])
  return (
    <Card padding="none" className={styles.toolsCard}>
      <div className={styles.toolsHead}>
        <CardHeader title="Tools Bun can use" subtitle="Switch any tool off for Bun. Tier 4 is locked: never allowed." />
      </div>
      {groups.map((g) => {
        const off = g.tools.filter((t) => disabled.includes(t.name)).length
        const locked = g.tier === 4
        return (
          <details key={g.tier} className={styles.toolGroup}>
            <summary className={styles.toolSummary}>
              <TierBadge tier={g.tier} size="sm" />
              <span className={styles.toolCount}>
                {g.tools.length} tool{g.tools.length === 1 ? '' : 's'}
                {' · '}
                {locked ? 'never allowed' : off ? `${off} off` : 'all on'}
              </span>
              <ChevronDown className={styles.toolChevron} aria-hidden="true" />
            </summary>
            <ul className={styles.toolList} role="list">
              {g.tools.map((t) => (
                <li key={t.name} className={styles.toolRow}>
                  <span className={styles.toolText}>
                    <span className={styles.toolLabel}>{t.label}</span>
                    <code className={styles.toolName}>{t.name}</code>
                  </span>
                  {locked ? (
                    <span className={styles.locked}>
                      <Lock aria-hidden="true" /> Never allowed
                    </span>
                  ) : (
                    <Toggle
                      checked={!disabled.includes(t.name)}
                      onChange={(on) => onToggle(t.name, t.label, on)}
                      ariaLabel={`${t.label}${g.tier >= 2 ? ' (turning on needs your PIN)' : ''}`}
                    />
                  )}
                </li>
              ))}
            </ul>
          </details>
        )
      })}
    </Card>
  )
}

function CapsEditor({ open, caps, currency, onClose, onSave }: { open: boolean; caps: Caps; currency: Currency; onClose: () => void; onSave: (c: Caps) => void }) {
  const [draft, setDraft] = useState<CapsDraft>(() => capsDraft(caps, currency))
  const [errors, setErrors] = useState<Partial<Record<keyof CapsDraft, string>>>({})
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    // reset the form each time the sheet opens
    setWasOpen(open)
    if (open) {
      setDraft(capsDraft(caps, currency))
      setErrors({})
    }
  }
  const check = checkCapsDraft(draft, currency)
  const raising = 'caps' in check && capsRaise(caps, check.caps)

  function submit(e: FormEvent) {
    e.preventDefault()
    if ('errors' in check) {
      setErrors(check.errors)
      return
    }
    onSave(check.caps)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Spending limits for Bun"
      description="Lowering is instant. Raising any limit asks for your PIN."
      footer={
        <Button type="submit" form="caps-form" fullWidth iconStart={raising ? <LockKeyhole /> : undefined}>
          {raising ? 'Continue with PIN' : 'Save limits'}
        </Button>
      }
    >
      <form id="caps-form" className={styles.form} onSubmit={submit} noValidate>
        {CAP_KEYS.map((k) => (
          <TextField
            key={k}
            label={CAP_META[k].label}
            hint={CAP_META[k].hint}
            error={errors[k]}
            prefix={CURRENCY_SYMBOL[currency]}
            inputMode="decimal"
            value={draft[k]}
            onChange={(e) => {
              const value = e.currentTarget.value
              setDraft((d) => ({ ...d, [k]: value }))
              setErrors((er) => ({ ...er, [k]: undefined }))
            }}
          />
        ))}
      </form>
    </Sheet>
  )
}
