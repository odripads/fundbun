import type { AppApi } from '../app-api'
import { importCsv as parseCsvImport } from '../sandbox/csv'
import { auditToJSONL, verifyAudit } from '../security/audit'
import type { AppState, Mandate } from '../types'
import { appendAudit } from './audit'
import { LOCKED_MSG, NOT_SET_UP_MSG, expirePending, userTx, userTxValue, type Core } from './core'
import {
  advanceDaysIn,
  filterTransactions,
  importParsedIn,
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
  | 'checkLlm' | 'isLocked' | 'unlock' | 'enableVault' | 'disableVault'
>

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
    try {
      const parsed = parseCsvImport(text, { accountId: checkingAccountId(s.bank), currency: s.profile.currency, userRules: s.categoryRules })
      return store.mutate((draft) => importParsedIn(draft, parsed, core.now()))
    } catch (e) {
      return emptyImport(errorMessage(e))
    }
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
    changePin,
    verifyAudit() {
      const log = store.get().audit
      return safely('verifyAudit', () => verifyAudit(log), { ok: false, count: log.length, reason: 'Audit verification is unavailable' })
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
