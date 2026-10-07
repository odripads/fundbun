import type { AppApi, Result } from '../app-api'
import { MAX_PIN_ATTEMPTS, PIN_LOCK_MINUTES } from '../security/pin'
import { decryptJSON } from '../security/vault'
import { appendAudit } from './audit'
import { LOCKED_MSG, NOT_SET_UP_MSG, expirePending, type Core } from './core'
import { stepUp } from './safety'
import { parseState } from './state'
import { OK, attempt, fail } from './util'

type VaultApi = Pick<AppApi, 'isLocked' | 'unlock' | 'enableVault' | 'disableVault'>

export function createVaultApi(core: Core, onUnlocked: () => void): VaultApi {
  const { store, persistence, lock } = core

  async function unlock(pin: string): Promise<Result> {
    if (!lock.locked || !lock.blob) return OK
    const nowMs = core.clock().getTime()
    if (lock.lockedUntil > nowMs) {
      const mins = Math.ceil((lock.lockedUntil - nowMs) / 60_000)
      return fail(`Too many wrong PINs. Try again in ${mins} min.`)
    }
    let data: unknown
    try {
      data = await decryptJSON<unknown>(lock.blob, pin)
    } catch {
      lock.failures++
      if (lock.failures >= MAX_PIN_ATTEMPTS) {
        lock.failures = 0
        lock.lockedUntil = nowMs + PIN_LOCK_MINUTES * 60_000
      }
      return fail('Wrong PIN')
    }
    if (!lock.locked) return OK // a concurrent unlock already finished
    const state = parseState(data)
    if (!state) return fail('Your saved data could not be read')
    Object.assign(lock, { locked: false, blob: null, failures: 0, lockedUntil: 0 })
    state.settings.vault = true
    persistence.setVaultPin(pin)
    core.engines.reset()
    appendAudit(state, core.now(), 'user', 'session_start', 'Vault unlocked with PIN', { vault: true })
    store.replace(state)
    expirePending(core)
    onUnlocked()
    return OK
  }

  async function enableVault(pin: string): Promise<Result> {
    if (lock.locked) return fail(LOCKED_MSG)
    const s = store.get()
    if (!s.profile) return fail(NOT_SET_UP_MSG)
    if (s.settings.vault) return OK
    const r = attempt(() => store.mutate((draft) => {
      const ts = core.now()
      const v = stepUp(draft, pin, 'Turn on the vault', ts)
      if (!v.ok) return v
      persistence.setVaultPin(pin)
      draft.settings.vault = true
      appendAudit(draft, ts, 'user', 'user_action', 'Vault on: local data is encrypted with your PIN', { vault: true })
      return OK
    }))
    if (!r.ok) return r
    const saved = await persistence.flush()
    if (saved.ok) return OK
    // never pretend the data is encrypted: roll back to plaintext and say so
    persistence.setVaultPin(null)
    attempt(() => store.mutate((draft) => {
      draft.settings.vault = false
      appendAudit(draft, core.now(), 'system', 'user_action', 'Vault could not be turned on', { error: saved.error })
      return OK
    }))
    return fail(saved.error ?? 'Encryption is not available on this device')
  }

  async function disableVault(pin: string): Promise<Result> {
    if (lock.locked) return fail(LOCKED_MSG)
    if (!store.get().settings.vault) return OK
    const r = attempt(() => store.mutate((draft) => {
      const ts = core.now()
      const v = stepUp(draft, pin, 'Turn off the vault', ts)
      if (!v.ok) return v
      draft.settings.vault = false
      appendAudit(draft, ts, 'user', 'user_action', 'Vault off: local data is stored unencrypted', { vault: false })
      return OK
    }))
    if (r.ok) persistence.setVaultPin(null)
    await persistence.flush()
    return r
  }

  return { isLocked: () => lock.locked, unlock, enableVault, disableVault }
}
