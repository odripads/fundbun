import { fmt } from '../../src/core/money'
import { redactDeep, redactText } from '../../src/core/security/redact'
import type { AppState, ChatCard, Currency, PendingAction } from '../../src/core/types'

export const money = (minor: number, currency: Currency = 'CNY') => fmt(minor, currency)
export const signedMoney = (minor: number, currency: Currency = 'CNY') => fmt(minor, currency, { signed: true })

export function clip(text: string, max = 240): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Personal data (cards, accounts, phones, emails, IDs) is redacted before anything is written to the evidence. */
export function redact(text: string): string {
  return redactText(String(text ?? '')).text
}

export function redactValue<T>(value: T): T {
  return redactDeep(value).value
}

export const hash8 = (hash: string) => hash.slice(0, 8)

/** one-line, table-safe markdown */
export function cell(text: string): string {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function quote(text: string): string {
  return String(text)
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n')
}

export function json(value: unknown): string {
  return JSON.stringify(value)
}

export function pendingLine(p: PendingAction | undefined, currency: Currency = 'CNY'): string {
  if (!p) return '(pending action not found)'
  const d = p.decision
  const parts = [`\`${p.call.tool}\``, `${d.decision} · T${d.tier}`, `status **${p.status}**`]
  if (p.preview.amount !== undefined) parts.push(money(p.preview.amount, currency))
  const { from, to } = p.preview
  if (from || to) parts.push(from && to ? `${from} → ${to}` : to ? `→ ${to}` : `${from} →`)
  if (d.ruleIds.length) parts.push(`rules ${d.ruleIds.join(', ')}`)
  if (d.tainted) parts.push('tainted')
  if (p.preview.reversible) parts.push('reversible')
  return parts.join(' · ')
}

/** Card type + the key numbers a reviewer needs, built from the structured card (never from prose). */
export function cardLine(card: ChatCard, state: AppState): string {
  const c: Currency = state.profile?.currency ?? 'CNY'
  const m = (v: number | undefined) => (v === undefined ? '?' : money(v, c))
  switch (card.type) {
    case 'mirror': {
      const x = card.mirror
      return `mirror — status ${x.status}, spent ${m(x.spent)} / target ${m(x.target)}, projected ${m(x.projected)}, delta ${m(x.delta)}, mood ${x.mood}${x.goalDelayDays ? `, goal delay ${x.goalDelayDays} d` : ''} — “${clip(x.headline, 90)}”`
    }
    case 'breakdown':
      return `breakdown — total ${m(card.total)} / target ${m(card.target)}; top: ${card.items.slice(0, 5).map((i) => `${i.category} ${m(i.spent)}`).join(', ')}`
    case 'transactions':
      return `transactions — “${clip(card.title, 60)}”, ${card.txns.length} rows${card.txns.some((t) => t.memo) ? `, ${card.txns.filter((t) => t.memo).length} with memo (untrusted)` : ''}`
    case 'findings':
      return `findings — ${card.findings.length}: ${card.findings.map((f) => `${f.kind} (${clip(f.title, 48)})`).join('; ')}`
    case 'recurring': {
      const active = card.series.filter((s) => s.status === 'active')
      return `recurring — ${card.series.length} series (${active.length} active), annual ${m(active.reduce((s, x) => s + x.annualCost, 0))}`
    }
    case 'insights':
      return `insights — ${card.insights.map((i) => `${i.kind}${i.dream ? ` (≈ ${clip(i.dream.label, 40)})` : ''}`).join('; ')}`
    case 'affordability': {
      const r = card.result
      return `affordability — ${m(r.amount)} “${clip(r.label, 30)}”: verdict **${r.verdict}**, ${r.hoursOfWork} h of work${r.goalName ? `, ${r.goalName} +${r.goalDelayDays ?? 0} d` : ''}`
    }
    case 'goals':
      return `goals — ${card.goals.map((g) => `${g.name} ${m(g.saved)}/${m(g.price)} (${Math.round(g.pct)}%)`).join('; ')}`
    case 'budget':
      return `budget — ${card.plan.categories.length} categories, limits sum ${m(card.plan.categories.reduce((s, x) => s + x.limit, 0))}, total ${m(card.plan.total)} (${card.plan.method})`
    case 'xray': {
      const r = card.result
      return `xray — ${r.merchant ?? '?'} total ${m(r.total)}, due ${r.dueDate ?? '?'}${r.comparison ? `, ${r.comparison.changePct >= 0 ? '+' : ''}${Math.round(r.comparison.changePct)}% vs ${m(r.comparison.previousAverage)} avg` : ''}, injection ${r.injection.suspicious ? `FLAGGED (score ${r.injection.score.toFixed(2)}; ${r.injection.signals.join(', ')})` : 'none'}`
    }
    case 'action':
      return `action — ${pendingLine(state.pending.find((p) => p.id === card.pendingId), c)}`
    case 'plan': {
      const plan = state.plans.find((p) => p.id === card.planId)
      if (!plan) return 'plan — (not found)'
      return `plan — “${clip(plan.goal, 50)}” ${plan.status}: ${plan.steps.map((s) => `${s.id} ${s.tool}${s.dependsOn.length ? `←${s.dependsOn.join('+')}` : ''} [${s.status}]`).join(', ')}`
    }
    case 'clarify':
      return `clarify — “${clip(card.question, 80)}” options: ${card.options.map((o) => o.label).join(' | ')}`
    case 'notice':
      return `notice (${card.level}) — ${clip(card.title, 60)}: ${clip(card.text, 120)}`
  }
}
