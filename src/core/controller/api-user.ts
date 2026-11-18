import type { AppApi } from '../app-api'
import { importCsv as parseCsvImport } from '../sandbox/csv'
import { auditToJSONL } from '../security/audit'
import { clipForDisplay } from '../security/redact'
import type { AppState, Mandate, SpendingCandidate, Transaction } from '../types'
import { appendAudit, verifyAuditAnchored } from './audit'
import { LOCKED_MSG, NOT_SET_UP_MSG, expirePending, syncClock, userTx, userTxValue, type Core } from './core'
import { applyTripwires } from './tripwires'
import {
  advanceDaysIn,
  filterTransactions,
  importParsedIn,
  mergeTransactions,
  purchaseError,
  simulatePurchaseIn,
  type ImportSummary,
} from './data'
import {
  addDreamTo,
  contributeIn,
  markAchievedIn,
  recategorizeIn,
  removeDreamFrom,
  setCategoryBudgetIn,
  updateDreamIn,
} from './dreams'
import { setConsentIn, setProfileIn, setSettingsIn } from './profile'
import { changePinIn, freezeIn, setAutonomyIn, setCapsIn, setToolEnabledIn, unfreezeIn } from './safety'
import { checkingAccountId } from './state'
import { addTripwireTo, markSeen, removeTripwireFrom, updateTripwireIn } from './tripwires'
import { errorMessage, safely } from './util'

type UserApi = Omit<
  AppApi,
  | 'getSnapshot' | 'subscribe' | 'isOnboarded' | 'completeOnboarding' | 'loadDemo' | 'resetAll'
  | 'sendMessage' | 'xrayBill' | 'approveAction' | 'rejectAction' | 'undoAction' | 'runSuggestedAction' | 'clearChat'
  | 'checkLlm' | 'isLocked' | 'unlock' | 'enableVault' | 'disableVault' | 'syncClock'
>

/** Longest handoff summary kept in the audit log. */
export const HANDOFF_SUMMARY_MAX = 280

/**
 * "Talk to a human": audited as a user_action (data.type 'handoff') with a short summary whose digit runs are
 * masked and PINs dropped; with `freeze` the kill switch goes on in the same step (audited as kill_switch).
 */
export function handoffIn(draft: AppState, summary: string | undefined, freeze: boolean, ts: string) {
  const text = typeof summary === 'string'
    ? clipForDisplay(summary.replace(/(pin|passcode|password|密码)(\W{0,3}(?:is\W{1,3})?)\d{4,6}\b/gi, '$1$2••••'), HANDOFF_SUMMARY_MAX)
    : ''
  const freezing = freeze && !draft.mandate.frozen
  appendAudit(draft, ts, 'user', 'user_action', 'Asked to talk to a human', {
    type: 'handoff', ...(text ? { summary: text } : {}), freeze: freezing, alreadyFrozen: draft.mandate.frozen,
  })
  if (freezing) freezeIn(draft, ts)
  return { ok: true }
}

/** The data export never contains the PIN hash or salt. */
export function exportableState(state: AppState): AppState {
  const mandate: Mandate = { ...state.mandate }
  delete mandate.pinHash
  delete mandate.pinSalt
  return { ...state, mandate }
}

