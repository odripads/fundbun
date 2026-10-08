/**
 * Pure view logic for the agent components (action cards, plans, evidence). No React, no DOM — unit-tested.
 */
import type { ActionPreview, Currency, PendingAction, PlanStep, PlanStepStatus, TaskPlan } from '../../../core/types'
import { fmt } from '../../../core/money'

// ───────────────────────────── action cards ─────────────────────────────

/** What the card shows: pending → buttons, undoable → success + Undo, the rest → a settled state line. */
export type ActionPhase = 'pending' | 'running' | 'undoable' | 'done' | 'blocked' | 'failed' | 'expired' | 'rejected' | 'undone'

export function actionPhase(p: Pick<PendingAction, 'status' | 'undoUntil'>, nowMs: number): ActionPhase {
  switch (p.status) {
    case 'pending': return 'pending'
    case 'approved': return 'running'
    case 'executed': return secondsLeft(p.undoUntil, nowMs) > 0 ? 'undoable' : 'done'
    case 'denied': return 'blocked'
    case 'failed': return 'failed'
    case 'expired': return 'expired'
    case 'rejected': return 'rejected'
    case 'undone': return 'undone'
  }
}

export type PhaseTone = 'accent' | 'under' | 'over' | 'neutral' | 'info'

export interface PhaseMeta {
  label: string
  tone: PhaseTone
  /** settled with nothing left to do (muted styling) */
  muted: boolean
}

export const PHASE_META: Record<ActionPhase, PhaseMeta> = {
  pending: { label: 'Waiting for your OK', tone: 'accent', muted: false },
  running: { label: 'Running…', tone: 'info', muted: false },
  undoable: { label: 'Done', tone: 'under', muted: false },
  done: { label: 'Done', tone: 'under', muted: false },
  blocked: { label: 'Blocked by your safety rules', tone: 'over', muted: false },
  failed: { label: 'Didn’t run', tone: 'over', muted: false },
  expired: { label: 'Expired — nothing ran', tone: 'neutral', muted: true },
  rejected: { label: 'Not now — nothing ran', tone: 'neutral', muted: true },
  undone: { label: 'Undone — back as it was', tone: 'neutral', muted: true },
}

/** Whole seconds until `until` (ISO), never negative; 0 when absent or unparseable. */
export function secondsLeft(until: string | undefined, nowMs: number): number {
  if (!until) return 0
  const end = Date.parse(until)
  if (!Number.isFinite(end)) return 0
  return Math.max(0, Math.ceil((end - nowMs) / 1000))
}

