/**
 * The current task plan as a DAG: steps layered by dependency depth, edges drawn underneath. The list is
 * the accessible structure (each step says what it waits for); the SVG edges are decoration.
 */
import { Ban, CircleCheck, CircleDashed, CircleX, Hand, LoaderCircle, SkipForward, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { toolTier } from '../../../core/agent/specs'
import type { PlanStep, TaskPlan } from '../../../core/types'
import { cx } from '../../components/ds'
import { STEP_STATUS_LABEL, layoutPlan } from './logic'
import styles from './GlassBox.module.css'

const ROW_H = 76
const NODE_H = 54

const STATUS_ICON: Record<PlanStep['status'], ReactNode> = {
  waiting: <CircleDashed />,
  running: <LoaderCircle />,
  done: <CircleCheck />,
  needs_approval: <Hand />,
  skipped: <SkipForward />,
  failed: <CircleX />,
  blocked: <Ban />,
}

const PLAN_STATUS: Record<TaskPlan['status'], string> = {
  running: 'Running',
  awaiting_user: 'Waiting for you',
  done: 'Done',
  cancelled: 'Cancelled',
  failed: 'Failed',
}

export function PlanDag({ plan }: { plan: TaskPlan }) {
  const { levels, edges } = layoutPlan(plan.steps)
  const height = Math.max(1, levels.length) * ROW_H - (ROW_H - NODE_H)
  const byId = new Map(plan.steps.map((s) => [s.id, s]))
  const done = plan.steps.filter((s) => s.status === 'done').length

  return (
    <section className={styles.plan} aria-labelledby="gb-plan">
      <div className={styles.planHead}>
        <Workflow aria-hidden="true" />
        <h3 id="gb-plan" className={styles.blockTitle}>Task plan</h3>
        <span className={cx(styles.planStatus, styles[`plan_${plan.status}`])}>{PLAN_STATUS[plan.status]}</span>
      </div>
      <p className={styles.planGoal}>{plan.goal} <span className={styles.mini}>· {done} of {plan.steps.length} steps done</span></p>
      <div className={styles.dag} style={{ height }}>
        <svg className={styles.edges} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {edges.map(({ from, to }) => {
            const y1 = from.level * ROW_H + NODE_H
            const y2 = to.level * ROW_H
            const mid = (y1 + y2) / 2
            const live = to.step.status === 'needs_approval' || to.step.status === 'running'
            return (
              <path
                key={`${from.step.id}-${to.step.id}`}
                d={`M ${from.x} ${y1} C ${from.x} ${mid}, ${to.x} ${mid}, ${to.x} ${y2}`}
                className={cx(styles.edge, live && styles.edgeLive, to.step.status === 'done' && styles.edgeDone)}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>
        <ol className={styles.nodes}>
          {levels.flat().map((n) => {
            const s = n.step
            const width = `calc(${100 / levels[n.level].length}% - 8px)`
            const deps = s.dependsOn.map((d) => byId.get(d)?.label).filter(Boolean)
            const tier = toolTier(s.tool)
            return (
              <li
                key={s.id}
                className={cx(styles.dagNode, styles[`node_${s.status}`])}
                style={{ left: `${n.x}%`, top: n.level * ROW_H, width, height: NODE_H }}
                title={`${s.label} · ${s.tool} (T${tier}) · ${STEP_STATUS_LABEL[s.status]}${s.resultSummary ? ` · ${s.resultSummary}` : ''}`}
              >
                <span className={styles.dagIcon} aria-hidden="true">{STATUS_ICON[s.status]}</span>
                <span className={styles.dagText}>
                  <span className={styles.dagLabel}>{s.label}</span>
                  <span className={styles.dagMeta}>
                    T{tier} · {STEP_STATUS_LABEL[s.status]}
                  </span>
                </span>
                <span className="sr-only">{deps.length ? ` After: ${deps.join(', ')}.` : ' Runs first.'}</span>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