export function createUserApi(core: Core, onLlmGranted: () => void): UserApi {
  const { store } = core
  const emptyImport = (error: string): ImportSummary => ({ added: 0, skipped: 0, errors: [error] })

  function importCsv(text: string): ImportSummary {
    if (core.lock.locked) return emptyImport(LOCKED_MSG)
    const s = store.get()
    if (!s.profile) return emptyImport(NOT_SET_UP_MSG)
    // rows up to the device's date must count: catch the calendar up first
    syncClock(core)
    try {
      const parsed = parseCsvImport(text, { accountId: checkingAccountId(s.bank), currency: s.profile.currency, userRules: s.categoryRules })
      return store.mutate((draft) => importParsedIn(draft, parsed, core.now()))
    } catch (e) {
      return emptyImport(errorMessage(e))
    }
  }

  function addSpending(candidates: SpendingCandidate[]): { added: number; duplicates: number } {
    const none = { added: 0, duplicates: 0 }
    if (core.lock.locked || !store.get().profile) return none
    if (!Array.isArray(candidates) || candidates.length === 0) return none
    // spend up to the device's date: catch the calendar up first
    syncClock(core)
    const s = store.get()
    const accountId = checkingAccountId(s.bank)
    const currency = s.profile!.currency
    const txns: Transaction[] = candidates.map((c) => ({
      id: c.id,
      accountId,
      date: c.date,
      time: c.time,
      amount: -Math.abs(c.amount),
      currency: c.currency || currency,
      merchant: c.merchant,
      description: c.description,
      category: c.category,
      categorySource: 'import',
      categoryConfidence: 1,
    }))
    return store.mutate((draft) => {
      const { added, duplicates } = mergeTransactions(draft, txns)
      if (added.length) {
        // a purchase the user just logged counts like any other: this month's ones can trip a wire (older ones stay quiet)
        const month = draft.bank.today.slice(0, 7)
        applyTripwires(draft, added.filter((t) => t.date.slice(0, 7) === month), core.now())
        appendAudit(draft, core.now(), 'user', 'data_import', `Added ${added.length} spending${added.length === 1 ? '' : 's'}`, {
          added: added.length, duplicates, source: candidates[0]?.source ?? 'unknown',
        })
      }
      return { added: added.length, duplicates }
    })
  }

  function changePin(oldPin: string, newPin: string) {
    return userTx(core, (draft, _bank, ts) => {
      const r = changePinIn(draft, oldPin, newPin, ts)
      // re-key the vault before this commit is saved, so the blob always opens with the current PIN
      if (r.ok && draft.settings.vault) core.persistence.setVaultPin(newPin)
      return r
    })
  }

  return {
    // ── dreams ──
    addDream: (input) => userTxValue(core, (draft, bank, ts) => addDreamTo(draft, bank, input, ts)),
    updateDream: (id, patch) => userTx(core, (draft, bank, ts) => updateDreamIn(draft, bank, id, patch, ts)),
    removeDream: (id) => userTx(core, (draft, bank, ts) => removeDreamFrom(draft, bank, id, ts)),
    contributeToGoal: (id, amount) => userTx(core, (draft, bank, ts) => contributeIn(draft, bank, id, amount, ts)),
    markDreamAchieved: (id) => userTx(core, (draft, _bank, ts) => markAchievedIn(draft, id, ts)),

    // ── tripwires & budget ──
    addTripwire: (input) => userTxValue(core, (draft, _bank, ts) => addTripwireTo(draft, input, ts)),
    updateTripwire: (id, patch) => userTx(core, (draft, _bank, ts) => updateTripwireIn(draft, id, patch, ts)),
    removeTripwire: (id) => userTx(core, (draft, _bank, ts) => removeTripwireFrom(draft, id, ts)),
    markEventsSeen(ids) {
      const only = ids ? new Set(ids) : null
      const any = store.get().tripwireEvents.some((e) => !e.seen && (!only || only.has(e.id)))
      if (any && !core.lock.locked) safely('markEventsSeen', () => store.mutate((draft) => markSeen(draft, ids)), undefined)
    },
    setCategoryBudget: (category, limit) => userTx(core, (draft, _bank, ts) => setCategoryBudgetIn(draft, category, limit, ts)),
    recategorize: (txnId, category) => userTx(core, (draft, _bank, ts) => recategorizeIn(draft, txnId, category, ts)),

    // ── safety ──
    setAutonomy: (autonomy, pin) => userTx(core, (draft, _bank, ts) => setAutonomyIn(draft, autonomy, pin, ts)),
    setCaps: (caps, pin) => userTx(core, (draft, _bank, ts) => setCapsIn(draft, caps, pin, ts)),
    setToolEnabled: (tool, enabled, pin) => userTx(core, (draft, _bank, ts) => setToolEnabledIn(draft, tool, enabled, pin, ts)),
    freeze() {
      if (core.lock.locked || store.get().mandate.frozen) return
      safely('freeze', () => store.mutate((draft) => freezeIn(draft, core.now())), undefined)
    },
    unfreeze: (pin) => userTx(core, (draft, _bank, ts) => unfreezeIn(draft, pin, ts)),
    requestHumanHandoff: (summary, opts) => userTx(core, (draft, _bank, ts) => handoffIn(draft, summary, opts?.freeze === true, ts)),
    changePin,
    verifyAudit() {
      const log = store.get().audit
      // while the vault is locked the in-memory log is a placeholder — the stored anchor is not about it
      const head = core.lock.locked ? null : safely('auditHead', () => core.persistence.auditHead(), null)
      return safely('verifyAudit', () => verifyAuditAnchored(log, head), { ok: false, count: log.length, reason: 'Audit verification is unavailable' })
    },
    exportData() {
      safely('audit data_export', () => store.mutate((draft) => {
        appendAudit(draft, core.now(), 'user', 'data_export', 'Exported all local data', {
          transactions: draft.bank.transactions.length, auditEntries: draft.audit.length, dreams: draft.dreams.length,
        })
      }), undefined)
      return JSON.stringify(exportableState(store.get()), null, 2)
    },
    exportAuditJSONL: () => auditToJSONL(store.get().audit),

    // ── profile & settings ──
    setProfile: (patch) => userTx(core, (draft, _bank, ts) => setProfileIn(draft, patch, ts)),
    setConsent(patch) {
      if (core.lock.locked || !store.get().profile) return
      const granted = safely('setConsent', () => store.mutate((draft) => setConsentIn(draft, patch, core.now())), false)
      if (granted) onLlmGranted()
    },
    setSettings(patch) {
      if (core.lock.locked) return
      const enabled = safely('setSettings', () => store.mutate((draft) => setSettingsIn(draft, patch, core.now())), false)
      if (enabled) onLlmGranted()
    },

    // ── data ──
    importCsv,
    addSpending,
    transactions: (filter) => filterTransactions(store.get().bank.transactions, filter),

    // ── sandbox / demo controls ──
    simulatePurchase(p) {
      const err = purchaseError(p)
      if (err) throw new Error(err)
      return userTxValue(core, (draft, bank, ts) => simulatePurchaseIn(draft, bank, p, ts))
    },
    advanceDays(n) {
      const out = userTxValue(core, (draft, bank, ts) => advanceDaysIn(draft, bank, n, ts))
      expirePending(core)
      return out
    },
  }
}
