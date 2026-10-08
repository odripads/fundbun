/**
 * The kill switch, first thing in Settings: one unmistakable "Freeze Bun" (instant, no PIN) and, while frozen,
 * the reason (incl. the circuit breaker's) and "Unfreeze with PIN".
 */
import { KeyRound, Snowflake } from 'lucide-react'
import { useState } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { BunMascot } from '../../components/brand'
import { Button, Callout, cx, useToast } from '../../components/ds'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { timeLabel } from '../activity/logic'
import { AUTONOMY_META, toneLine } from './logic'
import { PinSheet } from './PinSheet'
import styles from './Settings.module.css'

function selectKill(s: AppSnapshot) {
  const m = s.state.mandate
  let since: string | undefined
  for (let i = s.state.audit.length - 1; i >= 0; i--) {
    const e = s.state.audit[i]
    if (e.type === 'kill_switch' || e.type === 'circuit_breaker') {
      since = e.ts
      break
    }
  }
  return {
    frozen: m.frozen,
    breakerReason: m.breakerReason,
    breakerAt: m.breakerTrippedAt,
    autonomy: m.autonomy,
    tone: s.state.profile?.tone,
    since,
    waiting: s.derived.awaiting.length,
  }
}

export function KillSwitch() {
  const app = useApp()
  const toast = useToast()
  const k = useSnapshot(selectKill, shallowEqual)
  const [pinOpen, setPinOpen] = useState(false)
  const meta = AUTONOMY_META[k.autonomy]

  function freeze() {
    app.freeze()
    toast.show({
      id: 'kill-switch',
      tone: 'warn',
      title: toneLine(k.tone, { gentle: 'Bun is frozen', cheeky: 'Bun’s on ice', numbers: 'Agent frozen' }),
      message: toneLine(k.tone, {
        gentle: 'It can still read and explain. Nothing else happens until you unfreeze it.',
        cheeky: 'Read-only until you say so. No sneaky moves.',
        numbers: 'Read-only. Actions blocked (P-FROZEN).',
      }),
    })
  }

  if (!k.frozen) {
    return (
      <section id="set-kill" className={styles.kill} aria-labelledby="kill-title">
        <div className={styles.killHead}>
          <span className={styles.killArt} aria-hidden="true">
            <BunMascot mood="happy" size={72} animated />
          </span>
          <div className={styles.killText}>
            <p className={styles.killEyebrow}>
              <span className={styles.liveDot} aria-hidden="true" />
              Bun is on
            </p>
            <h2 id="kill-title" className={styles.killTitle}>{meta.label} mode</h2>
            <p className={styles.killSub}>{meta.hint}</p>
          </div>
        </div>
        <Button variant="danger" size="lg" fullWidth iconStart={<Snowflake />} onClick={freeze} className={styles.freezeButton}>
          Freeze Bun
        </Button>
        <p className={styles.killNote}>Instant, no PIN. Bun keeps reading and explaining but can’t take any action.</p>
      </section>
    )
  }

  const breaker = Boolean(k.breakerAt)
  return (
    <section id="set-kill" className={cx(styles.kill, styles.killFrozen)} aria-labelledby="kill-title">
      <span className={styles.snow} aria-hidden="true" />
      <div className={styles.killHead}>
        <span className={styles.killArt} aria-hidden="true">
          <BunMascot mood="sleepy" size={72} animated />
        </span>
        <div className={styles.killText}>
          <p className={cx(styles.killEyebrow, styles.killEyebrowFrozen)}>
            <Snowflake aria-hidden="true" />
            {breaker ? 'Circuit breaker' : 'Kill switch on'}
          </p>
          <h2 id="kill-title" className={styles.killTitle}>Bun is frozen</h2>
          <p className={styles.killSub}>
            Read-only{k.since ? ` since ${timeLabel(k.since)}` : ''}. Every action is blocked
            {k.waiting ? `, and ${k.waiting} pending approval${k.waiting === 1 ? ' is' : 's are'} parked` : ''}.
          </p>
        </div>
      </div>
      {k.breakerReason ? (
        <Callout tone="block" title="Why the breaker tripped">
          {k.breakerReason}
        </Callout>
      ) : null}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        iconStart={<KeyRound />}
        onClick={() => {
          toast.dismiss('kill-switch')
          setPinOpen(true)
        }}
      >
        Unfreeze with PIN
      </Button>
      <PinSheet
        open={pinOpen}
        title="Unfreeze Bun?"
        description={`Bun goes back to ${meta.label} mode. You can freeze it again any time, no PIN needed.`}
        onSubmit={(pin) => app.unfreeze(pin)}
        onSuccess={() =>
          toast.show({
            id: 'kill-switch',
            tone: 'success',
            title: toneLine(k.tone, { gentle: 'Bun is back', cheeky: 'Thawed and ready', numbers: 'Agent resumed' }),
            message: `${meta.label} mode. Freeze again any time.`,
          })
        }
        onClose={() => setPinOpen(false)}
      />
    </section>
  )
}