/** "3f9a2c" — the first characters of the binding hash, enough to compare by eye. */
export function shortHash(hash: string | undefined, length = 6): string {
  const clean = (hash ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase()
  return clean.slice(0, Math.max(0, length))
}

export function needsPin(p: Pick<PendingAction, 'decision'>): boolean {
  return p.decision.decision === 'step_up'
}

export function approveLabel(p: Pick<PendingAction, 'decision'>): string {
  return needsPin(p) ? 'Approve with PIN' : 'Approve'
}

export interface RiskMeta {
  label: string
  tone: 'under' | 'warn' | 'over'
}

export const RISK_META: Record<ActionPreview['risk'], RiskMeta> = {
  low: { label: 'Low risk', tone: 'under' },
  medium: { label: 'Medium risk', tone: 'warn' },
  high: { label: 'High risk', tone: 'over' },
}

/** "Runs only after you approve · offer ends 14:42" — timing built from the action's own timestamps. */
export function timingLine(p: Pick<PendingAction, 'status' | 'expiresAt' | 'executedAt' | 'decision'>, formatTime: (iso: string) => string): string {
  if (p.status === 'pending') {
    const gate = needsPin(p) ? 'Runs only after your PIN' : 'Runs only after you approve'
    return Number.isFinite(Date.parse(p.expiresAt)) ? `${gate} · offer ends ${formatTime(p.expiresAt)}` : gate
  }
  if (p.executedAt && (p.status === 'executed' || p.status === 'undone')) return `Ran at ${formatTime(p.executedAt)}`
  return 'Nothing ran'
}

/** HH:MM in the device's locale clock. */
export function clockTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Is PIN entry locked right now (too many wrong tries)? */
export function pinLockedFor(lockedUntil: string | undefined, nowMs: number): number {
  return secondsLeft(lockedUntil, nowMs)
}

// ───────────────────────────── plans (DAG) ─────────────────────────────

export interface StepMeta {
  label: string
  tone: PhaseTone | 'warn'
}

export const STEP_META: Record<PlanStepStatus, StepMeta> = {
  waiting: { label: 'Waiting', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  done: { label: 'Done', tone: 'under' },
  needs_approval: { label: 'Needs your OK', tone: 'accent' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'over' },
  blocked: { label: 'Blocked', tone: 'over' },
}

export const PLAN_META: Record<TaskPlan['status'], { label: string; tone: PhaseTone }> = {
  running: { label: 'Working on it', tone: 'info' },
  awaiting_user: { label: 'Waiting for you', tone: 'accent' },
  done: { label: 'Plan complete', tone: 'under' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
  failed: { label: 'Didn’t finish', tone: 'over' },
}

export function planIsLive(plan: Pick<TaskPlan, 'status'>): boolean {
  return plan.status === 'running' || plan.status === 'awaiting_user'
}

/**
 * Depth of every step in the DAG = the longest dependency chain above it (0 for roots). Unknown dependency ids
 * are ignored and cycles are broken, so a malformed plan still renders.
 */
export function planLevels(steps: Pick<PlanStep, 'id' | 'dependsOn'>[]): Map<string, number> {
  const byId = new Map(steps.map((s) => [s.id, s]))
  const levels = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (id: string): number => {
    const known = levels.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const step = byId.get(id)
    let d = 0
    for (const dep of step?.dependsOn ?? []) if (dep !== id && byId.has(dep)) d = Math.max(d, depth(dep) + 1)
    visiting.delete(id)
    levels.set(id, d)
    return d
  }
  for (const s of steps) depth(s.id)
  return levels
}

export interface PlanNode {
  step: PlanStep
  /** 1-based number in topological order */
  n: number
  level: number
  /** position within its level (0-based) */
  row: number
}

export interface PlanGraph {
  nodes: PlanNode[]
  edges: { from: string; to: string }[]
  /** steps grouped by level, in order */
  stages: PlanNode[][]
  maxRows: number
}

/** Topologically ordered nodes, numbered 1…n, grouped into stages of steps that can run in parallel. */
export function planGraph(steps: PlanStep[]): PlanGraph {
  const levels = planLevels(steps)
  const order = steps
    .map((step, i) => ({ step, i, level: levels.get(step.id) ?? 0 }))
    .sort((a, b) => a.level - b.level || a.i - b.i)
  const stages: PlanNode[][] = []
  const nodes = order.map(({ step, level }, idx) => {
    const stage = (stages[level] ??= [])
    const node: PlanNode = { step, n: idx + 1, level, row: stage.length }
    stage.push(node)
    return node
  })
  const ids = new Set(steps.map((s) => s.id))
  const edges = steps.flatMap((s) => s.dependsOn.filter((d) => d !== s.id && ids.has(d)).map((d) => ({ from: d, to: s.id })))
  const dense = stages.filter(Boolean)
  return { nodes, edges, stages: dense, maxRows: Math.max(1, ...dense.map((s) => s.length)) }
}

export interface PlanProgress {
  done: number
  total: number
  waiting: number
}

/** Settled steps (done or deliberately skipped) out of all steps; `waiting` = steps that need the user. */
export function planProgress(steps: Pick<PlanStep, 'status'>[]): PlanProgress {
  return {
    done: steps.filter((s) => s.status === 'done').length,
    total: steps.length,
    waiting: steps.filter((s) => s.status === 'needs_approval').length,
  }
}

/** Read-only steps are context-gathering; anything else is an action that may need the user. */
export const READ_TOOLS = new Set([
  'get_overview', 'get_spending_breakdown', 'search_transactions', 'list_recurring', 'analyze_bills', 'get_insights',
  'check_affordability', 'get_goals', 'xray_bill',
])

export function isReadStep(step: Pick<PlanStep, 'tool'>): boolean {
  return READ_TOOLS.has(step.tool)
}

// ───────────────────────────── evidence chips ─────────────────────────────

const MONEY_KEY = /(amount|price|total|spent|target|limit|projected|average|cost|saved|remaining|delta|balance|due|from|to|safe|over|under|rate)$/i
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/

/** "firstDate" → "First date", "safe_to_spend" → "Safe to spend". */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Format one evidence value: money-ish keys with integer values become ¥ amounts, dates stay readable. */
export function formatEvidence(key: string, value: number | string, currency: Currency): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—'
    if (/pct|percent|ratio/i.test(key)) return `${Math.round(value * 10) / 10}%`
    if (MONEY_KEY.test(key) && Number.isInteger(value)) return fmt(value, currency)
    return Number.isInteger(value) ? value.toLocaleString('en-US') : String(Math.round(value * 100) / 100)
  }
  if (DATE_VALUE.test(value)) {
    const d = new Date(`${value}T00:00:00Z`)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return value
}

/** Evidence → display chips, skipping internal plumbing keys. */
export function evidenceChips(evidence: Record<string, number | string> | undefined, currency: Currency, max = 6): { key: string; label: string; value: string }[] {
  if (!evidence) return []
  return Object.entries(evidence)
    .filter(([k]) => !/^(rule|id|.*Id|.*Ids)$/.test(k))
    .slice(0, max)
    .map(([k, v]) => ({ key: k, label: humanizeKey(k), value: formatEvidence(k, v, currency) }))
}

/** "instruction-override" → "Instruction override". */
export function signalLabel(signal: string): string {
  return humanizeKey(signal).replace(/\bai\b/gi, 'AI').replace(/\bllm\b/gi, 'LLM')
}

/** Capitalise the first letter of free text produced by code (labels like "sneakers"). */
export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
