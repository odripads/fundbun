import type { AppSnapshot } from '../app-api'
import { CATEGORIES } from '../categories'
import type { PluginFinanceSnapshot } from './types'

const MAX_PLUGIN_TRANSACTIONS = 200

/**
 * Build a read-only, PII-minimized finance snapshot for sandboxed UI/compute plugins.
 * Strips names, PINs, account/payee identifiers, raw descriptions, and untrusted counterparty memos.
 */
export function buildPluginSnapshot(snap: AppSnapshot): PluginFinanceSnapshot {
  const { state, derived } = snap
  const currency = state.profile?.currency ?? 'CNY'
  const mode = state.profile?.mode === 'tracking' ? 'tracking' : 'target'
  const viewMonth = (derived.viewDate || derived.today).slice(0, 7)

  const summary = derived.summary
    ? {
        income: derived.summary.income,
        spent: derived.summary.spent,
        target: derived.summary.target,
        projected: derived.summary.projected,
        safePerDay: derived.summary.safeToSpendToday,
        daysLeft: Math.max(0, derived.summary.daysInMonth - derived.summary.dayOfMonth),
        byCategory: derived.summary.byCategory.map((c) => ({
          category: c.category,
          label: CATEGORIES[c.category]?.label ?? c.category,
          spent: c.spent,
          budget: c.limit ?? 0,
          lastMonth: c.prevMonth ?? 0,
        })),
      }
    : null

  const history = derived.history.map((h) => ({
    month: h.month,
    spent: h.spent,
    target: h.target,
    income: h.income,
  }))

  const kinds = new Map(state.dreams.map((d) => [d.id, d.kind]))
  const goals = derived.goals.map((g) => ({
    id: g.itemId,
    name: g.name,
    kind: kinds.get(g.itemId) === 'treat' ? ('treat' as const) : ('goal' as const),
    price: g.price,
    saved: g.saved,
    pct: g.pct,
    etaMonths: g.etaMonths ?? null,
  }))

  const bills = derived.upcomingBills.map((b) => ({
    id: b.id,
    name: b.name,
    amountDue: b.amountDue,
    dueDate: b.dueDate,
    status: b.status,
  }))

  const transactions = state.bank.transactions
    .filter((t) => t.amount < 0)
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      const ta = a.time ?? ''
      const tb = b.time ?? ''
      if (ta !== tb) return tb.localeCompare(ta)
      return b.id.localeCompare(a.id)
    })
    .slice(0, MAX_PLUGIN_TRANSACTIONS)
    .map((t) => ({
      id: t.id,
      date: t.date,
      ...(t.time ? { time: t.time } : {}),
      merchant: t.merchant,
      category: t.category,
      amount: Math.abs(t.amount),
    }))

  return {
    today: derived.today,
    month: derived.summary?.month ?? viewMonth,
    currency,
    mode,
    summary,
    history,
    goals,
    bills,
    transactions,
    checkIn: {
      streak: derived.checkIn.streak,
      best: derived.checkIn.best,
      golden: derived.checkIn.golden,
      checkedToday: derived.checkIn.done,
    },
  }
}
