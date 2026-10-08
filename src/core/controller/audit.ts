import { createAuditEntry, verifyAudit, type AuditVerification } from '../security/audit'
import type { AppState, AuditActor, AuditEntry, AuditType, ISODateTime } from '../types'
import type { AuditHead } from './persistence'

/**
 * Append a hash-chained audit entry to a (draft) state. Mutates `state.audit`.
 * createAuditEntry stores `data` as its canonical-JSON round-trip, so the hash survives save/load.
 */
export function appendAudit(
  state: AppState,
  ts: ISODateTime,
  actor: AuditActor,
  type: AuditType,
  summary: string,
  data: Record<string, unknown> = {},
): void {
  state.audit.push(createAuditEntry(state.audit, { actor, type, summary, data, ts }))
}

/**
 * Verify the chain and, when an anchor was recorded, that the log still reaches the anchored head
 * (verifyAudit's expectedHeadHash on the anchored prefix): deleting the newest entries from storage then
 * fails with brokenAt = the first missing seq. Entries appended after the anchor (not yet saved) are fine.
 */
export function verifyAuditAnchored(log: readonly AuditEntry[], head: AuditHead | null): AuditVerification {
  const full = verifyAudit(log)
  if (!full.ok || !head) return full
  const anchored = verifyAudit(log.slice(0, head.count), { expectedHeadHash: head.hash })
  if (anchored.ok) return full
  // entries appended after the truncation reuse the missing seqs; the boot check recorded where the gap began
  const recorded = [...log].reverse().find((e) => e.type === 'session_start' && e.data.auditIntact === false && typeof e.data.brokenAt === 'number')
  const brokenAt = Math.min(anchored.brokenAt ?? Infinity, (recorded?.data.brokenAt as number | undefined) ?? Infinity)
  return { ...anchored, count: log.length, ...(Number.isFinite(brokenAt) ? { brokenAt } : {}) }
}
