import { Check, CircleDashed, Hand, LoaderCircle, Route, ShieldX, SkipForward, Square, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { TOOL_SPECS } from '../../../core/agent/specs'
import type { PlanStepStatus, TaskPlan, ToolName } from '../../../core/types'
import { useSnapshot } from '../../state'
import { Button, Card, TierBadge, cx } from '../ds'
import { ActionCard } from './ActionCard'
import { PLAN_META, STEP_META, isReadStep, planGraph, planIsLive, planProgress, type PlanGraph } from './logic'
import styles from './PlanCard.module.css'

export interface PlanCardProps {
  planId: string
  /** sends "stop" (the dialogue engine cancels the plan and drops its pending actions) */
  onStop?: () => void
}

const STEP_ICON: Record<PlanStepStatus, ReactNode> = {
  waiting: <CircleDashed />,
  running: <LoaderCircle className={styles.spin} />,
  done: <Check />,
  needs_approval: <Hand />,
  skipped: <SkipForward />,
  failed: <X />,
  blocked: <ShieldX />,
}

/**
 * A multi-step task plan as a DAG: a mini map (stages left → right, edges = dependencies) plus the numbered
 * steps in dependency order. Read steps run on their own; action steps embed their policy-gated ActionCard.
 */
export function PlanCard({ planId, onStop }: PlanCardProps) {
  const plan = useSnapshot((s) => s.state.plans.find((p) => p.id === planId))
  const titleId = useId()
  if (!plan) return null
  const graph = planGraph(plan.steps)
  const progress = planProgress(plan.steps)
  const meta = PLAN_META[plan.status]
  const live = planIsLive(plan)
  const numberOf = new Map(graph.nodes.map((n) => [n.step.id, n.n]))
  return (
    <Card as="section" padding="none" className={styles.plan} data-status={plan.status} aria-labelledby={titleId}>
      <header className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true"><Route /></span>
        <div className={styles.headText}>
          <p className={styles.eyebrow}>Task plan · {plan.steps.length} steps</p>
          <h3 id={titleId} className={styles.title}>{plan.goal}</h3>
        </div>
      </header>

      <div className={styles.statusRow}>
        <span className={cx(styles.pill, styles[`tone-${meta.tone}`])}>
          {plan.status === 'running' ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
          {meta.label}
        </span>
        <span className={styles.count}>
          {progress.done} of {progress.total} done{progress.waiting ? ` · ${progress.waiting} waiting for you` : ''}
        </span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
      </div>

      <PlanMap graph={graph} plan={plan} />

      <ol className={styles.steps}>
        {graph.nodes.map((node) => {
          const { step } = node
          const sm = STEP_META[step.status]
          const tier = TOOL_SPECS[step.tool as ToolName]?.tier
          const deps = step.dependsOn.map((d) => numberOf.get(d)).filter((n): n is number => n !== undefined)
          const parallel = (graph.stages[node.level]?.length ?? 1) > 1
          const action = step.pendingId && !isReadStep(step)
          return (
            <li key={step.id} className={styles.step} data-status={step.status}>
              <span className={cx(styles.node, styles[`tone-${sm.tone}`])} aria-hidden="true">
                {STEP_ICON[step.status]}
              </span>
              <div className={styles.stepBody}>
                <p className={styles.stepLabel}>
                  <span className={styles.num}>{node.n}</span>
                  {step.label}
                </p>
                <p className={styles.stepMeta}>
                  <span className={cx(styles.statusText, styles[`text-${sm.tone}`])}>{sm.label}</span>
                  {tier !== undefined ? <TierBadge tier={tier} size="sm" showLabel={false} /> : null}
                  {deps.length ? <span>after {deps.map((n) => `#${n}`).join(', ')}</span> : <span>first</span>}
                  {parallel ? <span className={styles.parallel}>in parallel</span> : null}
                </p>
                {step.resultSummary && !action ? <p className={styles.result}>{step.resultSummary}</p> : null}
                {action ? (
                  <ActionCard pendingId={step.pendingId!} variant={step.status === 'needs_approval' ? 'card' : 'receipt'} className={styles.embedded} />
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      {live && onStop ? (
        <footer className={styles.foot}>
          <Button size="sm" variant="secondary" iconStart={<Square />} onClick={onStop}>Stop plan</Button>
          <span className={styles.footHint}>Anything already done stays undoable from its card.</span>
        </footer>
      ) : null}
    </Card>
  )
}

const COL_W = 64
const ROW_H = 36
const R = 12
const PAD = 8

function nodeTone(status: PlanStepStatus): string {
  return STEP_META[status].tone
}

/** The DAG at a glance: one column per stage, curves for dependencies. Decorative; the list says it in words. */
function PlanMap({ graph, plan }: { graph: PlanGraph; plan: TaskPlan }) {
  const cols = graph.stages.length
  const width = Math.max(cols * COL_W, COL_W * 2)
  const height = graph.maxRows * ROW_H + PAD * 2
  const offsetX = (width - cols * COL_W) / 2
  const pos = new Map<string, { x: number; y: number }>()
  for (const stage of graph.stages) {
    const top = PAD + ((graph.maxRows - stage.length) * ROW_H) / 2
    for (const node of stage) pos.set(node.step.id, { x: offsetX + node.level * COL_W + COL_W / 2, y: top + node.row * ROW_H + ROW_H / 2 })
  }
  const status = new Map(plan.steps.map((s) => [s.id, s.status]))
  return (
    <svg className={styles.map} viewBox={`0 0 ${width} ${height}`} style={{ maxWidth: width * 1.25 }} aria-hidden="true">
      {graph.edges.map((e) => {
        const a = pos.get(e.from)
        const b = pos.get(e.to)
        if (!a || !b) return null
        const dx = (b.x - a.x) / 2
        const to = status.get(e.to) ?? 'waiting'
        const flowing = to === 'needs_approval' || to === 'running'
        return (
          <path
            key={`${e.from}-${e.to}`}
            d={`M ${a.x + R} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - R} ${b.y}`}
            className={cx(styles.edge, flowing && styles.edgeFlow, to === 'done' && styles.edgeDone, (to === 'skipped' || to === 'blocked' || to === 'failed') && styles.edgeDead)}
          />
        )
      })}
      {graph.nodes.map((node) => {
        const p = pos.get(node.step.id)
        if (!p) return null
        const tone = nodeTone(node.step.status)
        return (
          <g key={node.step.id} className={cx(styles.mapNode, styles[`map-${tone}`])} data-status={node.step.status}>
            {node.step.status === 'needs_approval' ? <circle cx={p.x} cy={p.y} r={R + 4} className={styles.halo} /> : null}
            <circle cx={p.x} cy={p.y} r={R} className={styles.dot} />
            <text x={p.x} y={p.y} className={styles.label} dominantBaseline="central" textAnchor="middle">{node.n}</text>
          </g>
        )
      })}
    </svg>
  )
}
