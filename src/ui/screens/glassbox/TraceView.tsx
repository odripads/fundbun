/**
 * Glass box · Trace: how the latest reply was produced, step by step (intent → tool calls → policy → grounding),
 * plus the task-plan DAG when one is in flight, and one-tap red-team prompts for the judges' attack list.
 */
import {
  BadgeCheck,
  Brain,
  CircleAlert,
  CircleCheck,
  CircleX,
  Cpu,
  EyeOff,
  MessageSquareText,
  Scale,
  ShieldAlert,
  Swords,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { fmt } from '../../../core/money'
import type { Currency } from '../../../core/types'
import { BunMascot } from '../../components/brand'
import { AiBadge, TierBadge, cx } from '../../components/ds'
import { navigate } from '../../router'
import { useApp, useSafeAction, useSnapshot } from '../../state'
import { timeLabel } from '../activity/logic'
import { PlanDag } from './PlanDag'
import { ATTACKS, DECISION_META, currentPlan, humanize, latestTurn, pctLabel, summarizeTrace, traceRows, turnPlanId, type LatestTurn, type StepView, type TraceRow } from './logic'
import styles from './GlassBox.module.css'

const MONEY_KEYS = /^(amount|limit|price|threshold|total|cap)$/i

const sameTurn = (a: LatestTurn | null, b: LatestTurn | null) =>
  a === b || (a !== null && b !== null && a.message.id === b.message.id && a.message.trace?.length === b.message.trace?.length && a.question === b.question)

const selectTurn = (s: AppSnapshot) => latestTurn(s.state.chat)
const selectBusy = (s: AppSnapshot) => s.derived.busy
const selectPlans = (s: AppSnapshot) => s.state.plans
const selectCurrency = (s: AppSnapshot) => (s.state.profile?.currency ?? 'CNY') as Currency

export function TraceView() {
  const turn = useSnapshot(selectTurn, sameTurn)
  const busy = useSnapshot(selectBusy)
  const plans = useSnapshot(selectPlans)
  const currency = useSnapshot(selectCurrency)
  const plan = currentPlan(plans)
  // a plan belongs here if this turn made or resumed it, or it is still waiting on the user
  const showPlan = plan && (plan.status === 'running' || plan.status === 'awaiting_user' || (turn && turnPlanId(turn.message.trace ?? []) === plan.id))

  return (
    <div className={styles.stack}>
      {busy ? (
        <p className={styles.busy} role="status">
          <span className={styles.busyDots} aria-hidden="true"><span /><span /><span /></span>
          Bun is working on a reply…
        </p>
      ) : null}
      {turn ? <TurnTrace key={turn.message.id} turn={turn} currency={currency} plan={showPlan ? <PlanDag plan={plan} /> : null} /> : <TraceEmpty />}
      {!turn && showPlan ? <PlanDag plan={plan} /> : null}
      <RedTeam disabled={busy} />
    </div>
  )
}

function TraceEmpty() {
  return (
    <div className={styles.empty}>
      <BunMascot mood="calm" size={72} animated />
      <div>
        <p className={styles.emptyTitle}>Nothing to trace yet</p>
        <p className={styles.emptyBody}>Ask Bun anything. Every step lands here: what it understood, which tools it asked for, what the policy engine decided and whether the numbers check out.</p>
      </div>
    </div>
  )
}

function TurnTrace({ turn, currency, plan }: { turn: LatestTurn; currency: Currency; plan: ReactNode }) {
  const steps = turn.message.trace ?? []
  const sum = summarizeTrace(steps)
  const rows = traceRows(steps)
  return (
    <section className={styles.turn} aria-label="Latest agent turn">
      <header className={styles.turnHead}>
        <div className={styles.turnMeta}>
          <span className={styles.eyebrow}>Latest turn · {timeLabel(turn.message.ts, true)}</span>
          <AiBadge engine={turn.message.engine} />
        </div>
        {turn.question ? (
          <p className={styles.question}>
            <MessageSquareText aria-hidden="true" />
            <q>{turn.question}</q>
          </p>
        ) : null}
        <ul className={styles.summary} role="list" aria-label="Turn summary">
          <li>{sum.steps} steps</li>
          <li>{sum.tools} tool call{sum.tools === 1 ? '' : 's'}</li>
          {sum.waiting ? <li className={styles.sumWait}>{sum.waiting} waiting for you</li> : null}
          {sum.denied ? <li className={styles.sumDeny}>{sum.denied} blocked</li> : null}
          {sum.injections ? <li className={styles.sumDeny}>injection caught</li> : sum.tainted ? <li className={styles.sumDeny}>tainted</li> : null}
          {sum.grounded ? (
            <li className={sum.grounded.ok ? styles.sumOk : styles.sumDeny}>{sum.grounded.ok ? 'grounded' : 'ungrounded'}</li>
          ) : null}
        </ul>
      </header>
      {plan}
      <ol className={styles.steps} aria-label="Steps, in order">
        {rows.map((r, i) =>
          r.kind === 'tool' ? (
            <li key={r.index} className={cx(styles.step, styles[`step_${toolTone(r)}`])} style={{ ['--i' as string]: i }}>
              <span className={styles.node} aria-hidden="true"><Wrench /></span>
              <div className={styles.stepBody}>
                <ToolRow row={r} currency={currency} />
              </div>
            </li>
          ) : (
            <li key={r.index} className={cx(styles.step, styles[`step_${tone(r.view)}`])} style={{ ['--i' as string]: i }}>
              <span className={styles.node} aria-hidden="true">{ICON[r.view.kind]}</span>
              <div className={styles.stepBody}>
                <StepBody v={r.view} currency={currency} />
              </div>
            </li>
          ),
        )}
      </ol>
    </section>
  )
}

function toolTone(r: Extract<TraceRow, { kind: 'tool' }>): 'neutral' | 'ok' | 'warn' | 'bad' {
  if (r.result && !r.result.ok) return 'bad'
  const d = r.policy?.decision
  if (d === 'deny') return 'bad'
  if (d === 'confirm' || d === 'step_up') return 'warn'
  if (r.result?.untrusted) return 'warn'
  return d === 'allow' ? 'ok' : 'neutral'
}

/** A tool call, the policy engine's verdict on it and what came back — one row. */
function ToolRow({ row, currency }: { row: Extract<TraceRow, { kind: 'tool' }>; currency: Currency }) {
  const { call, policy, result } = row
  const meta = policy?.decision ? DECISION_META[policy.decision] : undefined
  // the boilerplate "reading is always allowed" reason adds nothing; anything stricter is worth reading
  const showReason = policy?.reasons[0] && !(policy.decision === 'allow' && call.tier === 0)
  return (
    <>
      <p className={styles.stepTitle}>
        <code className={styles.tool}>{call.tool}</code>
        <TierBadge tier={call.tier} size="sm" />
        {meta ? <span className={cx(styles.pill, styles[`pill_${meta.tone}`])} title={meta.long}>{meta.label}</span> : null}
        {policy?.tainted ? <span className={styles.flag}>tainted</span> : null}
      </p>
      {call.args.length || policy?.ruleIds.length ? (
        <p className={styles.chips}>
          {policy?.ruleIds.map((r) => <code key={r} className={styles.rule}>{r}</code>)}
          {call.args.map(([k, val]) => (
            <code key={k} className={styles.arg}>
              <span>{k}</span>={argValue(k, val, currency)}
            </code>
          ))}
        </p>
      ) : null}
      {showReason ? <p className={styles.reason}>{policy?.reasons[0]}</p> : null}
      {result ? (
        <p className={cx(styles.result, !result.ok && styles.resultBad)}>
          <span aria-hidden="true">{result.ok ? '→' : '✕'}</span>
          <span className="sr-only">{result.ok ? 'Result:' : 'Failed:'}</span>
          <span className={styles.plain}>{result.title}</span>
          {result.untrusted ? <span className={styles.flag}>untrusted text</span> : null}
        </p>
      ) : null}
    </>
  )
}

const ICON: Record<StepView['kind'], ReactNode> = {
  intent: <Brain />,
  tool_call: <Wrench />,
  tool_result: <CircleCheck />,
  policy: <Scale />,
  injection: <ShieldAlert />,
  grounding: <BadgeCheck />,
  llm: <Cpu />,
  redaction: <EyeOff />,
  error: <TriangleAlert />,
}

function tone(v: StepView): 'neutral' | 'ok' | 'warn' | 'bad' | 'ai' {
  switch (v.kind) {
    case 'injection':
    case 'error':
      return 'bad'
    case 'policy':
      return v.decision === 'deny' ? 'bad' : v.decision === 'allow' ? 'ok' : v.decision ? 'warn' : 'neutral'
    case 'grounding':
      return v.ok ? 'ok' : 'bad'
    case 'tool_result':
      return !v.ok ? 'bad' : v.untrusted ? 'warn' : 'neutral'
    case 'intent':
    case 'llm':
      return 'ai'
    default:
      return 'neutral'
  }
}

function argValue(k: string, v: string, currency: Currency): string {
  return MONEY_KEYS.test(k) && /^\d+$/.test(v) ? fmt(Number(v), currency) : v
}

function StepBody({ v, currency }: { v: StepView; currency: Currency }) {
  switch (v.kind) {
    case 'intent': {
      const pct = pctLabel(v.confidence)
      return (
        <>
          <p className={styles.stepTitle}>
            <span className={styles.kind}>Intent</span>
            {v.intent ? <span className={styles.strong}>{humanize(v.intent)}</span> : <span className={styles.strong}>{v.title}</span>}
            {pct ? (
              <span className={styles.conf} title="Classifier confidence">
                <span className={styles.confBar} aria-hidden="true"><span style={{ width: pct }} /></span>
                {pct}
              </span>
            ) : null}
          </p>
          {v.rule || v.engine ? (
            <p className={styles.chips}>
              {v.rule ? <code className={styles.rule}>{v.rule}</code> : null}
              {v.engine ? <span className={styles.mini}>{v.engine === 'offline' ? 'on-device Bun Engine' : v.engine}</span> : null}
            </p>
          ) : null}
          {v.alternatives.length ? (
            <p className={styles.alt}>
              Also considered: {v.alternatives.map((a) => `${humanize(a.intent)} ${pctLabel(a.confidence)}`).join(' · ')}
            </p>
          ) : null}
        </>
      )
    }
    case 'tool_call':
      return (
        <>
          <p className={styles.stepTitle}>
            <span className={styles.kind}>Tool call</span>
            <code className={styles.tool}>{v.tool}</code>
            <TierBadge tier={v.tier} size="sm" />
          </p>
          {v.args.length ? (
            <p className={styles.chips}>
              {v.args.map(([k, val]) => (
                <code key={k} className={styles.arg}>
                  <span>{k}</span>={argValue(k, val, currency)}
                </code>
              ))}
            </p>
          ) : null}
          {v.proposedBy ? <p className={styles.alt}>Proposed by {v.proposedBy === 'offline' ? 'the on-device engine' : v.proposedBy === 'llm' ? 'the LLM' : v.proposedBy === 'user' ? 'a button you tapped' : v.proposedBy}</p> : null}
        </>
      )
    case 'policy': {
      const meta = v.decision ? DECISION_META[v.decision] : undefined
      return (
        <>
          <p className={styles.stepTitle}>
            <span className={styles.kind}>Policy</span>
            {meta ? <span className={cx(styles.pill, styles[`pill_${meta.tone}`])}>{meta.label}</span> : null}
            {v.tool ? <code className={styles.tool}>{v.tool}</code> : <span className={styles.strong}>{v.title}</span>}
            {v.tainted ? <span className={styles.flag}>tainted</span> : null}
          </p>
          {v.ruleIds.length ? (
            <p className={styles.chips}>
              {v.ruleIds.map((r) => <code key={r} className={styles.rule}>{r}</code>)}
            </p>
          ) : null}
          {v.reasons[0] ? <p className={styles.reason}>{v.reasons[0]}</p> : null}
        </>
      )
    }
    case 'tool_result':
      return (
        <p className={styles.stepTitle}>
          <span className={styles.kind}>{v.ok ? 'Result' : 'Failed'}</span>
          <span className={styles.plain}>{v.title}</span>
          {v.untrusted ? <span className={styles.flag}>untrusted text</span> : null}
          {!v.ok ? <CircleX className={styles.inlineIcon} aria-hidden="true" /> : null}
        </p>
      )
    case 'injection':
      return (
        <>
          <p className={styles.stepTitle}>
            <span className={cx(styles.kind, styles.kindBad)}>{v.signals.length ? 'Injection' : 'Taint'}</span>
            <span className={styles.strong}>{v.title}</span>
            {v.score !== undefined ? <span className={styles.mini}>score {v.score.toFixed(2)}</span> : null}
          </p>
          {v.signals.length ? (
            <p className={styles.chips}>
              {v.signals.map((s) => <code key={s} className={cx(styles.rule, styles.ruleBad)}>{s}</code>)}
            </p>
          ) : null}
          {v.reason ? <p className={styles.reason}>{v.reason}. Anything that moves money now needs your tap.</p> : null}
        </>
      )
    case 'grounding':
      return (
        <>
          <p className={styles.stepTitle}>
            <span className={styles.kind}>Grounding</span>
            <span className={styles.strong}>
              {!v.ok ? 'Some numbers didn’t trace back' : v.checked ? `All ${v.checked} number${v.checked === 1 ? '' : 's'} in the reply trace to tool results` : 'No numbers in the reply to check'}
            </span>
          </p>
          {!v.ok && v.ungrounded.length ? (
            <p className={styles.chips}>
              {v.ungrounded.map((u) => <code key={u} className={cx(styles.rule, styles.ruleBad)}>{u}</code>)}
            </p>
          ) : null}
        </>
      )
    default:
      return (
        <>
          <p className={styles.stepTitle}>
            <span className={cx(styles.kind, v.kind === 'error' && styles.kindBad)}>{v.kind === 'llm' ? 'LLM' : v.kind === 'redaction' ? 'Redaction' : 'Fallback'}</span>
            <span className={styles.plain}>{v.title}</span>
          </p>
          {v.facts.length ? (
            <p className={styles.chips}>
              {v.facts.map(([k, val]) => <code key={k} className={styles.arg}><span>{k}</span>={val}</code>)}
            </p>
          ) : null}
        </>
      )
  }
}

/** One tap each: the four attacks named in the official scoring. Sends the message and shows the chat. */
function RedTeam({ disabled }: { disabled: boolean }) {
  const app = useApp()
  const run = useSafeAction()
  const [sent, setSent] = useState<string | null>(null)
  async function attack(id: string, text: string) {
    setSent(id)
    navigate('chat')
    await run(() => app.sendMessage(text), { errorTitle: 'Bun couldn’t answer' })
  }
  return (
    <section className={styles.redteam} aria-labelledby="gb-redteam">
      <div className={styles.redHead}>
        <Swords aria-hidden="true" />
        <h3 id="gb-redteam" className={styles.blockTitle}>Red-team Bun</h3>
        <span className={styles.mini}>sends the message in chat</span>
      </div>
      <ul className={styles.attacks} role="list">
        {ATTACKS.map((a) => (
          <li key={a.id}>
            <button type="button" className={cx(styles.attack, sent === a.id && styles.attackSent)} onClick={() => attack(a.id, a.text)} disabled={disabled}>
              <span className={styles.attackLabel}>
                <CircleAlert aria-hidden="true" />
                {a.label}
              </span>
              <span className={styles.attackText}>“{a.text}”</span>
              <span className={styles.attackDefence}>Expect: {a.defence}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
